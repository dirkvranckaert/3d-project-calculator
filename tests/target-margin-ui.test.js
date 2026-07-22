'use strict';

/**
 * Frontend coverage for the target-margin guidance block and the
 * below-the-floor hint, via the documented `vm` escape hatch — both are
 * DOM-free string/value functions in `public/app.js`.
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
function extractConst(name) {
  const re = new RegExp('const ' + name + '\\s*=\\s*\\[[\\s\\S]*?\\n\\];', 'm');
  const m = APP_JS.match(re);
  if (!m) throw new Error('Could not locate const ' + name);
  return m[0];
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(
  // `esc` in app.js goes through `document`, which does not exist under the
  // node test environment. Stubbed rather than extracted: every string in the
  // guidance table is a hardcoded constant, so escaping is not what is under
  // test here — the content and the framing are.
  'function esc(s) { return String(s); }\n' +
  extractFn('fmtPct') + '\n' +
  extractConst('TARGET_MARGIN_GUIDANCE') + '\n' +
  extractFn('renderTargetMarginGuidance') + '\n' +
  extractFn('targetMarginHint') + '\n' +
  // `const` declarations do not attach to a vm context the way `function`
  // declarations do, so hand the array out explicitly.
  'this.TARGET_MARGIN_GUIDANCE = TARGET_MARGIN_GUIDANCE;',
  sandbox
);
const { renderTargetMarginGuidance, targetMarginHint, TARGET_MARGIN_GUIDANCE } = sandbox;

describe('target margin guidance table', () => {
  const html = renderTargetMarginGuidance();

  test('carries the four researched segments', () => {
    expect(TARGET_MARGIN_GUIDANCE).toHaveLength(4);
    for (const seg of ['Floor — any job', 'Small series', 'One-off custom / prototyping', 'Own product (B2C)']) {
      expect(html).toContain(seg);
    }
  });

  test('shows the ex-VAT converted targets', () => {
    for (const t of ['40%', '48%', '60%', '65–70%']) expect(html).toContain(t);
  });

  test('says floor-not-ceiling, so it cannot be read as a cap', () => {
    expect(html).toMatch(/not a ceiling/i);
    expect(html).toMatch(/may bear more/i);
  });

  test('reads as reference, not as a second place to configure', () => {
    expect(html).toContain('reference-block');
    expect(html).toMatch(/Reference/);
    expect(html).toMatch(/nothing here is a setting/i);
    // No inputs of any kind — the corroboration-vs-duplication requirement.
    expect(html).not.toContain('<input');
    expect(html).not.toContain('onchange');
    expect(html).not.toContain('saveSetting');
  });
});

describe('below-the-floor hint', () => {
  test('silent while the target is at or above the floor', () => {
    expect(targetMarginHint(40, 25)).toBeNull();
    expect(targetMarginHint(25, 25)).toBeNull();
    expect(targetMarginHint(90, 25)).toBeNull();
  });

  test('warns when the target sits under the floor', () => {
    const msg = targetMarginHint(20, 25);
    expect(msg).toBeTruthy();
    expect(msg).toContain('25.00%');
    expect(msg).toMatch(/red/);
    expect(msg).toMatch(/no orange band/i);
  });

  test('is a hint only — it never signals a blocked save', () => {
    const msg = targetMarginHint(20, 25);
    expect(msg).not.toMatch(/cannot|not allowed|invalid|must/i);
  });

  test('silent on incomplete input rather than warning about NaN', () => {
    expect(targetMarginHint(NaN, 25)).toBeNull();
    expect(targetMarginHint(20, NaN)).toBeNull();
    expect(targetMarginHint(undefined, 25)).toBeNull();
  });
});
