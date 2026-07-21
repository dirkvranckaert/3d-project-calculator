'use strict';

/**
 * Data-loss guard for the project edit modal.
 *
 * The modal exposes no inputs for actual_sales_price or notes, so the PUT has
 * to carry the stored values through. preservedProjectFields() lives in
 * public/app.js and is DOM-free, so we extract it via `vm` — same pattern as
 * tags-widget.test.js — and exercise it in Node.
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
vm.runInContext(extractFn('preservedProjectFields'), sandbox);
const { preservedProjectFields } = sandbox;

describe('preservedProjectFields — edit-modal data-loss guard', () => {
  test('carries stored values through untouched', () => {
    expect(preservedProjectFields({ actual_sales_price: 42.5, notes: 'hello' }))
      .toEqual({ actual_sales_price: 42.5, notes: 'hello' });
  });

  test('preserves a legitimate zero sales price', () => {
    // The `|| null` this replaced turned 0 into null. 0 is real data.
    expect(preservedProjectFields({ actual_sales_price: 0, notes: null }).actual_sales_price)
      .toBe(0);
  });

  test('preserves an empty-string note rather than nulling it', () => {
    expect(preservedProjectFields({ actual_sales_price: null, notes: '' }).notes).toBe('');
  });

  test('maps genuinely absent values to null', () => {
    expect(preservedProjectFields({})).toEqual({ actual_sales_price: null, notes: null });
    expect(preservedProjectFields({ actual_sales_price: undefined, notes: undefined }))
      .toEqual({ actual_sales_price: null, notes: null });
  });

  test('returns null when the project cannot be resolved, so the caller aborts', () => {
    // This is the data-loss path: an unresolved project must never produce a
    // payload, because PUTting nulls wipes both fields.
    expect(preservedProjectFields(null)).toBeNull();
    expect(preservedProjectFields(undefined)).toBeNull();
  });
});
