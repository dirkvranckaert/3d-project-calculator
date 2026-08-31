'use strict';

/**
 * `design_invoiced_separately` column migration (2026-08-31).
 *
 * Plain `addCol` migration (see db.js `migrate()`), not a one-shot data
 * transform — no marker row, nothing to convert. Default false: design is
 * absorbed into the unit price, Dirk's normal case.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

let dbPath;
// Test files share one process under --runInBand, so put DB_PATH back as we
// found it rather than deleting it out from under a neighbouring suite.
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

/** Rewind a bootstrapped DB to how it looked before this column existed. */
function dropDesignInvoicedSeparatelyColumn() {
  const raw = new Database(dbPath);
  raw.exec('ALTER TABLE projects DROP COLUMN design_invoiced_separately');
  raw.close();
}

/** Seed a project row directly, bypassing the app (as production data would look). */
function seedProject(name) {
  const raw = new Database(dbPath);
  const r = raw.prepare('INSERT INTO projects (name, items_per_set) VALUES (?, 1)').run(name);
  raw.close();
  return r.lastInsertRowid;
}

function readProject(id) {
  const raw = new Database(dbPath);
  const row = raw.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  raw.close();
  return row;
}

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-design-invoiced-')), 'calculator.db');
  withFreshDbModule(() => {}); // bootstrap a schema to work against
});

afterEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* not there */ }
  }
  if (originalDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = originalDbPath;
});

describe('design_invoiced_separately migration', () => {
  test('a fresh DB gets the column with default 0', () => {
    const id = seedProject('Fresh');
    expect(readProject(id).design_invoiced_separately).toBe(0);
  });

  test('a pre-existing row from before this migration gets backfilled to 0', () => {
    dropDesignInvoicedSeparatelyColumn();
    const id = seedProject('Pre-existing');

    withFreshDbModule(() => {}); // re-adds the missing column

    expect(readProject(id).design_invoiced_separately).toBe(0);
  });

  test('is idempotent — running it again does not touch an already-set value', () => {
    const id = seedProject('Already set');
    const raw = new Database(dbPath);
    raw.prepare('UPDATE projects SET design_invoiced_separately = 1 WHERE id = ?').run(id);
    raw.close();

    withFreshDbModule(() => {}); // column already present — addCol is a no-op

    expect(readProject(id).design_invoiced_separately).toBe(1);
  });
});
