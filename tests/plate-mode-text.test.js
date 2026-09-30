'use strict';

/** Wording for plate mode (#2135) — the override must explain itself. */

const T = require('../public/plate-mode-text');
const eur = v => `€${v.toFixed(2)}`;

describe('share override wording', () => {
  test('label is self-explanatory, not a bare "proportional override"', () => {
    expect(T.SHARE_LABEL).toMatch(/share this set uses/i);
    expect(T.SHARE_LABEL).not.toMatch(/proportional/i);
  });

  test('help text carries the plate numbers and the impact (Legs: makes 3, set needs 1)', () => {
    const t = T.shareHelp({ setSize: 1, ipp: 3, shareCost: 0.133, wholeCost: 0.40, fmt: eur });
    expect(t).toContain('This plate makes 3 per run and this set needs 1');
    expect(t).toContain('counts 1/3 of the plate');
    expect(t).toContain('€0.13 instead of €0.40 for whole runs');
    expect(t).toMatch(/Leave it off when leftovers are waste or spares/);
  });

  test('help text without saved costs omits the euro clause', () => {
    const t = T.shareHelp({ setSize: 1, ipp: 3 });
    expect(t).toContain('counts 1/3 of the plate');
    expect(t).not.toContain('for whole runs)');
  });

  test('fractions are reduced; set larger than plate reads correctly', () => {
    expect(T.fraction(2, 4)).toBe('1/2');
    expect(T.fraction(4, 3)).toBe('4/3');
    expect(T.shareBadge(1, 3)).toBe('1/3 of plate');
    expect(T.shareBadge(6, 3)).toBe('2 plates');
  });

  test('tooltip repeats the explanation', () => {
    const t = T.shareTooltip({ setSize: 1, ipp: 3 });
    expect(t).toContain('1/3 of plate');
    expect(t).toContain('not a whole print run');
  });

  test('count labels', () => {
    expect(T.countLabel({ mode: 'once' })).toBe('printed once');
    expect(T.countLabel({ mode: 'runs', runs: 3, shareNum: 91, shareDen: 38 })).toMatch(/^3 runs \(91 ÷ 38/);
    expect(T.countLabel({ mode: 'share', shareNum: 1, shareDen: 3 })).toMatch(/share 1\/3 of a run \(override/);
  });
});

describe('mode + quantity wording', () => {
  test('labels', () => {
    expect(T.modeLabel('parts')).toBe('Parts of one item');
    expect(T.modeLabel('batch')).toBe('Batch run');
    expect(T.modeLabel('nonsense')).toBe('Parts of one item');
  });
  test('quantity check messages', () => {
    expect(T.quantityCheckMessage({ status: 'ok' })).toBeNull();
    expect(T.quantityCheckMessage(null)).toBeNull();
    expect(T.quantityCheckMessage({ status: 'spare', onPlates: 45, itemsPerSet: 40, spare: 5, sparePct: 12.5 }))
      .toEqual({ level: 'spare', text: '45 on plates for set of 40 → 5 spare (12.5%)' });
    const short = T.quantityCheckMessage({ status: 'short', onPlates: 30, itemsPerSet: 40, shortfall: 10 });
    expect(short.level).toBe('short');
    expect(short.text).toContain('10 short');
  });
  test('info hint modifier outranks the base .field-hint warning colour', () => {
    const css = require('fs').readFileSync(require('path').join(__dirname, '../public/style.css'), 'utf8');
    expect(css).toMatch(/\.field-hint\.field-hint--info\s*\{/);
  });
});

describe('stale euro example guard (review round 1, finding 2)', () => {
  const saved = { minutes: 463, plastic: '238.36', items: '3', risk: '1', waste: '0',
    pre: '0', post: '2', printer: '1', material: '4' };

  test('every cost-driving form field is covered', () => {
    expect([...T.COST_FIELDS].sort()).toEqual(Object.keys(saved).sort());
  });

  test('unchanged form -> not changed (numeric strings compare as numbers)', () => {
    expect(T.costFieldsChanged(saved, { ...saved, plastic: '238.360', post: '2.0' })).toBe(false);
  });

  test.each(Object.keys(saved))('editing %s -> changed, so the euro example is dropped', (k) => {
    const cur = { ...saved, [k]: String(Number(saved[k]) + 1) };
    expect(T.costFieldsChanged(saved, cur)).toBe(true);
  });

  test('clearing printer/material (empty select) counts as a change', () => {
    expect(T.costFieldsChanged(saved, { ...saved, printer: '' })).toBe(true);
  });
});

describe('stale euro example: baseline is the RAW saved plate, not the rendered form (round 3)', () => {
  const row = { print_time_minutes: 59.6, plastic_grams: 10, items_per_plate: 3, risk_multiplier: 1,
    material_waste_grams: 0, pre_processing_minutes: 0, post_processing_minutes: 2, printer_id: 1, material_id: 4 };
  // What openPlateModal renders for 59.6 min: floor(59.6/60)=0 h, round(59.6%60)=60 min.
  const form = (plate) => ({ hours: String(Math.floor(plate.print_time_minutes / 60)),
    minutes: String(Math.round(plate.print_time_minutes % 60)), plastic: String(plate.plastic_grams),
    items: String(plate.items_per_plate), risk: String(plate.risk_multiplier), waste: String(plate.material_waste_grams),
    pre: String(plate.pre_processing_minutes), post: String(plate.post_processing_minutes),
    printer: String(plate.printer_id), material: String(plate.material_id) });

  test('59.6 min renders as 0h60m -> counts as CHANGED (no stale euro figure)', () => {
    expect(form(row).hours).toBe('0');
    expect(form(row).minutes).toBe('60');
    expect(T.costFieldsChanged(T.savedCostFields(row), T.formCostFields(form(row)))).toBe(true);
  });

  test('whole-minute plate: rendered form equals the raw baseline -> unchanged', () => {
    const r = { ...row, print_time_minutes: 463 };
    expect(T.costFieldsChanged(T.savedCostFields(r), T.formCostFields(form(r)))).toBe(false);
  });

  test.each(T.COST_FIELDS)('every saved field is read from the raw row: %s', (k) => {
    const saved = T.savedCostFields(row);
    expect(saved[k]).not.toBeUndefined();
    const cur = T.formCostFields({ ...form(row), ...(k === 'minutes' ? { hours: '1', minutes: '0' } : { [k]: '99' }) });
    expect(T.costFieldsChanged(saved, cur)).toBe(k === 'minutes' ? true : true);
  });
});

describe('one cents rule for every displayed money figure (round 3)', () => {
  const calc = require('../calc');
  const grid = [2.675, 1.005, 0.125, 0.135, 8.085, 9.7107, 0.4024 / 3, 0, 1e-9, 123456.785, 2.5, 0.005];

  test('cents equals calc.roundToCents over the value grid', () => {
    for (const v of grid) expect(T.cents(v)).toBe(calc.roundToCents(v));
  });

  test('half-cent: cell 2.675 shows 2.68 (toFixed would say 2.67), same as the total', () => {
    expect((2.675).toFixed(2)).toBe('2.67');
    expect(T.cents(2.675)).toBe(2.68);
    const pb = { materialCost: 2.675, processingCost: 0, electricityCost: 0, printerUsageCost: 0 };
    expect(T.rowTotal(pb)).toBe(2.68);
  });

  test('row total is always the sum of the four displayed (cents) cells', () => {
    const pb = { materialCost: 2.675, processingCost: 0.125, electricityCost: 1.005, printerUsageCost: 0.135 };
    const shown = ['materialCost', 'processingCost', 'electricityCost', 'printerUsageCost'].map(k => T.cents(pb[k]));
    expect(T.rowTotal(pb)).toBe(T.cents(shown.reduce((a, b) => a + b, 0)));
  });

  test('app.js formats every plate-table/sum/explanation money figure through fmtCents', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../public/app.js'), 'utf8');
    const plateTable = src.slice(src.indexOf('const rows = productionPlates.map'), src.indexOf('function renderCostSection'));
    const explain = src.slice(src.indexOf('function renderCalcExplanation'), src.indexOf('Material required (total filament'));
    for (const chunk of [plateTable, explain]) {
      expect(chunk).not.toMatch(/\$\{fmt\((?!undefined)/);
    }
  });
});
