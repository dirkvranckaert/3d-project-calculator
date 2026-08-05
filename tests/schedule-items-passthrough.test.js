'use strict';

/**
 * Coverage for forwarding the per-plate item count (objectCount) to the planner
 * on Schedule Print. Two layers:
 *   - buildScheduleQueue (DOM-free) must carry `items` through verbatim, in
 *     user order, only for checked plates — run for real in a vm sandbox.
 *   - confirmSchedulePrint (DOM-bound) must seed each plate's `items` from
 *     pl.objectCount — a source-level assertion (same escape hatch the other
 *     schedule-dispatch tests use).
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
vm.runInContext(extractFn('buildScheduleQueue'), sandbox);
const { buildScheduleQueue } = sandbox;

describe('buildScheduleQueue — items passthrough', () => {
  const inputs = [
    { checked: true,  plateIndex: 1, name: 'A', printerId: 5, durationMins: 60, copies: 2, items: 6, colors: [] },
    { checked: true,  plateIndex: 2, name: 'B', printerId: 5, durationMins: 30, copies: 1, items: null, colors: [] },
    { checked: false, plateIndex: 3, name: 'C', printerId: 5, durationMins: 90, copies: 1, items: 9, colors: [] },
  ];

  test('items carried verbatim for checked plates, in order', () => {
    const q = buildScheduleQueue([0, 1, 2], inputs);
    expect(q.map(p => p.name)).toEqual(['A', 'B']);       // C unchecked → dropped
    expect(q.map(p => p.items)).toEqual([6, null]);
  });

  test('a plate with no objectCount forwards items as null (untracked)', () => {
    const q = buildScheduleQueue([1], inputs);
    expect(q[0]).toMatchObject({ name: 'B', items: null });
  });

  test('reordering preserves each plate\'s own items', () => {
    const q = buildScheduleQueue([1, 0], inputs);
    expect(q.map(p => [p.name, p.items])).toEqual([['B', null], ['A', 6]]);
  });
});

describe('confirmSchedulePrint — seeds items from objectCount', () => {
  test('the inputs map sets items: pl.objectCount', () => {
    expect(APP_JS).toMatch(/items:\s*pl\.objectCount/);
  });
});
