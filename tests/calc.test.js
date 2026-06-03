'use strict';

const calc = require('../calc');

/* ================================================================== */
/*  Test data matching the actual spreadsheet                          */
/* ================================================================== */

// Settings from spreadsheet
const defaultSettings = {
  hourly_rate: 40,
  electricity_price_kwh: 0.40,
  vat_rate: 21,
  material_profit_pct: 200,
  processing_profit_pct: 100,
  electricity_profit_pct: 0,
  printer_cost_profit_pct: 50,
  price_rounding: 0.99,
  margin_green_pct: 30,
  margin_orange_pct: 5,
};

// Printers from spreadsheet
const printerP1S = { purchase_price: 812.43, earn_back_months: 24, kwh_per_hour: 0.11 };
const printerP1S_PETG = { purchase_price: 812.43, earn_back_months: 24, kwh_per_hour: 0.12 };
const printerMK4S = { purchase_price: 819, earn_back_months: 6, kwh_per_hour: 0.26 };
const printerH2C = { purchase_price: 1889.92, earn_back_months: 24, kwh_per_hour: 0.25 };

// Materials from spreadsheet
const matBambuPLABasic = { price_per_kg: 17.38 };
const matBambuPLAMat = { price_per_kg: 17.38 };
const matRealPLA = { price_per_kg: 29.50 };
const matPrusaPETG = { price_per_kg: 29.99 };
const matPrusaGalaxyBlack = { price_per_kg: 29.99 };

/* ================================================================== */
/*  calculatePlateCosts                                                */
/* ================================================================== */
describe('calculatePlateCosts', () => {
  test('Coffee Bag Clip (Large) — BambuLab P1S, PLA Basic', () => {
    const plate = {
      print_time_minutes: 237,
      plastic_grams: 76.35,
      items_per_plate: 1,
      risk_multiplier: 1,
      pre_processing_minutes: 0,
      post_processing_minutes: 5,
      material_waste_grams: 1,
    };
    const result = calc.calculatePlateCosts(plate, printerP1S, matBambuPLABasic, defaultSettings);

    expect(result.materialCost).toBeCloseTo(1.34, 2);
    expect(result.processingCost).toBeCloseTo(3.33, 2);
    expect(result.electricityCost).toBeCloseTo(0.17, 2);
    expect(result.printerUsageCost).toBeCloseTo(0.19, 2);
    expect(result.totalPlateCost).toBeCloseTo(5.04, 1);
  });

  test('Russian Doll — MK4S, REAL PLA', () => {
    const plate = {
      print_time_minutes: 405,
      plastic_grams: 109.95,
      items_per_plate: 1,
      risk_multiplier: 1,
      pre_processing_minutes: 0,
      post_processing_minutes: 2,
      material_waste_grams: 1,
    };
    const result = calc.calculatePlateCosts(plate, printerMK4S, matRealPLA, defaultSettings);

    expect(result.materialCost).toBeCloseTo(3.27, 2);
    expect(result.processingCost).toBeCloseTo(1.33, 2);
    expect(result.electricityCost).toBeCloseTo(0.70, 2);
    expect(result.printerUsageCost).toBeCloseTo(1.28, 2);
    expect(result.totalPlateCost).toBeCloseTo(6.59, 1);
  });

  test('Flexi Zeba — BambuLab P1S, PLA Mat, 20 items/plate', () => {
    // 28h 58m total = 1738 min, 20 items on plate
    const plate = {
      print_time_minutes: 1738,
      plastic_grams: 533.48,
      items_per_plate: 20,
      risk_multiplier: 1,
      pre_processing_minutes: 0,
      post_processing_minutes: 0,
      material_waste_grams: 0,
    };
    const result = calc.calculatePlateCosts(plate, printerP1S, matBambuPLAMat, defaultSettings);

    // Per plate values — items_per_plate division happens in calculatePerItemCosts
    const perItem = result.materialCost / 20;
    expect(perItem).toBeCloseTo(0.46, 2);

    const elecPerItem = result.electricityCost / 20;
    expect(elecPerItem).toBeCloseTo(0.06, 2);

    const printerPerItem = result.printerUsageCost / 20;
    expect(printerPerItem).toBeCloseTo(0.07, 2);
  });

  test('Apple Magsafe Stand — risk multiplier 3', () => {
    const plate = {
      print_time_minutes: 194,
      plastic_grams: 67.54,
      items_per_plate: 1,
      risk_multiplier: 3,
      pre_processing_minutes: 0,
      post_processing_minutes: 5,
      material_waste_grams: 1,
    };
    const result = calc.calculatePlateCosts(plate, printerMK4S, matPrusaPETG, defaultSettings);

    // effective plastic = 67.54 * 3 + 1 = 203.62 g
    // material cost = 203.62 * 0.02999 = 6.107
    expect(result.materialCost).toBeCloseTo(6.11, 1);
    expect(result.totalPlasticGrams).toBeCloseTo(203.62, 1);
    expect(result.effectivePrintTimeHours).toBeCloseTo(194 / 60 * 3, 2);
  });

  test('handles zero/empty inputs gracefully', () => {
    const plate = {
      print_time_minutes: 0,
      plastic_grams: 0,
      items_per_plate: 1,
      risk_multiplier: 1,
      pre_processing_minutes: 0,
      post_processing_minutes: 0,
      material_waste_grams: 0,
    };
    const printer = { purchase_price: 0, earn_back_months: 1, kwh_per_hour: 0 };
    const material = { price_per_kg: 0 };
    const result = calc.calculatePlateCosts(plate, printer, material, defaultSettings);

    expect(result.totalPlateCost).toBe(0);
    expect(result.materialCost).toBe(0);
  });
});

/* ================================================================== */
/*  calculatePerItemCosts                                              */
/* ================================================================== */
describe('calculatePerItemCosts', () => {
  test('single plate, single item', () => {
    const plateCosts = [{
      materialCost: 1.34,
      processingCost: 3.33,
      electricityCost: 0.17,
      printerUsageCost: 0.19,
      totalPlateCost: 5.03,
      itemsPerPlate: 1,
    }];
    const result = calc.calculatePerItemCosts(plateCosts);
    expect(result.materialCost).toBeCloseTo(1.34, 2);
    expect(result.totalPerItem).toBeCloseTo(5.03, 2);
  });

  test('single plate, multiple items', () => {
    const plateCosts = [{
      materialCost: 9.27,
      processingCost: 0,
      electricityCost: 1.27,
      printerUsageCost: 1.36,
      totalPlateCost: 11.90,
      itemsPerPlate: 20,
    }];
    const result = calc.calculatePerItemCosts(plateCosts);
    expect(result.materialCost).toBeCloseTo(9.27 / 20, 4);
    expect(result.totalPerItem).toBeCloseTo(11.90 / 20, 3);
  });

  test('multiple plates summed per-item', () => {
    const plateCosts = [
      { materialCost: 2, processingCost: 1, electricityCost: 0.5, printerUsageCost: 0.3, totalPlateCost: 3.8, itemsPerPlate: 2 },
      { materialCost: 4, processingCost: 0, electricityCost: 1, printerUsageCost: 0.6, totalPlateCost: 5.6, itemsPerPlate: 4 },
    ];
    const result = calc.calculatePerItemCosts(plateCosts);
    // Per item: plate1 = (2+1+0.5+0.3)/2 = 1.9; plate2 = (4+0+1+0.6)/4 = 1.4
    expect(result.materialCost).toBeCloseTo(2 / 2 + 4 / 4, 4); // 1 + 1 = 2
    expect(result.totalPerItem).toBeCloseTo(3.8 / 2 + 5.6 / 4, 4); // 1.9 + 1.4 = 3.3
  });
});

/* ================================================================== */
/*  applyProfitMargins                                                 */
/* ================================================================== */
describe('applyProfitMargins', () => {
  test('applies margins from spreadsheet defaults', () => {
    const perItem = { materialCost: 0.66, processingCost: 0.11, electricityCost: 0.08, printerUsageCost: 0.09 };
    const margins = { material_profit_pct: 200, processing_profit_pct: 100, electricity_profit_pct: 0, printer_cost_profit_pct: 50 };
    const result = calc.applyProfitMargins(perItem, margins);

    expect(result.materialProfit).toBeCloseTo(1.32, 2);
    expect(result.processingProfit).toBeCloseTo(0.11, 2);
    expect(result.electricityProfit).toBeCloseTo(0, 2);
    expect(result.printerCostProfit).toBeCloseTo(0.045, 2);
    expect(result.totalProfit).toBeCloseTo(1.475, 1);
  });

  test('zero margins return zero profit', () => {
    const perItem = { materialCost: 10, processingCost: 5, electricityCost: 2, printerUsageCost: 1 };
    const margins = { material_profit_pct: 0, processing_profit_pct: 0, electricity_profit_pct: 0, printer_cost_profit_pct: 0 };
    const result = calc.applyProfitMargins(perItem, margins);
    expect(result.totalProfit).toBe(0);
  });

  test('regression fence: processing margin still flows through pre/post processing as before', () => {
    // Per Dirk's 2026-05-05 override: keep processing margin behaviour untouched.
    // The settings-over-hardcoding decision means processingProfit MUST be a pure
    // function of processing_profit_pct × processingCost — nothing forces it to 0.
    const perItem = { materialCost: 0, processingCost: 2, electricityCost: 0, printerUsageCost: 0 };
    const margins = { material_profit_pct: 0, processing_profit_pct: 100, electricity_profit_pct: 0, printer_cost_profit_pct: 0 };
    const result = calc.applyProfitMargins(perItem, margins);
    // 100% margin on €2 processing cost → €2 profit. NOT zero.
    expect(result.processingProfit).toBeCloseTo(2, 6);
    expect(result.totalProfit).toBeCloseTo(2, 6);

    // And at 0% the user can dial it down themselves.
    const zero = calc.applyProfitMargins(perItem, { ...margins, processing_profit_pct: 0 });
    expect(zero.processingProfit).toBe(0);
  });
});

/* ================================================================== */
/*  calculateExtraCosts                                                */
/* ================================================================== */
describe('calculateExtraCosts', () => {
  test('sums extras correctly', () => {
    const extras = [
      { price_excl_vat: 0.06, quantity: 1 },
      { price_excl_vat: 1.00, quantity: 0 },
      { price_excl_vat: 0.03, quantity: 0 },
    ];
    expect(calc.calculateExtraCosts(extras)).toBeCloseTo(0.06, 2);
  });

  test('empty list returns 0', () => {
    expect(calc.calculateExtraCosts([])).toBe(0);
  });

  test('multiple quantities', () => {
    const extras = [
      { price_excl_vat: 0.50, quantity: 3 },
      { price_excl_vat: 1.00, quantity: 2 },
    ];
    expect(calc.calculateExtraCosts(extras)).toBeCloseTo(3.50, 2);
  });
});

/* ================================================================== */
/*  calculateExtraHoursCost                                            */
/* ================================================================== */
describe('calculateExtraHoursCost', () => {
  test('empty list returns 0', () => {
    expect(calc.calculateExtraHoursCost([])).toBe(0);
  });

  test('null/undefined returns 0', () => {
    expect(calc.calculateExtraHoursCost(null)).toBe(0);
    expect(calc.calculateExtraHoursCost(undefined)).toBe(0);
  });

  test('two rows summed: 2h*60 + 1h*40 = 160', () => {
    const rows = [
      { hours: 2, hourly_rate: 60 },
      { hours: 1, hourly_rate: 40 },
    ];
    expect(calc.calculateExtraHoursCost(rows)).toBeCloseTo(160, 4);
  });

  test('non-numeric inputs are treated as 0 / skipped', () => {
    const rows = [
      { hours: 'oops', hourly_rate: 60 },
      { hours: 1.5, hourly_rate: 'meh' },
      { hours: 2, hourly_rate: 50 },
    ];
    // Only the third row contributes: 2 * 50 = 100
    expect(calc.calculateExtraHoursCost(rows)).toBeCloseTo(100, 4);
  });

  test('per-project flat: result is independent of items_per_set caller', () => {
    // The function itself does not see itemsPerSet — it returns a flat sum.
    // This is the regression fence for the per-project-flat decision.
    const rows = [{ hours: 3, hourly_rate: 60 }];
    expect(calc.calculateExtraHoursCost(rows)).toBeCloseTo(180, 4);
  });
});

/* ================================================================== */
/*  calculateFinalPricing                                              */
/* ================================================================== */
describe('calculateFinalPricing', () => {
  test('matches spreadsheet example (keychain-like product)', () => {
    const perItemCosts = {
      materialCost: 0.66,
      processingCost: 0.11,
      electricityCost: 0.08,
      printerUsageCost: 0.09,
      totalPerItem: 0.94,
    };
    const profits = {
      materialProfit: 1.32,
      processingProfit: 0.11,
      electricityProfit: 0,
      printerCostProfit: 0.045,
      totalProfit: 1.475,
    };
    const result = calc.calculateFinalPricing({
      perItemCosts,
      profits,
      extraCostsTotal: 0.06,
      itemsPerSet: 1,
      vatRate: 21,
      priceRounding: 0.99,
    });

    // Production cost = base (0.94) + extras (0.06) = 1.00
    expect(result.productionCost).toBeCloseTo(1.00, 2);

    // Total excl VAT = 0.94 + 1.475 + 0.06 = 2.475
    expect(result.totalExclVat).toBeCloseTo(2.475, 2);

    // Total incl VAT = 2.475 * 1.21 = ~2.995
    expect(result.totalInclVat).toBeCloseTo(2.995, 2);

    // Suggested price rounds to 2.99 or 3.99
    // ceil(2.995 - 0.99) + 0.99 = ceil(2.005) + 0.99 = 3 + 0.99 = 3.99
    expect(result.suggestedPrice).toBeCloseTo(3.99, 2);
  });

  test('rounding to .95', () => {
    const perItemCosts = { materialCost: 5, processingCost: 2, electricityCost: 1, printerUsageCost: 0.5, totalPerItem: 8.5 };
    const profits = { totalProfit: 4 };
    const result = calc.calculateFinalPricing({
      perItemCosts,
      profits,
      extraCostsTotal: 0,
      itemsPerSet: 1,
      vatRate: 21,
      priceRounding: 0.95,
    });
    // Total incl VAT = (8.5 + 4) * 1.21 = 15.125
    // ceil(15.125 - 0.95) + 0.95 = ceil(14.175) + 0.95 = 15 + 0.95 = 15.95
    expect(result.suggestedPrice).toBeCloseTo(15.95, 2);
  });

  test('items per set multiplier', () => {
    const perItemCosts = { materialCost: 1, processingCost: 0.5, electricityCost: 0.2, printerUsageCost: 0.1, totalPerItem: 1.8 };
    const profits = { totalProfit: 1 };
    const result = calc.calculateFinalPricing({
      perItemCosts,
      profits,
      extraCostsTotal: 0.50,
      itemsPerSet: 3,
      vatRate: 21,
      priceRounding: 0.99,
    });
    // baseCostPerSet = 1.8 * 3 = 5.4
    // profitPerSet = 1 * 3 = 3
    // productionCost = 5.4 + 0.50 = 5.9
    expect(result.productionCost).toBeCloseTo(5.9, 2);
    // totalExclVat = 5.4 + 3 + 0.5 = 8.9
    expect(result.totalExclVat).toBeCloseTo(8.9, 2);
  });

  test('margin formula matches spreadsheet: (excl_vat - cost) / incl_vat', () => {
    const perItemCosts = { materialCost: 0.66, processingCost: 0.11, electricityCost: 0.08, printerUsageCost: 0.09, totalPerItem: 0.94 };
    const profits = { totalProfit: 1.475 };
    const result = calc.calculateFinalPricing({
      perItemCosts,
      profits,
      extraCostsTotal: 0.06,
      itemsPerSet: 1,
      vatRate: 21,
      priceRounding: 0.99,
    });

    // suggestedPrice = 3.99
    // suggestedExclVat = 3.99 / 1.21 = 3.2975...
    // productionCost = 1.00
    // profit = 3.2975 - 1.00 = 2.2975
    // margin = 2.2975 / 3.99 * 100 = 57.58%
    expect(result.suggestedMarginPct).toBeGreaterThan(55);
    expect(result.suggestedMarginPct).toBeLessThan(60);
  });

  test('extraHoursCost adds to productionCost AND totalExclVat — no margin', () => {
    const perItemCosts = { materialCost: 1, processingCost: 0.5, electricityCost: 0.2, printerUsageCost: 0.1, totalPerItem: 1.8 };
    const profits = { totalProfit: 1 };
    const baseOpts = {
      perItemCosts,
      profits,
      extraCostsTotal: 0,
      itemsPerSet: 1,
      vatRate: 21,
      priceRounding: 0.99,
    };
    const without = calc.calculateFinalPricing(baseOpts);
    const withHours = calc.calculateFinalPricing({ ...baseOpts, extraHoursCost: 50 });

    // Production cost picks up the full €50.
    expect(withHours.productionCost - without.productionCost).toBeCloseTo(50, 6);
    // Total excl. VAT picks up exactly €50 too — no margin applied on top.
    expect(withHours.totalExclVat - without.totalExclVat).toBeCloseTo(50, 6);
    // Returned breakdown carries the value through.
    expect(withHours.extraHoursCost).toBeCloseTo(50, 6);
    // Suggested-profit math reflects "no margin on the 50":
    //   suggestedProfitAmount = suggestedExclVat - productionCost
    expect(withHours.suggestedProfitAmount)
      .toBeCloseTo(withHours.suggestedExclVat - withHours.productionCost, 6);
  });

  test('extraHoursCost defaults to 0 when not provided (back-compat)', () => {
    const perItemCosts = { materialCost: 1, processingCost: 0, electricityCost: 0, printerUsageCost: 0, totalPerItem: 1 };
    const profits = { totalProfit: 0 };
    const result = calc.calculateFinalPricing({
      perItemCosts, profits,
      extraCostsTotal: 0,
      itemsPerSet: 1,
      vatRate: 21,
      priceRounding: 0.99,
    });
    expect(result.extraHoursCost).toBe(0);
    expect(result.productionCost).toBeCloseTo(1, 6);
  });
});

/* ================================================================== */
/*  calculateActualMargin                                              */
/* ================================================================== */
describe('calculateActualMargin', () => {
  test('matches spreadsheet custom price example', () => {
    // Custom price: 26.53, production cost: 1.00, VAT: 21%
    const result = calc.calculateActualMargin(26.53, 1.00, 21);

    expect(result.actualExclVat).toBeCloseTo(21.926, 2);
    expect(result.profitAmount).toBeCloseTo(20.926, 2);
    // margin = 20.926 / 26.53 = 78.87%
    expect(result.marginPct).toBeCloseTo(78.86, 1);
  });

  test('returns null for zero/missing price', () => {
    expect(calc.calculateActualMargin(0, 1.00, 21)).toBeNull();
    expect(calc.calculateActualMargin(null, 1.00, 21)).toBeNull();
  });

  test('negative margin when price too low', () => {
    const result = calc.calculateActualMargin(0.50, 1.00, 21);
    expect(result.marginPct).toBeLessThan(0);
  });
});

/* ================================================================== */
/*  marginIndicator                                                    */
/* ================================================================== */
describe('marginIndicator', () => {
  test('green >= 30', () => expect(calc.marginIndicator(30)).toBe('green'));
  test('green = 50', () => expect(calc.marginIndicator(50)).toBe('green'));
  test('orange >= 5 < 30', () => expect(calc.marginIndicator(15)).toBe('orange'));
  test('orange = 5', () => expect(calc.marginIndicator(5)).toBe('orange'));
  test('red < 5', () => expect(calc.marginIndicator(4.9)).toBe('red'));
  test('red negative', () => expect(calc.marginIndicator(-10)).toBe('red'));
  test('custom thresholds', () => {
    expect(calc.marginIndicator(40, 50, 20)).toBe('orange');
    expect(calc.marginIndicator(10, 50, 20)).toBe('red');
    expect(calc.marginIndicator(50, 50, 20)).toBe('green');
  });
});

/* ================================================================== */
/*  calculateProject (full orchestrator)                               */
/* ================================================================== */
describe('calculateProject', () => {
  test('full project with multiple plates', () => {
    const plates = [
      {
        id: 1, name: 'Base',
        print_time_minutes: 120, plastic_grams: 50,
        items_per_plate: 1, risk_multiplier: 1,
        pre_processing_minutes: 0, post_processing_minutes: 2,
        printer_purchase_price: 812.43, printer_earn_back_months: 24, printer_kwh_per_hour: 0.11,
        material_price_per_kg: 17.38,
      },
      {
        id: 2, name: 'Top',
        print_time_minutes: 60, plastic_grams: 20,
        items_per_plate: 1, risk_multiplier: 1,
        pre_processing_minutes: 0, post_processing_minutes: 2,
        printer_purchase_price: 812.43, printer_earn_back_months: 24, printer_kwh_per_hour: 0.11,
        material_price_per_kg: 17.38,
      },
    ];
    const extras = [{ price_excl_vat: 0.06, quantity: 1 }];

    const result = calc.calculateProject({
      plates,
      extras,
      settings: defaultSettings,
      itemsPerSet: 1,
      actualSalesPrice: 9.99,
    });

    // Should have 2 plate breakdowns
    expect(result.plateBreakdowns).toHaveLength(2);

    // Per-item costs sum both plates (1 item each)
    expect(result.perItemCosts.totalPerItem).toBeGreaterThan(0);

    // Profits applied
    expect(result.profits.totalProfit).toBeGreaterThan(0);

    // Extra costs
    expect(result.extraCostsTotal).toBeCloseTo(0.06, 2);

    // Pricing
    expect(result.pricing.suggestedPrice).toBeGreaterThan(0);
    expect(result.pricing.productionCost).toBeGreaterThan(0);

    // Actual margin calculated
    expect(result.actualMargin).not.toBeNull();
    expect(result.actualIndicator).toBeTruthy();
    expect(result.suggestedIndicator).toBeTruthy();
  });

  test('empty project returns zeros', () => {
    const result = calc.calculateProject({ plates: [], extras: [], settings: defaultSettings, itemsPerSet: 1 });
    expect(result.perItemCosts.totalPerItem).toBe(0);
    expect(result.pricing.suggestedPrice).toBe(0);
    expect(result.extraHoursCost).toBe(0);
  });

  test('calculateProject — extra hours add at cost, processing margin unchanged', () => {
    const plates = [{
      id: 1, name: 'Base',
      print_time_minutes: 120, plastic_grams: 50,
      items_per_plate: 1, risk_multiplier: 1,
      pre_processing_minutes: 0, post_processing_minutes: 2,
      printer_purchase_price: 812.43, printer_earn_back_months: 24, printer_kwh_per_hour: 0.11,
      material_price_per_kg: 17.38,
    }];

    const without = calc.calculateProject({
      plates, extras: [], extraHours: [],
      settings: defaultSettings, itemsPerSet: 1,
    });
    const withHours = calc.calculateProject({
      plates, extras: [],
      extraHours: [{ hours: 2, hourly_rate: 60 }],
      settings: defaultSettings, itemsPerSet: 1,
    });

    // Extra-hours total surfaces in the breakdown.
    expect(withHours.extraHoursCost).toBeCloseTo(120, 6);
    expect(withHours.pricing.extraHoursCost).toBeCloseTo(120, 6);

    // Production cost grew by exactly €120 (no scaling by items_per_set, no margin).
    expect(withHours.pricing.productionCost - without.pricing.productionCost).toBeCloseTo(120, 6);
    expect(withHours.pricing.totalExclVat - without.pricing.totalExclVat).toBeCloseTo(120, 6);

    // Regression fence: processing margin still flows through the existing path.
    // perItemCosts.processingCost > 0 (post=2min @ €40/h), and processing_profit_pct=100,
    // so the processingProfit must be > 0 — proves the pre/post path is unchanged.
    expect(without.perItemCosts.processingCost).toBeGreaterThan(0);
    expect(without.profits.processingProfit).toBeCloseTo(without.perItemCosts.processingCost, 6);
  });

  test('calculateProject — extra hours are flat per project, NOT scaled by items_per_set', () => {
    // Confirms Dirk's 2026-05-05 override #2: hours × price, not hours × price × items_per_set.
    const plates = [{
      id: 1, name: 'Base',
      print_time_minutes: 60, plastic_grams: 20,
      items_per_plate: 1, risk_multiplier: 1,
      pre_processing_minutes: 0, post_processing_minutes: 0,
      printer_purchase_price: 812.43, printer_earn_back_months: 24, printer_kwh_per_hour: 0.11,
      material_price_per_kg: 17.38,
    }];

    const single = calc.calculateProject({
      plates, extras: [],
      extraHours: [{ hours: 1, hourly_rate: 60 }],
      settings: defaultSettings, itemsPerSet: 1,
    });
    const set5 = calc.calculateProject({
      plates, extras: [],
      extraHours: [{ hours: 1, hourly_rate: 60 }],
      settings: defaultSettings, itemsPerSet: 5,
    });

    // The contribution from extra hours is identical in both — €60, not €60 × 5.
    expect(single.extraHoursCost).toBeCloseTo(60, 6);
    expect(set5.extraHoursCost).toBeCloseTo(60, 6);
  });
});

/* ================================================================== */
/*  calculateDesignCosts                                               */
/* ================================================================== */
describe('calculateDesignCosts', () => {
  test('all three populated', () => {
    const result = calc.calculateDesignCosts({
      designHours: [
        { hours: 2, hourly_rate: 65 },
        { hours: 1, hourly_rate: 50 },
      ],
      testPrints: [
        { estimated_cost: 3.50, attachmentBreakdowns: [{ totalPlateCost: 3.50 }] },
        { estimated_cost: 2.00, attachmentBreakdowns: [{ totalPlateCost: 2.00 }] },
      ],
      designExtras: [
        { amount: 10 },
        { amount: 5.50 },
      ],
    });
    // designHours: 2*65 + 1*50 = 180
    expect(result.designHoursSubtotal).toBeCloseTo(180, 4);
    // testPrints subtotal = sum of estimated_cost: 3.50 + 2.00 = 5.50
    expect(result.testPrintsSubtotal).toBeCloseTo(5.50, 4);
    // testPrintDetails: two entries
    expect(result.testPrintDetails).toHaveLength(2);
    expect(result.testPrintDetails[0].estimated).toBeCloseTo(3.50, 4);
    expect(result.testPrintDetails[0].actual).toBeCloseTo(3.50, 4);
    expect(result.testPrintDetails[1].estimated).toBeCloseTo(2.00, 4);
    expect(result.testPrintDetails[1].actual).toBeCloseTo(2.00, 4);
    // extras: 10 + 5.50 = 15.50
    expect(result.extrasSubtotal).toBeCloseTo(15.50, 4);
    // total: 180 + 5.50 + 15.50 = 201
    expect(result.designTotal).toBeCloseTo(201, 4);
  });

  test('empty inputs return all zeros', () => {
    const result = calc.calculateDesignCosts({});
    expect(result.designHoursSubtotal).toBe(0);
    expect(result.testPrintsSubtotal).toBe(0);
    expect(result.testPrintDetails).toHaveLength(0);
    expect(result.extrasSubtotal).toBe(0);
    expect(result.designTotal).toBe(0);
  });

  test('non-finite inputs are skipped gracefully', () => {
    const result = calc.calculateDesignCosts({
      designHours: [{ hours: 'bad', hourly_rate: 65 }, { hours: 1, hourly_rate: 65 }],
      testPrints: [
        { estimated_cost: NaN, attachmentBreakdowns: [] },
        { estimated_cost: 5, attachmentBreakdowns: [] },
      ],
      designExtras: [{ amount: null }, { amount: 10 }],
    });
    // only the valid rows contribute
    expect(result.designHoursSubtotal).toBeCloseTo(65, 4);
    // NaN → 0 for first, 5 for second → subtotal 5
    expect(result.testPrintsSubtotal).toBeCloseTo(5, 4);
    expect(result.extrasSubtotal).toBeCloseTo(10, 4);
  });

  test('testPrintsSubtotal uses estimated_cost, not computed plate cost', () => {
    // est=10 with attachment actual=15 → subtotal 10, detail.actual=15
    const r1 = calc.calculateDesignCosts({
      testPrints: [{ estimated_cost: 10, attachmentBreakdowns: [{ totalPlateCost: 15 }] }],
    });
    expect(r1.testPrintsSubtotal).toBeCloseTo(10, 4);
    expect(r1.testPrintDetails[0].estimated).toBeCloseTo(10, 4);
    expect(r1.testPrintDetails[0].actual).toBeCloseTo(15, 4);
    expect(r1.testPrintDetails[0].attachmentCount).toBe(1);

    // est=5 no attachments → actual=0; subtotal from two entries = 15
    const r2 = calc.calculateDesignCosts({
      testPrints: [
        { estimated_cost: 10, attachmentBreakdowns: [{ totalPlateCost: 15 }] },
        { estimated_cost: 5, attachmentBreakdowns: [] },
      ],
    });
    expect(r2.testPrintsSubtotal).toBeCloseTo(15, 4);
    expect(r2.testPrintDetails[1].estimated).toBeCloseTo(5, 4);
    expect(r2.testPrintDetails[1].actual).toBeCloseTo(0, 4);
    expect(r2.testPrintDetails[1].attachmentCount).toBe(0);
  });

  test('empty testPrints → subtotal 0, details length 0', () => {
    const result = calc.calculateDesignCosts({ testPrints: [] });
    expect(result.testPrintsSubtotal).toBe(0);
    expect(result.testPrintDetails).toHaveLength(0);
  });
});

/* ================================================================== */
/*  calculateProject — design cost integration                         */
/* ================================================================== */
describe('calculateProject — design cost module', () => {
  const plates = [
    {
      id: 1, name: 'Base',
      print_time_minutes: 120, plastic_grams: 50,
      items_per_plate: 1, risk_multiplier: 1,
      pre_processing_minutes: 0, post_processing_minutes: 2,
      printer_purchase_price: 812.43, printer_earn_back_months: 24, printer_kwh_per_hour: 0.11,
      material_price_per_kg: 17.38,
      enabled: 1,
      is_test_print: 0,
    },
  ];

  const testPrintPlate = {
    id: 2, name: 'Test',
    print_time_minutes: 60, plastic_grams: 20,
    items_per_plate: 1, risk_multiplier: 1,
    pre_processing_minutes: 0, post_processing_minutes: 0,
    printer_purchase_price: 812.43, printer_earn_back_months: 24, printer_kwh_per_hour: 0.11,
    material_price_per_kg: 17.38,
    enabled: 1,
    is_test_print: 1,
  };

  test('isCustom:false → designCosts is null', () => {
    const result = calc.calculateProject({
      plates,
      extras: [],
      settings: defaultSettings,
      itemsPerSet: 1,
      isCustom: false,
    });
    expect(result.designCosts).toBeNull();
  });

  test('isCustom:true → designCosts is non-null object', () => {
    const result = calc.calculateProject({
      plates,
      extras: [],
      settings: defaultSettings,
      itemsPerSet: 1,
      isCustom: true,
      designHours: [{ hours: 2, hourly_rate: 65 }],
      designExtras: [{ amount: 10 }],
    });
    expect(result.designCosts).not.toBeNull();
    expect(result.designCosts.designHoursSubtotal).toBeCloseTo(130, 4);
    expect(result.designCosts.extrasSubtotal).toBeCloseTo(10, 4);
  });

  test('is_test_print:1 plates excluded from perItemCosts; testPrintsSubtotal comes from explicit testPrints opts', () => {
    const result = calc.calculateProject({
      plates: [plates[0], testPrintPlate],
      extras: [],
      settings: defaultSettings,
      itemsPerSet: 1,
      isCustom: true,
      testPrints: [{ estimated_cost: 5.00, attachmentBreakdowns: [] }],
    });

    // Only the non-test-print plate should contribute to per-item costs
    const resultNoTestPrint = calc.calculateProject({
      plates: [plates[0]],
      extras: [],
      settings: defaultSettings,
      itemsPerSet: 1,
      isCustom: true,
    });
    expect(result.perItemCosts.totalPerItem).toBeCloseTo(resultNoTestPrint.perItemCosts.totalPerItem, 4);

    // testPrintsSubtotal = sum estimated_cost from explicit testPrints
    expect(result.designCosts.testPrintsSubtotal).toBeCloseTo(5.00, 4);
  });

  test('designTotal is NOT added to productionCost or totalExclVat', () => {
    const withDesign = calc.calculateProject({
      plates,
      extras: [],
      settings: defaultSettings,
      itemsPerSet: 1,
      isCustom: true,
      designHours: [{ hours: 5, hourly_rate: 65 }],
    });
    const withoutDesign = calc.calculateProject({
      plates,
      extras: [],
      settings: defaultSettings,
      itemsPerSet: 1,
      isCustom: false,
    });

    // Production cost and pricing are identical regardless of design hours
    expect(withDesign.pricing.productionCost).toBeCloseTo(withoutDesign.pricing.productionCost, 4);
    expect(withDesign.pricing.totalExclVat).toBeCloseTo(withoutDesign.pricing.totalExclVat, 4);
    expect(withDesign.pricing.suggestedPrice).toBeCloseTo(withoutDesign.pricing.suggestedPrice, 4);
  });

  test('mixed enabled/disabled/test-print plates — only production-enabled count', () => {
    const disabledPlate = {
      id: 3, name: 'Disabled',
      print_time_minutes: 120, plastic_grams: 50,
      items_per_plate: 1, risk_multiplier: 1,
      pre_processing_minutes: 0, post_processing_minutes: 0,
      printer_purchase_price: 812.43, printer_earn_back_months: 24, printer_kwh_per_hour: 0.11,
      material_price_per_kg: 17.38,
      enabled: 0,
      is_test_print: 0,
    };
    const result = calc.calculateProject({
      plates: [plates[0], testPrintPlate, disabledPlate],
      extras: [],
      settings: defaultSettings,
      itemsPerSet: 1,
      isCustom: true,
    });

    // Only the enabled non-test-print plate should be in perItemCosts
    const resultSingle = calc.calculateProject({
      plates: [plates[0]],
      extras: [],
      settings: defaultSettings,
      itemsPerSet: 1,
      isCustom: true,
    });
    expect(result.perItemCosts.totalPerItem).toBeCloseTo(resultSingle.perItemCosts.totalPerItem, 4);
    // 3 plate breakdowns total (enabled, test-print, disabled)
    expect(result.plateBreakdowns).toHaveLength(3);
  });

  test('testPrints with non-zero estimated_cost → testPrintsSubtotal > 0', () => {
    const result = calc.calculateProject({
      plates: [plates[0], testPrintPlate],
      extras: [],
      settings: defaultSettings,
      itemsPerSet: 1,
      isCustom: true,
      testPrints: [{ estimated_cost: 7.50, attachmentBreakdowns: [] }],
    });
    expect(result.designCosts.testPrintsSubtotal).toBeCloseTo(7.50, 4);
  });

  test('testPrints not provided → testPrintsSubtotal === 0', () => {
    const result = calc.calculateProject({
      plates: [plates[0], testPrintPlate],
      extras: [],
      settings: defaultSettings,
      itemsPerSet: 1,
      isCustom: true,
      // no testPrints opt
    });
    expect(result.designCosts.testPrintsSubtotal).toBe(0);
  });

  test('test-print plates are excluded from production per-item cost', () => {
    const result = calc.calculateProject({
      plates: [plates[0], testPrintPlate],
      extras: [],
      settings: defaultSettings,
      itemsPerSet: 1,
      isCustom: true,
    });

    // testPrintPlate breakdown must be flagged
    const tpBreakdown = result.plateBreakdowns.find(b => b.plateId === testPrintPlate.id);
    expect(tpBreakdown).toBeDefined();
    expect(tpBreakdown.isTestPrint).toBe(true);

    // perItemCosts must equal the result computed without the test-print plate
    const resultNoTestPrint = calc.calculateProject({
      plates: [plates[0]],
      extras: [],
      settings: defaultSettings,
      itemsPerSet: 1,
      isCustom: true,
    });
    expect(result.perItemCosts.totalPerItem).toBeCloseTo(resultNoTestPrint.perItemCosts.totalPerItem, 6);
  });
});

/* ================================================================== */
/*  Printer hourly cost verification                                   */
/* ================================================================== */
describe('printer hourly cost formula', () => {
  test('P1S: 812.43 / (24 * 720) = ~0.047/h', () => {
    const hourlyRate = 812.43 / (24 * 30 * 24);
    expect(hourlyRate).toBeCloseTo(0.047, 3);
  });

  test('MK4S: 819 / (6 * 720) = ~0.190/h', () => {
    const hourlyRate = 819 / (6 * 30 * 24);
    expect(hourlyRate).toBeCloseTo(0.190, 2);
  });

  test('H2C: 1889.92 / (24 * 720) = ~0.109/h', () => {
    const hourlyRate = 1889.92 / (24 * 30 * 24);
    expect(hourlyRate).toBeCloseTo(0.109, 2);
  });
});

/* ================================================================== */
/*  Electricity cost verification                                      */
/* ================================================================== */
describe('electricity cost formula', () => {
  test('P1S printing 237 min at 0.11 kWh: (237/60)*0.11*0.40', () => {
    const cost = (237 / 60) * 0.11 * 0.40;
    expect(cost).toBeCloseTo(0.174, 2);
  });

  test('MK4S printing 405 min at 0.26 kWh: (405/60)*0.26*0.40', () => {
    const cost = (405 / 60) * 0.26 * 0.40;
    expect(cost).toBeCloseTo(0.702, 2);
  });
});
