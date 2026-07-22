'use strict';

/**
 * One-shot split of the margin lock's own pin off `target_margin_pct` into
 * `locked_margin_pct` (task #736, 2026-07-22).
 *
 * Root cause: #726 introduced the lock using `target_margin_pct` as its pin.
 * #732 repurposed that same column as the project's own target but never
 * split the lock's write path off it, so locking silently overwrote the
 * target from then on.
 *
 * Dirk confirmed production carries exactly ONE locked project as of
 * 2026-07-22 — he had never locked a margin before that day. The migration is
 * written to that fact: it moves exactly one row and refuses (loudly) to
 * touch anything if more than one `margin_locked` row turns up.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const calc = require('../calc');

let dbPath;
const originalDbPath = process.env.DB_PATH;

/** Boot db.js against `dbPath` in a fresh module registry, run it, close it. */
function withFreshDbModule(fn) {
  let result;
  jest.isolateModules(() => {
    process.env.DB_PATH = dbPath;
    const dbModule = require('../db');
    const db = dbModule.getDb();
    try {
      result = fn(db, dbModule);
    } finally {
      db.close();
    }
  });
  return result;
}

/**
 * Boot db.js against `dbPath` expecting `getDb()` to throw. `_db` in db.js is
 * assigned before bootstrap runs, so a second `getDb()` call in the SAME
 * isolated module registry short-circuits past the throwing migration and
 * hands back the (already-open) connection to close cleanly.
 */
function withFreshDbModuleExpectingThrow() {
  let thrown = null;
  jest.isolateModules(() => {
    process.env.DB_PATH = dbPath;
    const dbModule = require('../db');
    let db;
    try {
      db = dbModule.getDb();
    } catch (err) {
      thrown = err;
      db = dbModule.getDb();
    }
    db.close();
  });
  return thrown;
}

/** Rewind to how a DB looked BEFORE this migration ran: delete its marker. */
function rewindLockedMarginSplit() {
  const raw = new Database(dbPath);
  raw.prepare("DELETE FROM settings WHERE key = 'locked_margin_pct_split'").run();
  raw.close();
}

/** Seed a project row directly, bypassing the app (as production data would look). */
function seedProject({ name, marginLocked, targetMarginPct, lockedMarginPct = null, productionCostHint = 100 }) {
  const raw = new Database(dbPath);
  // A plate gives the project a real, non-zero production cost so the price
  // comparison below is meaningful. Sized so productionCost lands near
  // `productionCostHint` at the default material/printer profile used in tests.
  const r = raw.prepare(
    `INSERT INTO projects (name, items_per_set, margin_locked, target_margin_pct, locked_margin_pct)
     VALUES (?, 1, ?, ?, ?)`
  ).run(name, marginLocked ? 1 : 0, targetMarginPct, lockedMarginPct);
  const projectId = r.lastInsertRowid;
  raw.prepare(
    `INSERT INTO project_plates (project_id, name, print_time_minutes, plastic_grams, items_per_plate)
     VALUES (?, 'Plate 1', 60, 100, 1)`
  ).run(projectId);
  raw.close();
  return projectId;
}

function readProject(id) {
  const raw = new Database(dbPath);
  const row = raw.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  raw.close();
  return row;
}

function readAllLocked() {
  const raw = new Database(dbPath);
  const rows = raw.prepare('SELECT * FROM projects WHERE margin_locked = 1 ORDER BY id').all();
  raw.close();
  return rows;
}

function readSetting(key) {
  const raw = new Database(dbPath);
  const row = raw.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  raw.close();
  return row ? row.value : null;
}

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-locked-margin-')), 'calculator.db');
  withFreshDbModule(() => {}); // bootstrap a schema (and let this migration run its normal no-op path)
});

afterEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* not there */ }
  }
  if (originalDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = originalDbPath;
});

describe('locked_margin_pct split migration', () => {
  test('a fresh DB with no locked project needs no migration and stamps the marker', () => {
    // beforeEach already ran the migration once against an empty DB.
    expect(readSetting('locked_margin_pct_split')).toBe('1');
  });

  test('the exactly-one-row production case: lock pct survives, target resets, price is unchanged', () => {
    rewindLockedMarginSplit();
    // Mirrors the confirmed production row: project 29, locked at 63%, target
    // overwritten from 60 to 63 by the #736 bug.
    const id = seedProject({ name: 'Shipping Container w/ lid - ARGT', marginLocked: true, targetMarginPct: 63 });

    withFreshDbModule(() => {});

    const row = readProject(id);
    expect(row.margin_locked).toBe(1);
    expect(row.locked_margin_pct).toBe(63);
    // The overwritten 60 cannot be recovered; it resets to the seeded default.
    expect(row.target_margin_pct).toBe(40);
    expect(readSetting('locked_margin_pct_split')).toBe('1');

    // The price a customer is actually charged must not move as a side effect
    // of the migration: same production cost, same VAT, same pct in -> same
    // price out, whether read from the old shared column or the new one.
    const cost = 100; // matches the fixture plate's production cost
    const beforeMigrationPrice = calc.calculateLockedPrice(cost, 63, 21).price;
    const afterMigrationPrice = calc.calculateLockedPrice(cost, row.locked_margin_pct, 21).price;
    expect(afterMigrationPrice).toBe(beforeMigrationPrice);
  });

  test('is idempotent — running it again does not move data a second time', () => {
    rewindLockedMarginSplit();
    const id = seedProject({ name: 'Once', marginLocked: true, targetMarginPct: 60 });
    withFreshDbModule(() => {});
    const once = readProject(id);

    // No rewind this time — the marker is set, so a second boot must no-op.
    withFreshDbModule(() => {});
    const twice = readProject(id);

    expect(twice.locked_margin_pct).toBe(once.locked_margin_pct);
    expect(twice.target_margin_pct).toBe(once.target_margin_pct);
  });

  test('more than one locked project aborts the migration and writes nothing', () => {
    rewindLockedMarginSplit();
    const a = seedProject({ name: 'Locked A', marginLocked: true, targetMarginPct: 60 });
    const b = seedProject({ name: 'Locked B', marginLocked: true, targetMarginPct: 70 });

    const err = withFreshDbModuleExpectingThrow();
    expect(err).toBeTruthy();
    expect(err.message).toMatch(/expected at most 1 locked project/i);

    // Nothing was written: no marker, both rows exactly as seeded.
    expect(readSetting('locked_margin_pct_split')).toBeNull();
    const rowA = readProject(a);
    const rowB = readProject(b);
    expect(rowA.locked_margin_pct).toBeNull();
    expect(rowA.target_margin_pct).toBe(60);
    expect(rowB.locked_margin_pct).toBeNull();
    expect(rowB.target_margin_pct).toBe(70);
    expect(readAllLocked()).toHaveLength(2);
  });

  test('does not touch an unlocked project even with a target set', () => {
    rewindLockedMarginSplit();
    const id = seedProject({ name: 'Never locked', marginLocked: false, targetMarginPct: 55 });

    withFreshDbModule(() => {});

    const row = readProject(id);
    expect(row.locked_margin_pct).toBeNull();
    expect(row.target_margin_pct).toBe(55); // untouched — only margin_locked=1 rows move
  });
});
