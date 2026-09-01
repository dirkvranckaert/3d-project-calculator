'use strict';

/**
 * The margin cap lives in three layers: `calc.js` (engine + the server route,
 * which reads `maxReachableMarginPct()`), `public/app.js` (the prompt's own
 * mirror constant) and the `max=` attribute on the project-modal input. A
 * change that lands in one and not the others gives a UI that refuses a value
 * the API accepts (or the reverse), with no test failure to show for it —
 * exactly what happened while the cap was 95.
 *
 * The frontend is not covered by the Jest suite (see CLAUDE.md), so these are
 * text assertions rather than behavioural ones. Cheap, and they fail loudly on
 * a half-applied cap change.
 */
const fs = require('fs');
const path = require('path');
const calc = require('../calc');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('margin cap is mirrored across every layer', () => {
  const cap = calc.maxReachableMarginPct();

  test('the engine cap is an exclusive 100', () => {
    expect(cap).toBe(100);
  });

  test('public/app.js mirrors the engine constant', () => {
    const m = read('public/app.js').match(/^const MAX_MARGIN_PCT = ([\d.]+);$/m);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBe(cap);
  });

  test('the project-modal input stops just under the cap', () => {
    const html = read('public/index.html');
    const m = html.match(/id="proj-target-margin"[^>]*max="([\d.]+)"/);
    expect(m).not.toBeNull();
    const max = Number(m[1]);
    // `max` is inclusive in HTML, so it can never be the cap itself.
    expect(max).toBeLessThan(cap);
    expect(max).toBeGreaterThanOrEqual(cap - 0.01);
  });

  test('the input step is fine enough to reach the values the cap now allows', () => {
    const html = read('public/index.html');
    const m = html.match(/id="proj-target-margin"[^>]*step="([\d.]+)"/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeLessThanOrEqual(0.01);
  });
});
