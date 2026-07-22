'use strict';

/**
 * One-shot migration of the margin basis from incl-VAT to ex-VAT (2026-07-22).
 *
 * The feature was already live, so existing rows carry `target_margin_pct` on
 * the old inclusive basis. Converting by (1 + vat) is what keeps a pinned
 * project's price exactly where it is.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const calc = require('../calc');

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

/** Rewind a bootstrapped DB to how it looked before this migration existed. */
/**
 * Put the DB back to how it looked BEFORE both margin migrations.
 *
 * `beforeEach` boots the app once to get a schema, which runs every migration —
 * including the per-project-target one, which renames the threshold keys and
 * stamps its marker. So rewinding only the ex-VAT marker is not enough: the old
 * keys no longer exist, the `UPDATE`s below would hit zero rows, and a test
 * would then pass against values nothing had actually rewound. Both markers go,
 * and the old key pair is written back explicitly.
 */
function rewindToOldBasis(vatRate = 21) {
  const raw = new Database(dbPath);
  raw.prepare("DELETE FROM settings WHERE key = 'margin_basis_ex_vat'").run();
  raw.prepare("DELETE FROM settings WHERE key = 'target_margin_per_project'").run();
  raw.prepare("UPDATE settings SET value = ? WHERE key = 'vat_rate'").run(String(vatRate));
  raw.prepare("DELETE FROM settings WHERE key IN ('default_target_margin_pct', 'lowest_target_margin_pct')").run();
  raw.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('margin_green_pct', '30')").run();
  raw.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('margin_orange_pct', '5')").run();
  raw.close();
}

function seedProject(name, targetMarginPct) {
  const raw = new Database(dbPath);
  const r = raw.prepare(
    'INSERT INTO projects (name, items_per_set, margin_locked, target_margin_pct) VALUES (?, 1, 1, ?)'
  ).run(name, targetMarginPct);
  raw.close();
  return r.lastInsertRowid;
}

function readProject(id) {
  const raw = new Database(dbPath);
  const row = raw.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  raw.close();
  return row;
}

function readSetting(key) {
  const raw = new Database(dbPath);
  const row = raw.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  raw.close();
  return row ? row.value : null;
}

beforeEach(() => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pc-margin-')), 'calculator.db');
  withFreshDbModule(() => {}); // bootstrap a schema to work against
});

afterEach(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(dbPath + suffix); } catch { /* not there */ }
  }
  if (originalDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = originalDbPath;
});

describe('margin basis migration (incl-VAT -> ex-VAT)', () => {
  test('converts a stored pin by (1 + vat) so the price does not move', () => {
    rewindToOldBasis(21);
    const id = seedProject('Pinned 50', 50);

    withFreshDbModule(() => {});

    expect(readProject(id).target_margin_pct).toBeCloseTo(60.5, 6);

    // The whole point: same production cost, same price before and after.
    // Compared before the price ending, which no longer applies to a locked
    // actual sales price at all (Dirk 2026-07-22) — the migration is about the
    // basis conversion, not about how the result is rounded.
    const oldPrice = 100 / ((1 / 1.21) - 0.5);
    const newPrice = calc.calculateLockedPrice(100, 60.5, 21).price;
    expect(newPrice).toBeCloseTo(oldPrice, 2);
  });

  test('uses the vat_rate setting rather than a hardcoded 21', () => {
    rewindToOldBasis(6);
    const id = seedProject('Pinned 50 at 6% VAT', 50);

    withFreshDbModule(() => {});

    expect(readProject(id).target_margin_pct).toBeCloseTo(53, 6);
  });

  test('clamps a converted value that would exceed the 95% cap', () => {
    rewindToOldBasis(21);
    const id = seedProject('Pinned 80', 80); // 80 * 1.21 = 96.8

    withFreshDbModule(() => {});

    // Strictly below the cap, never equal to it: the cap is an exclusive bound.
    expect(readProject(id).target_margin_pct).toBeLessThan(calc.maxReachableMarginPct());
    expect(readProject(id).target_margin_pct).toBe(94.99);
  });

  // A migration must never write a value the app's own validators reject.
  // Clamping to exactly 95 did: `calculateLockedPrice` and the margin-lock route
  // both reject `target >= maxPct`, so the whole clamped band landed on locks
  // that could not produce a price at all.
  test.each([78.51, 78.6, 80, 82.6])(
    'an old pin of %s%% migrates to a lock that still prices',
    (oldPin) => {
      rewindToOldBasis(21);
      const id = seedProject(`Pinned ${oldPin}`, oldPin);

      withFreshDbModule(() => {});

      const migrated = readProject(id).target_margin_pct;
      expect(migrated).toBeLessThan(95);

      const lock = calc.calculateLockedPrice(100, migrated, 21);
      expect(lock.reason).toBeNull();
      expect(lock.price).toBeGreaterThan(0);
    }
  );

  test('the whole legal old-basis range survives migration priceable', () => {
    // Everything below the old 82.64% ceiling was a legal pin, so nothing in
    // that range may migrate into an unpriceable lock.
    for (let oldPin = 1; oldPin < 82.64; oldPin += 0.5) {
      const migrated = Math.min(oldPin * 1.21, 95 - 0.01);
      const lock = calc.calculateLockedPrice(100, migrated, 21);
      expect(lock.reason).toBeNull();
      expect(lock.price).toBeGreaterThan(0);
    }
  });

  test('does not invent a pin for a project that had none', () => {
    rewindToOldBasis(21);
    const id = seedProject('Unpinned', null);

    withFreshDbModule(() => {});

    // The ex-VAT conversion itself only multiplies existing pins — it must not
    // manufacture one. The value seen here is 40 because the per-project-target
    // migration backfills the default in the same boot (see its own tests);
    // what matters for THIS migration is that it is not 60.5, i.e. nothing was
    // converted. Asserting NULL stopped being possible once every project
    // started carrying its own target.
    expect(readProject(id).target_margin_pct).toBe(40);
  });

  test('sets the colour thresholds to the ex-VAT 40 / 25', () => {
    rewindToOldBasis(21);

    withFreshDbModule(() => {});

    // The ex-VAT migration writes margin_green_pct/margin_orange_pct; the
    // per-project-target migration then renames them in the same boot, so the
    // values land under the new keys and the old ones are gone.
    expect(readSetting('default_target_margin_pct')).toBe('40');
    expect(readSetting('lowest_target_margin_pct')).toBe('25');
    expect(readSetting('margin_green_pct')).toBeNull();
    expect(readSetting('margin_orange_pct')).toBeNull();
  });

  test('runs exactly once — a second boot does not convert again', () => {
    rewindToOldBasis(21);
    const id = seedProject('Pinned 50', 50);

    withFreshDbModule(() => {});
    withFreshDbModule(() => {});
    withFreshDbModule(() => {});

    // 50 -> 60.5, not 60.5 -> 73.2 -> 88.6.
    expect(readProject(id).target_margin_pct).toBeCloseTo(60.5, 6);
  });

  test('a threshold Dirk edits afterwards is not stomped on the next boot', () => {
    rewindToOldBasis(21);
    withFreshDbModule(() => {});

    const raw = new Database(dbPath);
    raw.prepare("UPDATE settings SET value = '55' WHERE key = 'default_target_margin_pct'").run();
    raw.close();

    withFreshDbModule(() => {});

    expect(readSetting('default_target_margin_pct')).toBe('55');
  });

  test('a fresh DB is seeded on the new basis and marked as migrated', () => {
    // beforeEach already bootstrapped a brand-new DB.
    expect(readSetting('margin_basis_ex_vat')).toBe('1');
    expect(readSetting('default_target_margin_pct')).toBe('40');
    expect(readSetting('lowest_target_margin_pct')).toBe('25');
  });
});

describe('per-project target margin migration (#732)', () => {
  test('renames the settings pair and removes the old keys', () => {
    rewindToOldBasis(21);
    withFreshDbModule(() => {});

    expect(readSetting('default_target_margin_pct')).toBe('40');
    expect(readSetting('lowest_target_margin_pct')).toBe('25');
    // Removed, not merely unread — a leftover key nothing consults is the trap
    // this rename exists to close.
    expect(readSetting('margin_green_pct')).toBeNull();
    expect(readSetting('margin_orange_pct')).toBeNull();
    expect(readSetting('target_margin_per_project')).toBe('1');
  });

  test('backfills every project without a target, so the default stops mattering', () => {
    rewindToOldBasis(21);
    const unpinned = seedProject('No pin', null);
    const pinned = seedProject('Pinned 50', 50);

    withFreshDbModule(() => {});

    // The unpinned project now owns a stored 40 rather than deferring to the
    // settings default — editing that default later must not move its price.
    expect(readProject(unpinned).target_margin_pct).toBe(40);
    // An existing pin is a real decision and is left alone (converted by the
    // ex-VAT migration, not overwritten by the backfill).
    expect(readProject(pinned).target_margin_pct).toBeCloseTo(60.5, 6);
  });

  test('the marker guard is what stops a re-run, not luck', () => {
    // The test below is idempotent for the wrong reason: once no NULL rows
    // remain, the backfill is a no-op whether or not the guard exists. This one
    // re-creates the precondition the backfill acts on — a NULL target — and
    // bumps the default. With the guard, the migration is skipped and the NULL
    // stands. Without it, the row is re-stamped with the new default.
    rewindToOldBasis(21);
    const id = seedProject('No pin', null);

    withFreshDbModule(() => {});
    expect(readProject(id).target_margin_pct).toBe(40);

    const raw = new Database(dbPath);
    raw.prepare('UPDATE projects SET target_margin_pct = NULL WHERE id = ?').run(id);
    raw.prepare("UPDATE settings SET value = '77' WHERE key = 'default_target_margin_pct'").run();
    raw.close();

    withFreshDbModule(() => {});

    // Verified to fail (receives 77) when `if (done) return;` is removed.
    expect(readProject(id).target_margin_pct).toBeNull();
  });

  test('runs exactly once — repeated boots do not re-stamp targets', () => {
    rewindToOldBasis(21);
    const id = seedProject('No pin', null);

    withFreshDbModule(() => {});

    const raw = new Database(dbPath);
    raw.prepare('UPDATE projects SET target_margin_pct = 72 WHERE id = ?').run(id);
    raw.prepare("UPDATE settings SET value = '55' WHERE key = 'default_target_margin_pct'").run();
    raw.close();

    withFreshDbModule(() => {});
    withFreshDbModule(() => {});

    // Neither the project's own edit nor the default edit is stomped.
    expect(readProject(id).target_margin_pct).toBe(72);
    expect(readSetting('default_target_margin_pct')).toBe('55');
  });
});
