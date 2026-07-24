'use strict';

/**
 * Frontend coverage for the Setup & Design summary card, via the same documented
 * `vm` escape hatch used by `pricing-margin-affordance.test.js` —
 * `renderPricingSection` returns a markup string, so it runs in Node.
 *
 * The rule pinned here: the two big numbers in the pricing grid are the same
 * quantity. "Actual Sales Price" is incl. VAT, so "Setup & Design" leads with
 * incl. VAT too, and every figure in the card names its basis. Dirk added an
 * incl. VAT sales price to an excl. VAT setup total (2026-07-24) — the maths was
 * right, the card invited the mistake.
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

const plate = {
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

const VAT = 1.21;
const DESIGN_EXCL = 200;

function customProject({ itemsPerSet = 40, actualSalesPrice = 539.83 } = {}) {
  const calculation = calc.calculateProject({
    plates: [plate],
    settings: sandbox.settings,
    itemsPerSet,
    actualSalesPrice,
    isCustom: true,
    designExtras: [{ amount: DESIGN_EXCL }],
  });
  return {
    id: 20,
    items_per_set: itemsPerSet,
    is_custom: 1,
    actual_sales_price: actualSalesPrice,
    plates: [plate],
    calculation,
  };
}

/** The Setup & Design card only — the grid holds four other blocks. */
function designBlock(html) {
  const start = html.indexOf('<h4>Setup &amp; Design');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start);
}

describe('Setup & Design card — VAT basis', () => {
  test('the header names the basis, like the sales-price card', () => {
    const html = renderPricingSection(customProject());
    expect(html).toContain('<h4>Setup &amp; Design (one-time, incl. VAT)</h4>');
  });

  test('the big number is incl. VAT — the same quantity as the sales price', () => {
    const block = designBlock(renderPricingSection(customProject()));
    const m = block.match(/<div class="big-price">€([\d.]+)<\/div>/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeCloseTo(DESIGN_EXCL * VAT, 2);
  });

  test('the excl. VAT figure sits under it, labelled', () => {
    const block = designBlock(renderPricingSection(customProject()));
    expect(block).toContain(`<div class="sub">€${DESIGN_EXCL.toFixed(2)} excl. VAT</div>`);
  });

  test('the per-item line carries both bases', () => {
    const block = designBlock(renderPricingSection(customProject({ itemsPerSet: 40 })));
    expect(block).toContain('€5.00 / item excl. &middot; €6.05 / item incl. VAT');
  });

  test('a single-item project shows no per-item line', () => {
    const block = designBlock(renderPricingSection(customProject({ itemsPerSet: 1 })));
    expect(block).not.toContain('/ item excl.');
  });

  test('no figure in the card is left without a basis', () => {
    const block = designBlock(renderPricingSection(customProject()));
    // The big price takes its basis from the header, exactly as the sales-price
    // card does; every figure below it names its own.
    const belowBigPrice = block.slice(block.indexOf('</div>', block.indexOf('big-price')));
    const amounts = [...belowBigPrice.matchAll(/€[\d.]+/g)].map(m => m.index);
    for (let i = 0; i < amounts.length; i++) {
      const end = i + 1 < amounts.length ? amounts[i + 1] : belowBigPrice.length;
      const tail = belowBigPrice.slice(amounts[i], end);
      expect(tail).toMatch(/excl\.|incl\./);
    }
  });
});

describe('Setup & Design card — the all-in line is unchanged', () => {
  test('all-in excl. VAT is the ex-VAT sales price plus the ex-VAT setup', () => {
    const p = customProject();
    const block = designBlock(renderPricingSection(p));
    const expected = (p.calculation.actualMargin.actualExclVat + DESIGN_EXCL) / 40;
    const m = block.match(/All-in \/ item incl\. setup &amp; design: €([\d.]+) excl\./);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeCloseTo(expected, 2);
  });

  test('all-in incl. VAT applies VAT once, to the whole', () => {
    const p = customProject();
    const block = designBlock(renderPricingSection(p));
    const expected = ((p.calculation.actualMargin.actualExclVat + DESIGN_EXCL) * VAT) / 40;
    const m = block.match(/excl\. &middot; €([\d.]+) incl\. VAT<\/strong>/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeCloseTo(expected, 2);
  });
});
