'use strict';

/**
 * Plate mode (#2135): `parts` (whole runs, optional per-plate "charge only the
 * share this set uses") vs `batch` (every enabled plate printed exactly once).
 * Acceptance values come from the agreed spec table, using the real production
 * plate numbers (2026-09-30 copy).
 */

const calc = require('../calc');

const settings = {
  hourly_rate: 40, electricity_price_kwh: 0.40, vat_rate: 21,
  material_profit_pct: 200, processing_profit_pct: 0,
  electricity_profit_pct: 0, printer_cost_profit_pct: 50, price_rounding: 0.99,
};

// BambuLab H2C (PLA 0.25 kWh/h) — the printer all spec projects use.
function plate(id, name, timeMin, grams, ipp, extra = {}) {
  return {
    id, name, print_time_minutes: timeMin, plastic_grams: grams, items_per_plate: ipp,
    risk_multiplier: 1, pre_processing_minutes: 0, post_processing_minutes: 2,
    material_waste_grams: 0, enabled: 1, is_test_print: 0,
    printer_purchase_price: 1889.92, printer_earn_back_months: 24, printer_kwh_per_hour: 0.25,
    material_price_per_kg: 17.38, ...extra,
  };
}

const run = (plates, itemsPerSet, plateMode) =>
  calc.calculateProject({ plates, settings, itemsPerSet, plateMode });

const keychains = () => [
  plate(1, 'Geel', 473, 215.34, 38),
  plate(2, 'Rood', 479, 221.09, 39),
  plate(3, 'Geel small', 67, 28.8, 7),
  plate(4, 'Rood small', 60, 26.06, 7),
];
const kg = 17.38 / 1000;

describe('#32 keychains, set 91', () => {
  test('parts: whole runs (3/3/13/13) drive material and time', () => {
    const r = run(keychains(), 91, 'parts');
    const expected = 3 * 215.34 * kg + 3 * 221.09 * kg + 13 * 28.8 * kg + 13 * 26.06 * kg;
    expect(r.totals.materialCost).toBeCloseTo(expected, 6);
    expect(r.totals.materialCost).toBeCloseTo(3 * 3.74 + 3 * 3.84 + 13 * 0.50 + 13 * 0.45, 0);
    // 3*473 + 3*479 + 13*67 + 13*60 = 4507 min = 75h07 (unchanged from before)
    expect(r.totals.minutes).toBe(4507);
    expect(r.totalPrintTimeMinutes).toBe(4507);
    expect(r.plateBreakdowns.map(p => p.count.runs)).toEqual([3, 3, 13, 13]);
    expect(r.plateBreakdowns.every(p => p.count.mode === 'runs')).toBe(true);
  });

  test('batch: plain sum, one run each', () => {
    const r = run(keychains(), 91, 'batch');
    // spec says 8.53 = the four parts each rounded to cents; exact sum is 8.5386
    expect(r.totals.materialCost).toBeCloseTo(8.5386, 3);
    expect(r.totals.minutes).toBe(1079); // 17h59
    expect(r.totals.plasticGrams).toBeCloseTo(491.29, 2);
    expect(r.plateBreakdowns.every(p => p.count.mode === 'once' && p.count.runs === 1)).toBe(true);
    // per item = total / items per set
    expect(r.perItemCosts.materialCost).toBeCloseTo(r.totals.materialCost / 91, 8);
    expect(r.pricing.baseCostPerSet).toBeCloseTo(r.totals.totalCost, 8);
  });

  test('batch quantity check: 38+39+7+7 = 91 on plates for set of 91 -> nothing', () => {
    const r = run(keychains(), 91, 'batch');
    expect(r.quantityCheck).toMatchObject({ onPlates: 91, itemsPerSet: 91, status: 'ok' });
  });

  test('parts mode has no quantity check', () => {
    expect(run(keychains(), 91, 'parts').quantityCheck).toBeNull();
  });
});

describe('#29 containers, set 100, 4 per plate, parts', () => {
  test('25 runs each -> (8.09 + 1.62) x 25', () => {
    const plates = [
      plate(1, 'Containers PLA', 1064, 465.23, 4),
      plate(2, 'Lids PLA', 170, 93.19, 4),
    ];
    const r = run(plates, 100, 'parts');
    expect(r.totals.materialCost).toBeCloseTo(25 * (465.23 + 93.19) * kg, 6);
    expect(r.totals.materialCost).toBeCloseTo(242.75, 0);
    expect(r.plateBreakdowns.map(p => p.count.runs)).toEqual([25, 25]);
  });
});

describe('#1 Henriegga, set 1, parts', () => {
  const plates = (override) => [
    plate(1, 'Body', 463, 238.36, 1),
    plate(2, 'Head (open eyes)', 280, 80.64, 1),
    plate(3, 'Legs', 49, 23.15, 3, override ? { charge_share_only: 1 } : {}),
    plate(4, 'Head (closed eyes)', 202, 67.9, 1),
  ];
  const withClosed = plates;

  test('no override: Legs counts a whole run (0.40)', () => {
    const r = run(withClosed(false), 1, 'parts');
    expect(r.totals.materialCost).toBeCloseTo(4.14 + 1.40 + 0.40 + 1.18, 1);
    expect(r.plateBreakdowns[2].count).toMatchObject({ mode: 'runs', runs: 1 });
  });

  test('override on: Legs counts 1/3 of the plate (0.13)', () => {
    const r = run(withClosed(true), 1, 'parts');
    expect(r.totals.materialCost).toBeCloseTo(4.14 + 1.40 + 0.13 + 1.18, 1);
    const legs = r.plateBreakdowns[2];
    expect(legs.count).toMatchObject({ mode: 'share', shareNum: 1, shareDen: 3 });
    expect(legs.factor).toBeCloseTo(1 / 3, 10);
    expect(legs.contribution.materialCost).toBeCloseTo(23.15 * kg / 3, 8);
    // time is prorated too
    expect(legs.contribution.minutes).toBeCloseTo(49 / 3, 8);
  });

  test('override ignored in batch mode (plate counts once)', () => {
    const r = run(withClosed(true), 1, 'batch');
    expect(r.plateBreakdowns[2].count.mode).toBe('once');
    expect(r.totals.materialCost).toBeCloseTo(4.14 + 1.40 + 0.40 + 1.18, 1);
  });
});

describe('#33 Mini Konijntjes, set 40, plate of 45, batch', () => {
  const plates = [plate(1, 'Lil buns', 519, 74.26, 45)];
  test('full plate is charged once; per item = / 40', () => {
    const r = run(plates, 40, 'batch');
    expect(r.totals.materialCost).toBeCloseTo(1.29, 2);
    expect(r.totals.totalCost).toBeCloseTo(4.44, 1);
    expect(r.perItemCosts.totalPerItem).toBeCloseTo(r.totals.totalCost / 40, 8);
  });
  test('spare info: 45 on plates for set of 40 -> 5 spare (12.5%)', () => {
    const q = run(plates, 40, 'batch').quantityCheck;
    expect(q).toMatchObject({ status: 'spare', onPlates: 45, itemsPerSet: 40, spare: 5 });
    expect(q.sparePct).toBeCloseTo(12.5, 6);
  });
  test('shortfall: fewer on plates than set -> short', () => {
    const q = run([plate(1, 'p', 60, 10, 30)], 40, 'batch').quantityCheck;
    expect(q).toMatchObject({ status: 'short', onPlates: 30, shortfall: 10 });
  });
});

describe('sum row (single run of every enabled plate)', () => {
  test('is the raw one-run sum regardless of mode, skips disabled and test prints', () => {
    const plates = [
      ...keychains(),
      plate(9, 'off', 100, 100, 1, { enabled: 0 }),
      plate(10, 'test', 100, 100, 1, { is_test_print: 1 }),
    ];
    for (const mode of ['parts', 'batch']) {
      const r = run(plates, 91, mode);
      expect(r.plateSum.minutes).toBe(1079);
      expect(r.plateSum.plasticGrams).toBeCloseTo(491.29, 2);
      expect(r.plateSum.materialCost).toBeCloseTo(8.5386, 3);
      expect(r.plateSum.totalCost).toBeCloseTo(
        r.plateSum.materialCost + r.plateSum.processingCost
        + r.plateSum.electricityCost + r.plateSum.printerUsageCost, 8);
    }
  });
});

describe('every total comes from the same run count', () => {
  test('risk multiplies time+plastic per run; runs multiply everything', () => {
    const p = plate(1, 'p', 60, 100, 4, { risk_multiplier: 2 });
    const r = run([p], 10, 'parts'); // 3 runs
    const one = calc.calculatePlateCosts(p,
      { purchase_price: 1889.92, earn_back_months: 24, kwh_per_hour: 0.25 },
      { price_per_kg: 17.38 }, { hourly_rate: 40, electricity_price_kwh: 0.4 });
    expect(r.totals.materialCost).toBeCloseTo(3 * one.materialCost, 8);
    expect(r.totals.processingCost).toBeCloseTo(3 * one.processingCost, 8);
    expect(r.totals.electricityCost).toBeCloseTo(3 * one.electricityCost, 8);
    expect(r.totals.printerUsageCost).toBeCloseTo(3 * one.printerUsageCost, 8);
    expect(r.totals.plasticGrams).toBeCloseTo(3 * 200, 8);
    expect(r.totals.minutes).toBe(180); // raw minutes, no risk (matches Time column)
    // material requirements follow the same run count
    expect(r.materialRequirements.reduce((s, m) => s + m.grams, 0)).toBeCloseTo(600, 6);
  });

  test('default plateMode is parts', () => {
    const r = calc.calculateProject({ plates: [plate(1, 'p', 60, 100, 4)], settings, itemsPerSet: 10 });
    expect(r.plateMode).toBe('parts');
    expect(r.plateBreakdowns[0].count.runs).toBe(3);
  });

  test('calculateTotalPrintTime honours plate mode and override', () => {
    const ps = [plate(1, 'a', 90, 1, 3), plate(2, 'b', 30, 1, 3, { charge_share_only: 1 })];
    expect(calc.calculateTotalPrintTime(ps, 4, 'parts')).toBeCloseTo(2 * 90 + 30 * 4 / 3, 8);
    expect(calc.calculateTotalPrintTime(ps, 4, 'batch')).toBe(120);
  });
});
