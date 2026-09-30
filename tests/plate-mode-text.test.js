'use strict';

/** Wording for plate mode (#2135) — the override must explain itself. */

const T = require('../public/plate-mode-text');
const eur = v => `€${v.toFixed(2)}`;

describe('share override wording', () => {
  test('label is self-explanatory, not a bare "proportional override"', () => {
    expect(T.SHARE_LABEL).toMatch(/share this set uses/i);
    expect(T.SHARE_LABEL).not.toMatch(/proportional/i);
  });

  // Three cases: fewer than a run (needs 1, makes 3), more + not multiple (needs 10, makes 4), exact multiple (needs 6, makes 3).
  const money = { shareCost: 0.133, wholeCost: 0.40, fmt: eur };

  test('fraction case: help, no euro, tooltip, badge, count label', () => {
    const t = T.shareHelp({ setSize: 1, ipp: 3, ...money });
    expect(t).toBe('This plate makes 3 per run and this set needs 1, so the set uses 1/3 of one run. '
      + 'With the override on, 1/3 of one run is charged instead of 1 whole run (€0.13 instead of €0.40). '
      + 'Turn it on when the leftover pieces will be used in later sets. '
      + 'Leave it off when leftovers are waste or spares, then whole runs are charged.');
    expect(T.shareHelp({ setSize: 1, ipp: 3 })).not.toContain('instead of €');
    expect(T.shareTooltip({ setSize: 1, ipp: 3, ...money })).toBe('Override on. This plate makes 3 per run and this set needs 1, '
      + 'so the set uses 1/3 of one run. With the override on, 1/3 of one run is charged instead of 1 whole run (€0.13 instead of €0.40). '
      + 'Edit the plate to switch it off.');
    expect(T.shareBadge(1, 3)).toBe('1/3 of a run, not 1');
    expect(T.shareBadge(2, 4)).toBe('1/2 of a run, not 1');
    expect(T.countLabel({ mode: 'share', shareNum: 1, shareDen: 3 }))
      .toBe('1/3 of one run instead of 1 whole run (override on: set needs 1, plate makes 3 per run)');
  });

  test('multi case (needs 10, makes 4): 2.5 runs instead of 3 whole runs, no "10 of the 4" nonsense', () => {
    const t = T.shareHelp({ setSize: 10, ipp: 4, shareCost: 1.25, wholeCost: 1.5, fmt: eur });
    expect(t).toContain('This plate makes 4 per run and this set needs 10, so the set uses 2.5 runs. '
      + 'With the override on, 2.5 runs are charged');
    expect(t).toContain('2.5 runs are charged instead of 3 whole runs (€1.25 instead of €1.50)');
    expect(t).not.toMatch(/10 of the 4|5\/2/);
    expect(T.shareTooltip({ setSize: 10, ipp: 4, shareCost: 1.25, wholeCost: 1.5, fmt: eur })).not.toMatch(/10 of the 4|5\/2/);
    expect(T.shareBadge(10, 4)).toBe('2.5 runs, not 3');
    expect(T.shareBadge(7, 3)).toBe('about 2.33 runs, not 3');
    expect(T.countLabel({ mode: 'share', shareNum: 10, shareDen: 4 }))
      .toBe('2.5 runs instead of 3 whole runs (override on: set needs 10, plate makes 4 per run)');
  });

  test('exact multiple (needs 6, makes 3): override has no effect and says so', () => {
    const t = T.shareHelp({ setSize: 6, ipp: 3, ...money });
    expect(t).toBe('This plate makes 3 per run and this set needs 6, which is exactly 2 whole runs, '
      + 'so this override changes nothing for this plate. It only matters if the set size or #/plate changes later.');
    expect(T.shareTooltip({ setSize: 6, ipp: 3 })).toContain('changes nothing for this plate');
    expect(T.shareBadge(6, 3)).toBe('2 runs, same as whole');
    expect(T.shareBadge(3, 3)).toBe('1 run, same as whole');
    expect(T.countLabel({ mode: 'share', shareNum: 6, shareDen: 3 }))
      .toBe('2 runs (override on, but it changes nothing: set needs 6, plate makes 3 per run, an exact multiple)');
  });

  test('fractions reduce', () => {
    expect(T.fraction(2, 4)).toBe('1/2');
    expect(T.fraction(4, 3)).toBe('4/3');
  });

  test('explanation paragraph: one plain sentence per plate, no repetition', () => {
    const out = T.overrideParagraph([
      { name: 'Legs', setSize: 1, ipp: 3, shareCost: 0.133, wholeCost: 0.4 },
      { name: 'Body', setSize: 10, ipp: 4, shareCost: 1.25, wholeCost: 1.5 },
      { name: 'Lid', setSize: 6, ipp: 3, shareCost: 1, wholeCost: 1 },
    ], eur);
    expect(out).toEqual([
      'Legs: counts 1/3 of one run instead of 1 whole run (€0.13 instead of €0.40); switch the override off in the plate editor if the leftovers are waste or spares.',
      'Body: counts 2.5 runs instead of 3 whole runs (€1.25 instead of €1.50); switch the override off in the plate editor if the leftovers are waste or spares.',
      'Lid: 6 \u00f7 3 is exactly 2 whole runs, so the override changes nothing here.',
    ]);
  });

  test('shareCosts: share vs whole-run euro, per-run cost cells', () => {
    const pb = { materialCost: 0.4, processingCost: 0, electricityCost: 0, printerUsageCost: 0 };
    expect(T.shareCosts(pb, 1, 3)).toEqual({ shareCost: 0.13, wholeCost: 0.4 });
    expect(T.shareCosts(pb, 10, 4)).toEqual({ shareCost: 1, wholeCost: 1.2 });
  });

  test('count labels', () => {
    expect(T.countLabel({ mode: 'once' })).toBe('printed once');
    expect(T.countLabel({ mode: 'runs', runs: 3, shareNum: 91, shareDen: 38 })).toMatch(/^3 runs \(91 ÷ 38/);
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
