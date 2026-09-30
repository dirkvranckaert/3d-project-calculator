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

test('pre-existing projects and plates migrate to parts / override off', () => {
  // Rewind to the pre-#2135 schema, with projects of several shapes.
  const raw = new Database(dbPath);
  raw.exec('ALTER TABLE projects DROP COLUMN plate_mode');
  raw.exec('ALTER TABLE project_plates DROP COLUMN charge_share_only');
  raw.prepare('INSERT INTO projects (name, items_per_set, archived) VALUES (?,?,?)').run('a', 91, 0);
  raw.prepare('INSERT INTO projects (name, items_per_set, archived) VALUES (?,?,?)').run('b', 1, 1);
  raw.prepare('INSERT INTO project_plates (project_id, name, items_per_plate) VALUES (1, ?, 38)').run('p');
  raw.close();

  bootDb(); // migrate() runs

  const after = new Database(dbPath);
  const projects = after.prepare('SELECT plate_mode FROM projects').all();
  const plates = after.prepare('SELECT charge_share_only FROM project_plates').all();
  after.close();
  expect(projects).toHaveLength(2);
  expect(projects.every(p => p.plate_mode === 'parts')).toBe(true);
  expect(plates.every(p => p.charge_share_only === 0)).toBe(true);
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
