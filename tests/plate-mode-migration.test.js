'use strict';

/**
 * `projects.plate_mode` + `project_plates.charge_share_only` (#2135).
 * Every existing project must land on 'parts' (never 'batch'); the override
 * starts off. Plain addCol migration, so the DEFAULT is what migrates rows.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

let dbPath;
const originalDbPath = process.env.DB_PATH;

function bootDb() {
  jest.isolateModules(() => {
    process.env.DB_PATH = dbPath;
    require('../db').getDb().close();
  });
}

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-plate-mode-')), 'calculator.db');
  bootDb();
});

afterEach(() => {
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  if (originalDbPath === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = originalDbPath;
});

// Rewind to the pre-#2135 schema. Set 91: plate 38 (not a divisor) + plate 7 (divides);
// set 1: plate of 3 (not a divisor) and a disabled plate of 3; set 100 plate of 4 (divides).
function seedLegacy() {
  const raw = new Database(dbPath);
  raw.exec('ALTER TABLE projects DROP COLUMN plate_mode');
  raw.exec('ALTER TABLE project_plates DROP COLUMN charge_share_only');
  const proj = raw.prepare('INSERT INTO projects (name, items_per_set, archived) VALUES (?,?,?)');
  proj.run('a', 91, 0); proj.run('b', 1, 1); proj.run('c', 100, 0);
  const pl = raw.prepare('INSERT INTO project_plates (project_id, name, items_per_plate, enabled) VALUES (?,?,?,?)');
  pl.run(1, 'a-38', 38, 1); pl.run(1, 'a-7', 7, 1);
  pl.run(2, 'b-3', 3, 1); pl.run(2, 'b-3-disabled', 3, 0); pl.run(2, 'b-1', 1, 1);
  pl.run(3, 'c-4', 4, 1);
  raw.close();
}
const overrides = () => {
  const d = new Database(dbPath);
  const r = Object.fromEntries(d.prepare('SELECT name, charge_share_only AS o FROM project_plates').all().map(x => [x.name, x.o]));
  d.close();
  return r;
};

test('existing projects stay parts; override ON exactly where whole runs would change the cost', () => {
  seedLegacy();
  bootDb(); // migrate() runs

  const after = new Database(dbPath);
  const projects = after.prepare('SELECT plate_mode FROM projects').all();
  after.close();
  expect(projects).toHaveLength(3);
  expect(projects.every(p => p.plate_mode === 'parts')).toBe(true);
  expect(overrides()).toEqual({
    'a-38': 1,            // 91 % 38 != 0
    'a-7': 0,             // 91 % 7 == 0 (13 whole runs = proportional)
    'b-3': 1,             // 1 % 3 != 0
    'b-3-disabled': 1,    // disabled plates included
    'b-1': 0,             // 1 % 1 == 0
    'c-4': 0,             // 100 % 4 == 0
  });
});

test('backfill runs once: a later manual OFF survives every further boot', () => {
  seedLegacy();
  bootDb();
  const d = new Database(dbPath);
  d.prepare("UPDATE project_plates SET charge_share_only = 0 WHERE name = 'a-38'").run();
  d.close();
  bootDb();
  bootDb();
  expect(overrides()['a-38']).toBe(0);
  expect(overrides()['b-3']).toBe(1);
});

test('plates created after the migration default to override OFF (whole runs)', () => {
  seedLegacy();
  bootDb();
  const d = new Database(dbPath);
  d.prepare("INSERT INTO project_plates (project_id, name, items_per_plate) VALUES (1, 'new', 38)").run();
  d.prepare("INSERT INTO projects (name, items_per_set) VALUES ('fresh', 5)").run();
  d.prepare("INSERT INTO project_plates (project_id, name, items_per_plate) VALUES (4, 'fresh-3', 3)").run();
  d.close();
  bootDb();
  expect(overrides().new).toBe(0);
  expect(overrides()['fresh-3']).toBe(0);
});

test('migration is idempotent and never overwrites a chosen mode', () => {
  const raw = new Database(dbPath);
  raw.prepare("INSERT INTO projects (name, items_per_set, plate_mode) VALUES ('x', 1, 'batch')").run();
  raw.close();
  bootDb();
  bootDb();
  const after = new Database(dbPath);
  expect(after.prepare("SELECT plate_mode FROM projects WHERE name='x'").get().plate_mode).toBe('batch');
  after.close();
});

test('a new project defaults to parts', () => {
  const raw = new Database(dbPath);
  raw.prepare("INSERT INTO projects (name) VALUES ('new')").run();
  expect(raw.prepare("SELECT plate_mode FROM projects WHERE name='new'").get().plate_mode).toBe('parts');
  raw.close();
});

/* ---- round 3: atomic backfill + real-quotient predicate ---- */
const calc = require('../calc');

const shareCol = () => {
  const d = new Database(dbPath);
  const has = d.prepare('PRAGMA table_info(project_plates)').all().some(c => c.name === 'charge_share_only');
  d.close();
  return has;
};

test('failed backfill rolls the column back too, so the next boot redoes it (recovery)', () => {
  seedLegacy();
  const d = new Database(dbPath);
  d.exec(`CREATE TRIGGER boom BEFORE UPDATE ON project_plates BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
  d.close();
  expect(() => bootDb()).toThrow(/disk full/);
  expect(shareCol()).toBe(false);          // ALTER rolled back with the UPDATE

  const fix = new Database(dbPath);
  fix.exec('DROP TRIGGER boom');
  fix.close();
  bootDb();                                // column present now, backfill ran
  expect(shareCol()).toBe(true);
  expect(overrides()['a-38']).toBe(1);
  expect(overrides()['b-3']).toBe(1);
  expect(overrides()['a-7']).toBe(0);
});

test('done backfill never runs again: manual OFF survives, later boots do not fire updates', () => {
  seedLegacy();
  bootDb();
  const d = new Database(dbPath);
  d.prepare("UPDATE project_plates SET charge_share_only = 0 WHERE name = 'b-3'").run();
  d.exec(`CREATE TRIGGER boom BEFORE UPDATE ON project_plates BEGIN SELECT RAISE(ABORT, 'must not run'); END`);
  d.close();
  expect(() => bootDb()).not.toThrow();    // an UPDATE attempt would throw
  expect(overrides()['b-3']).toBe(0);
});

// Legacy rows the old SQL `%` got wrong (REAL operands truncated to integers).
test('REAL / 0 / negative legacy values use the real quotient, not SQL %', () => {
  const raw = new Database(dbPath);
  raw.exec('ALTER TABLE projects DROP COLUMN plate_mode');
  raw.exec('ALTER TABLE project_plates DROP COLUMN charge_share_only');
  const proj = raw.prepare('INSERT INTO projects (name, items_per_set) VALUES (?,?)');
  const pl = raw.prepare('INSERT INTO project_plates (project_id, name, items_per_plate) VALUES (?,?,?)');
  proj.run('real-set', 3.5); pl.run(1, 'set3.5-ipp3', 3);            // % says 0; quotient 1.1667
  proj.run('real-ipp', 6);   pl.run(2, 'set6-ipp2.5', 2.5);          // % says 0; quotient 2.4
  proj.run('exact', 3.5);    pl.run(3, 'set3.5-ipp0.5', 0.5);        // quotient 7 exactly -> off
  proj.run('zero', 3);       pl.run(4, 'ipp0', 0);                   // runtime treats 0 as 1 -> off
  proj.run('zero-set', 0);   pl.run(5, 'set0-ipp2', 2);              // runtime treats set 0 as 1 -> 1/2 -> on
  proj.run('neg', 91);       pl.run(6, 'ipp-38', -38);               // not integral -> on
  proj.run('neg-exact', 90); pl.run(7, 'ipp-3', -3);                 // -30 exactly -> off
  raw.close();
  bootDb();
  expect(overrides()).toEqual({
    'set3.5-ipp3': 1, 'set6-ipp2.5': 1, 'set3.5-ipp0.5': 0, 'ipp0': 0, 'set0-ipp2': 1, 'ipp-38': 1, 'ipp-3': 0,
  });
});

test('runtime run count and migration predicate agree over the same value grid (REAL, 0, NULL, negative)', () => {
  const sets = [1, 2, 3, 3.5, 6, 7, 40, 45, 90, 91, 100, 0, null, -3, 0.3, 2.5];
  const ipps = [1, 2, 3, 3.5, 2.5, 0.5, 0.1, 7, 38, 0, null, -3, -38, 100];
  for (const set of sets) {
    for (const ipp of ipps) {
      const whole = calc.resolvePlateCount({ items_per_plate: ipp }, set, 'parts');
      const share = calc.resolvePlateCount({ items_per_plate: ipp, charge_share_only: 1 }, set, 'parts');
      // Override needed exactly when whole runs charge something other than the share.
      expect(calc.wholeRunsDifferFromShare(set, ipp)).toBe(whole.factor !== share.factor);
    }
  }
});

test('DB backfill result equals the runtime rule for every insertable grid pair', () => {
  const sets = [1, 3, 3.5, 6, 45, 91, 100, 0, -3, 0.3, 2.5];
  const ipps = [1, 3, 2.5, 0.5, 0.1, 7, 38, 0, -3, -38];
  const raw = new Database(dbPath);
  raw.exec('ALTER TABLE projects DROP COLUMN plate_mode');
  raw.exec('ALTER TABLE project_plates DROP COLUMN charge_share_only');
  const proj = raw.prepare('INSERT INTO projects (name, items_per_set) VALUES (?,?)');
  const pl = raw.prepare('INSERT INTO project_plates (project_id, name, items_per_plate) VALUES (?,?,?)');
  const expected = {};
  for (const set of sets) {
    const pid = proj.run(`s${set}`, set).lastInsertRowid;
    for (const ipp of ipps) {
      const name = `${set}/${ipp}`;
      pl.run(pid, name, ipp);
      const whole = calc.resolvePlateCount({ items_per_plate: ipp }, set, 'parts');
      const share = calc.resolvePlateCount({ items_per_plate: ipp, charge_share_only: 1 }, set, 'parts');
      expected[name] = whole.factor !== share.factor ? 1 : 0;
    }
  }
  raw.close();
  bootDb();
  expect(overrides()).toEqual(expected);
});
