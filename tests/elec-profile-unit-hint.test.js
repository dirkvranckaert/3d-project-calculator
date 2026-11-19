'use strict';

/**
 * Electricity Profiles field must state its unit in the printer dialog.
 * elecRowHtml / kwhToWattsText are DOM-free helpers in public/app.js,
 * extracted via `vm` (frontend is otherwise uncovered by Jest).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function extractFn(name) {
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}', 'm');
  const m = APP_JS.match(re);
  if (!m) throw new Error('Could not locate function ' + name);
  return m[0];
}

const sandbox = {
  // esc() in app.js needs a DOM; stand-in with the same contract (& < > only)
  esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
};
vm.createContext(sandbox);
vm.runInContext(
  'function escAttr(s) { return esc(s).replace(/"/g, \'&quot;\').replace(/\'/g, \'&#39;\'); }\n' +
  extractFn('kwhToWattsText') + '\n' + extractFn('elecRowHtml'),
  sandbox
);
const { kwhToWattsText, elecRowHtml } = sandbox;

describe('kwhToWattsText', () => {
  test('converts kW to rounded watts', () => {
    expect(kwhToWattsText(0.2)).toBe('≈ 200 W');
    expect(kwhToWattsText('0.11')).toBe('≈ 110 W');
  });
  test('empty for blank, NaN and negative input', () => {
    expect(kwhToWattsText('')).toBe('');
    expect(kwhToWattsText('abc')).toBe('');
    expect(kwhToWattsText(-1)).toBe('');
  });
});

describe('elecRowHtml', () => {
  const html = elecRowHtml('PLA', 0.11);
  test('shows unit suffix, watts hint and placeholder', () => {
    expect(html).toContain('<span class="elec-unit">kWh/h</span>');
    expect(html).toContain('<span class="elec-watts">≈ 110 W</span>');
    expect(html).toContain('placeholder="kWh/h"');
  });
  test('keeps two inputs in order (savePrinter reads inputs[0], inputs[1])', () => {
    expect((html.match(/<input /g) || []).length).toBe(2);
    expect(html.indexOf('type="text"')).toBeLessThan(html.indexOf('type="number"'));
  });
  test('material name is attribute-escaped', () => {
    expect(elecRowHtml('a"b', 0.1)).toContain('value="a&quot;b"');
  });
});

describe('printer dialog copy', () => {
  test('helper text covers unit, average draw, measuring and PLA fallback', () => {
    expect(APP_JS).toContain('kWh per print hour</strong>');
    expect(APP_JS).toContain('average draw over a whole print');
    expect(APP_JS).toContain('kWh used &divide; print hours');
    expect(APP_JS).toContain('fall back to the PLA row');
  });
});
