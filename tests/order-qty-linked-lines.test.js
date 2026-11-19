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
  'const _listWriteQueues = new Map();\nconst _listWritePending = new Map();\n' + ['parsePerUnitInput', 'parseHoursMinutes', 'formatHoursMinutes', 'extraHourPayload', 'parseExtraQtyInput', 'buildExtrasPayload', 'toggleLinkedPatch', 'setListPanelInert', 'serializeListWrite', 'collectExtraHoursItems', 'commitExtraHours'].map(extractFn).join('\n'),
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

describe('decimal per-item ratio, rounded up (#3927, Dirk)', () => {
  const lin = (q) => ({ price_excl_vat: 0.2, quantity: q, scales_with_order: 1 });

  test.each([
    [2, 50, 100], [0.5, 50, 25], [0.5, 51, 26], [0.25, 50, 13], [1.5, 3, 5], [0.01, 50, 1],
  ])('ratio %p x order %p = %p pieces (rounded up)', (ratio, order, expected) => {
    expect(calc.effectiveExtraQuantity(lin(ratio), order)).toBe(expected);
  });

  test('float noise does not add a piece (0.07 x 100 = 7.000000000000001 -> 7)', () => {
    expect(0.07 * 100).not.toBe(7);
    expect(calc.effectiveExtraQuantity(lin(0.07), 100)).toBe(7);
    expect(calc.effectiveExtraQuantity(lin(0.29), 100)).toBe(29);
  });

  test('cost uses the rounded-up quantity; unlinked decimals are never rounded here', () => {
    expect(calc.calculateExtraCosts([lin(0.5)], 51)).toBeCloseTo(0.2 * 26, 10);
    expect(calc.effectiveExtraQuantity({ quantity: 2.5, scales_with_order: 0 }, 50)).toBe(2.5);
  });

  test.each([['0,5', 0.5], ['2', 2], ['1.25', 1.25], [' 3,0 ', 3]])('linked input %j -> %p', (raw, v) => {
    expect(ctx.parseExtraQtyInput(raw, true)).toBeCloseTo(v, 10);
  });
  test.each(['abc', '-1', '', '1,2,3'])('linked garbage %j -> 0 (removes the line)', (raw) => {
    expect(ctx.parseExtraQtyInput(raw, true)).toBe(0);
  });
  test('fixed lines stay whole numbers (parseInt, as before)', () => {
    expect(ctx.parseExtraQtyInput('3', false)).toBe(3);
    expect(ctx.parseExtraQtyInput('2,5', false)).toBe(2);
    expect(ctx.parseExtraQtyInput('x', false)).toBe(0);
  });

  test('payload builder keeps other rows flags and applies one patch', () => {
    const extras = [
      { extra_cost_id: 1, quantity: 0.5, scales_with_order: 1 },
      { extra_cost_id: 2, quantity: 1, scales_with_order: 0 },
    ];
    const out = ctx.buildExtrasPayload(extras, 2, { scales_with_order: 1 });
    expect(out).toEqual([
      { extra_cost_id: 1, quantity: 0.5, scales_with_order: 1 },
      { extra_cost_id: 2, quantity: 1, scales_with_order: 1 },
    ]);
    expect(ctx.buildExtrasPayload([], 9, { quantity: 1 })).toEqual([{ extra_cost_id: 9, quantity: 1, scales_with_order: 0 }]);
  });

  test('list writes of one project run strictly in order, other projects are independent', async () => {
    const log = [];
    const slow = (name, ms) => () => new Promise(r => setTimeout(() => { log.push(name); r(); }, ms));
    await Promise.all([
      ctx.serializeListWrite('p1', slow('a', 30)),
      ctx.serializeListWrite('p1', slow('b', 1)),
      ctx.serializeListWrite('p2', slow('c', 1)),
    ]);
    expect(log.indexOf('a')).toBeLessThan(log.indexOf('b'));
    expect(log.indexOf('c')).toBeLessThan(log.indexOf('a'));
  });

  test('a failing write does not block the next one', async () => {
    const log = [];
    const p1 = ctx.serializeListWrite('p3', () => Promise.reject(new Error('boom')));
    const p2 = ctx.serializeListWrite('p3', async () => { log.push('ran'); });
    await expect(p1).rejects.toThrow('boom');
    await p2;
    expect(log).toEqual(['ran']);
  });
});

describe('list write queue: stale recovery and edit snapshot (Codex R2)', () => {
  test('after a failed task the next one runs only once refresh succeeded', async () => {
    const log = [];
    const failing = ctx.serializeListWrite('r1', () => Promise.reject(new Error('reload failed')), async () => log.push('refresh0'));
    await expect(failing).rejects.toThrow();
    const ok = ctx.serializeListWrite('r1', async () => { log.push('ran'); }, async () => { log.push('refresh'); });
    await ok;
    expect(log).toEqual(['refresh', 'ran']);
  });

  test('if the refresh itself fails the next task does not write', async () => {
    const log = [];
    await expect(ctx.serializeListWrite('r2', () => Promise.reject(new Error('x')))).rejects.toThrow();
    const next = ctx.serializeListWrite('r2', async () => { log.push('ran'); }, () => Promise.reject(new Error('still down')));
    await expect(next).rejects.toThrow('still down');
    expect(log).toEqual([]);
    // and the one after that tries to refresh again before writing
    await ctx.serializeListWrite('r2', async () => { log.push('ran2'); }, async () => { log.push('refresh'); });
    expect(log).toEqual(['refresh', 'ran2']);
  });

  test('panel is inert from enqueue until the whole queue drained (no overlapping edits), also after a failure', async () => {
    const els = { 'extra-hours-9': { inert: false }, 'extras-9': { inert: false } };
    const saved = ctx.document;
    ctx.document = { querySelectorAll: (sel) => {
      const m = /data-(extras|extra-hours)-panel="9"/.exec(sel);
      return m ? [els[m[1] + '-9']] : [];
    } };
    let release;
    const a = ctx.serializeListWrite('extra-hours-9', () => new Promise(r => { release = r; }));
    expect(els['extra-hours-9'].inert).toBe(true);
    expect(els['extras-9'].inert).toBe(false);
    const b = ctx.serializeListWrite('extra-hours-9', () => Promise.reject(new Error('x')));
    await new Promise(r => setTimeout(r, 1));
    release();
    await a;
    expect(els['extra-hours-9'].inert).toBe(true);   // b still pending
    await expect(b).rejects.toThrow();
    await new Promise(r => setTimeout(r, 1));
    expect(els['extra-hours-9'].inert).toBe(false);  // unlocked after failure too
    ctx.document = saved;
  });

  test('no failure, no refresh', async () => {
    const log = [];
    await ctx.serializeListWrite('r3', async () => { log.push('a'); }, async () => { log.push('refresh'); });
    await ctx.serializeListWrite('r3', async () => { log.push('b'); }, async () => { log.push('refresh'); });
    expect(log).toEqual(['a', 'b']);
  });

  test('commitExtraHours reads the DOM at edit time, so a later re-render cannot wipe a queued edit', async () => {
    const mkRow = (desc, hours) => ({
      dataset: { ehFixed: '0' },
      querySelector: (sel) => ({
        '.eh-input-desc': { value: desc },
        '.eh-rate .eh-input': { value: '60' },
        '.eh-mode': { value: 'fixed' },
        '.eh-input-hours': { value: hours },
      })[sel] || null,
    });
    let rows = [mkRow('A', '1:00'), mkRow('B', '2:00')];
    ctx.document = { querySelector: () => ({ querySelectorAll: () => rows }), querySelectorAll: () => [] };
    const puts = [];
    let release;
    ctx.PUT = (url, body) => { puts.push(body.map(i => i.hours)); return puts.length === 1 ? new Promise(r => { release = r; }) : Promise.resolve(); };
    ctx.reloadSingleProject = async () => { rows = [mkRow('A', '1:00'), mkRow('B', '2:00')]; }; // re-render from stale server state
    const first = ctx.commitExtraHours(7);                 // edit A (row A unchanged here)
    rows = [mkRow('A', '1:00'), mkRow('B', '3:00')];       // user edits B while the first PUT is in flight
    const second = ctx.commitExtraHours(7);
    await new Promise(r => setTimeout(r, 5));              // let the first PUT start
    release();
    await first; await second;
    expect(puts).toEqual([[1, 2], [1, 3]]);
  });
});

describe('API: supplies payload validation (Codex R2)', () => {
  let cookie;
  const api = (method, url, body) => {
    const r = request(app)[method](url).set('Cookie', cookie);
    return body === undefined ? r : r.send(body);
  };
  beforeAll(async () => {
    const login = await request(app).post('/login').send({ username: 'testadmin', password: 'testpass' });
    cookie = login.headers['set-cookie'][0].split(';')[0];
  });

  test('fixed line with a fraction is rejected and the stored list is untouched', async () => {
    const ec = (await api('post', '/api/extra-costs', { name: 'Val box', price_excl_vat: 1, default_included: 0, default_quantity: 1 })).body.id;
    const pid = (await api('post', '/api/projects', { name: 'Val', items_per_set: 10 })).body.id;
    await api('put', `/api/projects/${pid}/extras`, [{ extra_cost_id: ec, quantity: 3, scales_with_order: 0 }]);
    const bad = await api('put', `/api/projects/${pid}/extras`, [{ extra_cost_id: ec, quantity: 2.5, scales_with_order: 0 }]);
    expect(bad.status).toBe(400);
    const after = (await api('get', `/api/projects/${pid}`)).body.extras;
    expect(after.map(e => e.quantity)).toEqual([3]);
  });

  test('non-finite quantity, bad row and non-array body are rejected; linked decimal is fine', async () => {
    const ec = (await api('post', '/api/extra-costs', { name: 'Val ring', price_excl_vat: 1, default_included: 0, default_quantity: 1 })).body.id;
    const pid = (await api('post', '/api/projects', { name: 'Val2', items_per_set: 10 })).body.id;
    expect((await api('put', `/api/projects/${pid}/extras`, [{ extra_cost_id: ec, quantity: 'abc', scales_with_order: 1 }])).status).toBe(400);
    expect((await api('put', `/api/projects/${pid}/extras`, [{ quantity: 1 }])).status).toBe(400);
    expect((await api('put', `/api/projects/${pid}/extras`, { nope: 1 })).status).toBe(400);
    const ok = await api('put', `/api/projects/${pid}/extras`, [{ extra_cost_id: ec, quantity: 0.25, scales_with_order: 1 }]);
    expect(ok.status).toBe(200);
    expect(ok.body.extras[0].effective_quantity).toBe(3);
  });

  test('unknown supplies item or duplicate item is 400 and the old list survives (no partial replace)', async () => {
    const ec = (await api('post', '/api/extra-costs', { name: 'Atomic', price_excl_vat: 1, default_included: 0, default_quantity: 1 })).body.id;
    const pid = (await api('post', '/api/projects', { name: 'Atomic', items_per_set: 10 })).body.id;
    await api('put', `/api/projects/${pid}/extras`, [{ extra_cost_id: ec, quantity: 4, scales_with_order: 0 }]);
    const unknown = await api('put', `/api/projects/${pid}/extras`, [{ extra_cost_id: 987654, quantity: 1, scales_with_order: 0 }]);
    expect(unknown.status).toBe(400);
    const dup = await api('put', `/api/projects/${pid}/extras`, [
      { extra_cost_id: ec, quantity: 1, scales_with_order: 0 }, { extra_cost_id: ec, quantity: 2, scales_with_order: 0 },
    ]);
    expect(dup.status).toBe(400);
    expect((await api('get', `/api/projects/${pid}`)).body.extras.map(e => e.quantity)).toEqual([4]);
    // a zero-quantity duplicate is a removal, not a constraint hit
    const rm = await api('put', `/api/projects/${pid}/extras`, [
      { extra_cost_id: ec, quantity: 0, scales_with_order: 0 }, { extra_cost_id: ec, quantity: 2, scales_with_order: 0 },
    ]);
    expect(rm.status).toBe(200);
  });

  test('unknown project is 404 and nothing is deleted first', async () => {
    expect((await api('put', '/api/projects/999999/extras', [])).status).toBe(404);
  });
});

describe('toggling a supplies line keeps its total', () => {
  test('ON: 50 fixed at order 50 becomes ratio 1', () => {
    expect(ctx.toggleLinkedPatch({ quantity: 50 }, true, 50)).toEqual({ scales_with_order: 1, quantity: 1 });
    expect(ctx.toggleLinkedPatch({ quantity: 25 }, true, 50)).toEqual({ scales_with_order: 1, quantity: 0.5 });
  });
  test('OFF: ratio becomes the current total, rounded up', () => {
    expect(ctx.toggleLinkedPatch({ quantity: 1 }, false, 50)).toEqual({ scales_with_order: 0, quantity: 50 });
    expect(ctx.toggleLinkedPatch({ quantity: 0.5 }, false, 51)).toEqual({ scales_with_order: 0, quantity: 26 });
    expect(ctx.toggleLinkedPatch({ quantity: 0.1 }, false, 30)).toEqual({ scales_with_order: 0, quantity: 3 });
  });
  test('ON then OFF at the same order quantity is a round trip, also for awkward ratios', () => {
    for (const [q, n] of [[50, 50], [7, 3], [10, 30], [1, 7]]) {
      const on = ctx.toggleLinkedPatch({ quantity: q }, true, n);
      const off = ctx.toggleLinkedPatch({ quantity: on.quantity }, false, n);
      expect(off.quantity).toBe(q);
    }
  });
  test('missing/invalid order quantity falls back to 1', () => {
    expect(ctx.toggleLinkedPatch({ quantity: 4 }, true, 0)).toEqual({ scales_with_order: 1, quantity: 4 });
    expect(ctx.toggleLinkedPatch(undefined, false, 50)).toEqual({ scales_with_order: 0, quantity: 0 });
  });
  test('total unchanged through the calc layer', () => {
    const row = { price_excl_vat: 0.2, quantity: 50, scales_with_order: 0 };
    const before = calc.calculateExtraCosts([row], 50);
    const on = { ...row, ...ctx.toggleLinkedPatch(row, true, 50) };
    expect(calc.calculateExtraCosts([on], 50)).toBeCloseTo(before, 10);
  });
});

describe('API: decimal ratio, duplicate and export carry the new fields', () => {
  let cookie;
  const api = (method, url, body) => {
    const r = request(app)[method](url).set('Cookie', cookie);
    return body === undefined ? r : r.send(body);
  };
  beforeAll(async () => {
    const login = await request(app).post('/login').send({ username: 'testadmin', password: 'testpass' });
    cookie = login.headers['set-cookie'][0].split(';')[0];
  });

  test('0.5 per item persists as a decimal and totals round up', async () => {
    const ec = (await api('post', '/api/extra-costs', { name: 'Ratio ring', price_excl_vat: 0.2, default_included: 0, default_quantity: 1 })).body.id;
    const pid = (await api('post', '/api/projects', { name: 'Ratio', items_per_set: 51 })).body.id;
    const r = await api('put', `/api/projects/${pid}/extras`, [{ extra_cost_id: ec, quantity: 0.5, scales_with_order: 1 }]);
    expect(r.body.extras[0].quantity).toBeCloseTo(0.5, 10);
    expect(r.body.extras[0].effective_quantity).toBe(26);
    expect(r.body.calculation.pricing.extraCostsTotal).toBeCloseTo(0.2 * 26, 10);
  });

  test('duplicate copies production extra hours incl. per-unit rows; export lists them', async () => {
    const pid = (await api('post', '/api/projects', { name: 'Dup hours', items_per_set: 50 })).body.id;
    await api('put', `/api/projects/${pid}/extra-hours`, [
      { description: 'Per unit', hours: 0, hourly_rate: 60, per_unit_value: 0.75, per_unit_unit: 'min' },
      { description: 'Fixed', hours: 1, hourly_rate: 60 },
    ]);
    const d = await api('post', `/api/projects/${pid}/duplicate`);
    const dup = (await api('get', `/api/projects/${d.body.id}`)).body;
    expect(dup.extra_hours.map(h => [h.description, h.per_unit_value, h.per_unit_unit])).toEqual([
      ['Per unit', 0.75, 'min'], ['Fixed', null, null],
    ]);
    const orig = (await api('get', `/api/projects/${pid}`)).body;
    expect(dup.calculation.pricing.extraHoursCost).toBeCloseTo(orig.calculation.pricing.extraHoursCost, 10);
    const exp = (await api('get', '/api/export')).body;
    const ep = exp.projects.find(p => p.id === pid);
    expect(ep.extra_hours.map(h => h.description)).toEqual(['Per unit', 'Fixed']);
    expect(ep.extra_hours[0].per_unit_value).toBeCloseTo(0.75, 10);
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
