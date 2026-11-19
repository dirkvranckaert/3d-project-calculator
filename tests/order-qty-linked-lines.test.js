'use strict';

/**
 * #3927 supplies lines that follow the order quantity, #3928 extra-hours rows in
 * "time per unit" mode. The order quantity is the project's `items_per_set`.
 */

const request = require('supertest');
const http = require('http');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const testDbPath = path.join(__dirname, '..', 'data', 'test-order-qty-linked.db');
process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'testadmin';
process.env.ADMIN_PASS = 'testpass';
process.env.DB_PATH = testDbPath;
fs.mkdirSync(path.dirname(testDbPath), { recursive: true });
for (const p of [testDbPath, testDbPath + '-wal', testDbPath + '-shm']) fs.rmSync(p, { force: true });

const { app: expressApp, getDb } = require('../server');
const calc = require('../calc');

const app = http.createServer(expressApp).listen(0);
afterAll(() => new Promise((resolve) => app.close(resolve)));

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
function extractFn(name) {
  const m = APP_JS.match(new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}', 'm'));
  if (!m) throw new Error('Could not locate function ' + name);
  return m[0];
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  ['parsePerUnitInput', 'parseHoursMinutes', 'formatHoursMinutes', 'extraHourPayload'].map(extractFn).join('\n'),
  ctx
);

/* ---------------------------------------------------------------- */
/*  calc.js — supplies                                               */
/* ---------------------------------------------------------------- */
describe('supplies following the order quantity (#3927)', () => {
  const keyring = { price_excl_vat: 0.2, quantity: 1, scales_with_order: 1 };
  const box = { price_excl_vat: 1.5, quantity: 1, scales_with_order: 0 };

  test('effective quantity = per-ordered-item qty x order qty; unlinked line stays fixed', () => {
    expect(calc.effectiveExtraQuantity(keyring, 50)).toBe(50);
    expect(calc.effectiveExtraQuantity({ ...keyring, quantity: 2 }, 50)).toBe(100);
    expect(calc.effectiveExtraQuantity(box, 50)).toBe(1);
  });

  test('total follows the order quantity when it changes; box/sticker do not', () => {
    expect(calc.calculateExtraCosts([keyring, box], 50)).toBeCloseTo(0.2 * 50 + 1.5, 10);
    expect(calc.calculateExtraCosts([keyring, box], 80)).toBeCloseTo(0.2 * 80 + 1.5, 10);
  });

  test('legacy rows (no flag) and the batch-calculator call (no order qty) are unchanged', () => {
    const legacy = [{ price_excl_vat: 0.2, quantity: 50 }];
    expect(calc.calculateExtraCosts(legacy)).toBeCloseTo(10, 10);
    expect(calc.calculateExtraCosts(legacy, 999)).toBeCloseTo(10, 10);
    expect(calc.calculateExtraCosts([keyring])).toBeCloseTo(0.2, 10); // default order qty 1
  });

  test('invalid order quantity falls back to 1', () => {
    for (const bad of [0, -3, NaN, null, undefined, 'x']) {
      expect(calc.effectiveExtraQuantity(keyring, bad)).toBe(1);
    }
  });

  test('calculateProject folds the linked line into extraCostsTotal using itemsPerSet', () => {
    const run = (n) => calc.calculateProject({
      plates: [], extras: [keyring, box], itemsPerSet: n, settings: {},
    }).pricing.extraCostsTotal;
    expect(run(50)).toBeCloseTo(11.5, 10);
    expect(run(80)).toBeCloseTo(17.5, 10);
  });
});

/* ---------------------------------------------------------------- */
/*  calc.js — extra hours                                            */
/* ---------------------------------------------------------------- */
describe('extra hours, time per unit (#3928)', () => {
  const row = (v, unit) => ({ hours: 0, hourly_rate: 60, per_unit_value: v, per_unit_unit: unit });

  test('hours / minutes / seconds per unit x order quantity', () => {
    expect(calc.effectiveExtraHours(row(0.5, 'h'), 10)).toBeCloseTo(5, 10);
    expect(calc.effectiveExtraHours(row(0.75, 'min'), 50)).toBeCloseTo(37.5 / 60, 10);
    expect(calc.effectiveExtraHours(row(30, 's'), 50)).toBeCloseTo(25 / 60, 10);
  });

  test('missing unit defaults to minutes; unknown unit / bad value is NaN (row skipped in cost)', () => {
    expect(calc.effectiveExtraHours({ per_unit_value: 3 }, 20)).toBeCloseTo(1, 10);
    expect(Number.isNaN(calc.effectiveExtraHours(row(1, 'days'), 5))).toBe(true);
    expect(calc.calculateExtraHoursCost([row(1, 'days')], 5)).toBe(0);
  });

  test('subtotal = effective hours x rate; changes with order quantity', () => {
    expect(calc.calculateExtraHoursCost([row(0.75, 'min')], 50)).toBeCloseTo((37.5 / 60) * 60, 10);
    expect(calc.calculateExtraHoursCost([row(0.75, 'min')], 80)).toBeCloseTo((60 / 60) * 60, 10);
  });

  test('fixed rows and rows without the new fields keep their old maths (flat per project)', () => {
    const fixed = [{ hours: 2, hourly_rate: 60 }, { hours: 1, hourly_rate: 80, per_unit_value: null }];
    expect(calc.calculateExtraHoursCost(fixed)).toBeCloseTo(200, 10);
    expect(calc.calculateExtraHoursCost(fixed, 500)).toBeCloseTo(200, 10);
  });

  test('a per-unit value of 0 is per-unit mode (0 h), not a fixed row', () => {
    expect(calc.effectiveExtraHours({ hours: 3, per_unit_value: 0, per_unit_unit: 'min' }, 50)).toBe(0);
  });

  test('calculateProject uses itemsPerSet for per-unit rows', () => {
    const c = calc.calculateProject({ plates: [], extraHours: [row(1, 'min')], itemsPerSet: 60, settings: {} });
    expect(c.pricing.extraHoursCost).toBeCloseTo(60, 10); // 60 min x EUR 60/h
  });
});

/* ---------------------------------------------------------------- */
/*  frontend pure helpers                                            */
/* ---------------------------------------------------------------- */
describe('time-per-unit input parsing and h:mm display', () => {
  test.each([
    ['0,75', 0.75], ['0.75', 0.75], [' 1,5 ', 1.5], ['2', 2], ['', 0], ['.5', 0.5], [0.25, 0.25],
  ])('parsePerUnitInput(%j) = %p', (input, expected) => {
    expect(ctx.parsePerUnitInput(input)).toBeCloseTo(expected, 10);
  });

  test.each(['abc', '-1', '1,2,3', '1.2.3', '1e3', ',', -2, NaN])('parsePerUnitInput(%j) is NaN', (input) => {
    expect(Number.isNaN(ctx.parsePerUnitInput(input))).toBe(true);
  });

  test('h:mm display rounds to the nearest minute (0,75 min x 50 = 37.5 min -> 0:38)', () => {
    expect(ctx.formatHoursMinutes(calc.effectiveExtraHours({ per_unit_value: 0.75, per_unit_unit: 'min' }, 50))).toBe('0:38');
    expect(ctx.formatHoursMinutes(calc.effectiveExtraHours({ per_unit_value: 10, per_unit_unit: 's' }, 50))).toBe('0:08');
    expect(ctx.formatHoursMinutes(calc.effectiveExtraHours({ per_unit_value: 1.5, per_unit_unit: 'h' }, 4))).toBe('6:00');
  });

  test('replace-the-list payload keeps per-unit fields (and nothing extra for fixed rows)', () => {
    const fixed = ctx.extraHourPayload({ description: 'a', hours: 2, hourly_rate: 60 }, 0);
    expect(fixed).toEqual({ description: 'a', hours: 2, hourly_rate: 60, sort_order: 0 });
    const unit = ctx.extraHourPayload({ description: 'b', hours: 0, hourly_rate: 60, per_unit_value: 0.75, per_unit_unit: 's', sort_order: 3 }, 1);
    expect(unit).toMatchObject({ per_unit_value: 0.75, per_unit_unit: 's', sort_order: 3 });
  });
});

/* ---------------------------------------------------------------- */
/*  server                                                            */
/* ---------------------------------------------------------------- */
describe('API: order-quantity-linked lines', () => {
  let cookie;
  let pid;
  let keyringId;
  let boxId;
  const api = (method, url, body) => {
    const r = request(app)[method](url).set('Cookie', cookie);
    return body === undefined ? r : r.send(body);
  };

  beforeAll(async () => {
    const login = await request(app).post('/login').send({ username: 'testadmin', password: 'testpass' });
    cookie = login.headers['set-cookie'][0].split(';')[0];
    keyringId = (await api('post', '/api/extra-costs', { name: 'Keyring', price_excl_vat: 0.2, default_included: 0, default_quantity: 1 })).body.id;
    boxId = (await api('post', '/api/extra-costs', { name: 'Shipping box', price_excl_vat: 1.5, default_included: 0, default_quantity: 1 })).body.id;
    pid = (await api('post', '/api/projects', { name: 'Keychains', items_per_set: 50 })).body.id;
  });

  test('new columns exist with old-behaviour defaults', () => {
    const db = getDb();
    const ec = db.prepare('PRAGMA table_info(project_extra_costs)').all().find(c => c.name === 'scales_with_order');
    expect(ec.dflt_value).toBe('0');
    const cols = db.prepare('PRAGMA table_info(project_extra_hours)').all().map(c => c.name);
    expect(cols).toEqual(expect.arrayContaining(['per_unit_value', 'per_unit_unit']));
  });

  test('a row saved without the flag is fixed (existing projects unchanged)', async () => {
    const r = await api('put', `/api/projects/${pid}/extras`, [{ extra_cost_id: keyringId, quantity: 50 }]);
    expect(r.status).toBe(200);
    expect(r.body.extras[0].scales_with_order).toBe(0);
    expect(r.body.extras[0].effective_quantity).toBe(50);
    expect(r.body.calculation.pricing.extraCostsTotal).toBeCloseTo(10, 10);
  });

  test('linked line follows items_per_set when the order quantity changes; fixed line does not', async () => {
    let r = await api('put', `/api/projects/${pid}/extras`, [
      { extra_cost_id: keyringId, quantity: 1, scales_with_order: 1 },
      { extra_cost_id: boxId, quantity: 1 },
    ]);
    expect(r.body.extras.find(e => e.extra_cost_id === keyringId).effective_quantity).toBe(50);
    expect(r.body.calculation.pricing.extraCostsTotal).toBeCloseTo(0.2 * 50 + 1.5, 10);

    r = await api('put', `/api/projects/${pid}`, { name: 'Keychains', items_per_set: 80 });
    expect(r.status).toBe(200);
    const after = (await api('get', `/api/projects/${pid}`)).body;
    expect(after.extras.find(e => e.extra_cost_id === keyringId).effective_quantity).toBe(80);
    expect(after.extras.find(e => e.extra_cost_id === boxId).effective_quantity).toBe(1);
    expect(after.calculation.pricing.extraCostsTotal).toBeCloseTo(0.2 * 80 + 1.5, 10);
    await api('put', `/api/projects/${pid}`, { name: 'Keychains', items_per_set: 50 });
  });

  test('duplicate keeps the link flag', async () => {
    const d = await api('post', `/api/projects/${pid}/duplicate`);
    expect(d.status).toBeLessThan(300);
    const dup = (await api('get', `/api/projects/${d.body.id}`)).body;
    expect(dup.extras.find(e => e.extra_cost_id === keyringId).scales_with_order).toBe(1);
    await api('delete', `/api/projects/${d.body.id}`);
  });
});

describe('API: extra hours, time per unit', () => {
  let cookie;
  let pid;
  const api = (method, url, body) => {
    const r = request(app)[method](url).set('Cookie', cookie);
    return body === undefined ? r : r.send(body);
  };

  beforeAll(async () => {
    const login = await request(app).post('/login').send({ username: 'testadmin', password: 'testpass' });
    cookie = login.headers['set-cookie'][0].split(';')[0];
    pid = (await api('post', '/api/projects', { name: 'Hours', items_per_set: 50 })).body.id;
  });

  test('per-unit row persists, resolves to effective hours and prices at rate', async () => {
    const r = await api('put', `/api/projects/${pid}/extra-hours`, [
      { description: 'Assemble', hours: 0, hourly_rate: 60, per_unit_value: 0.75, per_unit_unit: 'min' },
      { description: 'Design', hours: 2, hourly_rate: 60 },
    ]);
    expect(r.status).toBe(200);
    const [a, d] = r.body.extra_hours;
    expect(a.per_unit_value).toBeCloseTo(0.75, 10);
    expect(a.per_unit_unit).toBe('min');
    expect(a.effective_hours).toBeCloseTo(37.5 / 60, 10);
    expect(d.per_unit_value).toBeNull();
    expect(d.effective_hours).toBe(2);
    expect(r.body.calculation.pricing.extraHoursCost).toBeCloseTo(37.5 / 60 * 60 + 120, 8);
  });

  test('changing the order quantity re-prices the per-unit row only', async () => {
    await api('put', `/api/projects/${pid}`, { name: 'Hours', items_per_set: 80 });
    const p = (await api('get', `/api/projects/${pid}`)).body;
    expect(p.extra_hours[0].effective_hours).toBeCloseTo(1, 10);
    expect(p.extra_hours[1].effective_hours).toBe(2);
    expect(p.calculation.pricing.extraHoursCost).toBeCloseTo(60 + 120, 8);
  });

  test('seconds and hours units are stored', async () => {
    const r = await api('put', `/api/projects/${pid}/extra-hours`, [
      { description: 's', hours: 0, hourly_rate: 36, per_unit_value: 45, per_unit_unit: 's' },
      { description: 'h', hours: 0, hourly_rate: 10, per_unit_value: 0.1, per_unit_unit: 'h' },
    ]);
    expect(r.body.extra_hours[0].effective_hours).toBeCloseTo(45 * 80 / 3600, 10);
    expect(r.body.extra_hours[1].effective_hours).toBeCloseTo(8, 10);
  });

  test('invalid unit or value is rejected and the stored list is untouched', async () => {
    const before = (await api('get', `/api/projects/${pid}`)).body.extra_hours.length;
    let r = await api('put', `/api/projects/${pid}/extra-hours`, [
      { description: 'ok', hours: 1, hourly_rate: 1 },
      { description: 'bad', hours: 0, hourly_rate: 1, per_unit_value: 1, per_unit_unit: 'days' },
    ]);
    expect(r.status).toBe(400);
    r = await api('put', `/api/projects/${pid}/extra-hours`, [
      { description: 'bad', hours: 0, hourly_rate: 1, per_unit_value: -1, per_unit_unit: 'min' },
    ]);
    expect(r.status).toBe(400);
    const after = (await api('get', `/api/projects/${pid}`)).body.extra_hours.length;
    expect(after).toBe(before);
  });

  test('a null per_unit_value turns the row back into a fixed row', async () => {
    const r = await api('put', `/api/projects/${pid}/extra-hours`, [
      { description: 'back', hours: 1.5, hourly_rate: 40, per_unit_value: null },
    ]);
    expect(r.body.extra_hours[0].per_unit_unit).toBeNull();
    expect(r.body.extra_hours[0].effective_hours).toBe(1.5);
    expect(r.body.calculation.pricing.extraHoursCost).toBeCloseTo(60, 10);
  });
});
