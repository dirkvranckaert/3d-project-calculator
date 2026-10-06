'use strict';

/**
 * Suggested price on the ALL-IN basis (Dirk 2026-10-06, hub #2284).
 *
 * With setup & design the suggested price must be the price to enter as the
 * actual sales price so the TARGET margin is hit on the all-in line
 * (`allInMargin`), not only on the production cost. Without design nothing
 * changes. Also pins the summary-bar block order via the same `vm` hatch as
 * `setup-design-vat-labels.test.js`.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const calc = require('../calc');

const settings = {
  vat_rate: 21, price_rounding: 0.99, hourly_rate: 40,
  material_profit_pct: 200, printer_cost_profit_pct: 50,
  default_target_margin_pct: 40, lowest_target_margin_pct: 25,
  currency_symbol: '€',
};
const plate = {
  id: 1, enabled: 1, is_test_print: 0,
  print_time_minutes: 600, plastic_grams: 800, items_per_plate: 1,
  printer_purchase_price: 1000, printer_earn_back_months: 24, printer_kwh_per_hour: 0.1,
  material_price_per_kg: 25,
};
const DESIGN = 120;

const run = (opts = {}) => calc.calculateProject({
  plates: [plate], settings, itemsPerSet: 1, targetMarginPct: 40, ...opts,
});
const withDesign = (opts = {}) => run({ isCustom: true, designExtras: [{ amount: DESIGN }], ...opts });

describe('suggested price — all-in basis', () => {
  test.each([25, 40, 60])('absorbed: actual = unrounded suggested -> all-in margin == target (%i)', (target) => {
    const base = withDesign({ targetMarginPct: target });
    const r = withDesign({ targetMarginPct: target, actualSalesPrice: base.pricing.minPriceForTarget });
    expect(r.allInMargin.marginPct).toBeCloseTo(target, 6);
  });

  test.each([25, 40, 60])('invoiced separately: actual = unrounded suggested -> all-in margin == target (%i)', (target) => {
    // Small design (10) so the charge-on-top stays below the target price.
    const o = { targetMarginPct: target, designInvoicedSeparately: true, designExtras: [{ amount: 10 }] };
    const base = withDesign(o);
    expect(base.pricing.minPriceForTarget).toBeGreaterThan(0);
    const r = withDesign({ ...o, actualSalesPrice: base.pricing.minPriceForTarget });
    expect(r.allInMargin.marginPct).toBeCloseTo(target, 6);
  });

  test('rounded suggested (.99 ending) is never below the target on the all-in line', () => {
    const r = withDesign({ targetMarginPct: 40 });
    expect(r.pricing.suggestedBasis).toBe('all-in');
    expect(r.pricing.suggestedMarginPct).toBeGreaterThanOrEqual(40);
    expect(r.pricing.suggestedMarginPct).toBeLessThan(41.5);
    // Badge/profit line on the suggested card equal the all-in line when no actual price.
    expect(r.allInMargin.marginPct).toBeCloseTo(r.pricing.suggestedMarginPct, 8);
    expect(r.allInMargin.profitAmount).toBeCloseTo(r.pricing.suggestedProfitAmount, 8);
  });

  test('suggested price covers design: higher than the production-only price', () => {
    const plain = run({ isCustom: true });
    const all = withDesign();
    expect(all.pricing.suggestedPrice).toBeGreaterThan(plain.pricing.suggestedPrice);
    // production cost and the production-basis margin stay available and unchanged
    expect(all.pricing.productionCost).toBeCloseTo(plain.pricing.productionCost, 8);
    expect(all.pricing.suggestedProductionMarginPct).toBeGreaterThan(40);
  });

  test('invoiced separately with design above the whole target price clamps to 0, not negative', () => {
    const r = run({ isCustom: true, designExtras: [{ amount: 100000 }], designInvoicedSeparately: true });
    expect(r.pricing.suggestedPrice).toBe(0);
  });

  test('without setup & design: unchanged, production basis', () => {
    const plain = run();
    const noDesignCustom = run({ isCustom: true }); // custom but designTotal 0
    for (const r of [plain, noDesignCustom]) {
      expect(r.pricing.suggestedBasis).toBe('production');
      const cost = r.pricing.productionCost;
      const expected = calc.roundToPriceEnding((cost / 0.6) * 1.21, 0.99);
      expect(r.pricing.suggestedPrice).toBe(expected);
      expect(r.pricing.suggestedMarginPct).toBe(r.pricing.suggestedProductionMarginPct);
      expect(r.pricing.suggestedMarginPct).toBeCloseTo(
        ((r.pricing.suggestedExclVat - cost) / r.pricing.suggestedExclVat) * 100, 10
      );
    }
    expect(noDesignCustom.pricing.suggestedPrice).toBe(plain.pricing.suggestedPrice);
  });
});

/* ---- summary bar order + hint (frontend, via vm) ------------------------ */

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
function extractFn(name) {
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}', 'm');
  const m = APP_JS.match(re);
  if (!m) throw new Error('Could not locate function ' + name);
  return m[0];
}
const sandbox = { settings, MAX_MARGIN_PCT: calc.maxReachableMarginPct() };
vm.createContext(sandbox);
vm.runInContext(
  extractFn('fmt') + '\n' + extractFn('fmtPct') + '\n' + extractFn('lockBadge') + '\n' + extractFn('lockSeedMarginPct') + '\n' +
  extractFn('renderPricingSection'),
  sandbox
);

const asProject = (calculation, isCustom) => ({
  id: 1, items_per_set: 1, is_custom: isCustom ? 1 : 0,
  actual_sales_price: calculation.effectiveSalesPrice || null, plates: [plate], calculation,
});

describe('summary bar block order', () => {
  test('with design: Raw -> Total excl. VAT -> Setup & Design -> Suggested -> Actual', () => {
    const html = sandbox.renderPricingSection(asProject(withDesign({ actualSalesPrice: 100 }), true));
    const idx = ['<h4>Raw Production Cost', '<h4>Total excl. VAT', '<h4>Setup &amp; Design',
      '<h4>Suggested Price', '<h4>Actual Sales Price'].map(h => html.indexOf(h));
    expect(idx.every(i => i > -1)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  test('without design: no Setup & Design block, rest in order', () => {
    const html = sandbox.renderPricingSection(asProject(run({ actualSalesPrice: 100 }), false));
    expect(html).not.toContain('Setup &amp; Design');
    expect(html.indexOf('<h4>Suggested Price')).toBeLessThan(html.indexOf('<h4>Actual Sales Price'));
  });

  test('"Min. for X%" hint matches the all-in suggested basis when design is present', () => {
    const r = withDesign();
    const html = sandbox.renderPricingSection(asProject(r, true));
    expect(html).toContain('all-in margin excl. VAT: <strong>€' + r.pricing.minPriceForTarget.toFixed(2));
    const plainHtml = sandbox.renderPricingSection(asProject(run(), false));
    expect(plainHtml).not.toContain('all-in margin excl. VAT');
  });
});

/* ---- review round 1 ------------------------------------------------------ */

describe('round 1: zero production cost with design', () => {
  const zeroPlate = { ...plate, print_time_minutes: 0, plastic_grams: 0, printer_kwh_per_hour: 0, printer_purchase_price: 0 };
  const zero = (opts = {}) => calc.calculateProject({
    plates: [zeroPlate], settings, itemsPerSet: 1, targetMarginPct: 40,
    isCustom: true, designExtras: [{ amount: DESIGN }], ...opts,
  });

  test('absorbed P=0, D=120, m=40% -> 200 excl. VAT', () => {
    const r = zero();
    expect(r.pricing.productionCost).toBe(0);
    expect(r.pricing.minPriceForTarget / 1.21).toBeCloseTo(200, 8);
    expect(r.pricing.suggestedPrice).toBeGreaterThan(200 * 1.21 - 1);
    expect(r.pricing.suggestedMarginPct).toBeGreaterThanOrEqual(40);
  });

  test('no design and no cost stays on the legacy fallback (no target price)', () => {
    const r = zero({ designExtras: [] });
    expect(r.pricing.minPriceForTarget).toBe(0);
  });
});

describe('round 1: lock seed stays inside what the lock accepts', () => {
  const sb = { MAX_MARGIN_PCT: calc.maxReachableMarginPct() };
  vm.createContext(sb);
  vm.runInContext(extractFn('lockSeedMarginPct'), sb);

  test('invoiced-separately design: seed below -100 reproduces the suggested price via the lock', () => {
    const P = run({ isCustom: true }).pricing.productionCost;
    const r = withDesign({ designInvoicedSeparately: true, designExtras: [{ amount: 1.4 * P }] });
    expect(r.pricing.suggestedPrice).toBeGreaterThan(0);
    const seed = sb.lockSeedMarginPct(r.pricing.suggestedProductionMarginPct);
    expect(Number(seed)).toBeLessThan(-100);
    const locked = calc.calculateLockedPrice(r.pricing.productionCost, Number(seed), 21);
    expect(locked.reason).toBeNull();
    expect(Math.abs(locked.price - r.pricing.suggestedPrice)).toBeLessThan(0.05);
  });

  test('prompt validation has no -100 floor (server never had one)', () => {
    expect(APP_JS).not.toMatch(/n < -100/);
  });

  test('zero production cost (100% margin) or non-finite -> blank seed, never an invalid value', () => {
    expect(sb.lockSeedMarginPct(100)).toBeNull();
    expect(sb.lockSeedMarginPct(99.996)).toBeNull();
    expect(sb.lockSeedMarginPct(NaN)).toBeNull();
    expect(sb.lockSeedMarginPct(42.5)).toBe('42.50');
  });
});

/* ---- review round 2 ------------------------------------------------------ */

const sandbox2 = { settings, MAX_MARGIN_PCT: calc.maxReachableMarginPct() };
vm.createContext(sandbox2);
vm.runInContext(
  extractFn('fmt') + '\n' + extractFn('fmtPct') + '\n' + extractFn('lockBadge') + '\n' + extractFn('lockSeedMarginPct') + '\n' +
  extractFn('renderPricingSection') + '\n' + extractFn('renderSummaryCard') + '\n' +
  'function renderTagsPills() { return ""; }\nfunction esc(s) { return String(s); }',
  sandbox2
);
const asProject2 = (calculation, sep) => ({
  id: 1, name: 'x', items_per_set: 1, is_custom: 1, design_invoiced_separately: sep ? 1 : 0,
  actual_sales_price: calculation.effectiveSalesPrice || null, plates: [plate], calculation,
});
const designBlock2 = html => {
  const s = html.indexOf('<h4>Setup &amp; Design');
  return html.slice(s, html.indexOf('<div class="pricing-block', s));
};
const allInValue = html => Number(designBlock2(html).match(/All-in value \/ item: €([\d.]+) excl\./)[1]);

// Dirk 2026-08-31 (round 3 overrule): "All-in value / item" is ALWAYS
// (price + design) / items on both bases, ignoring design_invoiced_separately.
describe('round 4: all-in value card = (price + design) / items, toggle ignored', () => {
  test('suggested basis, absorbed: value = suggested + design', () => {
    const r = withDesign();
    const v = allInValue(sandbox2.renderPricingSection(asProject2(r, false)));
    expect(v).toBeCloseTo(r.pricing.suggestedExclVat + DESIGN, 2);
  });

  test('suggested basis, invoiced separately: value = suggested + design', () => {
    const r = withDesign({ designInvoicedSeparately: true });
    const v = allInValue(sandbox2.renderPricingSection(asProject2(r, true)));
    expect(v).toBeCloseTo(r.pricing.suggestedExclVat + DESIGN, 2);
  });

  test('actual basis, both toggle states: value = actual + design', () => {
    for (const sep of [false, true]) {
      const r = withDesign({ actualSalesPrice: 300, designInvoicedSeparately: sep });
      const v = allInValue(sandbox2.renderPricingSection(asProject2(r, sep)));
      expect(v).toBeCloseTo(r.actualMargin.actualExclVat + DESIGN, 2);
    }
  });

  test('suggested price entered unchanged as actual gives the same card value (absorbed)', () => {
    const sug = withDesign();
    const same = withDesign({ actualSalesPrice: sug.pricing.suggestedPrice });
    const vs = allInValue(sandbox2.renderPricingSection(asProject2(sug, false)));
    const va = allInValue(sandbox2.renderPricingSection(asProject2(same, false)));
    expect(va).toBeCloseTo(vs, 1);
  });

  test('profit/margin line stays on allInMargin (toggle-driven)', () => {
    for (const sep of [false, true]) {
      const r = withDesign({ designInvoicedSeparately: sep });
      const html = designBlock2(sandbox2.renderPricingSection(asProject2(r, sep)));
      expect(html).toContain('Profit excl. VAT: €' + r.allInMargin.profitAmount.toFixed(2));
    }
  });

  test('wording says loaded job value, not invoiced', () => {
    const html = designBlock2(sandbox2.renderPricingSection(asProject2(withDesign(), false)));
    expect(html).toContain('the loaded job value per item, not the amount actually invoiced per item');
  });

});

describe('round 4: lock prompt rejects a margin whose price rounds to 0.00', () => {
  const sb = { MAX_MARGIN_PCT: calc.maxReachableMarginPct(), settings, projects: [{ id: 7, calculation: { pricing: { productionCost: 100 } } }], captured: null };
  sb.showPrompt = async opts => { sb.captured = opts; return null; };
  vm.createContext(sb);
  vm.runInContext(extractFn('lockDerivedPrice') + '\nasync ' + extractFn('promptTargetMargin'), sb);
  const validate = async (id, v) => { await sb.promptTargetMargin(id, null); return sb.captured.validate(v); };

  test('-1e9% with cost 100 -> rejected with a clear message', async () => {
    expect(calc.calculateLockedPrice(100, -1e9, 21).price).toBe(0);
    expect(await validate(7, '-1000000000')).toMatch(/rounds to 0\.00/);
  });

  test('non-finite derived price is rejected too', async () => {
    expect(await validate(7, '-1e308')).toMatch(/rounds to 0\.00/);
  });

  test('below -100 seeds that give a valid price still pass; normal values pass', async () => {
    expect(await validate(7, '-150')).toBeNull();
    expect(await validate(7, '-5000')).toBeNull();
    expect(await validate(7, '40')).toBeNull();
  });

  test('cap + junk validation unchanged; unknown cost skips the price check', async () => {
    expect(await validate(7, '100')).toMatch(/Must be below/);
    expect(await validate(7, 'abc')).toMatch(/valid number/);
    expect(await validate(99, '-1000000000')).toBeNull();
  });
});

describe('round 2: zero suggested revenue is a non-lockable sentinel', () => {
  const clamp = () => run({ isCustom: true, designExtras: [{ amount: 100000 }], designInvoicedSeparately: true });

  test('clamped to 0 -> suggestedProductionMarginPct null, lock seed blank, display margin stays numeric', () => {
    const r = clamp();
    expect(r.pricing.suggestedExclVat).toBe(0);
    expect(r.pricing.productionCost).toBeGreaterThan(0);
    expect(r.pricing.suggestedProductionMarginPct).toBeNull();
    expect(sandbox2.lockSeedMarginPct(r.pricing.suggestedProductionMarginPct)).toBeNull();
    expect(Number.isFinite(r.pricing.suggestedMarginPct)).toBe(true);
  });

  test('"Lock margin" prompt is seeded blank in the clamp case (no fallback to the all-in %)', () => {
    const html = sandbox2.renderPricingSection(asProject2(clamp(), true));
    expect(html).toMatch(/promptTargetMargin\(1, null\)/);
  });

  test('no design, no cost fallback: production margin null, suggestedMarginPct 0', () => {
    const zeroPlate = { ...plate, print_time_minutes: 0, plastic_grams: 0, printer_kwh_per_hour: 0, printer_purchase_price: 0 };
    const r = run({ plates: [zeroPlate] });
    expect(r.pricing.suggestedProductionMarginPct).toBeNull();
    expect(r.pricing.suggestedMarginPct).toBe(0);
  });
});

describe('round 2: labels name the all-in basis', () => {
  test('summary card (suggested state, all-in) says All-in margin; production basis keeps old label', () => {
    expect(sandbox2.renderSummaryCard(asProject2(withDesign(), false))).toContain('All-in margin excl. VAT</span>');
    const plain = sandbox2.renderSummaryCard(asProject2(run({ isCustom: true }), false));
    expect(plain).toContain('>Margin excl. VAT</span>');
    expect(plain).not.toContain('All-in margin');
  });

  test('summary card with an actual price shows the production margin label', () => {
    const html = sandbox2.renderSummaryCard(asProject2(withDesign({ actualSalesPrice: 300 }), false));
    expect(html).toContain('>Margin excl. VAT</span>');
  });

  test('Suggested Price headline carries (incl. VAT)', () => {
    expect(sandbox2.renderPricingSection(asProject2(withDesign(), false))).toContain('<h4>Suggested Price (incl. VAT)</h4>');
  });
});
