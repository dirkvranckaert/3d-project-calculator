'use strict';

/**
 * Actual Sales Price on the ALL-IN basis, server side (task #2290, Dirk
 * 2026-10-06): price-impact endpoint basis, and the one-shot price-stable
 * conversion of existing locks (`migrate-lock-all-in.js`).
 */

const request = require('supertest');
const http = require('http');
const path = require('path');
const fs = require('fs');

const testDbPath = path.join(__dirname, '..', 'data', 'test-actual-all-in.db');
process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'testadmin';
process.env.ADMIN_PASS = 'testpass';
process.env.DB_PATH = testDbPath;
fs.mkdirSync(path.dirname(testDbPath), { recursive: true });
for (const p of [testDbPath, testDbPath + '-wal', testDbPath + '-shm']) fs.rmSync(p, { force: true });

const { app: expressApp, getDb, enrichProject, lockMigration } = require('../server');
const { migrateLockedMarginAllIn } = require('../migrate-lock-all-in');
const calc = require('../calc');

const app = http.createServer(expressApp).listen(0);
afterAll(() => new Promise((resolve) => app.close(resolve)));

let cookie;
let materialId;
let printerId;

async function api(method, url, body) {
  const r = request(app)[method](url).set('Cookie', cookie);
  return body ? r.send(body) : r;
}

/** Project with one plate; `design` > 0 makes it a custom project with design. */
async function makeProject(name, { design = 0, separately = false, actual = null } = {}) {
  const pr = await api('post', '/api/projects', { name, items_per_set: 1 });
  const id = pr.body.id;
  await api('post', `/api/projects/${id}/plates`, {
    name: 'p', print_time_minutes: 300, plastic_grams: 200, items_per_plate: 1,
    risk_multiplier: 1, pre_processing_minutes: 0, post_processing_minutes: 2,
    printer_id: printerId, material_id: materialId, material_waste_grams: 1,
  });
  const db = getDb();
  if (design > 0) {
    db.prepare('UPDATE projects SET is_custom = 1, design_invoiced_separately = ? WHERE id = ?').run(separately ? 1 : 0, id);
    db.prepare("INSERT INTO project_design_extras (project_id, description, amount) VALUES (?, 'design', ?)").run(id, design);
  }
  if (actual !== null) db.prepare('UPDATE projects SET actual_sales_price = ? WHERE id = ?').run(actual, id);
  return id;
}
const enrich = id => enrichProject(getDb(), getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id));

beforeAll(async () => {
  const login = await request(app).post('/login').send({ username: 'testadmin', password: 'testpass' });
  cookie = login.headers['set-cookie'][0].split(';')[0];
  printerId = (await api('get', '/api/printers')).body[0].id;
  materialId = (await api('get', '/api/materials')).body[0].id;
});

describe('actual price on the all-in basis (server)', () => {
  test.each([false, true])('actual = suggested -> identical profit/margin/indicator (separately=%s)', async (sep) => {
    const id = await makeProject(`same-${sep}`, { design: 40, separately: sep });
    const sug = enrich(id).calculation;
    getDb().prepare('UPDATE projects SET actual_sales_price = ? WHERE id = ?').run(sug.pricing.suggestedPrice, id);
    const c = enrich(id).calculation;
    expect(c.actualMargin.basis).toBe('all-in');
    expect(c.actualMargin.profitAmount).toBeCloseTo(sug.pricing.suggestedProfitAmount, 10);
    expect(c.actualMargin.marginPct).toBeCloseTo(sug.pricing.suggestedMarginPct, 10);
    expect(c.actualIndicator).toBe(sug.suggestedIndicator);
  });

  test('D = 0: actualMargin is the untouched 3-field production reading', async () => {
    const id = await makeProject('plain', { actual: 20 });
    const c = enrich(id).calculation;
    expect(Object.keys(c.actualMargin).sort()).toEqual(['actualExclVat', 'marginPct', 'profitAmount']);
    expect(c.actualMargin.marginPct).toBeCloseTo(
      ((20 / 1.21 - c.pricing.productionCost) / (20 / 1.21)) * 100, 10);
  });

  test('price-impact reports ONE basis: actual = suggested gives the same margin as no actual', async () => {
    const id = await makeProject('impact', { design: 40 });
    const before = await api('post', `/api/materials/${materialId}/price-impact`, { new_price_per_kg: 99 });
    const noActual = before.body.impacts.find(i => i.projectId === id);
    getDb().prepare('UPDATE projects SET actual_sales_price = ? WHERE id = ?')
      .run(enrich(id).calculation.pricing.suggestedPrice, id);
    const after = await api('post', `/api/materials/${materialId}/price-impact`, { new_price_per_kg: 99 });
    const withActual = after.body.impacts.find(i => i.projectId === id);
    expect(withActual.current.marginPct).toBeCloseTo(noActual.current.marginPct, 10);
    // all-in, so far below the ~70% production-only reading
    expect(withActual.current.marginPct).toBeLessThan(60);
  });
});

describe('lock migration (price-stable, #2290)', () => {
  const resetMarker = () => getDb().prepare("DELETE FROM settings WHERE key = 'locked_margin_all_in'").run();

  test.each([false, true])('locked D>0 keeps its price; pct becomes the all-in margin (separately=%s)', async (sep) => {
    const id = await makeProject(`lock-${sep}`, { design: 40, separately: sep });
    const production = enrich(id).calculation.pricing.productionCost;
    const oldPrice = calc.calculateLockedPrice(production, 60, 21).price;
    getDb().prepare('UPDATE projects SET margin_locked = 1, locked_margin_pct = 60 WHERE id = ?').run(id);
    resetMarker();
    const res = migrateLockedMarginAllIn(getDb(), enrichProject, calc);
    expect(res.migrated).toContain(id);
    const c = enrich(id).calculation;
    expect(c.effectiveSalesPrice).toBe(oldPrice);
    expect(c.marginLock.basis).toBe('all-in');
    expect(c.actualMargin.marginPct).toBeCloseTo(c.marginLock.targetPct, 6);
    // full precision stored, not 2-decimal text
    const stored = getDb().prepare('SELECT locked_margin_pct FROM projects WHERE id = ?').get(id).locked_margin_pct;
    expect(stored).not.toBe(60);
  });

  test('locked D=0 and unlocked rows are untouched; second run is a no-op', async () => {
    const plain = await makeProject('lock-plain');
    const unlocked = await makeProject('unlocked-design', { design: 40 });
    getDb().prepare('UPDATE projects SET margin_locked = 1, locked_margin_pct = 55 WHERE id = ?').run(plain);
    getDb().prepare('UPDATE projects SET margin_locked = 0, locked_margin_pct = 55 WHERE id = ?').run(unlocked);
    resetMarker();
    const res = migrateLockedMarginAllIn(getDb(), enrichProject, calc);
    expect(res.migrated).not.toContain(plain);
    expect(res.migrated).not.toContain(unlocked);
    const pct = id => getDb().prepare('SELECT locked_margin_pct FROM projects WHERE id = ?').get(id).locked_margin_pct;
    expect(pct(plain)).toBe(55);
    expect(pct(unlocked)).toBe(55);
    expect(migrateLockedMarginAllIn(getDb(), enrichProject, calc).alreadyDone).toBe(true);
  });

  const lockedRow = async (name) => {
    const id = await makeProject(name, { design: 40 });
    getDb().prepare('UPDATE projects SET margin_locked = 1, locked_margin_pct = 60 WHERE id = ?').run(id);
    return id;
  };
  const storedPct = id => getDb().prepare('SELECT locked_margin_pct FROM projects WHERE id = ?').get(id).locked_margin_pct;

  test('marker check + select + updates + marker write are one write-locked transaction (R1 #1)', async () => {
    const Database = require('better-sqlite3');
    const id = await lockedRow('atomic');
    resetMarker();
    const other = new Database(testDbPath, { timeout: 0 });
    let lockedDuring = null;
    let otherResult = null;
    const enrichSpy = (db, row) => {
      if (lockedDuring === null) {
        // A concurrent starter cannot even begin its own transaction while A holds the write lock.
        try {
          otherResult = migrateLockedMarginAllIn(other, enrichProject, calc);
          lockedDuring = false;
        } catch (e) { lockedDuring = /locked|busy/i.test(e.message); }
      }
      return enrichProject(db, row);
    };
    const a = migrateLockedMarginAllIn(getDb(), enrichSpy, calc);
    expect(a.migrated).toContain(id);
    expect(lockedDuring).toBe(true);
    const afterA = storedPct(id);
    // B starts after A committed: sees the marker INSIDE its transaction, converts nothing.
    const b = migrateLockedMarginAllIn(other, enrichProject, calc);
    other.close();
    expect(b.alreadyDone).toBe(true);
    expect(b.migrated).toEqual([]);
    expect(storedPct(id)).toBe(afterA);
  });

  test('a stale pre-transaction marker read cannot double-convert (marker rechecked inside)', async () => {
    const id = await lockedRow('stale');
    resetMarker();
    migrateLockedMarginAllIn(getDb(), enrichProject, calc);
    const once = storedPct(id);
    // second starter that "read no marker earlier": it only ever reads inside the transaction
    expect(migrateLockedMarginAllIn(getDb(), enrichProject, calc).alreadyDone).toBe(true);
    expect(storedPct(id)).toBe(once);
  });

  test('request in the listen->migration window migrates first; locked D>0 price is the stable one (R1 #2)', async () => {
    const id = await lockedRow('window');
    const production = enrich(id).calculation.pricing.productionCost;
    const oldPrice = calc.calculateLockedPrice(production, 60, 21).price;
    resetMarker();
    lockMigration.setPending(true);
    const res = await api('get', `/api/projects/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.calculation.effectiveSalesPrice).toBe(oldPrice);
    expect(res.body.calculation.marginLock.basis).toBe('all-in');
    expect(getDb().prepare("SELECT 1 FROM settings WHERE key = 'locked_margin_all_in'").get()).toBeTruthy();
    lockMigration.run(); // pending already consumed: no second run
  });

  test('migration failure is logged, never thrown (server keeps serving)', async () => {
    await lockedRow('failing');
    resetMarker();
    getDb().exec("CREATE TRIGGER boom BEFORE INSERT ON settings WHEN NEW.key = 'locked_margin_all_in' BEGIN SELECT RAISE(ABORT, 'boom'); END");
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      lockMigration.setPending(true);
      expect(() => lockMigration.run()).not.toThrow();
      expect(spy).toHaveBeenCalled();
      expect(getDb().prepare("SELECT 1 FROM settings WHERE key = 'locked_margin_all_in'").get()).toBeUndefined();
      // failed transaction rolled back: nothing half-converted, retry works
      getDb().exec('DROP TRIGGER boom');
      expect(migrateLockedMarginAllIn(getDb(), enrichProject, calc).alreadyDone).toBe(false);
    } finally {
      spy.mockRestore();
      getDb().exec('DROP TRIGGER IF EXISTS boom');
    }
  });
});

describe('server boot: binds before the migration, survives its failure (R1 #2)', () => {
  test('listens even when the migration cannot complete', async () => {
    const { spawn } = require('child_process');
    const id = await makeProject('boot', { design: 40 });
    getDb().prepare('UPDATE projects SET margin_locked = 1, locked_margin_pct = 60 WHERE id = ?').run(id);
    getDb().prepare("DELETE FROM settings WHERE key = 'locked_margin_all_in'").run();
    getDb().exec("CREATE TRIGGER boom2 BEFORE INSERT ON settings WHEN NEW.key = 'locked_margin_all_in' BEGIN SELECT RAISE(ABORT, 'boom'); END");
    const port = 3500 + Math.floor(Math.random() * 400);
    const child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'production', PORT: String(port), DB_PATH: testDbPath },
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    try {
      const deadline = Date.now() + 15000;
      while (!/migration failed/.test(out) && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
      expect(out).toMatch(/Project Calculator running/);
      expect(out).toMatch(/migration failed/);
      expect(out.indexOf('Project Calculator running')).toBeLessThan(out.indexOf('migration failed'));
      const r = await new Promise((resolve, reject) => {
        http.get({ port, path: '/login', host: '127.0.0.1' }, resolve).on('error', reject);
      });
      expect(r.statusCode).toBeLessThan(500);
      r.resume();
    } finally {
      child.kill('SIGKILL');
      getDb().exec('DROP TRIGGER IF EXISTS boom2');
    }
  });
});
