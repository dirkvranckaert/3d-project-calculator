'use strict';

/**
 * `locked_margin_basis` column (task #2290): plain guarded `addCol`, no data
 * rewrite, no marker row. Every row that exists before the column does is a
 * legacy production-basis lock and reads back as 'production'.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

let dbPath;
const originalDbPath = process.env.DB_PATH;

function withFreshDbModule(fn) {
  let result;
  jest.isolateModules(() => {
    process.env.DB_PATH = dbPath;
    const dbModule = require('../db');
    const db = dbModule.getDb();
    try { result = fn(db, dbModule); } finally { db.close(); }
  });
  return result;
}

function raw(fn) {
  const db = new Database(dbPath);
  try { return fn(db); } finally { db.close(); }
}
const seed = (name, lockPct = null) => raw(db => db.prepare(
  'INSERT INTO projects (name, items_per_set, margin_locked, locked_margin_pct) VALUES (?, 1, ?, ?)',
).run(name, lockPct === null ? 0 : 1, lockPct).lastInsertRowid);
const read = id => raw(db => db.prepare('SELECT * FROM projects WHERE id = ?').get(id));

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-lock-basis-')), 'calculator.db');
  withFreshDbModule(() => {});
});

afterEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* not there */ }
  }
  if (originalDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = originalDbPath;
});

describe('locked_margin_basis column', () => {
  test('a row that predates the column is a legacy lock: basis production, pin untouched', () => {
    const id = seed('legacy', 55.5);
    raw(db => db.exec('ALTER TABLE projects DROP COLUMN locked_margin_basis'));
    withFreshDbModule(() => {}); // boot re-adds the column
    const row = read(id);
    expect(row.locked_margin_basis).toBe('production');
    expect(row.locked_margin_pct).toBe(55.5);
    expect(row.margin_locked).toBe(1);
  });

  test('idempotent: booting again neither fails nor touches a stored basis', () => {
    const id = seed('stamped', 40);
    raw(db => db.prepare("UPDATE projects SET locked_margin_basis = 'all-in' WHERE id = ?").run(id));
    expect(() => withFreshDbModule(() => {})).not.toThrow();
    expect(() => withFreshDbModule(() => {})).not.toThrow();
    expect(read(id).locked_margin_basis).toBe('all-in');
    const cols = raw(db => db.prepare('PRAGMA table_info(projects)').all().filter(c => c.name === 'locked_margin_basis'));
    expect(cols).toHaveLength(1);
  });

  test('the migration is a pure column add: no settings marker, no row rewritten', () => {
    const id = seed('untouched', 61.234567890123);
    raw(db => db.exec('ALTER TABLE projects DROP COLUMN locked_margin_basis'));
    withFreshDbModule(() => {});
    expect(read(id).locked_margin_pct).toBe(61.234567890123);
    expect(raw(db => db.prepare("SELECT 1 FROM settings WHERE key = 'locked_margin_all_in'").get())).toBeUndefined();
  });
});
