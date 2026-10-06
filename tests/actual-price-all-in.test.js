'use strict';

/**
 * Actual Sales Price card on the ALL-IN basis (task #2290, Dirk 2026-10-06).
 *
 * With setup & design (D > 0) the actual price's profit / margin / colour /
 * lock are computed exactly like the suggested price's. D = 0 is untouched.
 * Frontend parts run through the documented `vm` hatch (see
 * `pricing-margin-affordance.test.js`).
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

describe('actual = suggested -> identical profit and margin', () => {
  test.each([false, true])('with design (separately=%s)', (sep) => {
    // small design when invoiced separately, so the suggestion is not the EUR 0 clamp
    const o = { designInvoicedSeparately: sep, designExtras: [{ amount: sep ? 5 : DESIGN }] };
    const sug = withDesign(o);
    expect(sug.pricing.suggestedPrice).toBeGreaterThan(0);
    const act = withDesign({ ...o, actualSalesPrice: sug.pricing.suggestedPrice });
    expect(act.actualMargin.basis).toBe('all-in');
    expect(act.actualMargin.profitAmount).toBeCloseTo(sug.pricing.suggestedProfitAmount, 10);
    expect(act.actualMargin.marginPct).toBeCloseTo(sug.pricing.suggestedMarginPct, 10);
    expect(act.actualIndicator).toBe(sug.suggestedIndicator);
    // and the old production-basis reading stays available, not the headline
    expect(act.actualMargin.productionMarginPct).not.toBeCloseTo(act.actualMargin.marginPct, 3);
  });

  test('a EUR 62.99 price reads the all-in figure (production cost + design), not production only', () => {
    const am = calc.calculateActualMargin(62.99, 20.77, 21, { designTotalExcl: 10.00, designInvoicedSeparately: false });
    const ex = 62.99 / 1.21;
    expect(am.profitAmount).toBeCloseTo(ex - 20.77 - 10, 10);
    expect(am.marginPct).toBeCloseTo(((ex - 30.77) / ex) * 100, 10);
  });

  test('D = 0 is byte-identical to the production reading (no extra fields)', () => {
    const am = calc.calculateActualMargin(100, 40, 21);
    expect(am).toEqual({ actualExclVat: 100 / 1.21, profitAmount: 100 / 1.21 - 40, marginPct: ((100 / 1.21 - 40) / (100 / 1.21)) * 100 });
    expect(run({ actualSalesPrice: 100 }).actualMargin)
      .toEqual(calc.calculateActualMargin(100, run().pricing.productionCost, 21));
    // custom project with design 0 stays production basis too
    expect(run({ isCustom: true, actualSalesPrice: 100 }).actualMargin.basis).toBeUndefined();
  });
});

describe('lock margin on the all-in basis', () => {
  test.each([false, true])('locking X yields the price whose all-in margin is X (separately=%s)', (sep) => {
    for (const x of [25, 40, 55.5, 70]) {
      const r = withDesign({
        designInvoicedSeparately: sep, targetMarginPct: 20,
        marginLocked: true, lockedMarginPct: x,
        designExtras: [{ amount: sep ? 5 : DESIGN }],
      });
      expect(r.marginLock.basis).toBe('all-in');
      // exact to the cent: the margin of the rounded price is within a cent's reach of X
      expect(r.actualMargin.marginPct).toBeCloseTo(x, 1);
      // never nice-rounded
      expect(Math.round(r.effectiveSalesPrice * 100) / 100).toBe(r.effectiveSalesPrice);
    }
  });

  test('exact inverse of calculateAllInMargin at full precision', () => {
    const P = 10; const D = 1000;
    for (const sep of [false, true]) {
      const lock = calc.calculateLockedPrice(P, 40, 21, { designTotalExcl: sep ? 2 : D, designInvoicedSeparately: sep });
      const ai = calc.calculateAllInMargin({
        actualExclVat: lock.rawPrice / 1.21, productionCost: P,
        designTotalExcl: sep ? 2 : D, designInvoicedSeparately: sep,
      });
      expect(ai.marginPct).toBeCloseTo(40, 9);
    }
  });

  test('seeding the full-precision suggested margin reproduces the suggested price (finding 3)', () => {
    // P = 10, D = 1000, target 40: seeding the 2-decimal rounded margin moved the price by ~EUR 14.
    const sug = calc.calculateAllInMargin({ actualExclVat: 2036.99 / 1.21, productionCost: 10, designTotalExcl: 1000 });
    const exact = calc.calculateLockedPrice(10, sug.marginPct, 21, { designTotalExcl: 1000 }).price;
    expect(exact).toBe(2036.99);
    const rounded = calc.calculateLockedPrice(10, Number(sug.marginPct.toFixed(2)), 21, { designTotalExcl: 1000 }).price;
    expect(rounded).not.toBe(2036.99);
  });

  test('D = 0 lock is byte-identical (no basis flag, production formula)', () => {
    const l = calc.calculateLockedPrice(100, 50, 21);
    expect(l).toEqual({ price: 242, rawPrice: 242, reason: null, maxMarginPct: calc.maxReachableMarginPct() });
    expect(calc.calculateLockedPrice(100, 50, 21, { designTotalExcl: 0 })).toEqual(l);
  });

  test('invoiced separately: design above the whole target price clamps to 0, flagged as not derivable', () => {
    const l = calc.calculateLockedPrice(10, 40, 21, { designTotalExcl: 100000, designInvoicedSeparately: true });
    expect(l.price).toBe(0);
  });
});

describe('a recorded EUR 0 actual price stays an actual price (finding 2)', () => {
  test('stored 0 produces an actualMargin and survives a changed suggestion', () => {
    const r = withDesign({ designInvoicedSeparately: true, actualSalesPrice: 0 });
    expect(r.actualMargin).not.toBeNull();
    expect(r.effectiveSalesPrice).toBe(0);
    const absorbed = withDesign({ actualSalesPrice: 0 });
    expect(absorbed.actualMargin.actualExclVat).toBe(0);
    expect(absorbed.actualMargin.profitAmount).toBeLessThan(0);
    // revenue basis of the all-in line is the recorded 0, not the suggestion
    expect(absorbed.allInMargin.revenue).toBe(0);
  });

  test('null / negative is still "no price"; a lock deriving 0 is still "no price"', () => {
    expect(withDesign({ actualSalesPrice: null }).actualMargin).toBeNull();
    expect(withDesign({ actualSalesPrice: -1 }).actualMargin).toBeNull();
    const locked = withDesign({ designInvoicedSeparately: true, designExtras: [{ amount: 100000 }], marginLocked: true, lockedMarginPct: 40 });
    expect(locked.effectiveSalesPrice).toBe(0);
    expect(locked.actualMargin).toBeNull();
  });
});

/* ---- frontend, via vm --------------------------------------------------- */

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
function extractFn(name) {
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}', 'm');
  const m = APP_JS.match(re);
  if (!m) throw new Error('Could not locate function ' + name);
  return m[0];
}
const sandbox = { settings, MAX_MARGIN_PCT: 100 };
vm.createContext(sandbox);
vm.runInContext(
  ['fmt', 'fmtPct', 'allInBasisText', 'lockBadge', 'lockSeedMarginPct', 'lockPromptArgs', 'renderPricingSection', 'renderSummaryCard']
    .map(extractFn).join('\n') +
  '\nfunction renderTagsPills() { return ""; }\nfunction esc(s) { return String(s); }',
  sandbox
);
const asProject = (calculation, sep = false, isCustom = true) => ({
  id: 1, name: 'x', items_per_set: 1, is_custom: isCustom ? 1 : 0, design_invoiced_separately: sep ? 1 : 0,
  actual_sales_price: calculation.actualMargin ? calculation.effectiveSalesPrice : null, plates: [plate], calculation,
});
const block = (html, title) => {
  const s = html.indexOf(`<h4>${title}`);
  expect(s).toBeGreaterThan(-1);
  const n = html.indexOf('<div class="pricing-block', s + 1);
  return html.slice(s, n > -1 ? n : undefined);
};

describe('Actual Sales Price card (all-in)', () => {
  test.each([false, true])('actual = suggested renders the suggested card profit + margin (separately=%s)', (sep) => {
    const sug = withDesign({ designInvoicedSeparately: sep });
    const act = withDesign({ designInvoicedSeparately: sep, actualSalesPrice: sug.pricing.suggestedPrice });
    const html = sandbox.renderPricingSection(asProject(act, sep));
    const suggested = block(html, 'Suggested Price');
    const actual = block(html, 'Actual Sales Price');
    const profit = s => s.match(/Profit excl\. VAT: (€[\d.]+)/)[1];
    const pct = s => s.match(/margin-badge[^>]*>([\d.]+%)</)[1];
    expect(profit(actual)).toBe(profit(suggested));
    expect(pct(actual)).toBe(pct(suggested));
    expect(actual).toContain('margin-badge--editable');
    expect(actual).toContain('All-in margin excl. VAT');
    expect(actual).toContain(`margin-badge ${sug.suggestedIndicator}`);
  });

  test('D = 0: card keeps the production wording', () => {
    const html = sandbox.renderPricingSection(asProject(run({ actualSalesPrice: 100 }), false, false));
    const actual = block(html, 'Actual Sales Price');
    expect(actual).toContain('title="Margin on the price excl. VAT');
    expect(actual).not.toContain('All-in');
  });

  test('summary card margin follows the all-in actual', () => {
    const act = withDesign({ actualSalesPrice: 300 });
    const html = sandbox.renderSummaryCard(asProject(act));
    expect(html).toContain(`>${act.actualMargin.marginPct.toFixed(2)}%`);
    expect(html).toContain('All-in margin excl. VAT');
  });

  test('a recorded EUR 0 renders the actual block, not an empty input', () => {
    const html = sandbox.renderPricingSection(asProject(withDesign({ designInvoicedSeparately: true, actualSalesPrice: 0 }), true));
    const actual = block(html, 'Actual Sales Price');
    expect(actual).toContain('€0.00');
    expect(actual).not.toContain('actual-price-input');
  });

  test('lock prompt args carry the full-precision margin; untouched seed submits it', async () => {
    const am = calc.calculateAllInMargin({ actualExclVat: 2036.99 / 1.21, productionCost: 10, designTotalExcl: 1000 });
    const args = sandbox.lockPromptArgs(am.marginPct, false);
    expect(args).toBe(`${am.marginPct.toFixed(2)}, ${am.marginPct}`);
    expect(sandbox.lockPromptArgs(NaN, false)).toBe('null, null');
    expect(sandbox.lockPromptArgs(63, true)).toBe('63, 63');

    const sb = {
      MAX_MARGIN_PCT: 100, settings, projects: [], detachedProject: null, shown: null, sent: null,
    };
    sb.showPrompt = async o => { sb.shown = o.initialValue; return sb.shown; };
    sb.setMarginLock = async (id, locked, pct) => { sb.sent = pct; };
    vm.createContext(sb);
    vm.runInContext(['findProject', 'lockDerivedPrice'].map(extractFn).join('\n') + '\nasync ' + extractFn('promptTargetMargin'), sb);
    await sb.promptTargetMargin(1, am.marginPct.toFixed(2), am.marginPct);
    expect(sb.sent).toBe(am.marginPct);
    // an edited value wins over the exact seed
    sb.showPrompt = async () => '55';
    await sb.promptTargetMargin(1, am.marginPct.toFixed(2), am.marginPct);
    expect(sb.sent).toBe(55);
  });

  test('lock validator on an ARCHIVED project (detached) still validates the derived price (finding 4)', async () => {
    const sb = {
      MAX_MARGIN_PCT: 100, settings, projects: [], captured: null,
      detachedProject: { id: 9, calculation: { pricing: { productionCost: 100 } } },
    };
    sb.showPrompt = async o => { sb.captured = o; return null; };
    vm.createContext(sb);
    vm.runInContext(['findProject', 'lockDerivedPrice'].map(extractFn).join('\n') + '\nasync ' + extractFn('promptTargetMargin'), sb);
    await sb.promptTargetMargin(9, null);
    expect(sb.captured.validate('-1000000000')).toMatch(/rounds to 0\.00/);
  });

  test('lock validator is all-in aware: design makes a no-cost project lockable', async () => {
    const sb = {
      MAX_MARGIN_PCT: 100, settings, projects: [{ id: 3, design_invoiced_separately: 0, calculation: { pricing: { productionCost: 0 }, designCosts: { designTotal: 50 } } }],
      detachedProject: null, captured: null,
    };
    sb.showPrompt = async o => { sb.captured = o; return null; };
    vm.createContext(sb);
    vm.runInContext(['findProject', 'lockDerivedPrice'].map(extractFn).join('\n') + '\nasync ' + extractFn('promptTargetMargin'), sb);
    await sb.promptTargetMargin(3, null);
    expect(sb.captured.validate('40')).toBeNull();
    expect(sb.lockDerivedPrice(0, 40, 21, 50, false)).toBeCloseTo((50 / 0.6) * 1.21, 2);
  });
});

describe('Codex R1 fixes (#2290)', () => {
  const marginClick = s => s.match(/promptTargetMargin\(1, ([^)]*)\)/)[1];

  test.each([
    ['D = 0', () => asProject(run({ actualSalesPrice: 0 }), false, false)],
    ['absorbed design', () => asProject(withDesign({ actualSalesPrice: 0 }))],
  ])('recorded EUR 0 (%s): margin badge seeds blank, not the 0%% sentinel', (_n, mk) => {
    const actual = block(sandbox.renderPricingSection(mk()), 'Actual Sales Price');
    expect(actual).toContain('€0.00');
    expect(marginClick(actual)).toBe('null, null');
  });

  test('a real price still seeds its margin (not blanked)', () => {
    const actual = block(sandbox.renderPricingSection(asProject(withDesign({ actualSalesPrice: 300 }))), 'Actual Sales Price');
    expect(marginClick(actual)).not.toBe('null, null');
  });

  test('labels say All-in margin when D > 0 in the no-price and underivable-lock branches', () => {
    const noPrice = block(sandbox.renderPricingSection(asProject(withDesign({}))), 'Actual Sales Price');
    expect(noPrice).toContain('All-in margin excl. VAT:');
    const locked = withDesign({ designInvoicedSeparately: true, designExtras: [{ amount: 100000 }], marginLocked: true, lockedMarginPct: 40 });
    const lockedBlock = block(sandbox.renderPricingSection(asProject(locked, true)), 'Actual Sales Price');
    expect(lockedBlock).toContain('All-in margin excl. VAT:');
    expect(lockedBlock).toContain('An all-in margin of');
    // D = 0 keeps the production wording in both
    const plainNo = block(sandbox.renderPricingSection(asProject(run({}), false, false)), 'Actual Sales Price');
    expect(plainNo).toContain('>Margin excl. VAT:');
    expect(plainNo).not.toContain('All-in');
  });

  test('Verify Batch: recorded EUR 0 is the selling price, a no-price lock is not', () => {
    const sb = {
      settings, verifyProjectId: null, verifyProjectRef: null, verifyPlates: [], verifySupplies: [],
      projects: [], detachedProject: null,
    };
    const zero = { id: 5, items_per_set: 1, calculation: { ...withDesign({ actualSalesPrice: 0 }) } };
    const none = { id: 6, items_per_set: 1, calculation: { ...withDesign({ designInvoicedSeparately: true, designExtras: [{ amount: 100000 }], marginLocked: true, lockedMarginPct: 40 }) } };
    sb.projects = [zero, none];
    vm.createContext(sb);
    const src = extractFn('openVerifyModal');
    // only the price-selection head of openVerifyModal is under test
    const head = src.slice(0, src.indexOf('// Reset state'));
    vm.runInContext(extractFn('findProject') + '\n' + head.replace('function openVerifyModal(projectId) {', 'function pick(projectId) {') + '\n return verifyProjectRef; }', sb);
    expect(sb.pick(5).sellingPrice).toBe(0);
    expect(sb.pick(5).sellingPriceLabel).toBe('Calculated selling price');
    expect(sb.pick(6).sellingPriceLabel).toBe('Suggested price');
  });
});

describe('Setup & Design card no longer carries all-in value or profit', () => {
  test.each([false, true])('only headline incl. VAT + excl. VAT line (separately=%s)', (sep) => {
    const html = sandbox.renderPricingSection(asProject(withDesign({ designInvoicedSeparately: sep, actualSalesPrice: 200 }), sep));
    const card = block(html, 'Setup &amp; Design');
    expect(card).not.toContain('All-in value');
    expect(card).not.toContain('loaded job value');
    expect(card).not.toContain('Profit excl. VAT');
    expect(card).not.toContain('margin-badge');
    expect(card).toContain('excl. VAT');
    expect(card).toContain(`€${(DESIGN * 1.21).toFixed(2)}`);
  });
});

describe('per-row lock basis (calc + UI, #2290 R2)', () => {
  const lockedOpts = (basis, sep = false) => ({
    designInvoicedSeparately: sep, marginLocked: true, lockedMarginPct: 60, lockedMarginBasis: basis,
  });

  test.each([false, true])('legacy production basis inverts P / (1 - m), exactly the old price (separately=%s)', (sep) => {
    const c = withDesign(lockedOpts('production', sep));
    expect(c.effectiveSalesPrice).toBe(calc.calculateLockedPrice(c.pricing.productionCost, 60, 21).price);
    expect(c.marginLock.basis).toBe('production');
    // descriptive actual card stays all-in
    expect(c.actualMargin.basis).toBe('all-in');
  });

  test('all-in basis differs from production when D > 0, and is the default when no basis is given', () => {
    const legacy = withDesign(lockedOpts('production'));
    const allIn = withDesign(lockedOpts('all-in'));
    expect(allIn.effectiveSalesPrice).not.toBe(legacy.effectiveSalesPrice);
    expect(withDesign({ marginLocked: true, lockedMarginPct: 60 }).effectiveSalesPrice).toBe(allIn.effectiveSalesPrice);
    expect(allIn.actualMargin.marginPct).toBeCloseTo(60, 1);
  });

  test('D = 0: both bases are byte-identical', () => {
    const a = run(lockedOpts('production'));
    const b = run(lockedOpts('all-in'));
    expect(a.effectiveSalesPrice).toBe(b.effectiveSalesPrice);
    expect(a.marginLock).toEqual(b.marginLock);
    expect(a.marginLock.basis).toBeUndefined();
  });

  test.each([false, true])('legacy lock seeds the ALL-IN margin of its price; re-lock is price-stable (separately=%s)', (sep) => {
    const legacy = withDesign(lockedOpts('production', sep));
    const html = sandbox.renderPricingSection(asProject(legacy, sep));
    const actual = block(html, 'Actual Sales Price');
    const seedArgs = actual.match(/promptTargetMargin\(1, ([^)]*)\)/)[1];
    expect(seedArgs).toBe(`${legacy.actualMargin.marginPct.toFixed(2)}, ${legacy.actualMargin.marginPct}`);
    const relocked = withDesign({ ...lockedOpts('all-in', sep), lockedMarginPct: legacy.actualMargin.marginPct });
    expect(relocked.effectiveSalesPrice).toBe(legacy.effectiveSalesPrice);
  });

  test('legacy lock badge says production-basis; an all-in lock does not', () => {
    const legacy = block(sandbox.renderPricingSection(asProject(withDesign(lockedOpts('production')))), 'Actual Sales Price');
    expect(legacy).toContain('of production cost excl. VAT');
    const fresh = block(sandbox.renderPricingSection(asProject(withDesign(lockedOpts('all-in')))), 'Actual Sales Price');
    expect(fresh).not.toContain('of production cost excl. VAT');
  });

  test('wording follows design_invoiced_separately (tooltips)', () => {
    for (const sep of [false, true]) {
      const act = withDesign({ designInvoicedSeparately: sep, designExtras: [{ amount: 5 }], actualSalesPrice: 300 });
      const html = sandbox.renderPricingSection(asProject(act, sep)) + sandbox.renderSummaryCard(asProject(act, sep));
      if (sep) {
        expect(html).toContain('setup &amp; design invoiced on top, counted in revenue');
        expect(html).not.toContain('production cost + setup');
      } else {
        expect(html).toContain('production cost + setup &amp; design');
        expect(html).not.toContain('invoiced on top');
      }
    }
  });

  test.each([
    [false, 'absorbed into the unit price', 'invoiced on top'],
    [true, 'invoiced on top of the unit price and counted in revenue', 'absorbed'],
  ])('lock prompt message (separately=%s)', async (sep, has, hasNot) => {
    const sb = {
      MAX_MARGIN_PCT: 100, settings, projects: [{ id: 3, design_invoiced_separately: sep ? 1 : 0,
        calculation: { pricing: { productionCost: 10 }, designCosts: { designTotal: 50 } } }],
      detachedProject: null, captured: null,
    };
    sb.showPrompt = async o => { sb.captured = o; return null; };
    vm.createContext(sb);
    vm.runInContext(['findProject', 'lockDerivedPrice'].map(extractFn).join('\n') + '\nasync ' + extractFn('promptTargetMargin'), sb);
    await sb.promptTargetMargin(3, null);
    expect(sb.captured.message).toContain(has);
    expect(sb.captured.message).not.toContain(hasNot);
    expect(sb.captured.message).not.toContain('plus setup');
  });
});

describe('Codex R3 fixes (#2290)', () => {
  test('lockPromptArgs: eligibility on full precision, 99.999% seeds (finding 1)', () => {
    expect(sandbox.lockPromptArgs(99.999, false)).toBe('100.00, 99.999');
    expect(sandbox.lockPromptArgs(99.999, true)).toBe('100.00, 99.999');
    expect(sandbox.lockPromptArgs(100, false)).toBe('null, null');
    expect(sandbox.lockPromptArgs(100.004, false)).toBe('null, null');
    expect(sandbox.lockSeedMarginPct(99.99)).toBe('99.99');
  });

  test.each([
    ['unreachable (target >= cap)', 10, 100],
    ['unreachable (no target)', 10, null],
    ['no-cost', 0, 60],
  ])('calculateLockedPrice attaches the per-row basis on early returns: %s (finding 2)', (name, cost, target) => {
    const legacy = calc.calculateLockedPrice(cost, target, 21, { designTotalExcl: 50, lockBasis: 'production' });
    expect(legacy.price).toBeNull();
    expect(legacy.basis).toBe('production');
    if (name !== 'no-cost') {
      expect(calc.calculateLockedPrice(cost, target, 21, { designTotalExcl: 50 }).basis).toBe('all-in');
    }
    // D = 0: no basis key, byte-identical to before
    expect(calc.calculateLockedPrice(cost, target, 21)).not.toHaveProperty('basis');
  });

  test('lock dialog message is text-only: literal ampersand, no HTML entities (finding 3)', async () => {
    for (const sep of [false, true]) {
      const sb = {
        MAX_MARGIN_PCT: 100, settings, detachedProject: null, captured: null,
        projects: [{ id: 3, design_invoiced_separately: sep ? 1 : 0, calculation: { pricing: { productionCost: 10 }, designCosts: { designTotal: 50 } } }],
      };
      sb.showPrompt = async o => { sb.captured = o; return null; };
      vm.createContext(sb);
      vm.runInContext(['findProject', 'lockDerivedPrice'].map(extractFn).join('\n') + '\nasync ' + extractFn('promptTargetMargin'), sb);
      await sb.promptTargetMargin(3, null);
      expect(sb.captured.message).toContain('Setup & design');
      for (const s of [sb.captured.title, sb.captured.message, sb.captured.label, sb.captured.validate('abc')]) {
        expect(s).not.toMatch(/&(amp|lt|gt|quot|#\d+);/);
      }
    }
  });
});
