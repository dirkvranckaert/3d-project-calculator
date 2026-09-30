/**
 * #2157 — "How these numbers are built" is collapsed by default and stays open
 * across re-renders once the user expanded it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const fn = APP_JS.match(/function renderCalcExplanation\s*\([^)]*\)\s*\{[\s\S]*?\n\}/)[0];

const sandbox = {
  PlateModeText: {
    modeExplanation: () => 'mode', countLabel: () => 'runs', shareCosts: () => ({}),
    overrideParagraph: () => [], SHARE_LABEL: 'x', RISK_NOTE: 'note',
  },
};
vm.createContext(sandbox);
vm.runInContext(
  'function esc(s) { return String(s); }\nfunction fmtTime(s) { return String(s); }\nfunction fmtCents(s) { return String(s); }\n' +
  'let calcExplainOpenId = null;\n' + fn + '\n' +
  'this.render = renderCalcExplanation; this.setOpen = id => { calcExplainOpenId = id; };',
  sandbox
);

const k = { minutes: 1, materialCost: 1, processingCost: 1, electricityCost: 1, printerUsageCost: 1, totalCost: 1 };
const project = id => ({
  id, items_per_set: 1,
  calculation: {
    plateMode: 'parts', totals: k,
    plateBreakdowns: [{ enabled: true, plateName: 'A', count: { mode: 'runs' }, contribution: k }],
  },
});

describe('calc explanation disclosure (#2157)', () => {
  test('collapsed by default (no open attribute)', () => {
    sandbox.setOpen(null);
    const html = sandbox.render(project(1));
    expect(html).toMatch(/^<details class="calc-explain"[^>]*>/);
    expect(html.match(/^<details[^>]*>/)[0]).not.toMatch(/\sopen[\s>=]/);
  });
  test('stays open on re-render of the same project once expanded', () => {
    sandbox.setOpen(1);
    expect(sandbox.render(project(1)).match(/^<details[^>]*>/)[0]).toMatch(/ open /);
  });
  test('collapsed for another project', () => {
    sandbox.setOpen(1);
    expect(sandbox.render(project(2)).match(/^<details[^>]*>/)[0]).not.toMatch(/ open /);
  });
  test('toggle handler records the state and render() resets on project change', () => {
    expect(APP_JS).toContain('ontoggle="calcExplainOpenId = this.open ?');
    expect(APP_JS).toContain('if (route.projectId !== currentProjectId) calcExplainOpenId = null;');
  });
});
