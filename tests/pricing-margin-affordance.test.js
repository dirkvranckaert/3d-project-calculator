'use strict';

/**
 * Frontend coverage for the margin-lock affordance, via the documented `vm`
 * escape hatch — `renderPricingSection` is DOM-free (it returns a markup
 * string), so it can be exercised in Node.
 *
 * The rule pinned here: the actual-sales-price margin is the ONLY clickable
 * margin in the pricing grid, and it is clickable in all states (no price,
 * price without a lock, locked, locked-but-underivable). The suggested-price
 * margin is display-only — one target margin per project.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const calc = require('../calc');

const APP_JS = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'app.js'),
  'utf8'
);

function extractFn(name) {
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}', 'm');
  const m = APP_JS.match(re);
  if (!m) throw new Error('Could not locate function ' + name);
  return m[0];
}

const sandbox = {
  settings: {
    currency_symbol: '€',
    vat_rate: 21,
    price_rounding: 0.99,
    default_target_margin_pct: 40,
    lowest_target_margin_pct: 25,
  },
};
vm.createContext(sandbox);
vm.runInContext(
  extractFn('fmt') + '\n' +
  extractFn('fmtPct') + '\n' +
  extractFn('lockBadge') + '\n' +
  extractFn('renderPricingSection'),
  sandbox
);

const { renderPricingSection } = sandbox;

// A plate expensive enough that the .99 rounding step is a rounding artefact.
const bigPlate = {
  id: 1,
  enabled: 1,
  is_test_print: 0,
  print_time_minutes: 6000,
  plastic_grams: 3000,
  items_per_plate: 1,
  printer_purchase_price: 1000,
  printer_earn_back_months: 24,
  printer_kwh_per_hour: 0.1,
  material_price_per_kg: 25,
};
// A plate cheap enough that the same rounding step is a huge margin distortion.
const cheapPlate = { ...bigPlate, print_time_minutes: 1, plastic_grams: 10 };

function project(opts = {}) {
  const { plate = bigPlate, actualSalesPrice = null, marginLocked = false, targetMarginPct = null } = opts;
  const calculation = calc.calculateProject({
    plates: [plate],
    settings: sandbox.settings,
    itemsPerSet: 1,
    actualSalesPrice,
    marginLocked,
    targetMarginPct,
    // This fixture isn't exercising target/lock independence (that's covered
    // in calc.test.js) — same value keeps every existing case's intent intact.
    lockedMarginPct: targetMarginPct,
  });
  return {
    id: 42,
    items_per_set: 1,
    is_custom: 0,
    actual_sales_price: actualSalesPrice,
    plates: [plate],
    calculation,
  };
}

/** Every `<span class="margin-badge …">` in the rendered markup. */
function badges(html) {
  return [...html.matchAll(/<span class="margin-badge[^>]*>[\s\S]*?<\/span>/g)].map(m => m[0]);
}
function clickableBadges(html) {
  return badges(html).filter(b => b.includes('margin-badge--editable'));
}

describe('pricing section — margin affordance', () => {
  const states = {
    'no actual price, no lock': project(),
    'actual price, no lock': project({ actualSalesPrice: 500 }),
    'locked': project({ marginLocked: true, targetMarginPct: 60 }),
    // Above the 95% cap: locked, but no price can be derived.
    'locked but underivable': project({ marginLocked: true, targetMarginPct: 95 }),
  };

  test.each(Object.keys(states))('%s — exactly one clickable margin badge', (name) => {
    const html = renderPricingSection(states[name]);
    expect(clickableBadges(html)).toHaveLength(1);
  });

  test.each(Object.keys(states))('%s — the clickable badge opens the margin lock', (name) => {
    const html = renderPricingSection(states[name]);
    expect(clickableBadges(html)[0]).toContain('promptTargetMargin(42');
  });

  test.each(Object.keys(states))('%s — nothing non-clickable carries the click handler', (name) => {
    const html = renderPricingSection(states[name]);
    for (const b of badges(html)) {
      expect(b.includes('onclick')).toBe(b.includes('margin-badge--editable'));
    }
  });

  test('the suggested-price margin is display-only', () => {
    for (const name of Object.keys(states)) {
      const html = renderPricingSection(states[name]);
      const suggested = html.slice(html.indexOf('<h4>Suggested Price</h4>'));
      const block = suggested.slice(0, suggested.indexOf('</div>', suggested.indexOf('margin-badge')));
      expect(block).not.toContain('margin-badge--editable');
      expect(block).not.toContain('promptTargetMargin');
    }
  });

  test('the unlocked actual margin is as clickable as the locked one', () => {
    const unlocked = clickableBadges(renderPricingSection(states['actual price, no lock']))[0];
    const locked = clickableBadges(renderPricingSection(states['locked']))[0];
    expect(unlocked).toContain('margin-badge--editable');
    expect(locked).toContain('margin-badge--editable');
  });

  test('a project with no sales price can still be locked', () => {
    const badge = clickableBadges(renderPricingSection(states['no actual price, no lock']))[0];
    expect(badge).toContain('Lock margin');
    // Seeded with the suggested margin so the dialog opens on a sane number.
    const suggested = states['no actual price, no lock'].calculation.pricing.suggestedMarginPct;
    expect(badge).toContain(`promptTargetMargin(42, ${suggested.toFixed(2)})`);
  });
});

describe('pricing section — margin display', () => {
  test('the locked margin badge and the profit line agree by construction', () => {
    // No target-vs-effective special-casing: the derived price is exact, so
    // the profit-line percentage IS the pinned target.
    const p = project({ marginLocked: true, targetMarginPct: 60 });
    const html = renderPricingSection(p);
    expect(html).toContain('60.00% locked');
    expect(clickableBadges(html)[0]).toContain('>60.00%</span>');
    expect(p.calculation.actualMargin.marginPct).toBeCloseTo(60, 2);
  });

  test('a cheap item no longer overshoots — the price ending is gone', () => {
    const p = project({ plate: cheapPlate, marginLocked: true, targetMarginPct: 60 });
    // Used to price at a .99 ending for a wildly different margin. Now the only
    // error is the half cent an invoice forces, which on a sub-euro price is
    // still a few hundredths of a point — so the badge and the profit line can
    // differ in the last decimal. That residual is irreducible: you cannot
    // charge a fraction of a cent.
    expect(Math.abs(p.calculation.actualMargin.marginPct - 60)).toBeLessThan(0.5);
    expect(p.calculation.effectiveSalesPrice % 1).not.toBeCloseTo(0.99, 6);
  });

  test('nothing in the block explains a rounding discrepancy any more', () => {
    const p = project({ marginLocked: true, targetMarginPct: 60 });
    const html = renderPricingSection(p);
    expect(html).not.toContain('Pinned target');
    expect(html).not.toContain('effective');
  });

  test('the euro profit amount is the real figure', () => {
    const p = project({ marginLocked: true, targetMarginPct: 60 });
    const am = p.calculation.actualMargin;
    const html = renderPricingSection(p);
    expect(html).toContain(`Profit excl. VAT: €${am.profitAmount.toFixed(2)}`);
  });

  test('unlocked shows the real computed margin, unchanged', () => {
    const p = project({ actualSalesPrice: 500 });
    const badge = clickableBadges(renderPricingSection(p))[0];
    expect(badge).toContain(`>${p.calculation.actualMargin.marginPct.toFixed(2)}%<`);
  });

  test('the suggested-price margin is unaffected by the lock', () => {
    const p = project({ marginLocked: true, targetMarginPct: 60 });
    const html = renderPricingSection(p);
    const suggested = html.slice(html.indexOf('<h4>Suggested Price</h4>'));
    expect(suggested).toContain(
      `>${p.calculation.pricing.suggestedMarginPct.toFixed(2)}%<`
    );
  });
});

describe('the "Min. for X% margin" price hint', () => {
  // A price hint rather than a colour, so a colour-only sweep misses it — and
  // it sits beside the margin badge, so pointing it at the global default would
  // have it contradict the badge on any project not on the default.
  test('quotes the project target, never the global default', () => {
    const html = renderPricingSection(project({ targetMarginPct: 65 }));
    expect(html).toContain('Min. for 65% margin');
    expect(html).not.toContain('Min. for 40% margin');
  });

  test('follows the project target when it changes', () => {
    expect(renderPricingSection(project({ targetMarginPct: 30 }))).toContain('Min. for 30% margin');
    expect(renderPricingSection(project({ targetMarginPct: 80 }))).toContain('Min. for 80% margin');
  });

  test('the quoted price is the one that actually reaches that margin', () => {
    const p = project({ targetMarginPct: 65 });
    const cost = p.calculation.pricing.productionCost;
    const expected = (cost / (1 - 0.65)) * 1.21;
    const m = renderPricingSection(p).match(/Min\. for 65% margin excl\. VAT: <strong>€([\d.]+)<\/strong>/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeCloseTo(expected, 2);
  });
});
