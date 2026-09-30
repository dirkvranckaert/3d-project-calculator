'use strict';

/** Follow-ups to plate mode (#2146): hint spacing, run wording, help/runtime parity, write validation, mobile table. */

const fs = require('fs');
const path = require('path');
const request = require('supertest');

const T = require('../public/plate-mode-text');
const calc = require('../calc');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const css = read('public/style.css');

/* ---------------------------------------------------------------- */
/*  1. hint spacing + tokens                                         */
/* ---------------------------------------------------------------- */
describe('field-hint spacing', () => {
  const rule = css.match(/\n\.field-hint \{([^}]*)\}/)[1];
  test('gap between control and hint is positive and the line height is comfortable', () => {
    const margin = rule.match(/margin:\s*(-?\d+)px/);
    expect(Number(margin[1])).toBeGreaterThanOrEqual(4); // was -4px: pulled under the control
    expect(Number(rule.match(/line-height:\s*([\d.]+)/)[1])).toBeGreaterThanOrEqual(1.5);
  });
  test('checkbox label carries no extra bottom margin so its hint gap matches a select hint', () => {
    expect(css).toMatch(/\.plate-share-check \{[^}]*margin-bottom:\s*0/);
  });
  test('every custom property used by .field-hint rules is defined in all three theme blocks', () => {
    const blocks = [
      css.match(/:root \{([\s\S]*?)\n\}/)[1],
      css.match(/prefers-color-scheme: dark\) \{\s*:root:not\(\[data-theme="light"\]\) \{([\s\S]*?)\n  \}/)[1],
      css.match(/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/)[1],
    ];
    const rules = [...css.matchAll(/[^{}]*\.field-hint[^{}]*\{([^}]*)\}/g)].map(m => m[1]).join('\n');
    const used = [...new Set([...rules.matchAll(/var\((--[\w-]+)\)/g)].map(m => m[1]))];
    expect(used.length).toBeGreaterThan(0);
    for (const tok of used) for (const b of blocks) expect(b).toContain(`${tok}:`);
  });
});

/* ---------------------------------------------------------------- */
/*  2. near-integer wording                                          */
/* ---------------------------------------------------------------- */
describe('run quantity wording never contradicts itself', () => {
  const cases = [
    [1999, 1000, 'just under 2 runs', 'just under 2 runs, not 2 whole runs'],
    [202, 201, 'just over 1 run', 'just over 1 run, not 2'],
    [2001, 1000, 'just over 2 runs', 'just over 2 runs, not 3'],
    [10, 4, '2.5 runs', '2.5 runs, not 3'],
    [7, 3, 'about 2.33 runs', 'about 2.33 runs, not 3'],
  ];
  test.each(cases)('%i / %i', (set, per, share, badge) => {
    const c = T.shareCase(set, per);
    expect(c.shareText).toBe(share);
    expect(c.badgeText).toBe(badge);
  });
  test('1/3 stays a fraction, 10/5 stays "same as whole"', () => {
    expect(T.shareCase(1, 3).shareText).toBe('1/3 of one run');
    expect(T.shareCase(10, 5).kind).toBe('none');
    expect(T.shareCase(10, 5).badgeText).toBe('2 runs, same as whole');
  });
  test('never "about N ... not N", never "about 1 runs"', () => {
    for (let set = 1; set <= 400; set += 7) for (let per = 1; per <= 400; per += 3) {
      const t = T.shareCase(set, per).badgeText;
      expect(t).not.toMatch(/about 1 runs/);
      const m = t.match(/^about ([\d.]+) runs?, not (\d+)/);
      if (m) expect(m[1]).not.toBe(m[2]);
      expect(t).not.toMatch(/(^|\s)1 runs/);
    }
  });
  test('count label agrees with the run count', () => {
    expect(T.countLabel({ mode: 'runs', runs: 2, shareNum: 1999, shareDen: 1000 }))
      .toBe('2 runs (1999 ÷ 1000 = just under 2, rounded up)');
  });
});

/* ---------------------------------------------------------------- */
/*  3. legacy REAL #/plate: help == runtime                          */
/* ---------------------------------------------------------------- */
describe('run inputs mirror calc.effectiveRunInputs', () => {
  test.each([[10, 2.5], [10, 0], [0, 3], [7, 3], [3, '4'], [undefined, undefined]])('%p %p', (set, ipp) => {
    expect(T.runInputs(set, ipp)).toEqual(calc.effectiveRunInputs(Number(set) || 0, Number(ipp) || 0));
  });
  test('REAL 2.5 per plate: help run count equals resolvePlateCount', () => {
    const c = T.shareCase(10, 2.5);
    const rt = calc.resolvePlateCount({ items_per_plate: 2.5, charge_share_only: 1 }, 10, 'parts');
    expect(c.set / c.per).toBe(rt.factor);
    expect(c.whole).toBe(Math.ceil(10 / 2.5));
  });
  test('app.js no longer truncates #/plate with parseInt in the share help', () => {
    const src = read('public/app.js');
    const fn = src.slice(src.indexOf('function updateShareHelp'), src.indexOf("['plate-hours'"));
    expect(fn).not.toMatch(/parseInt\(/);
    expect(fn).toMatch(/PlateModeText\.runInputs/);
  });
});

/* ---------------------------------------------------------------- */
/*  4. help euros == explanation-block euros                         */
/* ---------------------------------------------------------------- */
describe('share help euros equal the runtime contribution', () => {
  const settings = {
    hourly_rate: 40, electricity_price_kwh: 0.40, vat_rate: 21, material_profit_pct: 200,
    processing_profit_pct: 0, electricity_profit_pct: 0, printer_cost_profit_pct: 50, price_rounding: 0.99,
  };
  const mkPlate = (ipp, extra) => ({
    id: 1, name: 'P', print_time_minutes: 473, plastic_grams: 215.34, items_per_plate: ipp,
    risk_multiplier: 1, pre_processing_minutes: 0, post_processing_minutes: 2, material_waste_grams: 0,
    enabled: 1, is_test_print: 0, printer_purchase_price: 1889.92, printer_earn_back_months: 24,
    printer_kwh_per_hour: 0.25, material_price_per_kg: 17.38, ...extra,
  });
  test('grid set 1..14 x #/plate 1..14', () => {
    let checked = 0;
    for (let set = 1; set <= 14; set++) for (let ipp = 1; ipp <= 14; ipp++) {
      const share = calc.calculateProject({ plates: [mkPlate(ipp, { charge_share_only: 1 })], settings, itemsPerSet: set, plateMode: 'parts' });
      const whole = calc.calculateProject({ plates: [mkPlate(ipp)], settings, itemsPerSet: set, plateMode: 'parts' });
      const pb = share.plateBreakdowns[0];
      const h = T.shareCosts(pb, set, ipp);
      expect(h.shareCost).toBe(pb.contribution.totalCost);
      expect(h.wholeCost).toBe(whole.plateBreakdowns[0].contribution.totalCost);
      checked++;
    }
    expect(checked).toBe(196);
  });
  test('integer share: rounded-per-run x factor, not raw x factor', () => {
    // 0.4024 per run: raw x 5 = 2.012 -> 2.01, rounded-per-run 0.40 x 5 = 2.00
    const pb = { materialCost: 0.4024, processingCost: 0, electricityCost: 0, printerUsageCost: 0 };
    expect(T.shareCosts(pb, 10, 2).shareCost).toBe(2);
  });
});

/* ---------------------------------------------------------------- */
/*  5. server validation                                             */
/* ---------------------------------------------------------------- */
describe('items_per_set / items_per_plate validation', () => {
  const dbPath = path.join(__dirname, '..', 'data', 'test-2146.db');
  let app, db, cookie;
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_USER = 'u2146';
    process.env.ADMIN_PASS = 'p2146';
    process.env.DB_PATH = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true });
    jest.resetModules();
    ({ app } = require('../server'));
    db = require('../db').getDb();
    const res = await request(app).post('/login').send({ username: 'u2146', password: 'p2146' });
    cookie = res.headers['set-cookie'][0].split(';')[0];
  });
  afterAll(() => { for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true }); });
  const api = (m, u, body) => request(app)[m](u).set('Cookie', cookie).send(body);
  const BAD = [0, -1, 1.5, 'abc', null, NaN, Infinity, [], {}, true, ''];

  test.each(BAD.map(v => [JSON.stringify(v) ?? String(v), v]))('POST /api/projects rejects items_per_set %s', async (_l, v) => {
    const res = await api('post', '/api/projects', { name: 'X', items_per_set: v });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Items per set must be a whole number of at least 1/);
  });

  test('project create + PUT accept valid, reject invalid, store integers', async () => {
    const created = await api('post', '/api/projects', { name: 'Valid', items_per_set: '3' });
    expect(created.status).toBe(201);
    expect(created.body.items_per_set).toBe(3);
    const bad = await api('put', `/api/projects/${created.body.id}`, { name: 'Valid', items_per_set: 2.5 });
    expect(bad.status).toBe(400);
    const ok = await api('put', `/api/projects/${created.body.id}`, { name: 'Valid', items_per_set: 4 });
    expect(ok.status).toBe(200);
    expect(ok.body.items_per_set).toBe(4);
  });

  test('plates: POST/PUT/PATCH reject bad items_per_plate, accept good', async () => {
    const p = (await api('post', '/api/projects', { name: 'Plates' })).body;
    for (const v of BAD.filter(x => x !== null && x !== '')) {
      const r = await api('post', `/api/projects/${p.id}/plates`, { name: 'a', items_per_plate: v });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/Items per plate must be a whole number of at least 1/);
    }
    const good = await api('post', `/api/projects/${p.id}/plates`, { name: 'a', items_per_plate: 5 });
    expect(good.status).toBe(201);
    const plate = good.body.plates[0];
    expect((await api('put', `/api/projects/${p.id}/plates/${plate.id}`, { ...plate, items_per_plate: 0 })).status).toBe(400);
    expect((await api('patch', `/api/projects/${p.id}/plates/${plate.id}`, { items_per_plate: -2 })).status).toBe(400);
    expect((await api('patch', `/api/projects/${p.id}/plates/${plate.id}`, { items_per_plate: 6 })).status).toBe(200);
    expect(db.prepare('SELECT items_per_plate FROM project_plates WHERE id=?').get(plate.id).items_per_plate).toBe(6);
  });

  test('3MF import: bad items_per_plate -> 400 and nothing inserted', async () => {
    const p = (await api('post', '/api/projects', { name: 'Import' })).body;
    const r = await api('post', `/api/projects/${p.id}/import-3mf`, { plates: [{ name: 'ok', items_per_plate: 2 }, { name: 'bad', items_per_plate: 1.5 }] });
    expect(r.status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) c FROM project_plates WHERE project_id=?').get(p.id).c).toBe(0);
    const ok = await api('post', `/api/projects/${p.id}/import-3mf`, { plates: [{ name: 'ok', items_per_plate: 2 }, { name: 'none' }] });
    expect(ok.status).toBe(201);
    expect(db.prepare('SELECT items_per_plate FROM project_plates WHERE project_id=? ORDER BY id').all(p.id).map(x => x.items_per_plate)).toEqual([2, 1]);
  });

  test('legacy REAL row: saving an unrelated field still works, changing the count to another bad value does not', async () => {
    const p = (await api('post', '/api/projects', { name: 'Legacy', items_per_set: 2 })).body;
    const pl = (await api('post', `/api/projects/${p.id}/plates`, { name: 'a', items_per_plate: 2 })).body.plates[0];
    db.prepare('UPDATE projects SET items_per_set = 2.5 WHERE id=?').run(p.id);
    db.prepare('UPDATE project_plates SET items_per_plate = 2.5 WHERE id=?').run(pl.id);
    expect((await api('put', `/api/projects/${p.id}`, { name: 'Renamed', items_per_set: 2.5 })).status).toBe(200);
    expect((await api('put', `/api/projects/${p.id}`, { name: 'Renamed', items_per_set: 2.75 })).status).toBe(400);
    expect((await api('put', `/api/projects/${p.id}/plates/${pl.id}`, { ...pl, name: 'b', items_per_plate: 2.5 })).status).toBe(200);
    expect((await api('put', `/api/projects/${p.id}/plates/${pl.id}`, { ...pl, items_per_plate: 3.5 })).status).toBe(400);
  });
});

/* ---------------------------------------------------------------- */
/*  6. explanation table on narrow screens                           */
/* ---------------------------------------------------------------- */
describe('explanation table columns keep a minimum width', () => {
  test('"How it counts" column has min-width so it cannot collapse into a tall sliver', () => {
    expect(css).toMatch(/\.calc-explain th:nth-child\(2\), \.calc-explain td:nth-child\(2\) \{ min-width: (\d+)px; \}/);
    expect(Number(css.match(/\.calc-explain th:nth-child\(2\), \.calc-explain td:nth-child\(2\) \{ min-width: (\d+)px/)[1])).toBeGreaterThanOrEqual(180);
  });
  test('explanation table sits in the scrolling wrapper', () => {
    const src = read('public/app.js');
    expect(src.slice(src.indexOf('function renderCalcExplanation'))).toMatch(/<div class="plates-table-wrap"><table>/);
    expect(css).toMatch(/\.plates-table-wrap \{\s*overflow-x: auto;/);
  });
});
