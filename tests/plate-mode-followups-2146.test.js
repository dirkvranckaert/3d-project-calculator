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
    for (let set = 1; set <= 400; set++) for (let per = 1; per <= 400; per++) {
      const t = T.shareCase(set, per).badgeText;
      expect(t).not.toMatch(/about 1 runs/);
      const m = t.match(/^about ([\d.]+) runs?, not (\d+)/);
      if (m) expect(m[1]).not.toBe(m[2]);
      expect(t).not.toMatch(/(^|\s)1 runs/);
    }
  });
  test('scan is exhaustive: all 400 x 400 pairs (step 1) were visited', () => {
    let n = 0;
    for (let set = 1; set <= 400; set++) for (let per = 1; per <= 400; per++) { T.shareCase(set, per); n++; }
    expect(n).toBe(160000);
  });
  test('safe-integer boundary: 5999999999 / 2000000000 is just under 3, not exact', () => {
    const c = T.shareCase(5999999999, 2000000000);
    expect(c.shareText).toBe('just under 3 runs');
    expect(c.badgeText).toBe('just under 3 runs, not 3 whole runs');
    expect(T.shareCase(6000000001, 2000000000).badgeText).toBe('just over 3 runs, not 4');
    expect(T.runsQuantity(5999999999 / 2000000000).qual).toBe('just under ');
  });
  test('exact branch only when the quotient is exactly the shown value', () => {
    expect(T.runsQuantity(2.5)).toEqual({ qual: '', num: '2.5', one: false });
    expect(T.runsQuantity(3)).toEqual({ qual: '', num: '3', one: false });
    expect(T.runsQuantity(2.9999999995).qual).toBe('just under ');
  });
  test('legacy non-whole pair 1.998 / 2 uses the qualified formatter', () => {
    const c = T.shareCase(1.998, 2);
    expect(c.shareText).toBe('just under 1 run');
    expect(c.badgeText).toBe('just under 1 run, not 1 whole run');
    expect(T.shareStatement({ setSize: 1.998, ipp: 2 })).toMatch(/just under 1 run is charged instead of 1 whole run/);
    expect(T.shareCase(1.5, 4).badgeText).toBe('about 0.38 runs, not 1');
    expect(T.shareCase(1, 3).badgeText).toBe('1/3 of a run, not 1');
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
  let app, expressApp, db, cookie;
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.ADMIN_USER = 'u2146';
    process.env.ADMIN_PASS = 'p2146';
    process.env.DB_PATH = dbPath;
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true });
    jest.resetModules();
    // One shared listening server (same fix as tests/server.test.js): a fresh
    // ephemeral-port server per request flaked with "socket hang up" on Node 26.
    ({ app: expressApp } = require('../server'));
    app = require('http').createServer(expressApp).listen(0);
    db = require('../db').getDb();
    const res = await request(app).post('/login').send({ username: 'u2146', password: 'p2146' });
    cookie = res.headers['set-cookie'][0].split(';')[0];
  });
  afterAll(async () => {
    await new Promise((resolve) => app.close(resolve));
    for (const s of ['', '-wal', '-shm']) fs.rmSync(dbPath + s, { force: true });
  });
  const api = (m, u, body) => request(app)[m](u).set('Cookie', cookie).send(body);
  const BAD = [0, -1, 1.5, 'abc', null, NaN, Infinity, [], {}, true, ''];

  test.each(BAD.map(v => [JSON.stringify(v) ?? String(v), v]))('POST /api/projects rejects items_per_set %s', async (_l, v) => {
    const res = await api('post', '/api/projects', { name: 'X', items_per_set: v });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Items per set must be a whole number between 1 and 1000000/);
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
      expect(r.body.error).toMatch(/Items per plate must be a whole number between 1 and 1000000/);
    }
    const good = await api('post', `/api/projects/${p.id}/plates`, { name: 'a', items_per_plate: 5 });
    expect(good.status).toBe(201);
    const plate = good.body.plates[0];
    expect((await api('put', `/api/projects/${p.id}/plates/${plate.id}`, { ...plate, items_per_plate: 0 })).status).toBe(400);
    expect((await api('patch', `/api/projects/${p.id}/plates/${plate.id}`, { items_per_plate: -2 })).status).toBe(400);
    expect((await api('patch', `/api/projects/${p.id}/plates/${plate.id}`, { items_per_plate: 6 })).status).toBe(200);
    expect(db.prepare('SELECT items_per_plate FROM project_plates WHERE id=?').get(plate.id).items_per_plate).toBe(6);
  });

  test.each([
    ['unsafe numeric string', '9007199254740993'], ['unsafe number', 9007199254740993], ['1e100', 1e100],
    ['just over cap', 1000001], ['huge string', '99999999999999999999'], ['1e21 string', '1e21'],
  ])('unsafe/oversized run count %s is rejected on every write path', async (_l, v) => {
    const p = (await api('post', '/api/projects', { name: 'Big' })).body;
    expect((await api('post', '/api/projects', { name: 'X', items_per_set: v })).status).toBe(400);
    expect((await api('put', `/api/projects/${p.id}`, { name: 'Big', items_per_set: v })).status).toBe(400);
    expect((await api('post', `/api/projects/${p.id}/plates`, { name: 'a', items_per_plate: v })).status).toBe(400);
    const pl = (await api('post', `/api/projects/${p.id}/plates`, { name: 'a', items_per_plate: 2 })).body.plates[0];
    expect((await api('put', `/api/projects/${p.id}/plates/${pl.id}`, { ...pl, items_per_plate: v })).status).toBe(400);
    expect((await api('patch', `/api/projects/${p.id}/plates/${pl.id}`, { items_per_plate: v })).status).toBe(400);
    expect((await api('post', `/api/projects/${p.id}/import-3mf`, { plates: [{ name: 'i', items_per_plate: v }] })).status).toBe(400);
  });
  test('upper bound 1000000 accepted', async () => {
    const p = (await api('post', '/api/projects', { name: 'Cap', items_per_set: 1000000 })).body;
    expect(p.items_per_set).toBe(1000000);
  });

  test('null vs omitted: one rule on every write path (null rejected, omitted defaults on create/import, keeps on update)', async () => {
    const p = (await api('post', '/api/projects', { name: 'Nulls' })).body;
    expect((await api('post', '/api/projects', { name: 'N', items_per_set: null })).status).toBe(400);
    expect((await api('post', `/api/projects/${p.id}/plates`, { name: 'a', items_per_plate: null })).status).toBe(400);
    expect((await api('post', `/api/projects/${p.id}/import-3mf`, { plates: [{ name: 'n', items_per_plate: null }] })).status).toBe(400);
    expect(db.prepare('SELECT COUNT(*) c FROM project_plates WHERE project_id=?').get(p.id).c).toBe(0);
    const created = await api('post', `/api/projects/${p.id}/plates`, { name: 'omitted' });
    expect(created.status).toBe(201);
    const imp = await api('post', `/api/projects/${p.id}/import-3mf`, { plates: [{ name: 'omitted' }] });
    expect(imp.status).toBe(201);
    expect(db.prepare('SELECT items_per_plate FROM project_plates WHERE project_id=? ORDER BY id').all(p.id).map(x => x.items_per_plate)).toEqual([1, 1]);
    const pl = created.body.plates[0];
    expect((await api('put', `/api/projects/${p.id}/plates/${pl.id}`, { ...pl, items_per_plate: null })).status).toBe(400);
    expect((await api('patch', `/api/projects/${p.id}/plates/${pl.id}`, { items_per_plate: null })).status).toBe(400);
    expect((await api('put', `/api/projects/${p.id}`, { name: 'Nulls', items_per_set: null })).status).toBe(400);
    const kept = await api('patch', `/api/projects/${p.id}/plates/${pl.id}`, { name: 'renamed' });
    expect(kept.status).toBe(200);
  });

  test('plate duplicate is a server-side copy: legacy 2.5 copied verbatim, ownership checked, other flows do not 400', async () => {
    const p = (await api('post', '/api/projects', { name: 'Dup', items_per_set: 2 })).body;
    const other = (await api('post', '/api/projects', { name: 'Other' })).body;
    const pl = (await api('post', `/api/projects/${p.id}/plates`, { name: 'a', items_per_plate: 2, colors: ['#fff'], charge_share_only: 1 })).body.plates[0];
    db.prepare('UPDATE project_plates SET items_per_plate = 2.5 WHERE id=?').run(pl.id);
    db.prepare('UPDATE projects SET items_per_set = 2.5 WHERE id=?').run(p.id);
    const d = await api('post', `/api/projects/${p.id}/plates/${pl.id}/duplicate`);
    expect(d.status).toBe(201);
    const rows = db.prepare('SELECT * FROM project_plates WHERE project_id=? ORDER BY id').all(p.id);
    expect(rows).toHaveLength(2);
    expect(rows[1].items_per_plate).toBe(2.5);
    expect(rows[1].name).toBe('a (copy)');
    expect(rows[1].colors).toBe(rows[0].colors);
    expect(rows[1].charge_share_only).toBe(1);
    expect(rows[1].sort_order).toBeGreaterThan(rows[0].sort_order);
    // the body cannot inject a value
    const d2 = await api('post', `/api/projects/${p.id}/plates/${pl.id}/duplicate`, { items_per_plate: 99 });
    expect(d2.status).toBe(201);
    expect(db.prepare('SELECT items_per_plate FROM project_plates WHERE project_id=? ORDER BY id DESC').get(p.id).items_per_plate).toBe(2.5);
    // wrong project / unknown plate
    expect((await api('post', `/api/projects/${other.id}/plates/${pl.id}/duplicate`)).status).toBe(404);
    expect((await api('post', `/api/projects/${p.id}/plates/999999/duplicate`)).status).toBe(404);
    // other flows over legacy rows: project duplicate, toggle, unrelated PATCH
    const pd = await api('post', `/api/projects/${p.id}/duplicate`);
    expect(pd.status).toBe(201);
    expect(db.prepare('SELECT items_per_set FROM projects WHERE id=?').get(pd.body.id).items_per_set).toBe(2.5);
    expect(db.prepare('SELECT items_per_plate FROM project_plates WHERE project_id=?').all(pd.body.id).every(r => r.items_per_plate === 2.5)).toBe(true);
    expect((await api('patch', `/api/projects/${p.id}/plates/${pl.id}/toggle`)).status).toBe(200);
    expect((await api('patch', `/api/projects/${p.id}/plates/${pl.id}`, { name: 'x' })).status).toBe(200);
  });

  /* -------- duplicate copies EVERY column (#2146 round 3) -------- */
  const plateCols = () => db.prepare('PRAGMA table_info(project_plates)').all().map(c => c.name);
  const projCols = () => db.prepare('PRAGMA table_info(projects)').all().map(c => c.name);
  // "copy equals source except X": the generic assertion, built from the live column list.
  const expectCopyEquals = (copy, source, cols, except, expectedOverrides = {}) => {
    for (const c of cols) {
      if (except.includes(c)) continue;
      expect([c, copy[c]]).toEqual([c, source[c]]);
    }
    for (const [c, v] of Object.entries(expectedOverrides)) expect([c, copy[c]]).toEqual([c, v]);
  };
  // Give every optional plate column a distinctive non-default value.
  const richPlate = async () => {
    const printer = db.prepare("INSERT INTO printers (name) VALUES ('Dup printer')").run().lastInsertRowid;
    const material = db.prepare("INSERT INTO materials (name, material_type, price_per_kg) VALUES ('Dup PLA','PLA',20)").run().lastInsertRowid;
    const p = (await api('post', '/api/projects', { name: 'Rich', items_per_set: 4 })).body;
    const pl = (await api('post', `/api/projects/${p.id}/plates`, { name: 'rich', print_time_minutes: 90, plastic_grams: 33, items_per_plate: 2, risk_multiplier: 1.3, pre_processing_minutes: 5, post_processing_minutes: 7, printer_id: printer, material_id: material, material_waste_grams: 4, notes: 'n', colors: ['#123456'], enabled: false, charge_share_only: 1 })).body.plates[0];
    db.prepare('UPDATE project_plates SET source_plate_index = 3, source_file_id = ? WHERE id = ?').run('fictional-widget.3mf', pl.id);
    return { p, plateId: pl.id };
  };

  test('plate duplicate: every column equals the source except id/name/sort_order (enabled, mapping, share override, legacy count)', async () => {
    const { p, plateId } = await richPlate();
    db.prepare('UPDATE project_plates SET items_per_plate = 2.5 WHERE id = ?').run(plateId);
    const src = db.prepare('SELECT * FROM project_plates WHERE id=?').get(plateId);
    expect(src.enabled).toBe(0);
    expect(src.source_plate_index).toBe(3);
    expect((await api('post', `/api/projects/${p.id}/plates/${plateId}/duplicate`)).status).toBe(201);
    const copy = db.prepare('SELECT * FROM project_plates WHERE project_id=? AND id<>? ORDER BY id DESC').get(p.id, plateId);
    expectCopyEquals(copy, src, plateCols(), ['id', 'name', 'sort_order'], { name: 'rich (copy)', sort_order: src.sort_order + 1 });
    expect(copy.enabled).toBe(0);
    expect(copy.source_file_id).toBe('fictional-widget.3mf');
    expect(copy.charge_share_only).toBe(1);
    expect(copy.items_per_plate).toBe(2.5);
    // the column list really is live: every plates column is either compared or a named exclusion
    expect(plateCols()).toEqual(expect.arrayContaining(['source_plate_index', 'source_file_id', 'is_test_print', 'test_print_id', 'charge_share_only', 'enabled']));
  });

  test('plate duplicate: a plate with a null name stays unnamed (no "null (copy)")', async () => {
    const p = (await api('post', '/api/projects', { name: 'NoName' })).body;
    const pl = (await api('post', `/api/projects/${p.id}/plates`, {})).body.plates[0];
    await api('post', `/api/projects/${p.id}/plates/${pl.id}/duplicate`);
    expect(db.prepare('SELECT name FROM project_plates WHERE project_id=? ORDER BY id DESC').get(p.id).name).toBeNull();
  });

  test('plate duplicate: test-print plate source is refused with 400, nothing inserted, kind never changes', async () => {
    const p = (await api('post', '/api/projects', { name: 'TP' })).body;
    const tp = (await api('post', `/api/projects/${p.id}/test-prints`, { description: 'Fit test' })).body;
    const tpId = (tp.test_prints?.[0] || tp).id;
    const plateId = db.prepare("INSERT INTO project_plates (project_id, name, is_test_print, test_print_id, sort_order) VALUES (?, 'tp plate', 1, ?, 1)").run(p.id, tpId).lastInsertRowid;
    const orphanId = db.prepare("INSERT INTO project_plates (project_id, name, is_test_print, test_print_id, sort_order) VALUES (?, 'orphan tp', 1, NULL, 2)").run(p.id).lastInsertRowid;
    for (const id of [plateId, orphanId]) {
      const r = await api('post', `/api/projects/${p.id}/plates/${id}/duplicate`);
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/Test-print plates cannot be duplicated/);
    }
    expect(db.prepare('SELECT COUNT(*) c FROM project_plates WHERE project_id=?').get(p.id).c).toBe(2);
  });

  test('project duplicate: every plate column copied (mapping, enabled, share override, test-print kind) with test_print_id re-wired; every project column copied or a named exclusion', async () => {
    const { p, plateId } = await richPlate();
    const tp = (await api('post', `/api/projects/${p.id}/test-prints`, { description: 'Fit test' })).body;
    const tpId = (tp.test_prints?.[0] || tp).id;
    const tpPlate = db.prepare("INSERT INTO project_plates (project_id, name, is_test_print, test_print_id, sort_order, source_plate_index, source_file_id, charge_share_only) VALUES (?, 'tp', 1, ?, 9, 1, 'tp.3mf', 0)").run(p.id, tpId).lastInsertRowid;
    db.prepare("UPDATE projects SET plate_mode='batch', margin_locked=1, locked_margin_pct=33, design_invoiced_separately=1, is_custom=1, design_notes='dn', notes='pn', tags='a,b', customer_name='Fictional Cust', actual_sales_price=1234, archived=1 WHERE id=?").run(p.id);
    const srcProj = db.prepare('SELECT * FROM projects WHERE id=?').get(p.id);
    const r = await api('post', `/api/projects/${p.id}/duplicate`);
    expect(r.status).toBe(201);
    const copyProj = db.prepare('SELECT * FROM projects WHERE id=?').get(r.body.id);
    expectCopyEquals(copyProj, srcProj, projCols(), ['id', 'name', 'actual_sales_price', 'archived', 'created_at', 'updated_at'],
      { name: 'Rich (copy)', actual_sales_price: null, archived: 0 });
    expect(copyProj.plate_mode).toBe('batch');
    const srcPlates = db.prepare('SELECT * FROM project_plates WHERE project_id=? ORDER BY sort_order, id').all(p.id);
    const copyPlates = db.prepare('SELECT * FROM project_plates WHERE project_id=? ORDER BY sort_order, id').all(r.body.id);
    expect(copyPlates).toHaveLength(srcPlates.length);
    const newTp = db.prepare('SELECT id FROM project_test_prints WHERE project_id=?').get(r.body.id).id;
    srcPlates.forEach((s, i) => {
      expectCopyEquals(copyPlates[i], s, plateCols(), ['id', 'project_id', 'test_print_id'], { project_id: r.body.id });
      expect(copyPlates[i].test_print_id).toBe(s.test_print_id === null ? null : newTp);
    });
    expect(copyPlates.find(x => x.name === 'rich').source_file_id).toBe('fictional-widget.3mf');
    expect(copyPlates.find(x => x.name === 'tp').is_test_print).toBe(1);
    expect(tpPlate).toBeGreaterThan(plateId);
  });

  test('every table column is copied or named: a new column cannot be dropped silently', () => {
    // If this fails a column was added to projects/project_plates: copy it (plates
    // are automatic) or add it to the project duplicate's documented exclusions.
    expect(projCols().sort()).toEqual(['id', 'name', 'customer_name', 'items_per_set', 'actual_sales_price', 'tags', 'notes', 'archived', 'created_at', 'updated_at', 'is_custom', 'design_notes', 'margin_locked', 'target_margin_pct', 'locked_margin_pct', 'design_invoiced_separately', 'plate_mode'].sort());
  });

  /* -------- omitted run counts keep the stored value (#2146 round 3) -------- */
  test('omitted items_per_set / items_per_plate keep the stored value on PUT project, PUT plate and PATCH plate', async () => {
    const p = (await api('post', '/api/projects', { name: 'Keep', items_per_set: 6 })).body;
    const pl = (await api('post', `/api/projects/${p.id}/plates`, { name: 'k', items_per_plate: 3 })).body.plates[0];
    const { items_per_plate, ...plateNoCount } = pl;
    const put1 = await api('put', `/api/projects/${p.id}`, { name: 'Keep renamed' });
    expect(put1.status).toBe(200);
    expect(put1.body.items_per_set).toBe(6);
    expect(db.prepare('SELECT items_per_set FROM projects WHERE id=?').get(p.id).items_per_set).toBe(6);
    const put2 = await api('put', `/api/projects/${p.id}/plates/${pl.id}`, plateNoCount);
    expect(put2.status).toBe(200);
    expect(db.prepare('SELECT items_per_plate FROM project_plates WHERE id=?').get(pl.id).items_per_plate).toBe(3);
    const patch = await api('patch', `/api/projects/${p.id}/plates/${pl.id}`, { name: 'patched' });
    expect(patch.status).toBe(200);
    expect(db.prepare('SELECT items_per_plate, name FROM project_plates WHERE id=?').get(pl.id)).toEqual({ items_per_plate: 3, name: 'patched' });
    // a legacy stored value is kept verbatim too
    db.prepare('UPDATE projects SET items_per_set = 2.5 WHERE id=?').run(p.id);
    db.prepare('UPDATE project_plates SET items_per_plate = 2.5 WHERE id=?').run(pl.id);
    expect((await api('put', `/api/projects/${p.id}`, { name: 'Keep renamed' })).status).toBe(200);
    expect((await api('put', `/api/projects/${p.id}/plates/${pl.id}`, plateNoCount)).status).toBe(200);
    expect(db.prepare('SELECT items_per_set FROM projects WHERE id=?').get(p.id).items_per_set).toBe(2.5);
    expect(db.prepare('SELECT items_per_plate FROM project_plates WHERE id=?').get(pl.id).items_per_plate).toBe(2.5);
    // unknown project / plate -> 404, not a 500
    expect((await api('put', '/api/projects/999999', { name: 'x' })).status).toBe(404);
    expect((await api('put', `/api/projects/${p.id}/plates/999999`, plateNoCount)).status).toBe(404);
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

  /* -------- atomic multi-statement writes + identifier quoting (#2146 round 4) -------- */
  const counts = () => Object.fromEntries(['projects', 'project_plates', 'project_extra_costs', 'project_extra_hours', 'project_design_extras', 'project_test_prints']
    .map(t => [t, db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c]));
  const withTrigger = async (sql, fn) => {
    db.exec(sql);
    try { await fn(); } finally { db.exec('DROP TRIGGER IF EXISTS t_fail_2146'); }
  };

  async function seedFullProject(name, plateNames) {
    const p = (await api('post', '/api/projects', { name })).body;
    for (const n of plateNames) await api('post', `/api/projects/${p.id}/plates`, { name: n });
    const ec = db.prepare("INSERT INTO extra_cost_items (name, price_excl_vat) VALUES (?, 1)").run(`ec ${name}`).lastInsertRowid;
    db.prepare('INSERT INTO project_extra_costs (project_id, extra_cost_id, quantity) VALUES (?,?,1)').run(p.id, ec);
    db.prepare("INSERT INTO project_extra_hours (project_id, description, hours, hourly_rate, is_design_cost) VALUES (?, 'dh', 1, 10, 1)").run(p.id);
    db.prepare("INSERT INTO project_design_extras (project_id, description, amount) VALUES (?, 'de', 5)").run(p.id);
    await api('post', `/api/projects/${p.id}/test-prints`, { description: 'tp-boom' });
    return p;
  }

  test('project duplicate is atomic: a plate insert failing midway leaves nothing of the new project', async () => {
    const p = await seedFullProject('Atomic A', ['first', 'boom-plate']);
    const before = counts();
    await withTrigger(`CREATE TRIGGER t_fail_2146 BEFORE INSERT ON project_plates WHEN NEW.name = 'boom-plate'
      BEGIN SELECT RAISE(ABORT, 'forced plate failure'); END`, async () => {
      expect((await api('post', `/api/projects/${p.id}/duplicate`)).status).toBe(500);
    });
    expect(counts()).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) c FROM projects WHERE name = 'Atomic A (copy)'").get().c).toBe(0);
    expect((await api('post', `/api/projects/${p.id}/duplicate`)).status).toBe(201); // trigger gone: copy works
  });

  test('project duplicate is atomic: a test-print insert failing after plates/extras/hours were copied leaves nothing', async () => {
    const p = await seedFullProject('Atomic B', ['only']);
    const before = counts();
    await withTrigger(`CREATE TRIGGER t_fail_2146 BEFORE INSERT ON project_test_prints WHEN NEW.description = 'tp-boom'
      BEGIN SELECT RAISE(ABORT, 'forced test-print failure'); END`, async () => {
      expect((await api('post', `/api/projects/${p.id}/duplicate`)).status).toBe(500);
    });
    expect(counts()).toEqual(before);
  });

  test('plate duplicate is atomic: copy + project touch roll back together', async () => {
    const p = (await api('post', '/api/projects', { name: 'Atomic C' })).body;
    const pl = (await api('post', `/api/projects/${p.id}/plates`, { name: 'c' })).body.plates[0];
    const before = counts();
    await withTrigger(`CREATE TRIGGER t_fail_2146 BEFORE UPDATE ON projects WHEN NEW.id = ${p.id}
      BEGIN SELECT RAISE(ABORT, 'forced touch failure'); END`, async () => {
      expect((await api('post', `/api/projects/${p.id}/plates/${pl.id}/duplicate`)).status).toBe(500);
    });
    expect(counts()).toEqual(before);
  });

  test('3MF import is all-or-nothing on a database failure too, not only on validation', async () => {
    const p = (await api('post', '/api/projects', { name: 'Atomic D' })).body;
    const before = counts();
    await withTrigger(`CREATE TRIGGER t_fail_2146 BEFORE INSERT ON project_plates WHEN NEW.name = 'boom-import'
      BEGIN SELECT RAISE(ABORT, 'forced import failure'); END`, async () => {
      const r = await api('post', `/api/projects/${p.id}/import-3mf`, { plates: [{ name: 'fine' }, { name: 'boom-import' }] });
      expect(r.status).toBe(500);
    });
    expect(counts()).toEqual(before);
  });

  test('plate create / PUT / PATCH: plate write + project touch roll back together', async () => {
    const p = (await api('post', '/api/projects', { name: 'Atomic E' })).body;
    const pl = (await api('post', `/api/projects/${p.id}/plates`, { name: 'e' })).body.plates[0];
    const before = counts();
    const plateRow = () => db.prepare('SELECT name, items_per_plate FROM project_plates WHERE id=?').get(pl.id);
    await withTrigger(`CREATE TRIGGER t_fail_2146 BEFORE UPDATE ON projects WHEN NEW.id = ${p.id}
      BEGIN SELECT RAISE(ABORT, 'forced touch failure'); END`, async () => {
      expect((await api('post', `/api/projects/${p.id}/plates`, { name: 'new' })).status).toBe(500);
      expect((await api('put', `/api/projects/${p.id}/plates/${pl.id}`, { ...pl, name: 'renamed' })).status).toBe(500);
      expect((await api('patch', `/api/projects/${p.id}/plates/${pl.id}`, { name: 'patched' })).status).toBe(500);
    });
    expect(counts()).toEqual(before);
    expect(plateRow().name).toBe('e');
  });

  test('quoteIdent double-quotes and escapes embedded quotes', () => {
    const { quoteIdent } = require('../server');
    expect(quoteIdent('name')).toBe('"name"');
    expect(quoteIdent('order')).toBe('"order"');
    expect(quoteIdent('odd col')).toBe('"odd col"');
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });

  test('plate duplicate copies a future column whose name needs quoting (reserved word, space, embedded quote)', async () => {
    const p = (await api('post', '/api/projects', { name: 'Quoting' })).body;
    const pl = (await api('post', `/api/projects/${p.id}/plates`, { name: 'q' })).body.plates[0];
    db.exec('ALTER TABLE project_plates ADD COLUMN "order" TEXT; ALTER TABLE project_plates ADD COLUMN "odd col" TEXT; ALTER TABLE project_plates ADD COLUMN "q""x" TEXT');
    try {
      db.prepare('UPDATE project_plates SET "order"=?, "odd col"=?, "q""x"=? WHERE id=?').run('o', 'sp', 'qq', pl.id);
      expect((await api('post', `/api/projects/${p.id}/plates/${pl.id}/duplicate`)).status).toBe(201);
      const copy = db.prepare('SELECT * FROM project_plates WHERE project_id=? AND id<>?').get(p.id, pl.id);
      expect([copy.order, copy['odd col'], copy['q"x']]).toEqual(['o', 'sp', 'qq']);
      expect((await api('post', `/api/projects/${p.id}/duplicate`)).status).toBe(201);
    } finally {
      db.exec('ALTER TABLE project_plates DROP COLUMN "order"; ALTER TABLE project_plates DROP COLUMN "odd col"; ALTER TABLE project_plates DROP COLUMN "q""x"');
    }
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
