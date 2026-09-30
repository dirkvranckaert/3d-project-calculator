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
const cents = (n) => Math.round(n * 100) / 100;

describe('#32 keychains, set 91', () => {
  test('parts: whole runs (3/3/13/13) drive material and time', () => {
    const r = run(keychains(), 91, 'parts');
    const expected = 3 * 215.34 * kg + 3 * 221.09 * kg + 13 * 28.8 * kg + 13 * 26.06 * kg;
    expect(expected).toBeCloseTo(35.15, 2); // unrounded reference; cents rule gives 35.09
    // per-plate cost is rounded to cents BEFORE the run multiplication
    expect(r.totals.materialCost).toBe(35.09);
    expect(cents(3 * 3.74 + 3 * 3.84 + 13 * 0.50 + 13 * 0.45)).toBe(35.09);
    // 3*473 + 3*479 + 13*67 + 13*60 = 4507 min = 75h07 (unchanged from before)
    expect(r.totals.minutes).toBe(4507);
    expect(r.totalPrintTimeMinutes).toBe(4507);
    expect(r.plateBreakdowns.map(p => p.count.runs)).toEqual([3, 3, 13, 13]);
    expect(r.plateBreakdowns.every(p => p.count.mode === 'runs')).toBe(true);
  });

  test('batch: plain sum, one run each', () => {
    const r = run(keychains(), 91, 'batch');
    // 3.74 + 3.84 + 0.50 + 0.45 = 8.53 (each plate rounded to cents, as the spec pins)
    expect(r.totals.materialCost).toBe(8.53);
    expect(r.totals.minutes).toBe(1079); // 17h59
    expect(r.totals.plasticGrams).toBeCloseTo(491.29, 2);
    expect(r.plateBreakdowns.every(p => p.count.mode === 'once' && p.count.runs === 1)).toBe(true);
    // per item = total / items per set
    expect(r.perItemCosts.materialCost).toBeCloseTo(r.totals.materialCost / 91, 8);
    expect(r.pricing.baseCostPerSet).toBeCloseTo(r.totals.totalCost, 8);
    expect(r.totals.totalCost).toBe(cents(r.totals.materialCost + r.totals.processingCost
      + r.totals.electricityCost + r.totals.printerUsageCost));
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
    expect(r.plateBreakdowns.map(p => cents(p.materialCost))).toEqual([8.09, 1.62]);
    expect(r.totals.materialCost).toBe(242.75); // was 242.63 with unrounded per-run costs
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
    expect(r.plateBreakdowns.map(p => cents(p.materialCost))).toEqual([4.14, 1.40, 0.40, 1.18]);
    expect(r.totals.materialCost).toBe(7.12); // was 7.13 with unrounded per-run costs
    expect(r.plateBreakdowns[2].count).toMatchObject({ mode: 'runs', runs: 1 });
  });

  test('override on: Legs counts 1/3 of the plate (0.13)', () => {
    const r = run(withClosed(true), 1, 'parts');
    expect(r.totals.materialCost).toBe(6.85);
    const legs = r.plateBreakdowns[2];
    expect(legs.count).toMatchObject({ mode: 'share', shareNum: 1, shareDen: 3 });
    expect(legs.factor).toBeCloseTo(1 / 3, 10);
    expect(legs.contribution.materialCost).toBe(0.13);
    // time is prorated too
    expect(legs.contribution.minutes).toBeCloseTo(49 / 3, 8);
  });

  test('override ignored in batch mode (plate counts once)', () => {
    const r = run(withClosed(true), 1, 'batch');
    expect(r.plateBreakdowns[2].count.mode).toBe('once');
    expect(r.totals.materialCost).toBe(7.12);
  });
});

describe('#33 Mini Konijntjes, set 40, plate of 45, batch', () => {
  const plates = [plate(1, 'Lil buns', 519, 74.26, 45)];
  test('full plate is charged once; per item = / 40', () => {
    const r = run(plates, 40, 'batch');
    expect(r.totals.materialCost).toBe(1.29);
    expect(r.totals.totalCost).toBe(4.44);
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
      expect(r.plateSum.materialCost).toBe(8.53);
      expect(r.plateSum.totalCost).toBe(cents(
        r.plateSum.materialCost + r.plateSum.processingCost
        + r.plateSum.electricityCost + r.plateSum.printerUsageCost));
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
    expect(r.totals.materialCost).toBe(cents(3 * cents(one.materialCost)));
    expect(r.totals.processingCost).toBe(cents(3 * cents(one.processingCost)));
    expect(r.totals.electricityCost).toBe(cents(3 * cents(one.electricityCost)));
    expect(r.totals.printerUsageCost).toBe(cents(3 * cents(one.printerUsageCost)));
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

describe('every displayed number agrees to the cent', () => {
  const cases = {
    'parts #32': [keychains(), 91, 'parts'],
    'batch #32': [keychains(), 91, 'batch'],
    'parts #1 override': [[plate(1, 'a', 463, 238.36, 1), plate(3, 'Legs', 49, 23.15, 3, { charge_share_only: 1 })], 1, 'parts'],
  };
  test.each(Object.keys(cases))('%s: totals == sum of explanation rows; cost boxes == totals', (name) => {
    const [pl, set, mode] = cases[name];
    const r = run(pl, set, mode);
    for (const k of ['materialCost', 'processingCost', 'electricityCost', 'printerUsageCost', 'totalCost']) {
      const rows = r.plateBreakdowns.filter(b => b.enabled).reduce((s, b) => s + b.contribution[k], 0);
      expect(cents(rows)).toBe(r.totals[k]);
    }
    // cost boxes are per-item x set; must land on the same cents as the totals
    expect(cents(r.perItemCosts.materialCost * set)).toBe(r.totals.materialCost);
    expect(cents(r.pricing.baseCostPerSet)).toBe(r.totals.totalCost);
  });
});

describe('money preserved by the migration override (#2135 data migration)', () => {
  // Old (pre-#2135) model: sum of plate cost / #/plate x items per set, unrounded.
  // The migration turns the share override ON for every plate whose #/plate does not
  // divide the set; the rest already resolve to the same run count.
  const oldModel = (plates, set) => plates.reduce((s, p) => s + p.raw.totalPlateCost / p.itemsPerPlate * set, 0);
  const migrate = (plates, set) => plates.map(p => ({ ...p, charge_share_only: set % p.items_per_plate !== 0 ? 1 : 0 }));

  test.each([
    ['#1 set 1, legs 3/plate', [plate(1, 'Body', 463, 238.36, 1), plate(2, 'Head', 280, 80.64, 1),
      plate(3, 'Legs', 49, 23.15, 3), plate(4, 'Head2', 202, 67.9, 1)], 1],
    ['#32 set 91', keychains(), 91],
    ['#29 set 100 (divides)', [plate(1, 'C', 1064, 465.23, 4), plate(2, 'L', 170, 93.19, 4)], 100],
    ['set 1, 37/plate', [plate(1, 'Rugby', 300, 120, 37)], 1],
  ])('%s: per plate, migrated money == old proportional money; time unchanged', (name, plates, set) => {
    const before = run(plates, set, 'parts'); // whole runs, override off (what a new plate gets)
    const migrated = run(migrate(plates, set), set, 'parts');
    migrated.plateBreakdowns.forEach((b, i) => {
      const old = b.totalPlateCost / b.itemsPerPlate * set;
      const flagged = set % plates[i].items_per_plate !== 0;
      // flagged plates: the share is cents-rounded per component (<= 2 cents over 4 components);
      // divisible plates: same run count as before, only the cents boundary moves (<= 0.02 per run)
      const tol = flagged ? 0.02 : 0.02 * b.count.runs;
      expect(Math.abs(b.contribution.totalCost - old)).toBeLessThanOrEqual(tol);
      if (flagged) expect(b.count.mode).toBe('share');
    });
    const changes = plates.some(p => set % p.items_per_plate !== 0);
    if (changes) expect(before.totals.totalCost).toBeGreaterThan(migrated.totals.totalCost);
    // time: old proportional = set / ipp runs of raw minutes, ceil for divisors is identical
    expect(migrated.totals.minutes).toBeCloseTo(
      plates.reduce((s, p) => s + p.print_time_minutes * set / p.items_per_plate, 0), 6);
  });
});
