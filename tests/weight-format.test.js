'use strict';

/**
 * Weight display formatting.
 *
 * fmtGrams() is the single shared weight formatter used across the project
 * calculator (material-required block, plate rows, 3MF import preview,
 * verify-schedule rows). It switches to kilograms from 1000 g up.
 *
 * Extracted from public/app.js via `vm`, same approach as hours-format.test.js.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(extractFn('fmtGrams'), sandbox);

const { fmtGrams } = sandbox;

describe('fmtGrams', () => {
  test('below 1000 g stays in grams with 2 decimals', () => {
    expect(fmtGrams(845.3)).toBe('845.30g');
  });

  test('999.99 g stays in grams', () => {
    expect(fmtGrams(999.99)).toBe('999.99g');
  });

  test('exactly 1000 g switches to kg', () => {
    expect(fmtGrams(1000)).toBe('1.00 kg');
  });

  test('formats a per-material total in kg', () => {
    expect(fmtGrams(1999.47)).toBe('2.00 kg');
    expect(fmtGrams(11809.03)).toBe('11.81 kg');
  });

  test('formats a project total in kg', () => {
    expect(fmtGrams(13808.5)).toBe('13.81 kg');
  });

  test('zero and nullish render as grams', () => {
    expect(fmtGrams(0)).toBe('0.00g');
    expect(fmtGrams(null)).toBe('0.00g');
    expect(fmtGrams(undefined)).toBe('0.00g');
  });
});
