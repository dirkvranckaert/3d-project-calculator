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

  test('per-item (÷ set size) derives from the per-set totals', () => {
    const plates = [{
      id: 1, name: 'Base',
      print_time_minutes: 120, plastic_grams: 50,
      items_per_plate: 1, risk_multiplier: 1,
      pre_processing_minutes: 0, post_processing_minutes: 2,
      printer_purchase_price: 812.43, printer_earn_back_months: 24, printer_kwh_per_hour: 0.11,
      material_price_per_kg: 17.38,
    }];
    const extras = [{ price_excl_vat: 1.00, quantity: 2 }]; // 2.00 flat per project
    const setSize = 4;
    const result = calc.calculateProject({ plates, extras, settings: defaultSettings, itemsPerSet: setSize });

    // Base cost scales linearly with set size
    expect(result.pricing.baseCostPerSet).toBeCloseTo(result.perItemCosts.totalPerItem * setSize, 6);

    // The UI per-item production figure = productionCost / setSize
    const perItemProduction = result.pricing.productionCost / setSize;
    expect(perItemProduction).toBeCloseTo(
      result.perItemCosts.totalPerItem + result.extraCostsTotal / setSize, 6
    );
  });

  test('customLines fold into extraCostsTotal like supplies', () => {
    const base = calc.calculateProject({ plates: [], extras: [], settings: defaultSettings, itemsPerSet: 1 });
    const withCustom = calc.calculateProject({
      plates: [], extras: [], customLines: [{ label: 'Bespoke jig', amount: 5 }],
      settings: defaultSettings, itemsPerSet: 1,
    });
    expect(withCustom.customLinesTotal).toBeCloseTo(5, 6);
    expect(withCustom.extraCostsTotal).toBeCloseTo(base.extraCostsTotal + 5, 6);
    expect(withCustom.pricing.productionCost).toBeCloseTo(base.pricing.productionCost + 5, 6);
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

  test('materialRequirements — grams consistent with material cost, excludes disabled/test', () => {
    const baseMat = {
      material_id: 1, material_name: 'Bambulab - Generic (ABS)', material_type: 'ABS',
      material_color: 'Red', material_roll_weight_g: 1000, material_price_per_kg: 20,
    };
    const plates = [
      { id: 1, name: 'A', print_time_minutes: 60, plastic_grams: 100, items_per_plate: 8,
        risk_multiplier: 1, pre_processing_minutes: 0, post_processing_minutes: 0,
        printer_purchase_price: 800, printer_earn_back_months: 24, printer_kwh_per_hour: 0.11,
        enabled: 1, ...baseMat },
      { id: 2, name: 'B', print_time_minutes: 30, plastic_grams: 40, items_per_plate: 4,
        risk_multiplier: 1, pre_processing_minutes: 0, post_processing_minutes: 0,
        printer_purchase_price: 800, printer_earn_back_months: 24, printer_kwh_per_hour: 0.11,
        enabled: 1, ...baseMat },
      // Disabled plate — must NOT contribute
      { id: 3, name: 'Disabled', print_time_minutes: 30, plastic_grams: 999, items_per_plate: 1,
        risk_multiplier: 1, pre_processing_minutes: 0, post_processing_minutes: 0,
        printer_purchase_price: 800, printer_earn_back_months: 24, printer_kwh_per_hour: 0.11,
        enabled: 0, ...baseMat },
      // Test-print plate — must NOT contribute
      { id: 4, name: 'Test', print_time_minutes: 30, plastic_grams: 500, items_per_plate: 1,
        risk_multiplier: 1, pre_processing_minutes: 0, post_processing_minutes: 0,
        printer_purchase_price: 800, printer_earn_back_months: 24, printer_kwh_per_hour: 0.11,
        enabled: 1, is_test_print: 1, ...baseMat },
    ];
    const itemsPerSet = 8;
    const result = calc.calculateProject({ plates, extras: [], settings: defaultSettings, itemsPerSet });

    expect(result.materialRequirements).toHaveLength(1);
    const req = result.materialRequirements[0];
    // grams = (100/8 + 40/4) × 8 = (12.5 + 10) × 8 = 180
    expect(req.grams).toBeCloseTo(180, 6);
    expect(req.materialName).toBe('Bambulab - Generic (ABS)');
    expect(req.materialColor).toBe('Red');
    expect(req.spools).toBeCloseTo(0.18, 6);

    // Consistency: Σ(grams × price_per_kg / 1000) === perItemCosts.materialCost × itemsPerSet
    const gramsCost = result.materialRequirements.reduce((s, r) => s + r.grams * (20 / 1000), 0);
    expect(gramsCost).toBeCloseTo(result.perItemCosts.materialCost * itemsPerSet, 6);
  });

  test('materialRequirements — mixed legacy + grams-carrying plates keep totals exact', () => {
    const matA = {
      material_id: 1, material_name: 'Bambulab - Generic (PLA Basic)', material_type: 'PLA Basic',
      material_color: 'Red', material_roll_weight_g: 1000, material_price_per_kg: 20,
    };
    const plates = [
      // Legacy plate — no per-filament colour data at all
      { id: 1, name: 'Legacy', print_time_minutes: 60, plastic_grams: 100, items_per_plate: 1,
        risk_multiplier: 1, pre_processing_minutes: 0, post_processing_minutes: 0,
        printer_purchase_price: 800, printer_earn_back_months: 24, printer_kwh_per_hour: 0.11,
        enabled: 1, ...matA },
      // Grams-carrying plate — same material, split across two colours (3:1)
      { id: 2, name: 'Multi', print_time_minutes: 60, plastic_grams: 40, items_per_plate: 1,
        risk_multiplier: 1, pre_processing_minutes: 0, post_processing_minutes: 0,
        printer_purchase_price: 800, printer_earn_back_months: 24, printer_kwh_per_hour: 0.11,
        enabled: 1, ...matA,
        colors: [
          { color: '#ffffff', name: 'White', brand: 'Bambulab', grams: 3 },
          { color: '#0000ff', name: 'Blue',  brand: 'Bambulab', grams: 1 },
        ] },
    ];
    const itemsPerSet = 1;
    const result = calc.calculateProject({ plates, extras: [], settings: defaultSettings, itemsPerSet });
    const reqs = result.materialRequirements;

    // Legacy → 1 aggregate material row (100g); Multi → 2 colour rows (30g / 10g)
    expect(reqs).toHaveLength(3);
    const legacy = reqs.find(r => !r.colorSplit);
    expect(legacy.grams).toBeCloseTo(100, 6);
    const white = reqs.find(r => r.colorHex === '#ffffff');
    const blue  = reqs.find(r => r.colorHex === '#0000ff');
    expect(white.grams).toBeCloseTo(30, 6); // 40 × 3/4
    expect(blue.grams).toBeCloseTo(10, 6);  // 40 × 1/4

    // Consistency STILL holds across the mix: Σ grams × price = materialCost × itemsPerSet
    const gramsCost = reqs.reduce((s, r) => s + r.grams * (20 / 1000), 0);
    expect(gramsCost).toBeCloseTo(result.perItemCosts.materialCost * itemsPerSet, 6);
  });
});

/* ================================================================== */
/*  aggregateMaterialRequirements                                      */
/* ================================================================== */
describe('aggregateMaterialRequirements', () => {
  test('groups by material, sums grams, computes spools, sorts desc', () => {
    const enabled = [
      { itemsPerPlate: 8, totalPlasticGrams: 100, materialId: 1, materialName: 'Bambulab - Generic (ABS)', materialType: 'ABS', materialColor: 'Red', materialRollWeightG: 1000 },
      { itemsPerPlate: 4, totalPlasticGrams: 40,  materialId: 1, materialName: 'Bambulab - Generic (ABS)', materialType: 'ABS', materialColor: 'Red', materialRollWeightG: 1000 },
      { itemsPerPlate: 2, totalPlasticGrams: 30,  materialId: 2, materialName: 'Prusament - Generic (PETG)', materialType: 'PETG', materialColor: null, materialRollWeightG: 1000 },
    ];
    const reqs = calc.aggregateMaterialRequirements(enabled, 8);
    expect(reqs).toHaveLength(2);

    const abs = reqs.find(r => r.materialId === 1);
    // (100/8)×8 + (40/4)×8 = 100 + 80 = 180
    expect(abs.grams).toBeCloseTo(180, 6);
    expect(abs.spools).toBeCloseTo(0.18, 6);
    expect(abs.materialColor).toBe('Red');

    const petg = reqs.find(r => r.materialId === 2);
    // (30/2)×8 = 120
    expect(petg.grams).toBeCloseTo(120, 6);

    // sorted by grams descending
    expect(reqs[0].grams).toBeGreaterThanOrEqual(reqs[1].grams);
  });

  test('unassigned material grouped under id=null with spools=null', () => {
    const enabled = [
      { itemsPerPlate: 1, totalPlasticGrams: 25, materialId: null, materialName: null, materialType: null, materialColor: null, materialRollWeightG: null },
    ];
    const reqs = calc.aggregateMaterialRequirements(enabled, 1);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].materialId).toBeNull();
    expect(reqs[0].grams).toBeCloseTo(25, 6);
    expect(reqs[0].spools).toBeNull();
  });

  test('empty input returns empty array', () => {
    expect(calc.aggregateMaterialRequirements([], 5)).toEqual([]);
  });

  test('splits a plate with per-filament grams by colour, preserving the plate total', () => {
    const enabled = [{
      itemsPerPlate: 1, totalPlasticGrams: 100, materialId: 1,
      materialName: 'Bambulab - Generic (PLA Basic)', materialType: 'PLA Basic',
      materialColor: null, materialRollWeightG: 1000,
      colors: [
        { color: '#ffffff', name: 'White', brand: 'Bambulab', grams: 3 },
        { color: '#0000ff', name: 'Blue',  brand: 'Bambulab', grams: 1 },
      ],
    }];
    const reqs = calc.aggregateMaterialRequirements(enabled, 1);
    expect(reqs).toHaveLength(2);
    const white = reqs.find(r => r.colorHex === '#ffffff');
    const blue  = reqs.find(r => r.colorHex === '#0000ff');
    // plate grams = 100; split 3:1 (NOT even) → 75 / 25
    expect(white.grams).toBeCloseTo(75, 6);
    expect(blue.grams).toBeCloseTo(25, 6);
    expect(white.colorSplit).toBe(true);
    expect(white.brand).toBe('Bambulab');
    // Total preserved exactly
    expect(white.grams + blue.grams).toBeCloseTo(100, 6);
  });

  test('plate with colours but no grams falls back to a single material row', () => {
    const enabled = [{
      itemsPerPlate: 1, totalPlasticGrams: 50, materialId: 1,
      materialName: 'Bambulab - Generic (PLA Basic)', materialType: 'PLA Basic',
      materialColor: 'Red', materialRollWeightG: 1000,
      colors: [{ color: '#ff0000', name: 'Red', brand: 'Bambulab' }], // no grams
    }];
    const reqs = calc.aggregateMaterialRequirements(enabled, 1);
    expect(reqs).toHaveLength(1);
    expect(reqs[0].grams).toBeCloseTo(50, 6);
    expect(reqs[0].colorSplit).toBe(false);
    expect(reqs[0].colorHex).toBeNull();
  });
});

/* ================================================================== */
/*  calculateTotalPrintTime                                            */
/* ================================================================== */
describe('calculateTotalPrintTime', () => {
  test('single plate, 1 item/plate, 1 item/set — time = plate time', () => {
    const plates = [{ print_time_minutes: 90, items_per_plate: 1 }];
    expect(calc.calculateTotalPrintTime(plates, 1)).toBe(90);
  });

  test('ceil per plate — 100 items @ 8/plate = 13 prints (12.5 rounded up)', () => {
    const plates = [{ print_time_minutes: 60, items_per_plate: 8 }];
    // ceil(100/8) = ceil(12.5) = 13 → 13 × 60 = 780
    expect(calc.calculateTotalPrintTime(plates, 100)).toBe(780);
  });

  test('even division does not round up — 8 items @ 8/plate = 1 print', () => {
    const plates = [{ print_time_minutes: 60, items_per_plate: 8 }];
    expect(calc.calculateTotalPrintTime(plates, 8)).toBe(60);
  });

  test('multiple plates summed', () => {
    const plates = [
      { print_time_minutes: 30, items_per_plate: 1 },
      { print_time_minutes: 45, items_per_plate: 2 },
    ];
    // set=2: plate A ceil(2/1)=2 → 60; plate B ceil(2/2)=1 → 45; total 105
    expect(calc.calculateTotalPrintTime(plates, 2)).toBe(105);
  });

  test('excludes disabled and test-print plates', () => {
    const plates = [
      { print_time_minutes: 30, items_per_plate: 1, enabled: 1 },
      { print_time_minutes: 30, items_per_plate: 1, enabled: 0 },              // disabled
      { print_time_minutes: 30, items_per_plate: 1, enabled: 1, is_test_print: 1 }, // test
    ];
    expect(calc.calculateTotalPrintTime(plates, 1)).toBe(30);
  });

  test('empty input returns 0', () => {
    expect(calc.calculateTotalPrintTime([], 5)).toBe(0);
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

/* ================================================================== */
/*  calculateVerification                                              */
/* ================================================================== */
describe('calculateVerification', () => {
  // A single enriched plate object (embedded printer/material)
  const singlePlate = {
    print_time_minutes: 120,
    plastic_grams: 50,
    items_per_plate: 1,
    risk_multiplier: 1,
    pre_processing_minutes: 0,
    post_processing_minutes: 0,
    material_waste_grams: 0,
    printer_purchase_price: 812.43,
    printer_earn_back_months: 24,
    printer_kwh_per_hour: 0.11,
    material_price_per_kg: 17.38,
  };

  // Helper: build a plate with given items_per_plate
  function makePlate(items, overrides = {}) {
    return { ...singlePlate, items_per_plate: items, ...overrides };
  }

  test('single plate, items_per_set=1 — actualCostPerUnit equals totalBatchCost / totalPieces', () => {
    const result = calc.calculateVerification({
      plates: [singlePlate],
      preProcessingMinutes: 0,
      postProcessingMinutes: 0,
      hourlyRate: 40,
      supplies: [],
      itemsPerSet: 1,
      projectProductionCost: 10,
      projectSellingPrice: 20,
      settings: defaultSettings,
    });

    expect(result.totalPieces).toBe(1);
    expect(result.sellableUnits).toBe(1);
    expect(result.actualCostPerUnit).toBeCloseTo(result.totalBatchCost / 1, 6);
    expect(result.plateCosts).toHaveLength(1);
  });

  test('items_per_set=4, 9 total pieces — sellableUnits = floor(9/4) = 2', () => {
    // 9 total pieces from 3 plates of 3 items each
    const result = calc.calculateVerification({
      plates: [makePlate(3), makePlate(3), makePlate(3)],
      preProcessingMinutes: 0,
      postProcessingMinutes: 0,
      hourlyRate: 40,
      supplies: [],
      itemsPerSet: 4,
      projectProductionCost: 10,
      projectSellingPrice: 20,
      settings: defaultSettings,
    });

    expect(result.totalPieces).toBe(9);
    expect(result.sellableUnits).toBe(2); // floor(9/4)
  });

  test('multi-plate — totalMachineCost equals sum of plateCosts[].totalPlateCost', () => {
    const result = calc.calculateVerification({
      plates: [singlePlate, singlePlate],
      preProcessingMinutes: 0,
      postProcessingMinutes: 0,
      hourlyRate: 40,
      supplies: [],
      itemsPerSet: 1,
      projectProductionCost: 10,
      projectSellingPrice: 20,
      settings: defaultSettings,
    });

    const sumPlateCosts = result.plateCosts.reduce((s, pc) => s + pc.totalPlateCost, 0);
    expect(result.totalMachineCost).toBeCloseTo(sumPlateCosts, 6);
    expect(result.plateCosts).toHaveLength(2);
  });

  test('vsProductionCost positive when actualCostPerUnit < projectProductionCost', () => {
    const result = calc.calculateVerification({
      plates: [singlePlate],
      preProcessingMinutes: 0,
      postProcessingMinutes: 0,
      hourlyRate: 40,
      supplies: [],
      itemsPerSet: 1,
      projectProductionCost: 999, // far above actual cost
      projectSellingPrice: 1500,
      settings: defaultSettings,
    });

    expect(result.vsProductionCost.delta).toBeGreaterThan(0);
    expect(result.vsProductionCost.sign).toBe('+');
    expect(result.vsProductionCost.indicator).toBe('green');
  });

  test('vsProductionCost negative when actualCostPerUnit > projectProductionCost', () => {
    const result = calc.calculateVerification({
      plates: [singlePlate],
      preProcessingMinutes: 0,
      postProcessingMinutes: 0,
      hourlyRate: 40,
      supplies: [],
      itemsPerSet: 1,
      projectProductionCost: 0.01, // far below actual cost
      projectSellingPrice: 20,
      settings: defaultSettings,
    });

    expect(result.vsProductionCost.delta).toBeLessThan(0);
    expect(result.vsProductionCost.sign).toBe('-');
    expect(result.vsProductionCost.indicator).toBe('red');
  });

  test('vsSellingPrice positive when actualCostPerUnit < projectSellingPrice', () => {
    const result = calc.calculateVerification({
      plates: [singlePlate],
      preProcessingMinutes: 0,
      postProcessingMinutes: 0,
      hourlyRate: 40,
      supplies: [],
      itemsPerSet: 1,
      projectProductionCost: 10,
      projectSellingPrice: 9999, // very high selling price
      settings: defaultSettings,
    });

    expect(result.vsSellingPrice.delta).toBeGreaterThan(0);
    expect(result.vsSellingPrice.sign).toBe('+');
    expect(result.vsSellingPrice.indicator).toBe('green');
  });

  test('vsSellingPrice negative when actualCostPerUnit > projectSellingPrice', () => {
    const result = calc.calculateVerification({
      plates: [singlePlate],
      preProcessingMinutes: 0,
      postProcessingMinutes: 0,
      hourlyRate: 40,
      supplies: [],
      itemsPerSet: 1,
      projectProductionCost: 10,
      projectSellingPrice: 0.01, // far below actual cost
      settings: defaultSettings,
    });

    expect(result.vsSellingPrice.delta).toBeLessThan(0);
    expect(result.vsSellingPrice.sign).toBe('-');
    expect(result.vsSellingPrice.indicator).toBe('red');
  });

  test('0 sellable units — actualCostPerUnit is Infinity', () => {
    // items_per_plate=1, items_per_set=2 → floor(1/2)=0 sellable units
    const result = calc.calculateVerification({
      plates: [makePlate(1)],
      preProcessingMinutes: 0,
      postProcessingMinutes: 0,
      hourlyRate: 40,
      supplies: [],
      itemsPerSet: 2,
      projectProductionCost: 10,
      projectSellingPrice: 20,
      settings: defaultSettings,
    });

    expect(result.sellableUnits).toBe(0);
    expect(result.actualCostPerUnit).toBe(Infinity);
  });

  test('timeCost = (pre + post) / 60 * hourlyRate', () => {
    const pre = 30;
    const post = 15;
    const rate = 60;
    const result = calc.calculateVerification({
      plates: [singlePlate],
      preProcessingMinutes: pre,
      postProcessingMinutes: post,
      hourlyRate: rate,
      supplies: [],
      itemsPerSet: 1,
      projectProductionCost: 10,
      projectSellingPrice: 20,
      settings: defaultSettings,
    });

    const expected = (pre + post) / 60 * rate;
    expect(result.timeCost).toBeCloseTo(expected, 6);
  });

  test('suppliesCost = sum of price_excl_vat * quantity', () => {
    const supplies = [
      { price_excl_vat: 0.50, quantity: 3 },
      { price_excl_vat: 1.00, quantity: 2 },
    ];
    const result = calc.calculateVerification({
      plates: [singlePlate],
      preProcessingMinutes: 0,
      postProcessingMinutes: 0,
      hourlyRate: 40,
      supplies,
      itemsPerSet: 1,
      projectProductionCost: 10,
      projectSellingPrice: 20,
      settings: defaultSettings,
    });

    expect(result.suppliesCost).toBeCloseTo(3.50, 6);
  });

  test('totalBatchCost = totalMachineCost + timeCost + suppliesCost', () => {
    const supplies = [{ price_excl_vat: 1.00, quantity: 2 }];
    const result = calc.calculateVerification({
      plates: [singlePlate],
      preProcessingMinutes: 10,
      postProcessingMinutes: 5,
      hourlyRate: 40,
      supplies,
      itemsPerSet: 1,
      projectProductionCost: 10,
      projectSellingPrice: 20,
      settings: defaultSettings,
    });

    const expected = result.totalMachineCost + result.timeCost + result.suppliesCost;
    expect(result.totalBatchCost).toBeCloseTo(expected, 6);
  });

  test('vsProductionCost.delta === null when projectProductionCost = 0 (divide-by-zero guard)', () => {
    const result = calc.calculateVerification({
      plates: [singlePlate],
      preProcessingMinutes: 0,
      postProcessingMinutes: 0,
      hourlyRate: 40,
      supplies: [],
      itemsPerSet: 1,
      projectProductionCost: 0,
      projectSellingPrice: 20,
      settings: defaultSettings,
    });

    expect(result.vsProductionCost.delta).toBeNull();
  });
});

/* ================================================================== */
/*  calculateVerification — multi-plate aggregation (task #352)        */
/* ================================================================== */
describe('calculateVerification — multi-plate aggregation', () => {
  const basePlate = {
    print_time_minutes: 60,
    plastic_grams: 30,
    items_per_plate: 2,
    risk_multiplier: 1,
    material_waste_grams: 0,
    printer_purchase_price: 812.43,
    printer_earn_back_months: 24,
    printer_kwh_per_hour: 0.11,
    material_price_per_kg: 17.38,
  };

  test('totalPieces = Σ items_per_plate across all plates of all files', () => {
    // Simulates 2 files × 2 plates each: 3 + 2 + 4 + 1 = 10 items total
    const plates = [
      { ...basePlate, items_per_plate: 3, print_time_minutes: 40 },
      { ...basePlate, items_per_plate: 2, print_time_minutes: 50 },
      { ...basePlate, items_per_plate: 4, print_time_minutes: 30 },
      { ...basePlate, items_per_plate: 1, print_time_minutes: 60 },
    ];
    const result = calc.calculateVerification({
      plates, preProcessingMinutes: 0, postProcessingMinutes: 0,
      hourlyRate: 40, supplies: [], itemsPerSet: 1,
      projectProductionCost: 10, projectSellingPrice: 20,
      settings: defaultSettings,
    });

    expect(result.totalPieces).toBe(10);
    expect(result.plateCosts).toHaveLength(4);
  });

  test('totalMachineCost = Σ per-plate machine costs across all plates', () => {
    // Two plates: verify sum equals individual computations
    const p1 = { ...basePlate, items_per_plate: 3, print_time_minutes: 40 };
    const p2 = { ...basePlate, items_per_plate: 2, print_time_minutes: 60 };

    const combined = calc.calculateVerification({
      plates: [p1, p2], preProcessingMinutes: 0, postProcessingMinutes: 0,
      hourlyRate: 40, supplies: [], itemsPerSet: 1,
      projectProductionCost: 10, projectSellingPrice: 20,
      settings: defaultSettings,
    });

    const single1 = calc.calculateVerification({
      plates: [p1], preProcessingMinutes: 0, postProcessingMinutes: 0,
      hourlyRate: 40, supplies: [], itemsPerSet: 1,
      projectProductionCost: 10, projectSellingPrice: 20,
      settings: defaultSettings,
    });
    const single2 = calc.calculateVerification({
      plates: [p2], preProcessingMinutes: 0, postProcessingMinutes: 0,
      hourlyRate: 40, supplies: [], itemsPerSet: 1,
      projectProductionCost: 10, projectSellingPrice: 20,
      settings: defaultSettings,
    });

    expect(combined.totalMachineCost).toBeCloseTo(
      single1.totalMachineCost + single2.totalMachineCost, 6
    );
    // Regression fence: reverting multi-plate sum would give only one plate's cost
    expect(combined.totalMachineCost).toBeGreaterThan(single1.totalMachineCost);
    expect(combined.totalMachineCost).toBeGreaterThan(single2.totalMachineCost);
  });

  test('printingCost === totalMachineCost (named alias)', () => {
    const result = calc.calculateVerification({
      plates: [basePlate], preProcessingMinutes: 0, postProcessingMinutes: 0,
      hourlyRate: 40, supplies: [], itemsPerSet: 1,
      projectProductionCost: 10, projectSellingPrice: 20,
      settings: defaultSettings,
    });
    expect(result.printingCost).toBeCloseTo(result.totalMachineCost, 6);
  });

  test('postProcessingCost === timeCost (named alias)', () => {
    const result = calc.calculateVerification({
      plates: [basePlate], preProcessingMinutes: 20, postProcessingMinutes: 10,
      hourlyRate: 60, supplies: [], itemsPerSet: 1,
      projectProductionCost: 10, projectSellingPrice: 20,
      settings: defaultSettings,
    });
    expect(result.postProcessingCost).toBeCloseTo(result.timeCost, 6);
    // = (20+10)/60 * 60 = 30
    expect(result.postProcessingCost).toBeCloseTo(30, 6);
  });

  test('printing and post-processing are shown as distinct components of totalBatchCost', () => {
    const result = calc.calculateVerification({
      plates: [basePlate, basePlate],
      preProcessingMinutes: 10, postProcessingMinutes: 20,
      hourlyRate: 40,
      supplies: [{ price_excl_vat: 1.00, quantity: 3 }],
      itemsPerSet: 1,
      projectProductionCost: 10, projectSellingPrice: 20,
      settings: defaultSettings,
    });
    // post-proc = (10+20)/60 * 40 = 20
    expect(result.postProcessingCost).toBeCloseTo(20, 6);
    // printing = totalMachineCost > 0
    expect(result.printingCost).toBeGreaterThan(0);
    // totalBatchCost = printing + post-proc + supplies
    expect(result.totalBatchCost).toBeCloseTo(
      result.printingCost + result.postProcessingCost + result.suppliesCost, 6
    );
    // Regression fence: if post-proc was merged into printing, postProcessingCost would be 0
    expect(result.postProcessingCost).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/*  calculateVerification — actual margin on batch (task #352)         */
/* ================================================================== */
describe('calculateVerification — actual margin on batch', () => {
  const simplePlate = {
    print_time_minutes: 60,
    plastic_grams: 50,
    items_per_plate: 4,
    risk_multiplier: 1,
    material_waste_grams: 0,
    printer_purchase_price: 812.43,
    printer_earn_back_months: 24,
    printer_kwh_per_hour: 0.11,
    material_price_per_kg: 17.38,
  };

  test('actualMarginOnBatch is null when actualSellingTotalInclVat is 0 (default)', () => {
    const result = calc.calculateVerification({
      plates: [simplePlate],
      preProcessingMinutes: 0, postProcessingMinutes: 0,
      hourlyRate: 40, supplies: [], itemsPerSet: 1,
      projectProductionCost: 5, projectSellingPrice: 10,
      settings: defaultSettings,
    });
    expect(result.actualMarginOnBatch).toBeNull();
  });

  test('actualMarginOnBatch is null when actualSellingTotalInclVat is not provided', () => {
    const result = calc.calculateVerification({
      plates: [simplePlate],
      preProcessingMinutes: 0, postProcessingMinutes: 0,
      hourlyRate: 40, supplies: [], itemsPerSet: 1,
      projectProductionCost: 5, projectSellingPrice: 10,
      settings: defaultSettings,
      // actualSellingTotalInclVat not passed at all
    });
    expect(result.actualMarginOnBatch).toBeNull();
  });

  test('netRevenue = actualSellingTotalInclVat / 1.21 (vat_rate = 21 from settings)', () => {
    const inclVat = 121; // convenient: 121 / 1.21 = 100.00 exactly
    const result = calc.calculateVerification({
      plates: [simplePlate],
      preProcessingMinutes: 0, postProcessingMinutes: 0,
      hourlyRate: 40, supplies: [], itemsPerSet: 1,
      projectProductionCost: 5, projectSellingPrice: 10,
      actualSellingTotalInclVat: inclVat,
      settings: defaultSettings,
    });
    expect(result.actualMarginOnBatch).not.toBeNull();
    expect(result.actualMarginOnBatch.netRevenue).toBeCloseTo(100, 6);
    // Regression fence: if VAT rate were wrong (e.g. 0), netRevenue would equal inclVat
    expect(result.actualMarginOnBatch.netRevenue).toBeLessThan(inclVat);
  });

  test('netRevenue uses settings.vat_rate — non-21% rate flows through (no hardcode)', () => {
    const inclVat = 110; // at 10% VAT: 110 / 1.10 = 100.00 exactly
    const result = calc.calculateVerification({
      plates: [simplePlate],
      preProcessingMinutes: 0, postProcessingMinutes: 0,
      hourlyRate: 40, supplies: [], itemsPerSet: 1,
      projectProductionCost: 5, projectSellingPrice: 10,
      actualSellingTotalInclVat: inclVat,
      settings: { ...defaultSettings, vat_rate: 10 },
    });
    // vat_rate is a percentage (10), so divisor is 1 + 10/100 = 1.10 — NOT 1 + 10.
    expect(result.actualMarginOnBatch.netRevenue).toBeCloseTo(100, 6);
    // Regression fence: a hardcoded 21% would give 110 / 1.21 = 90.909, not 100.
    expect(result.actualMarginOnBatch.netRevenue).not.toBeCloseTo(inclVat / 1.21, 2);
  });

  test('absoluteMargin = netRevenue - totalBatchCost', () => {
    const inclVat = 50;
    const result = calc.calculateVerification({
      plates: [simplePlate],
      preProcessingMinutes: 0, postProcessingMinutes: 0,
      hourlyRate: 40, supplies: [], itemsPerSet: 1,
      projectProductionCost: 5, projectSellingPrice: 10,
      actualSellingTotalInclVat: inclVat,
      settings: defaultSettings,
    });
    const amb = result.actualMarginOnBatch;
    expect(amb.absoluteMargin).toBeCloseTo(amb.netRevenue - result.totalBatchCost, 6);
    // Regression fence: if absoluteMargin were computed from inclVat instead of netRevenue, it would differ
    const wrongAbsolute = inclVat - result.totalBatchCost;
    expect(Math.abs(amb.absoluteMargin - wrongAbsolute)).toBeGreaterThan(0.01);
  });

  test('marginPct = absoluteMargin / netRevenue * 100', () => {
    const inclVat = 121; // netRevenue = 100
    const result = calc.calculateVerification({
      plates: [simplePlate],
      preProcessingMinutes: 0, postProcessingMinutes: 0,
      hourlyRate: 40, supplies: [], itemsPerSet: 1,
      projectProductionCost: 5, projectSellingPrice: 10,
      actualSellingTotalInclVat: inclVat,
      settings: defaultSettings,
    });
    const amb = result.actualMarginOnBatch;
    const expectedPct = (amb.absoluteMargin / amb.netRevenue) * 100;
    expect(amb.marginPct).toBeCloseTo(expectedPct, 6);
  });

  test('negative margin when batch cost exceeds net revenue', () => {
    // Force totalBatchCost to be large: use very expensive plate
    const expensivePlate = {
      ...simplePlate,
      print_time_minutes: 10000, // very long print → high machine cost
    };
    const result = calc.calculateVerification({
      plates: [expensivePlate],
      preProcessingMinutes: 0, postProcessingMinutes: 0,
      hourlyRate: 40, supplies: [], itemsPerSet: 1,
      projectProductionCost: 5, projectSellingPrice: 10,
      actualSellingTotalInclVat: 1, // tiny selling price → loss
      settings: defaultSettings,
    });
    expect(result.actualMarginOnBatch.absoluteMargin).toBeLessThan(0);
    expect(result.actualMarginOnBatch.marginPct).toBeLessThan(0);
    expect(result.actualMarginOnBatch.indicator).toBe('red');
    // Regression fence: if negative margin was suppressed to 0, this would fail
    expect(result.actualMarginOnBatch.absoluteMargin).not.toBe(0);
  });
});

/* ================================================================== */
/*  Test-prints path parity with calculateProject (cost-only, no margin) */
/* ================================================================== */
describe('test-prints cost parity with calculateProject', () => {
  // Helper that replicates the fixed computePlateCost from buildTestPrints.
  // settings may be raw (string values from DB); same normalization as calculateProject.
  function computePlateCost(plate, settings) {
    const printer = {
      purchase_price: plate.printer_purchase_price || 0,
      earn_back_months: plate.printer_earn_back_months || 24,
      kwh_per_hour: plate.printer_kwh_per_hour || 0,
    };
    const material = { price_per_kg: plate.material_price_per_kg || 0 };
    const effectiveSettings = {
      ...settings,
      hourly_rate: Number(settings.hourly_rate) || 40,
      electricity_price_kwh: Number(settings.electricity_price_kwh) || 0.40,
    };
    return calc.calculatePlateCosts(plate, printer, material, effectiveSettings).totalPlateCost;
  }

  const basePlate = {
    print_time_minutes: 211,
    plastic_grams: 73.53,
    items_per_plate: 1,
    risk_multiplier: 1,
    pre_processing_minutes: 0,
    post_processing_minutes: 2,
    material_waste_grams: 0,
    printer_purchase_price: 1889.92,
    printer_earn_back_months: 24,
    printer_kwh_per_hour: 0.5,
    material_price_per_kg: 18.99,
    is_test_print: 1,
    enabled: true,
  };

  // Test 1: hourly_rate='0' (string, as it comes from the DB) — must normalize to 40
  // and agree with calculateProject's plateBreakdowns[].totalPlateCost.
  test('parity with calculateProject plateBreakdowns when hourly_rate is string "0" (normalizes to 40)', () => {
    const settingsZero = { ...defaultSettings, hourly_rate: '0', electricity_price_kwh: '0.40' };

    const testPrintTotal = computePlateCost(basePlate, settingsZero);

    const projectResult = calc.calculateProject({
      plates: [{ ...basePlate, is_test_print: 0 }],
      settings: settingsZero,
      itemsPerSet: 1,
    });
    // calculateProject's normalized 's' object uses Number('0') || 40 = 40,
    // so plateBreakdowns[0].totalPlateCost is computed at hourly_rate=40.
    const projectPlateCost = projectResult.plateBreakdowns[0].totalPlateCost;

    expect(testPrintTotal).toBeCloseTo(projectPlateCost, 6);
    // Repro target: €3.82
    expect(testPrintTotal).toBeCloseTo(3.82, 2);
  });

  // Test 2: non-zero hourly_rate — parity must hold there too.
  test('parity with calculateProject plateBreakdowns when hourly_rate is non-zero', () => {
    const settingsNonZero = { ...defaultSettings, hourly_rate: 50, electricity_price_kwh: 0.40 };

    const testPrintTotal = computePlateCost(basePlate, settingsNonZero);

    const projectResult = calc.calculateProject({
      plates: [{ ...basePlate, is_test_print: 0 }],
      settings: settingsNonZero,
      itemsPerSet: 1,
    });
    const projectPlateCost = projectResult.plateBreakdowns[0].totalPlateCost;

    expect(testPrintTotal).toBeCloseTo(projectPlateCost, 6);
  });

  // Test 3: test-prints value must NOT include margin — it is strictly less than
  // calculateProject's project-level price-with-margin for the same single plate.
  test('test-prints totalPlateCost is cost-only, strictly less than project price-with-margin', () => {
    const settings = defaultSettings; // has non-zero profit margins

    const testPrintTotal = computePlateCost(basePlate, settings);

    const projectResult = calc.calculateProject({
      plates: [{ ...basePlate, is_test_print: 0 }],
      settings,
      itemsPerSet: 1,
    });
    // Project-level price with margin = perItemCosts.totalPerItem + profits.totalProfit
    const projectPriceWithMargin =
      projectResult.perItemCosts.totalPerItem + projectResult.profits.totalProfit;

    // cost-only < cost+margin (margins are non-zero in defaultSettings)
    expect(testPrintTotal).toBeLessThan(projectPriceWithMargin);
    // And the plate-level cost agrees with calculateProject's own plate breakdown (cost-only)
    expect(testPrintTotal).toBeCloseTo(projectResult.plateBreakdowns[0].totalPlateCost, 6);
  });
});
