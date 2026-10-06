'use strict';

/**
 * Actual Sales Price on the ALL-IN basis, server side (task #2290, Dirk
 * 2026-10-06): price-impact endpoint basis, and the per-row lock basis
 * (`projects.locked_margin_basis`) that keeps every legacy lock price exact.
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

const { app: expressApp, getDb, enrichProject } = require('../server');
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
    const id = await makeProject(`same-${sep}`, { design: sep ? 5 : 40, separately: sep });
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

describe('per-row lock basis (#2290, replaces the data migration)', () => {
  const basisOf = id => getDb().prepare('SELECT locked_margin_basis b FROM projects WHERE id = ?').get(id).b;
  const pctOf = id => getDb().prepare('SELECT locked_margin_pct p FROM projects WHERE id = ?').get(id).p;
  /** Row exactly as a pre-upgrade lock looks: pin set, column left at its default. */
  const legacyLock = async (name, o = {}) => {
    const id = await makeProject(name, o);
    getDb().prepare('UPDATE projects SET margin_locked = 1, locked_margin_pct = 60 WHERE id = ?').run(id);
    return id;
  };
  const oldPrice = id => calc.calculateLockedPrice(enrich(id).calculation.pricing.productionCost, 60, 21).price;

  test('a new row defaults to production; nothing is rewritten to get there', async () => {
    const id = await makeProject('fresh');
    expect(basisOf(id)).toBe('production');
  });

  test.each([false, true])('legacy production lock with D>0 keeps its EXACT old price (separately=%s)', async (sep) => {
    const id = await legacyLock(`legacy-${sep}`, { design: sep ? 5 : 40, separately: sep });
    const c = enrich(id).calculation;
    expect(c.effectiveSalesPrice).toBe(oldPrice(id));
    expect(c.marginLock.basis).toBe('production');
    expect(pctOf(id)).toBe(60); // never rewritten
    // the actual card stays descriptive and all-in
    expect(c.actualMargin.basis).toBe('all-in');
    expect(c.actualMargin.marginPct).not.toBeCloseTo(60, 1);
  });

  test.each([false, true])('new lock round-trips on the all-in basis (separately=%s)', async (sep) => {
    const id = await makeProject(`new-${sep}`, { design: sep ? 5 : 40, separately: sep });
    const r = await api('patch', `/api/projects/${id}/margin-lock`, { locked: true, locked_margin_pct: 60 });
    expect(r.status).toBe(200);
    expect(basisOf(id)).toBe('all-in');
    const c = r.body.calculation;
    expect(c.marginLock.basis).toBe('all-in');
    expect(c.actualMargin.marginPct).toBeCloseTo(60, 1);
  });

  test.each([false, true])('re-lock of a legacy row with the untouched seed is price-stable (separately=%s)', async (sep) => {
    const id = await legacyLock(`relock-${sep}`, { design: sep ? 5 : 40, separately: sep });
    const before = enrich(id).calculation;
    // the UI seed: all-in margin of the current price, full precision
    const seedPct = before.actualMargin.marginPct;
    const r = await api('patch', `/api/projects/${id}/margin-lock`, { locked: true, locked_margin_pct: seedPct });
    expect(r.status).toBe(200);
    expect(basisOf(id)).toBe('all-in');
    expect(r.body.calculation.effectiveSalesPrice).toBe(before.effectiveSalesPrice);
  });

  test('D = 0: both bases give the identical price and no basis flag is exposed', async () => {
    const id = await legacyLock('plain-legacy');
    const legacy = enrich(id).calculation;
    expect(legacy.effectiveSalesPrice).toBe(oldPrice(id));
    expect(legacy.marginLock.basis).toBeUndefined();
    getDb().prepare("UPDATE projects SET locked_margin_basis = 'all-in' WHERE id = ?").run(id);
    expect(enrich(id).calculation.effectiveSalesPrice).toBe(legacy.effectiveSalesPrice);
  });

  test('unlock keeps pin AND basis (legacy one-click re-lock stays price-stable); clear-price keeps both', async () => {
    const id = await legacyLock('unlock', { design: 40 });
    const before = enrich(id).calculation.effectiveSalesPrice;
    await api('patch', `/api/projects/${id}/margin-lock`, { locked: false });
    expect(basisOf(id)).toBe('production');
    expect(pctOf(id)).toBe(60);
    const relock = await api('patch', `/api/projects/${id}/margin-lock`, { locked: true });
    expect(relock.body.calculation.effectiveSalesPrice).toBe(before);
    await api('patch', `/api/projects/${id}/clear-price`);
    expect(basisOf(id)).toBe('production');
    expect(pctOf(id)).toBe(60);
  });

  test('PUT /api/projects/:id never touches pin or basis', async () => {
    const id = await legacyLock('put', { design: 40 });
    const before = enrich(id).calculation.effectiveSalesPrice;
    const r = await api('put', `/api/projects/${id}`, { name: 'put2', items_per_set: 1 });
    expect(r.status).toBe(200);
    expect(basisOf(id)).toBe('production');
    expect(pctOf(id)).toBe(60);
    expect(r.body.calculation.effectiveSalesPrice).toBe(before);
  });

  test('duplicate copies pin and basis together (price identical)', async () => {
    const id = await legacyLock('dup-legacy', { design: 40 });
    const d1 = await api('post', `/api/projects/${id}/duplicate`);
    expect(basisOf(d1.body.id)).toBe('production');
    expect(d1.body.calculation.effectiveSalesPrice).toBe(enrich(id).calculation.effectiveSalesPrice);
    const nid = await makeProject('dup-new', { design: 40 });
    await api('patch', `/api/projects/${nid}/margin-lock`, { locked: true, locked_margin_pct: 55 });
    const d2 = await api('post', `/api/projects/${nid}/duplicate`);
    expect(basisOf(d2.body.id)).toBe('all-in');
    expect(d2.body.calculation.effectiveSalesPrice).toBe(enrich(nid).calculation.effectiveSalesPrice);
  });

  test('price-impact on a legacy lock follows its basis (same price as enrichProject)', async () => {
    const id = await legacyLock('impact-legacy', { design: 40 });
    const r = await api('post', `/api/materials/${materialId}/price-impact`, { new_price_per_kg: 99 });
    const row = r.body.impacts.find(i => i.projectId === id);
    expect(row).toBeTruthy();
    expect(Number.isFinite(row.current.marginPct)).toBe(true);
    expect(enrich(id).calculation.effectiveSalesPrice).toBe(oldPrice(id));
  });
});
