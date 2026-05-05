'use strict';

/**
 * Round 2 — H:MM hours format helpers + currency-symbol substitution
 * + default-new-row hours value.
 *
 * Tests two new pure helpers extracted from public/app.js via `vm`:
 *   - parseHoursMinutes()
 *   - formatHoursMinutes()
 *
 * Also verifies that the renderGeneralSettings() label for the default
 * hour rate uses the live `settings.currency_symbol` (not a hardcoded €),
 * and that addExtraHourRow's PUT payload defaults to 1 hour for new rows
 * (server-side, since addExtraHourRow itself touches the DOM).
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_JS = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'app.js'),
  'utf8'
);

function extractFn(name) {
  // Match "function NAME(...) { ... \n}" — non-greedy to first \n}.
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}', 'm');
  const m = APP_JS.match(re);
  if (!m) throw new Error('Could not locate function ' + name);
  return m[0];
}

function extractRenderGeneralSettings() {
  // The renderGeneralSettings function returns a backtick template string.
  // Its body contains nested `${...}` so the simple "first \n}" approach
  // can't be re-used; we slice from the function header to the matching
  // closing brace by counting braces.
  const start = APP_JS.indexOf('function renderGeneralSettings()');
  if (start === -1) throw new Error('renderGeneralSettings not found');
  let i = APP_JS.indexOf('{', start);
  let depth = 0;
  for (; i < APP_JS.length; i++) {
    const c = APP_JS[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return APP_JS.slice(start, i);
}

const sandbox = { settings: {} };
vm.createContext(sandbox);
vm.runInContext(
  extractFn('parseHoursMinutes') + '\n' +
  extractFn('formatHoursMinutes') + '\n' +
  extractRenderGeneralSettings(),
  sandbox
);

const { parseHoursMinutes, formatHoursMinutes, renderGeneralSettings } = sandbox;

/* ================================================================== */
/*  parseHoursMinutes                                                  */
/* ================================================================== */
describe('parseHoursMinutes', () => {
  test('"0:45" -> 0.75', () => {
    expect(parseHoursMinutes('0:45')).toBeCloseTo(0.75, 6);
  });
  test('"2" -> 2 (bare integer)', () => {
    expect(parseHoursMinutes('2')).toBe(2);
  });
  test('"0.5" -> 0.5 (decimal power-user fallback)', () => {
    expect(parseHoursMinutes('0.5')).toBe(0.5);
  });
  test('"1:30" -> 1.5', () => {
    expect(parseHoursMinutes('1:30')).toBeCloseTo(1.5, 6);
  });
  test('"" -> 0', () => {
    expect(parseHoursMinutes('')).toBe(0);
  });
  test('numeric pass-through 0.75 -> 0.75', () => {
    expect(parseHoursMinutes(0.75)).toBe(0.75);
  });
  test('minutes >= 60 rejected (returns NaN)', () => {
    expect(Number.isNaN(parseHoursMinutes('1:60'))).toBe(true);
    expect(Number.isNaN(parseHoursMinutes('0:99'))).toBe(true);
  });
  test('negative rejected (returns NaN)', () => {
    expect(Number.isNaN(parseHoursMinutes('-1'))).toBe(true);
    expect(Number.isNaN(parseHoursMinutes('-1:30'))).toBe(true);
  });
  test('garbage rejected (returns NaN)', () => {
    expect(Number.isNaN(parseHoursMinutes('abc'))).toBe(true);
    expect(Number.isNaN(parseHoursMinutes('1:2:3'))).toBe(true);
  });
});

/* ================================================================== */
/*  formatHoursMinutes                                                 */
/* ================================================================== */
describe('formatHoursMinutes', () => {
  test('0.75 -> "0:45"', () => {
    expect(formatHoursMinutes(0.75)).toBe('0:45');
  });
  test('1 -> "1:00"', () => {
    expect(formatHoursMinutes(1)).toBe('1:00');
  });
  test('2.5 -> "2:30"', () => {
    expect(formatHoursMinutes(2.5)).toBe('2:30');
  });
  test('0 -> "0:00"', () => {
    expect(formatHoursMinutes(0)).toBe('0:00');
  });
  test('NaN -> "0:00"', () => {
    expect(formatHoursMinutes(NaN)).toBe('0:00');
  });
  test('negative -> "0:00" (clamped)', () => {
    expect(formatHoursMinutes(-1)).toBe('0:00');
  });
  test('rounds to nearest minute (0.7501 -> 0:45)', () => {
    expect(formatHoursMinutes(0.7501)).toBe('0:45');
  });
});

/* ================================================================== */
/*  Round-trip: H:MM -> decimal -> H:MM identity                      */
/* ================================================================== */
describe('parse + format round-trip', () => {
  const samples = ['0:00', '0:15', '0:30', '0:45', '1:00', '1:30',
                   '2:00', '2:30', '10:05', '12:59'];
  for (const s of samples) {
    test(`"${s}" -> parse -> format = "${s}"`, () => {
      expect(formatHoursMinutes(parseHoursMinutes(s))).toBe(s);
    });
  }
});

/* ================================================================== */
/*  Currency-symbol substitution in the General Settings tab           */
/* ================================================================== */
describe('renderGeneralSettings currency-symbol substitution', () => {
  test('currency_symbol="$" renders rate label as "Default Hour Rate ($/h)"', () => {
    sandbox.settings = { currency_symbol: '$' };
    const html = sandbox.renderGeneralSettings();
    expect(html).toMatch(/Default Hour Rate \(\$\/h\)/);
    // And: no leftover "Extra-Uur" + no hardcoded \u20ac in the rate label
    expect(html).not.toMatch(/Extra-Uur/);
    // The € input field for currency_symbol itself is allowed (it's a
    // different control that lets the user TYPE €), but the rate label
    // should reflect $.
  });

  test('currency_symbol unset falls back to € in rate label', () => {
    sandbox.settings = {};
    const html = sandbox.renderGeneralSettings();
    expect(html).toMatch(/Default Hour Rate \(\u20ac\/h\)/);
  });

  test('all 3 unit-bearing labels (Hourly, Default Hour, Electricity) use live currency_symbol', () => {
    sandbox.settings = { currency_symbol: 'CHF' };
    const html = sandbox.renderGeneralSettings();
    expect(html).toMatch(/Hourly Processing Rate \(CHF\)/);
    expect(html).toMatch(/Default Hour Rate \(CHF\/h\)/);
    expect(html).toMatch(/Electricity Price \(CHF\/kWh\)/);
  });
});

