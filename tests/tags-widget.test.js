'use strict';

/**
 * Commit 4 — pure-function unit tests for the tags widget helpers.
 *
 * commitPill / removePill / filterSuggestions / parseTagsString /
 * serializePills live in public/app.js — DOM-free so we can extract
 * them via `vm` and exercise them in Node.
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

const src =
  extractFn('parseTagsString') + '\n' +
  extractFn('serializePills')  + '\n' +
  extractFn('commitPill')      + '\n' +
  extractFn('removePill')      + '\n' +
  extractFn('filterSuggestions');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

const {
  parseTagsString, serializePills,
  commitPill, removePill, filterSuggestions,
} = sandbox;

describe('tags widget — pure helpers', () => {
  describe('parseTagsString / serializePills', () => {
    test('parses a comma-delimited string into trimmed non-empty tokens', () => {
      expect(parseTagsString('a, b ,, c')).toEqual(['a', 'b', 'c']);
      expect(parseTagsString('')).toEqual([]);
      expect(parseTagsString(null)).toEqual([]);
    });
    test('serialise produces the shape the server already expects', () => {
      expect(serializePills(['a', 'b', 'c'])).toBe('a, b, c');
      expect(serializePills([])).toBe('');
      expect(serializePills([' x ', '', 'y'])).toBe('x, y');
    });
  });

  describe('commitPill', () => {
    test('appends a new pill', () => {
      expect(commitPill(['a'], 'b')).toEqual(['a', 'b']);
    });
    test('trims whitespace around the pill', () => {
      expect(commitPill([], '  hi  ')).toEqual(['hi']);
    });
    test('ignores empty / whitespace-only input', () => {
      expect(commitPill(['a'], '')).toEqual(['a']);
      expect(commitPill(['a'], '   ')).toEqual(['a']);
    });
    test('dedupes case-insensitively', () => {
      expect(commitPill(['Gift'], 'gift')).toEqual(['Gift']);
      expect(commitPill(['Gift'], 'GIFT')).toEqual(['Gift']);
    });
    test('is immutable w.r.t. the input array', () => {
      const before = ['a'];
      commitPill(before, 'b');
      expect(before).toEqual(['a']);
    });
  });

  describe('removePill', () => {
    test('removes the pill at the given index', () => {
      expect(removePill(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
    });
    test('returns a copy when the index is out of range', () => {
      expect(removePill(['a'], 5)).toEqual(['a']);
      expect(removePill(['a'], -1)).toEqual(['a']);
    });
    test('is immutable w.r.t. the input array', () => {
      const before = ['a', 'b'];
      removePill(before, 0);
      expect(before).toEqual(['a', 'b']);
    });
  });

  describe('filterSuggestions', () => {
    const all = ['gift', 'keychain', 'prototype', 'custom'];

    test('returns unused tags when the query is empty', () => {
      expect(filterSuggestions(all, ['gift'], '')).toEqual(['keychain', 'prototype', 'custom']);
    });
    test('filters case-insensitively by substring', () => {
      expect(filterSuggestions(all, [], 'YP')).toEqual(['prototype']);
      expect(filterSuggestions(all, [], 'cu')).toEqual(['custom']);
    });
    test('excludes tags already committed, regardless of case', () => {
      expect(filterSuggestions(all, ['Gift'], 'gi')).toEqual([]);
    });
    test('empty catalog → empty result', () => {
      expect(filterSuggestions([], [], 'x')).toEqual([]);
    });
  });
});
