'use strict';

/**
 * Frontend coverage for the "Schedule Print…" copies + reorder feature. The
 * three functions under test live in public/app.js (browser-only) and are
 * DOM-free, so they are extracted and run in a vm sandbox — same escape hatch
 * as target-margin-ui.test.js.
 *
 *   reorderPlates    — up/down swap over the plate-index order array
 *   sanitizeCopies   — client-side clamp of the Copies input
 *   buildScheduleQueue — assembles the dispatch payload in user order
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

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  extractFn('reorderPlates') + '\n' +
  extractFn('sanitizeCopies') + '\n' +
  extractFn('buildScheduleQueue'),
  sandbox
);
const { reorderPlates, sanitizeCopies, buildScheduleQueue } = sandbox;

describe('sanitizeCopies', () => {
  test('defaults to 1 for empty / non-numeric / undefined', () => {
    expect(sanitizeCopies(undefined)).toBe(1);
    expect(sanitizeCopies('')).toBe(1);
    expect(sanitizeCopies('abc')).toBe(1);
    expect(sanitizeCopies(null)).toBe(1);
  });

  test('floors below 1 to 1', () => {
    expect(sanitizeCopies(0)).toBe(1);
    expect(sanitizeCopies(-5)).toBe(1);
  });

  test('passes valid integers through', () => {
    expect(sanitizeCopies(1)).toBe(1);
    expect(sanitizeCopies(7)).toBe(7);
    expect(sanitizeCopies('4')).toBe(4);
  });

  test('truncates fractional input', () => {
    expect(sanitizeCopies(3.9)).toBe(3);
  });

  test('clamps above the cap (default 50)', () => {
    expect(sanitizeCopies(50)).toBe(50);
    expect(sanitizeCopies(51)).toBe(50);
    expect(sanitizeCopies(9999)).toBe(50);
  });
});

describe('reorderPlates', () => {
  test('move down swaps with the next entry', () => {
    expect(reorderPlates([0, 1, 2], 0, 1)).toEqual([1, 0, 2]);
  });
  test('move up swaps with the previous entry', () => {
    expect(reorderPlates([0, 1, 2], 2, -1)).toEqual([0, 2, 1]);
  });
  test('boundary moves are no-ops', () => {
    expect(reorderPlates([0, 1, 2], 0, -1)).toEqual([0, 1, 2]);
    expect(reorderPlates([0, 1, 2], 2, 1)).toEqual([0, 1, 2]);
  });
  test('does not mutate input', () => {
    const input = [0, 1, 2];
    reorderPlates(input, 0, 1);
    expect(input).toEqual([0, 1, 2]);
  });
});

describe('buildScheduleQueue', () => {
  // index 0 = plate A (2 copies), index 1 = plate B (1), index 2 = plate C (3, unchecked)
  const inputs = [
    { checked: true, plateIndex: 1, name: 'A', printerId: 5, customerName: 'Acme', orderNr: 'O1', durationMins: 60, bedType: 'textured_pei', copies: 2, colors: [{ color: '#fff' }] },
    { checked: true, plateIndex: 2, name: 'B', printerId: 5, customerName: null, orderNr: null, durationMins: 30, bedType: null, copies: 1, colors: [] },
    { checked: false, plateIndex: 3, name: 'C', printerId: 5, durationMins: 90, copies: 3, colors: [] },
  ];

  test('default order emits checked plates in index order, copies passed through', () => {
    const q = buildScheduleQueue([0, 1, 2], inputs);
    expect(q.map(p => p.name)).toEqual(['A', 'B']);      // C dropped (unchecked)
    expect(q.map(p => p.copies)).toEqual([2, 1]);
  });

  test('copies field defaults are carried verbatim (no expansion client-side)', () => {
    const q = buildScheduleQueue([0], inputs);
    expect(q).toHaveLength(1);                             // one payload entry, not two
    expect(q[0]).toMatchObject({
      plateIndex: 1, name: 'A', printerId: 5, customerName: 'Acme',
      orderNr: 'O1', durationMins: 60, bedType: 'textured_pei', copies: 2,
    });
    expect(q[0].colors).toEqual([{ color: '#fff' }]);
  });

  test('reordering changes the emitted schedule sequence', () => {
    const original = buildScheduleQueue([0, 1], inputs).map(p => p.name);
    expect(original).toEqual(['A', 'B']);
    // move A (pos 0) down -> [1, 0]
    const reordered = reorderPlates([0, 1], 0, 1);
    expect(buildScheduleQueue(reordered, inputs).map(p => p.name)).toEqual(['B', 'A']);
  });

  test('order + copies interleave correctly once the planner expands (B x2 before A x3)', () => {
    const two = [
      { checked: true, plateIndex: 2, name: 'B', copies: 2, colors: [] },
      { checked: true, plateIndex: 1, name: 'A', copies: 3, colors: [] },
    ];
    // user reorders so B is scheduled first
    const q = buildScheduleQueue([0, 1], two);
    expect(q.map(p => [p.name, p.copies])).toEqual([['B', 2], ['A', 3]]);

    // mirror the planner's in-place expansion to prove the final sequence
    const expanded = q.flatMap(p => Array.from({ length: p.copies }, () => p.name));
    expect(expanded).toEqual(['B', 'B', 'A', 'A', 'A']);
  });

  test('unchecked plates are never emitted', () => {
    const q = buildScheduleQueue([2], inputs);   // only the unchecked C
    expect(q).toEqual([]);
  });
});
