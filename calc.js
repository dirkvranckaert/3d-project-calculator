'use strict';

/**
 * Pure calculation engine for the 3D Project Calculator.
 * All functions are side-effect-free and fully testable.
 *
 * Formulas verified against the original Google Sheets spreadsheet.
 *
 * Key formulas:
 *   electricity_cost   = (print_time_hours * risk) * kwh_per_hour * electricity_price_kwh
 *   printer_hourly     = purchase_price / (earn_back_months * 30 * 24)
 *   printer_usage_cost = (print_time_hours * risk) * printer_hourly
 *   margin_pct         = (sales_excl_vat - cost_excl_vat) / sales_excl_vat * 100
 *
 * Margin basis (changed 2026-07-22): margin is measured on the **ex-VAT**
 * price — the conventional definition, and the money actually kept. It used to
 * be divided by the incl-VAT price, which capped it at 1/(1+vat) and made a
 * "50%" pin really a 60.5% margin on turnover. Every margin figure in this file
 * is ex-VAT — there is deliberately no second, inclusive reading: `price_incl -
 * cost` is profit plus the VAT owed to the tax office, not profit.
 */

/* ------------------------------------------------------------------ */
/*  Per-plate cost breakdown                                           */
/* ------------------------------------------------------------------ */

/**
 * Calculate costs for a single print plate.
 *
 * @param {object} plate
 *   - print_time_minutes       {number}
 *   - plastic_grams            {number}
 *   - items_per_plate          {number} >= 1
 *   - risk_multiplier          {number} >= 1
 *   - pre_processing_minutes   {number}
 *   - post_processing_minutes  {number}
 *   - material_waste_grams     {number}
 * @param {object} printer
 *   - purchase_price           {number}
 *   - earn_back_months         {number}
 *   - kwh_per_hour             {number}  (electricity consumption for this material type)
 * @param {object} material
 *   - price_per_kg             {number}
 * @param {object} settings
 *   - hourly_rate              {number}
 *   - electricity_price_kwh    {number}
 * @returns {object} per-PLATE cost breakdown
 */
function calculatePlateCosts(plate, printer, material, settings) {
  const risk = plate.risk_multiplier || 1;
  const printTimeMinutes = plate.print_time_minutes || 0;
  const printTimeHours = printTimeMinutes / 60;

  // Effective values after risk multiplier (risk affects time and plastic)
  const effectivePrintTimeHours = printTimeHours * risk;
  const effectivePlasticGrams = (plate.plastic_grams || 0) * risk;

  // 1. Material cost = (effective_plastic + waste_per_item * items) * price_per_gram
  //    Waste is per-item (each item on the plate wastes material independently)
  const items = plate.items_per_plate || 1;
  const totalWasteGrams = (plate.material_waste_grams || 0) * items;
  const totalPlasticGrams = effectivePlasticGrams + totalWasteGrams;
  const materialCost = totalPlasticGrams * ((material.price_per_kg || 0) / 1000);

  // 2. Processing cost = (pre + post minutes) / 60 * hourly_rate
  const processingMinutes = (plate.pre_processing_minutes || 0)
    + (plate.post_processing_minutes || 0);
  const processingCost = (processingMinutes / 60) * (settings.hourly_rate || 0);

  // 3. Electricity cost = effective_hours * kwh_per_hour * price_per_kwh
  const electricityCost = effectivePrintTimeHours
    * (printer.kwh_per_hour || 0)
    * (settings.electricity_price_kwh || 0);

  // 4. Printer usage cost (time-based amortisation)
  //    hourly_rate = purchase_price / (earn_back_months * 30 days * 24 hours)
  const earnBackHours = (printer.earn_back_months || 1) * 30 * 24;
  const printerHourlyRate = (printer.purchase_price || 0) / earnBackHours;
  const printerUsageCost = effectivePrintTimeHours * printerHourlyRate;

  const totalPlateCost = materialCost + processingCost + electricityCost + printerUsageCost;

  return {
    materialCost,
    processingCost,
    electricityCost,
    printerUsageCost,
    totalPlateCost,
    totalPlasticGrams,
    effectivePrintTimeHours,
    itemsPerPlate: plate.items_per_plate || 1,
  };
}

/* ------------------------------------------------------------------ */
/*  Per-item costs (summed across included plates)                     */
/* ------------------------------------------------------------------ */

/**
 * @param {Array<object>} plateCosts – output of calculatePlateCosts for each plate
 * @returns {object} per-item cost breakdown
 */
function calculatePerItemCosts(plateCosts) {
  let materialCost = 0;
  let processingCost = 0;
  let electricityCost = 0;
  let printerUsageCost = 0;

  for (const pc of plateCosts) {
    const items = pc.itemsPerPlate || 1;
    materialCost += pc.materialCost / items;
    processingCost += pc.processingCost / items;
    electricityCost += pc.electricityCost / items;
    printerUsageCost += pc.printerUsageCost / items;
  }

  const totalPerItem = materialCost + processingCost + electricityCost + printerUsageCost;

  return { materialCost, processingCost, electricityCost, printerUsageCost, totalPerItem };
}

/* ------------------------------------------------------------------ */
/*  Apply profit margins (additive on top of base cost)                */
/* ------------------------------------------------------------------ */

/**
 * Profit margins are ADDED on top of base costs.
 * E.g. 200% material profit means: material_profit = material_cost * 2.0
 *
 * @param {object} perItemCosts
 * @param {object} margins
 * @returns {object}
 */
function applyProfitMargins(perItemCosts, margins) {
  const materialProfit = perItemCosts.materialCost
    * ((margins.material_profit_pct || 0) / 100);
  const processingProfit = perItemCosts.processingCost
    * ((margins.processing_profit_pct || 0) / 100);
  const electricityProfit = perItemCosts.electricityCost
    * ((margins.electricity_profit_pct || 0) / 100);
  const printerCostProfit = perItemCosts.printerUsageCost
    * ((margins.printer_cost_profit_pct || 0) / 100);

  const totalProfit = materialProfit + processingProfit
    + electricityProfit + printerCostProfit;

  return {
    materialProfit,
    processingProfit,
    electricityProfit,
    printerCostProfit,
    totalProfit,
  };
}

/* ------------------------------------------------------------------ */
/*  Extra costs                                                        */
/* ------------------------------------------------------------------ */

/**
 * @param {Array<{price_excl_vat: number, quantity: number}>} extras
 * @returns {number} total extra cost excl. VAT
 */
function calculateExtraCosts(extras) {
  let total = 0;
  for (const e of extras) {
    total += (e.price_excl_vat || 0) * (e.quantity || 0);
  }
  return total;
}

/* ------------------------------------------------------------------ */
/*  Extra hours (project-level human-time, NO margin)                  */
/* ------------------------------------------------------------------ */

/**
 * Project-level extra hours (design, consultation, hand-finishing).
 * Each row contributes `hours * hourly_rate` to the project total.
 * Per-project flat — does NOT scale by items_per_set.
 * No profit margin is applied — billed at cost.
 *
 * @param {Array<{hours: number, hourly_rate: number}>} extraHours
 * @returns {number} total extra-hours cost in EUR
 */
function calculateExtraHoursCost(extraHours) {
  let total = 0;
  for (const e of extraHours || []) {
    const h = Number(e.hours);
    const r = Number(e.hourly_rate);
    if (!Number.isFinite(h) || !Number.isFinite(r)) continue;
    total += h * r;
  }
  return total;
}

/* ------------------------------------------------------------------ */
/*  Final pricing                                                      */
/* ------------------------------------------------------------------ */

/**
 * @param {object} opts
 *   - perItemCosts    {object}
 *   - profits         {object}  output of applyProfitMargins
 *   - extraCostsTotal {number}
 *   - extraHoursCost  {number}  project-level extra hours, billed at cost (no margin)
 *   - itemsPerSet     {number}
 *   - vatRate         {number}  e.g. 21
 *   - priceRounding   {number}  e.g. 0.99 or 0.95
 * @returns {object}
 */
/**
 * Round a price up to the configured price ending (e.g. 0.99 -> 24.99).
 * Never rounds down: the result is always >= value.
 */
function roundToPriceEnding(value, priceRounding = 0.99) {
  if (!(value > 0)) return 0;
  const roundingDecimal = priceRounding % 1 || priceRounding;
  let rounded = Math.ceil(value - roundingDecimal) + roundingDecimal;
  if (rounded < value) rounded += 1;
  return rounded;
}

/**
 * Hard cap on a pinnable margin.
 *
 * On the ex-VAT basis there is no VAT-derived ceiling any more — the
 * mathematical limit is 100% (price -> infinity as margin -> 100%). 95% is a
 * sane practical stop well short of the asymptote, where the price still
 * behaves: at 95% the price is 20x cost, at 99% it is 100x.
 *
 * Independent of the VAT rate. The argument is ignored and kept only so
 * existing call sites do not have to be threaded differently.
 */
const MAX_MARGIN_PCT = 95;

function maxReachableMarginPct() {
  return MAX_MARGIN_PCT;
}

/**
 * Round a money value to whole cents, half up.
 *
 * The `+ Number.EPSILON` nudge keeps values that are a hair below a half-cent
 * only because of binary floating point (1.005 is stored as 1.00499…) from
 * rounding down.
 */
function roundToCents(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Invert the margin formula: given a production cost and a target margin,
 * return the incl-VAT sales price that produces that margin.
 *
 *   margin = (price_ex - cost) / price_ex   =>   price_ex = cost / (1 - margin)
 *   price_incl = price_ex * (1 + vat)
 *
 * The result is rounded to whole cents and NOTHING else. Nice-pricing (the
 * `.99` ending from `price_rounding`) is a sales-presentation device for the
 * *suggested* price only — the actual sales price is exact, whether it is typed
 * by hand or derived from a locked margin (Dirk 2026-07-22). Applying the price
 * ending here is what used to push the effective margin above the pinned target:
 * harmless on a big number (60% → 60.02%), badly wrong on a small one (a €0.31
 * cost pinned at 1% priced at €0.99, an effective 62%). Rounding to the cent
 * holds the target to within half a cent at any price.
 *
 * Returns `{ price, rawPrice, reason, maxMarginPct }`. `price` is null when no
 * price can be derived, with `reason` explaining why:
 *   'unreachable' — target margin >= the hard cap (95%)
 *   'no-cost'     — production cost is 0 or missing, so there is nothing to mark up
 */
function calculateLockedPrice(productionCost, targetMarginPct, vatRate = 21) {
  // `Number(null)` and `Number('')` are 0, which would silently price a lock
  // with no target at a 0% margin. Treat absent as absent.
  const target = (targetMarginPct === null || targetMarginPct === undefined || targetMarginPct === '')
    ? NaN
    : Number(targetMarginPct);
  const maxMarginPct = MAX_MARGIN_PCT;
  const base = { price: null, rawPrice: null, maxMarginPct };
  if (!Number.isFinite(target)) return { ...base, reason: 'unreachable' };
  if (target >= maxMarginPct) return { ...base, reason: 'unreachable' };
  if (!(Number(productionCost) > 0)) return { ...base, reason: 'no-cost' };
  const priceExVat = Number(productionCost) / (1 - target / 100);
  const rawPrice = priceExVat * (1 + vatRate / 100);
  return {
    price: roundToCents(rawPrice),
    rawPrice,
    reason: null,
    maxMarginPct,
  };
}

function calculateFinalPricing(opts) {
  const {
    perItemCosts,
    profits,
    extraCostsTotal,
    extraHoursCost = 0,
    itemsPerSet = 1,
    vatRate = 21,
    priceRounding = 0.99,
  } = opts;

  // Scale per-item to per-set
  const baseCostPerSet = perItemCosts.totalPerItem * itemsPerSet;
  const profitPerSet = profits.totalProfit * itemsPerSet;

  // Production cost (all base costs + extras + extra hours, no margins)
  const productionCost = baseCostPerSet + extraCostsTotal + extraHoursCost;

  // Total excl VAT = base costs + profits + extras + extra hours (no margin on hours)
  const totalExclVat = baseCostPerSet + profitPerSet + extraCostsTotal + extraHoursCost;

  // VAT amount
  const vatAmount = totalExclVat * (vatRate / 100);

  // Total incl VAT
  const totalInclVat = totalExclVat + vatAmount;

  // Suggested price (round up to rounding target)
  const suggestedPrice = roundToPriceEnding(totalInclVat, priceRounding);

  // Sales excl VAT
  const suggestedExclVat = suggestedPrice / (1 + vatRate / 100);

  // Profit on suggested price, ex-VAT basis — the money actually kept.
  // Margin = (sales_excl_vat - production_cost) / sales_excl_vat * 100
  const suggestedProfitAmount = suggestedExclVat - productionCost;
  const suggestedMarginPct = suggestedExclVat > 0
    ? (suggestedProfitAmount / suggestedExclVat) * 100
    : 0;

  return {
    baseCostPerSet,
    profitPerSet,
    productionCost,
    extraCostsTotal,
    extraHoursCost,
    totalExclVat,
    vatAmount,
    totalInclVat,
    suggestedPrice,
    suggestedExclVat,
    suggestedProfitAmount,
    suggestedMarginPct,
  };
}

/**
 * Calculate margin for an actual sales price (given incl. VAT).
 *
 * `profitAmount` / `marginPct` are the ex-VAT reading — (excl_vat - cost) /
 * excl_vat — the money actually kept, and the only margin the app reports.
 */
function calculateActualMargin(actualSalesPrice, productionCost, vatRate) {
  if (!actualSalesPrice || actualSalesPrice <= 0) return null;
  const actualExclVat = actualSalesPrice / (1 + vatRate / 100);
  const profitAmount = actualExclVat - productionCost;
  const marginPct = actualExclVat > 0 ? (profitAmount / actualExclVat) * 100 : 0;
  return { actualExclVat, profitAmount, marginPct };
}

/**
 * Determine margin color indicator.
 *
 * Thresholds are ex-VAT margins (Dirk 2026-07-22). Green at 40% sits just above
 * the ~37% floor from the margin research (Protolabs 44.5%, Xometry 34.7% gross,
 * both ex-VAT), so green means "at least what an industrial operator earns"
 * rather than a number carried over from the old incl-VAT basis.
 */
function marginIndicator(marginPct, greenThreshold = 40, orangeThreshold = 25) {
  if (marginPct >= greenThreshold) return 'green';
  if (marginPct >= orangeThreshold) return 'orange';
  return 'red';
}

/* ------------------------------------------------------------------ */
/*  Design cost calculation (custom projects only)                     */
/* ------------------------------------------------------------------ */

/**
 * Calculate one-time design costs for a custom project.
 * These are separate from production costs and NOT added to suggestedPrice.
 *
 * @param {object} opts
 *   - designHours: Array<{hours, hourly_rate}>  (is_design_cost=1 rows)
 *   - testPrints: Array<{estimated_cost, attachmentBreakdowns: Array<{totalPlateCost}>}>
 *   - designExtras: Array<{amount}>
 * @returns {{ designHoursSubtotal, testPrintsSubtotal, testPrintDetails, extrasSubtotal, designTotal }}
 */
function calculateDesignCosts(opts) {
  const { designHours = [], testPrints = [], designExtras = [] } = opts;

  let designHoursSubtotal = 0;
  for (const h of designHours) {
    const hrs = Number(h.hours);
    const rate = Number(h.hourly_rate);
    if (Number.isFinite(hrs) && Number.isFinite(rate)) designHoursSubtotal += hrs * rate;
  }

  let testPrintsSubtotal = 0;
  const testPrintDetails = [];
  for (const tp of testPrints) {
    const est = Number(tp.estimated_cost) || 0;
    testPrintsSubtotal += est;
    const actual = (tp.attachmentBreakdowns || []).reduce((s, b) => s + (Number(b.totalPlateCost) || 0), 0);
    testPrintDetails.push({
      estimated: est,
      actual,
      attachmentCount: (tp.attachmentBreakdowns || []).length,
    });
  }

  let extrasSubtotal = 0;
  for (const e of designExtras) extrasSubtotal += Number(e.amount) || 0;

  return {
    designHoursSubtotal,
    testPrintsSubtotal,
    testPrintDetails,
    extrasSubtotal,
    designTotal: designHoursSubtotal + testPrintsSubtotal + extrasSubtotal,
  };
}

/* ------------------------------------------------------------------ */
/*  Material requirements (filament grams per material, whole project) */
/* ------------------------------------------------------------------ */

/**
 * Aggregate total filament grams needed to print the whole project.
 *
 * Grams per plate are scaled identically to the Material Cost figure:
 * (totalPlasticGrams / items_per_plate) × itemsPerSet — i.e. per-item plastic ×
 * project item count. This authoritative plate figure ALWAYS drives the total,
 * keeping Σ(grams × price_per_kg) consistent with materialCost × itemsPerSet.
 *
 * Two shapes are supported and may co-exist in one project (mixed DB state):
 *   - Plate WITH per-filament grams (`colors[].grams`, captured from the 3MF at
 *     import) → split the authoritative plate grams across colours in proportion
 *     to their used-gram ratio (NOT even division), one row per brand+type+colour.
 *     Σ of the split equals the plate total exactly, so the material-cost total
 *     is unchanged.
 *   - Plate WITHOUT per-filament grams (legacy) → a single row keyed on the
 *     material record, exactly the pre-colour behaviour. Never divided evenly,
 *     never dropped, never shown as 0g.
 *
 * @param {Array<object>} enabledPlates – plate breakdowns, already filtered to
 *   enabled & non-test, each carrying { itemsPerPlate, totalPlasticGrams,
 *   materialId, materialName, materialType, materialColor, materialRollWeightG,
 *   colors: Array<{color, name, brand, grams}> }
 * @param {number} itemsPerSet – project item count
 * @returns {Array<object>} rows { materialId, materialName, materialType,
 *   materialColor, colorHex, brand, rollWeightG, grams, spools, colorSplit },
 *   sorted by grams desc. `spools` = grams / rollWeightG, or null when unknown.
 */
function aggregateMaterialRequirements(enabledPlates, itemsPerSet = 1) {
  const groups = new Map();
  const ensure = (key, seed) => {
    let g = groups.get(key);
    if (!g) { g = seed; groups.set(key, g); }
    return g;
  };

  for (const p of enabledPlates) {
    const items = p.itemsPerPlate || 1;
    // Authoritative plate grams — the figure the material cost is built from.
    const plateGrams = ((p.totalPlasticGrams || 0) / items) * itemsPerSet;

    const colours = (p.colors || [])
      .map(c => ({ ...c, g: Number(c.grams) }))
      .filter(c => Number.isFinite(c.g) && c.g > 0);
    const sumUsed = colours.reduce((s, c) => s + c.g, 0);

    if (colours.length && sumUsed > 0) {
      // Split the authoritative plate grams by the per-filament ratio.
      for (const c of colours) {
        const hex = c.color || null;
        const key = `mat:${p.materialId ?? 'none'}|hex:${hex ?? ''}|name:${c.name ?? ''}`;
        const g = ensure(key, {
          materialId: p.materialId != null ? p.materialId : null,
          materialName: p.materialName || null,
          materialType: p.materialType || null,
          materialColor: c.name || hex || (p.materialColor || null),
          colorHex: hex,
          brand: c.brand || null,
          rollWeightG: p.materialRollWeightG || null,
          grams: 0,
          colorSplit: true,
        });
        g.grams += plateGrams * (c.g / sumUsed);
      }
    } else {
      // Legacy fallback — one row per material record (pre-colour behaviour).
      const key = p.materialId != null ? `id:${p.materialId}` : 'none';
      const g = ensure(key, {
        materialId: p.materialId != null ? p.materialId : null,
        materialName: p.materialName || null,
        materialType: p.materialType || null,
        materialColor: p.materialColor || null,
        colorHex: null,
        brand: null,
        rollWeightG: p.materialRollWeightG || null,
        grams: 0,
        colorSplit: false,
      });
      g.grams += plateGrams;
    }
  }

  const list = [...groups.values()];
  for (const g of list) {
    g.spools = g.rollWeightG > 0 ? g.grams / g.rollWeightG : null;
  }
  // Sort: material type → model (material record name) → colour → hex tiebreak.
  // The full material_type string sorted alphabetically keeps every variant of a
  // type adjacent (ABS, PETG, PLA, PLA Basic, PLA Mat), so all ABS rows group and
  // all PLA* rows group. Rows with a null/empty value at a given level sort AFTER
  // named rows at that level (nullRank), so a material-less row never clumps in
  // the middle. Fully deterministic — never depends on Map insertion order.
  const nullRank = (v) => (v == null || v === '' ? 1 : 0);
  const key = (v) => String(v == null ? '' : v).toLowerCase();
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const by = (a, b, f) => (nullRank(a[f]) - nullRank(b[f])) || cmp(key(a[f]), key(b[f]));
  list.sort((a, b) =>
    by(a, b, 'materialType') ||
    by(a, b, 'materialName') ||
    by(a, b, 'materialColor') ||
    by(a, b, 'colorHex')
  );
  return list;
}

/* ------------------------------------------------------------------ */
/*  Total print time (whole project)                                   */
/* ------------------------------------------------------------------ */

/**
 * Total print time (minutes) to produce the whole project.
 *
 * For each enabled, non-test plate the printer must run the plate
 * ceil(itemsPerSet / items_per_plate) times. A partially-filled final plate
 * still occupies a FULL print run, so the plate-print count is ROUNDED UP —
 * this deliberately diverges from material grams/cost, which scale linearly.
 * Total = Σ (per-plate time × plate-print count). Uses raw print_time_minutes
 * (no risk multiplier), matching the Time column in the plates table.
 *
 * @param {Array<object>} plates – raw plate objects
 *   ({ print_time_minutes, items_per_plate, enabled, is_test_print })
 * @param {number} itemsPerSet
 * @returns {number} total print time in minutes
 */
function calculateTotalPrintTime(plates, itemsPerSet = 1) {
  let totalMinutes = 0;
  for (const plate of plates) {
    const enabled = plate.enabled !== undefined ? !!plate.enabled : true;
    if (!enabled || plate.is_test_print) continue;
    const perPlateMinutes = plate.print_time_minutes || 0;
    const itemsPerPlate = plate.items_per_plate || 1;
    const platePrints = Math.ceil((itemsPerSet || 1) / itemsPerPlate);
    totalMinutes += perPlateMinutes * platePrints;
  }
  return totalMinutes;
}

/* ------------------------------------------------------------------ */
/*  Full project calculation (orchestrator)                            */
/* ------------------------------------------------------------------ */

/**
 * Calculate everything for a project.
 *
 * @param {object} opts
 *   - plates:    Array of enriched plate objects (with printer/material data merged in)
 *   - extras:    Array of { price_excl_vat, quantity }
 *   - settings:  All settings object
 *   - itemsPerSet: number
 *   - actualSalesPrice: number | null
 *   - testPrints: Array<{estimated_cost, attachmentBreakdowns}> (custom projects)
 * @returns {object} full breakdown
 */
function calculateProject(opts) {
  const {
    plates = [],
    extras = [],
    extraHours = [],
    settings = {},
    itemsPerSet = 1,
    actualSalesPrice = null,
    marginLocked = false,
    targetMarginPct = null,
  } = opts;

  const s = {
    hourly_rate: Number(settings.hourly_rate) || 40,
    electricity_price_kwh: Number(settings.electricity_price_kwh) || 0.40,
    vat_rate: Number(settings.vat_rate) || 21,
    material_profit_pct: Number(settings.material_profit_pct) || 0,
    processing_profit_pct: Number(settings.processing_profit_pct) || 0,
    electricity_profit_pct: Number(settings.electricity_profit_pct) || 0,
    printer_cost_profit_pct: Number(settings.printer_cost_profit_pct) || 0,
    price_rounding: Number(settings.price_rounding) || 0.99,
    margin_green_pct: Number(settings.margin_green_pct) || 40,
    margin_orange_pct: Number(settings.margin_orange_pct) || 25,
  };

  const {
    designHours = [],
    designExtras = [],
    isCustom = false,
  } = opts;

  // Calculate per-plate breakdowns
  const plateBreakdowns = plates.map(plate => {
    const printer = {
      purchase_price: plate.printer_purchase_price || 0,
      earn_back_months: plate.printer_earn_back_months || 24,
      kwh_per_hour: plate.printer_kwh_per_hour || 0,
    };
    const material = {
      price_per_kg: plate.material_price_per_kg || 0,
    };
    const costs = calculatePlateCosts(plate, printer, material, s);
    return {
      ...costs,
      plateId: plate.id,
      plateName: plate.name || '',
      enabled: plate.enabled !== undefined ? !!plate.enabled : true,
      isTestPrint: !!plate.is_test_print,
      materialId: plate.material_id != null ? plate.material_id : null,
      materialName: plate.material_name || null,
      materialType: plate.material_type || null,
      materialColor: plate.material_color || null,
      materialRollWeightG: Number(plate.material_roll_weight_g) || null,
      colors: Array.isArray(plate.colors) ? plate.colors : [],
    };
  });

  // Per-item costs (only enabled, non-test-print plates)
  const enabledPlates = plateBreakdowns.filter(p => p.enabled && !p.isTestPrint);
  const perItemCosts = calculatePerItemCosts(enabledPlates);

  // Material requirements — total filament grams per material needed for the whole
  // project. Same enabled/non-test filter and same (÷ items_per_plate × items_per_set)
  // scaling as the Material Cost figure, so Σ(grams × price_per_kg / 1000) equals
  // perItemCosts.materialCost × itemsPerSet.
  const materialRequirements = aggregateMaterialRequirements(enabledPlates, itemsPerSet);

  // Total print time for the whole project (enabled non-test plates, ceil per plate)
  const totalPrintTimeMinutes = calculateTotalPrintTime(plates, itemsPerSet);

  // Profit margins
  const profits = applyProfitMargins(perItemCosts, s);

  // Custom one-off lines (project-specific, not saved to the supplies catalog).
  // Billed like supplies — folded into the extra-costs total.
  const customLinesTotal = (opts.customLines || [])
    .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);

  // Extra costs
  const extraCostsTotal = calculateExtraCosts(extras) + customLinesTotal;

  // Extra hours (project-level human-time, no margin)
  const extraHoursCost = calculateExtraHoursCost(extraHours);

  // Design costs (only for custom projects)
  const designCosts = isCustom
    ? calculateDesignCosts({ designHours, testPrints: opts.testPrints || [], designExtras })
    : null;

  // Final pricing
  const pricing = calculateFinalPricing({
    perItemCosts,
    profits,
    extraCostsTotal,
    extraHoursCost,
    itemsPerSet,
    vatRate: s.vat_rate,
    priceRounding: s.price_rounding,
  });

  // Suggested margin indicator
  const suggestedIndicator = marginIndicator(
    pricing.suggestedMarginPct, s.margin_green_pct, s.margin_orange_pct
  );

  // Margin lock: the target percentage drives the price, not the other way
  // round. The locked price is always derived here rather than stored, so a
  // later cost change moves the price automatically with no write-back.
  let marginLock = null;
  let effectiveSalesPrice = actualSalesPrice;
  if (marginLocked) {
    // No `price_rounding` here on purpose — the price ending is for the
    // suggested price only; a locked actual price is exact to the cent.
    const lock = calculateLockedPrice(
      pricing.productionCost, targetMarginPct, s.vat_rate
    );
    marginLock = { locked: true, targetPct: Number(targetMarginPct), ...lock };
    // A lock with no derivable price falls back to no actual price at all
    // rather than silently reverting to the stale manual one.
    effectiveSalesPrice = lock.price;
  }

  // Actual price margin — computed from the locked price when a lock is active.
  let actualMargin = null;
  let actualIndicator = null;
  if (effectiveSalesPrice && effectiveSalesPrice > 0) {
    actualMargin = calculateActualMargin(
      effectiveSalesPrice, pricing.productionCost, s.vat_rate
    );
    actualIndicator = marginIndicator(
      actualMargin.marginPct, s.margin_green_pct, s.margin_orange_pct
    );
  }

  return {
    plateBreakdowns,
    perItemCosts,
    materialRequirements,
    totalPrintTimeMinutes,
    profits,
    extraCostsTotal,
    extraHoursCost,
    customLinesTotal,
    designCosts,
    pricing,
    suggestedIndicator,
    actualMargin,
    actualIndicator,
    marginLock,
    effectiveSalesPrice,
    settings: s,
  };
}

/* ------------------------------------------------------------------ */
/*  Production Verification (ephemeral spot-check, no DB)              */
/* ------------------------------------------------------------------ */

/**
 * Orchestrates a batch verification entirely in memory — no project, no DB.
 * Used by the Verify Batch modal and the POST /api/projects/:id/verify-batch route.
 *
 * Cost model:
 *   printingCost      = Σ per-plate (printer_amortisation + electricity + material)
 *                       via calculatePlateCosts with pre/post = 0
 *   postProcessingCost = ((preProcessingMinutes + postProcessingMinutes) / 60) * hourlyRate
 *   suppliesCost      = Σ price_excl_vat * quantity
 *   totalBatchCost    = printingCost + postProcessingCost + suppliesCost
 *   actualCostPerUnit = totalBatchCost / sellableUnits
 *
 * Actual revenue (when actualSellingTotalInclVat is provided):
 *   netRevenue        = actualSellingTotalInclVat / (1 + settings.vat_rate / 100)
 *   absoluteMargin    = netRevenue - totalBatchCost
 *   marginPct         = absoluteMargin / netRevenue * 100
 *
 * @param {object} opts
 *   - plates: Array of enriched plate objects with embedded printer/material fields:
 *       { print_time_minutes, plastic_grams, items_per_plate,
 *         risk_multiplier (default 1), pre_processing_minutes (ignored here),
 *         post_processing_minutes (ignored here), material_waste_grams (default 0),
 *         printer_purchase_price, printer_earn_back_months, printer_kwh_per_hour,
 *         material_price_per_kg }
 *   - preProcessingMinutes       {number}  batch-level (all plates combined)
 *   - postProcessingMinutes      {number}  batch-level (all plates combined)
 *   - hourlyRate                 {number}  €/h for time cost
 *   - supplies: Array<{price_excl_vat, quantity}>
 *   - itemsPerSet                {number}  pieces per sellable unit
 *   - projectProductionCost      {number}  reference from existing calculation
 *   - projectSellingPrice        {number}  actual_sales_price or suggestedPrice (labelled "Calculated selling price" in UI)
 *   - actualSellingTotalInclVat  {number}  Dirk's actual invoice total for this batch, incl. VAT (optional)
 *   - settings                   {object}  for marginIndicator thresholds
 *
 * @returns {object}
 *   { plateCosts, totalMachineCost, printingCost, timeCost, postProcessingCost,
 *     suppliesCost, totalBatchCost,
 *     totalPieces, sellableUnits, actualCostPerUnit,
 *     vsProductionCost: { reference, delta, deltaPct, sign, indicator },
 *     vsSellingPrice:   { reference, delta, deltaPct, sign, indicator },
 *     actualMarginOnBatch: null | { actualSellingInclVat, netRevenue, absoluteMargin, marginPct, indicator } }
 */
function calculateVerification(opts) {
  const {
    plates = [],
    preProcessingMinutes = 0,
    postProcessingMinutes = 0,
    hourlyRate = 40,
    supplies = [],
    itemsPerSet = 1,
    projectProductionCost = 0,
    projectSellingPrice = 0,
    actualSellingTotalInclVat = 0,
    settings = {},
  } = opts;

  // Per-plate machine costs — each plate carries embedded printer/material
  const plateCosts = plates.map(plate => {
    const printer = {
      purchase_price:   plate.printer_purchase_price   || 0,
      earn_back_months: plate.printer_earn_back_months || 24,
      kwh_per_hour:     plate.printer_kwh_per_hour     || 0,
    };
    const material = { price_per_kg: plate.material_price_per_kg || 0 };
    // risk_multiplier default 1, material_waste_grams default 0 per brief ambiguity defaults
    const plateFull = {
      risk_multiplier:         1,
      material_waste_grams:    0,
      ...plate,
      pre_processing_minutes:  0,   // processing handled at batch level
      post_processing_minutes: 0,
    };
    const s = { hourly_rate: 0, electricity_price_kwh: Number(settings.electricity_price_kwh) || 0.40 };
    const pc = calculatePlateCosts(plateFull, printer, material, s);
    return { totalPlateCost: pc.totalPlateCost, itemsPerPlate: plate.items_per_plate || 1 };
  });

  const totalMachineCost = plateCosts.reduce((s, pc) => s + pc.totalPlateCost, 0);

  // Named alias: printing cost = machine-only (printer amortisation + electricity + plastic)
  const printingCost = totalMachineCost;

  // Batch-level time cost (pre + post at the batch level) = post-processing cost
  const timeCost = ((preProcessingMinutes + postProcessingMinutes) / 60) * hourlyRate;
  const postProcessingCost = timeCost;

  // Supplies cost
  const suppliesCost = calculateExtraCosts(supplies);

  const totalBatchCost = totalMachineCost + timeCost + suppliesCost;

  const totalPieces   = plateCosts.reduce((s, pc) => s + pc.itemsPerPlate, 0);
  const sellableUnits = Math.floor(totalPieces / (itemsPerSet || 1));
  const actualCostPerUnit = sellableUnits === 0 ? Infinity : totalBatchCost / sellableUnits;

  function makeComparison(reference) {
    if (!Number.isFinite(actualCostPerUnit) || reference === 0) {
      return { reference, delta: null, deltaPct: null, sign: null, indicator: 'red' };
    }
    const delta    = reference - actualCostPerUnit; // positive = cheaper than reference
    const deltaPct = (delta / reference) * 100;
    const sign     = delta >= 0 ? '+' : '-';
    const indicator = delta >= 0 ? 'green' : 'red';
    return { reference, delta, deltaPct, sign, indicator };
  }

  // Actual revenue margin (only when caller supplies an actual selling price incl. VAT).
  // VAT rate comes from settings.vat_rate (percentage, e.g. 21), same source as
  // calculateProject — never a hardcoded constant.
  const vatRate = Number(settings.vat_rate) || 21;
  let actualMarginOnBatch = null;
  if (actualSellingTotalInclVat > 0) {
    const netRevenue = actualSellingTotalInclVat / (1 + vatRate / 100);
    const absoluteMargin = netRevenue - totalBatchCost;
    const marginPct = netRevenue > 0 ? (absoluteMargin / netRevenue) * 100 : 0;
    actualMarginOnBatch = {
      actualSellingInclVat: actualSellingTotalInclVat,
      netRevenue,
      absoluteMargin,
      marginPct,
      indicator: marginIndicator(marginPct,
        (settings.margin_green_pct  || 40),
        (settings.margin_orange_pct || 25)),
    };
  }

  return {
    plateCosts,
    totalMachineCost,
    printingCost,         // alias for totalMachineCost — machine + electricity + plastic, no time
    timeCost,
    postProcessingCost,   // alias for timeCost — (pre+post)/60 * hourlyRate
    suppliesCost,
    totalBatchCost,
    totalPieces,
    sellableUnits,
    actualCostPerUnit,
    vsProductionCost: makeComparison(projectProductionCost),
    vsSellingPrice:   makeComparison(projectSellingPrice),
    actualMarginOnBatch,
  };
}

module.exports = {
  calculatePlateCosts,
  calculatePerItemCosts,
  aggregateMaterialRequirements,
  calculateTotalPrintTime,
  applyProfitMargins,
  calculateExtraCosts,
  calculateExtraHoursCost,
  calculateDesignCosts,
  calculateFinalPricing,
  calculateActualMargin,
  roundToPriceEnding,
  maxReachableMarginPct,
  calculateLockedPrice,
  marginIndicator,
  calculateProject,
  calculateVerification,
};
