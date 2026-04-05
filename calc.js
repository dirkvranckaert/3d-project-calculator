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
 *   margin_pct         = (sales_excl_vat - cost_excl_vat) / sales_incl_vat * 100
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
/*  Final pricing                                                      */
/* ------------------------------------------------------------------ */

/**
 * @param {object} opts
 *   - perItemCosts   {object}
 *   - profits        {object}  output of applyProfitMargins
 *   - extraCostsTotal {number}
 *   - itemsPerSet    {number}
 *   - vatRate        {number}  e.g. 21
 *   - priceRounding  {number}  e.g. 0.99 or 0.95
 * @returns {object}
 */
function calculateFinalPricing(opts) {
  const {
    perItemCosts,
    profits,
    extraCostsTotal,
    itemsPerSet = 1,
    vatRate = 21,
    priceRounding = 0.99,
  } = opts;

  // Scale per-item to per-set
  const baseCostPerSet = perItemCosts.totalPerItem * itemsPerSet;
  const profitPerSet = profits.totalProfit * itemsPerSet;

  // Production cost (all base costs + extras, no margins)
  const productionCost = baseCostPerSet + extraCostsTotal;

  // Total excl VAT = base costs + profits + extras
  const totalExclVat = baseCostPerSet + profitPerSet + extraCostsTotal;

  // VAT amount
  const vatAmount = totalExclVat * (vatRate / 100);

  // Total incl VAT
  const totalInclVat = totalExclVat + vatAmount;

  // Suggested price (round up to rounding target)
  const roundingDecimal = priceRounding % 1 || priceRounding;
  let suggestedPrice;
  if (totalInclVat <= 0) {
    suggestedPrice = 0;
  } else {
    suggestedPrice = Math.ceil(totalInclVat - roundingDecimal) + roundingDecimal;
    // Ensure we don't round down
    if (suggestedPrice < totalInclVat) {
      suggestedPrice += 1;
    }
  }

  // Sales excl VAT
  const suggestedExclVat = suggestedPrice / (1 + vatRate / 100);

  // Profit on suggested price (excl VAT basis)
  const suggestedProfitAmount = suggestedExclVat - productionCost;

  // Margin = (sales_excl_vat - production_cost) / sales_incl_vat * 100
  // (matches spreadsheet formula)
  const suggestedMarginPct = suggestedPrice > 0
    ? (suggestedProfitAmount / suggestedPrice) * 100
    : 0;

  return {
    baseCostPerSet,
    profitPerSet,
    productionCost,
    extraCostsTotal,
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
 * Calculate margin for an actual sales price.
 * Uses same formula as spreadsheet: (excl_vat - cost) / incl_vat * 100
 */
function calculateActualMargin(actualSalesPrice, productionCost, vatRate) {
  if (!actualSalesPrice || actualSalesPrice <= 0) return null;
  const actualExclVat = actualSalesPrice / (1 + vatRate / 100);
  const profitAmount = actualExclVat - productionCost;
  const marginPct = (profitAmount / actualSalesPrice) * 100;
  return { actualExclVat, profitAmount, marginPct };
}

/**
 * Determine margin color indicator.
 */
function marginIndicator(marginPct, greenThreshold = 30, orangeThreshold = 5) {
  if (marginPct >= greenThreshold) return 'green';
  if (marginPct >= orangeThreshold) return 'orange';
  return 'red';
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
 * @returns {object} full breakdown
 */
function calculateProject(opts) {
  const {
    plates = [],
    extras = [],
    settings = {},
    itemsPerSet = 1,
    actualSalesPrice = null,
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
    margin_green_pct: Number(settings.margin_green_pct) || 30,
    margin_orange_pct: Number(settings.margin_orange_pct) || 5,
  };

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
    };
  });

  // Per-item costs (only enabled plates)
  const enabledPlates = plateBreakdowns.filter(p => p.enabled);
  const perItemCosts = calculatePerItemCosts(enabledPlates);

  // Profit margins
  const profits = applyProfitMargins(perItemCosts, s);

  // Extra costs
  const extraCostsTotal = calculateExtraCosts(extras);

  // Final pricing
  const pricing = calculateFinalPricing({
    perItemCosts,
    profits,
    extraCostsTotal,
    itemsPerSet,
    vatRate: s.vat_rate,
    priceRounding: s.price_rounding,
  });

  // Suggested margin indicator
  const suggestedIndicator = marginIndicator(
    pricing.suggestedMarginPct, s.margin_green_pct, s.margin_orange_pct
  );

  // Actual price margin
  let actualMargin = null;
  let actualIndicator = null;
  if (actualSalesPrice && actualSalesPrice > 0) {
    actualMargin = calculateActualMargin(
      actualSalesPrice, pricing.productionCost, s.vat_rate
    );
    actualIndicator = marginIndicator(
      actualMargin.marginPct, s.margin_green_pct, s.margin_orange_pct
    );
  }

  return {
    plateBreakdowns,
    perItemCosts,
    profits,
    extraCostsTotal,
    pricing,
    suggestedIndicator,
    actualMargin,
    actualIndicator,
    settings: s,
  };
}

module.exports = {
  calculatePlateCosts,
  calculatePerItemCosts,
  applyProfitMargins,
  calculateExtraCosts,
  calculateFinalPricing,
  calculateActualMargin,
  marginIndicator,
  calculateProject,
};
