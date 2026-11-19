'use strict';

/**
 * #3946 compact single-line rows: supplies Qty cell (narrow input + inline
 * "per item" checkbox + "Ratio x -> y" inline-edit chip) and extra-hours HOURS
 * cell (Fixed | Per unit toggle + "45 s/unit x 50 = 0:38" inline-edit chip).
 * UI only: payloads and serialization are covered by order-qty-linked-lines.test.js.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const STYLE_CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');
function extractFn(name) {
  const m = APP_JS.match(new RegExp('(?:async )?function ' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}', 'm'));
  if (!m) throw new Error('Could not locate function ' + name);
  return m[0];
}

const ctx = {
  settings: { currency_symbol: '€', extra_uren_default_rate: 60 },
  extraCostItems: [{ id: 5, name: 'Keyring', price_excl_vat: 0.2 }],
  esc: (s) => String(s || ''),
  fmt: (n) => '€' + Number(n || 0).toFixed(2),
};
vm.createContext(ctx);
vm.runInContext(
  ['formatHoursMinutes', 'renderExtraHoursSection', 'renderExtrasSection', 'inlineEditOpen', 'inlineEditFocusOut', 'inlineEditKey', 'setExtraHoursMode', 'commitExtraHours'].map(extractFn).join('\n'),
  ctx
);

const project = (extras, extra_hours) => ({ id: 9, items_per_set: 50, extras, extra_hours, custom_lines: [] });
const rowsOf = (html) => html.split('<tr').filter(r => /data-eh-row|ec-name/.test(r));

describe('supplies Qty cell (#3946)', () => {
  const linkedHtml = ctx.renderExtrasSection(project([{ extra_cost_id: 5, quantity: 1, scales_with_order: 1, effective_quantity: 50 }], []));
  const fixedHtml = ctx.renderExtrasSection(project([{ extra_cost_id: 5, quantity: 3, scales_with_order: 0, effective_quantity: 3 }], []));

  test('linked line: "Ratio 1 -> 50" chip, narrow input in the edit slot, no calculation line below', () => {
    expect(linkedHtml).toContain('class="ie-view"');
    expect(linkedHtml).toMatch(/Ratio 1 &rarr; 50<\/button>/);
    expect(linkedHtml).toMatch(/class="ie-edit"><input type="text" inputmode="decimal" class="ec-qty-input" value="1"/);
    expect(linkedHtml).not.toContain('ec-linked-result');
    expect(linkedHtml).not.toMatch(/1 &times; 50 = 50/);
  });

  test('checkbox is inline in the same flex line, short label, full meaning in the tooltip', () => {
    for (const html of [linkedHtml, fixedHtml]) {
      expect(html).toMatch(/<div class="ec-qty-line">[\s\S]*<label class="ec-linked" title="Follow the order quantity[^"]*"[\s\S]*<\/label><\/div><\/td>/);
      expect(html).toMatch(/> per item\s*<\/label>/);
      expect(html).not.toContain('per ordered item\n');
    }
  });

  test('unlinked line keeps the plain whole-number input', () => {
    expect(fixedHtml).toMatch(/<input type="number" min="1" class="ec-qty-input" value="3"/);
    expect(fixedHtml).not.toContain('ie-view');
  });

  test('the chip saves through the same updateExtraQty handler', () => {
    expect(linkedHtml).toContain('onchange="updateExtraQty(9, 5, this.value)"');
    expect(linkedHtml).toContain('onclick="inlineEditOpen(this)"');
  });

  test('chip tooltip spells out the ratio meaning', () => {
    expect(linkedHtml).toMatch(/title="Ratio: 1 per ordered item &times; 50 items per set = 50 pcs \(rounded up\)\. Click to edit\."/);
  });
});

describe('extra hours HOURS cell (#3946)', () => {
  const unitRow = { description: 'Sanding', hours: 0, hourly_rate: 60, per_unit_value: 45, per_unit_unit: 's', effective_hours: 0.625, sort_order: 0 };
  const fixedRow = { description: 'Setup', hours: 0.75, hourly_rate: 60, effective_hours: 0.75, sort_order: 1 };
  const html = ctx.renderExtraHoursSection(project([], [unitRow, fixedRow]));
  const [rUnit, rFixed] = rowsOf(html);

  test('per-unit row: one-line chip "45 s/unit x 50 = 0:38" + inline value input and s/min/h select', () => {
    expect(rUnit).toMatch(/class="ie-view"[^>]*>45 s\/unit &times; 50 = 0:38<\/button>/);
    expect(rUnit).toContain('eh-input-perunit');
    expect(rUnit).toMatch(/<option value="s" selected>s<\/option>/);
    expect(rUnit).toMatch(/<option value="min">min<\/option>/);
    expect(rUnit).toMatch(/<option value="h">h<\/option>/);
    expect(rUnit).not.toContain('eh-effective');
    expect(rUnit).not.toMatch(/<select[^>]*eh-mode/);
  });

  test('fixed row: unchanged h:mm input', () => {
    expect(rFixed).toMatch(/class="eh-input eh-input-hours num" value="0:45"/);
    expect(rFixed).not.toContain('ie-view');
  });

  test('segmented Fixed | Per unit toggle with aria-pressed; hidden .eh-mode carries the mode for the serializer', () => {
    expect(rUnit).toContain('<input type="hidden" class="eh-mode" value="unit">');
    expect(rFixed).toContain('<input type="hidden" class="eh-mode" value="fixed">');
    expect(rUnit).toMatch(/seg-btn" aria-pressed="false"[^>]*>Fixed</);
    expect(rUnit).toMatch(/seg-btn active" aria-pressed="true"[^>]*>Per unit</);
    expect(rFixed).toMatch(/seg-btn active" aria-pressed="true"[^>]*>Fixed</);
    expect(rFixed).toContain("setExtraHoursMode(9, 1, 'unit')");
  });

  test('whole hours cell is one flex line wrapper', () => {
    expect(rUnit).toMatch(/<td class="eh-hours num"><div class="eh-line">[\s\S]*<\/div><\/td>/);
  });
});

describe('inline-edit behaviour', () => {
  const mkWrap = () => {
    const cls = new Set();
    const input = { value: '99', defaultValue: '45', select: jest.fn(), focus: jest.fn(), blur: jest.fn() };
    const optS = { value: 's' };
    const sel = { value: 'h', querySelector: (q) => (q === 'option[selected]' ? optS : null) };
    const view = { focus: jest.fn() };
    const wrap = {
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), has: (c) => cls.has(c) },
      contains: (n) => n === input || n === sel,
      querySelector: (q) => (q === '.ie-edit input' ? input : q === '.ie-view' ? view : null),
      querySelectorAll: (q) => (q === '.ie-edit input' ? [input] : q === '.ie-edit select' ? [sel] : []),
    };
    return { wrap, cls, input, sel, view };
  };

  test('click opens in place and focuses the input', () => {
    const { wrap, cls, input } = mkWrap();
    ctx.inlineEditOpen({ closest: () => wrap });
    expect(cls.has('editing')).toBe(true);
    expect(input.focus).toHaveBeenCalled();
  });

  test('Enter blurs (change fires the save)', () => {
    const { wrap, input } = mkWrap();
    const ev = { key: 'Enter', currentTarget: wrap, target: input, preventDefault: jest.fn() };
    ctx.inlineEditKey(ev);
    expect(input.blur).toHaveBeenCalled();
  });

  test('Esc restores the rendered values, closes, returns focus to the chip', () => {
    const { wrap, cls, input, sel, view } = mkWrap();
    cls.add('editing');
    ctx.inlineEditKey({ key: 'Escape', currentTarget: wrap, target: input, preventDefault: jest.fn() });
    expect(input.value).toBe('45');
    expect(sel.value).toBe('s');
    expect(cls.has('editing')).toBe(false);
    expect(view.focus).toHaveBeenCalled();
  });

  test('focus leaving the edit area closes; focus moving between value and unit keeps it open', () => {
    const { wrap, cls, input } = mkWrap();
    cls.add('editing');
    ctx.inlineEditFocusOut({ currentTarget: wrap, relatedTarget: input });
    expect(cls.has('editing')).toBe(true);
    ctx.inlineEditFocusOut({ currentTarget: wrap, relatedTarget: {} });
    expect(cls.has('editing')).toBe(false);
  });

  test('mode toggle flips the hidden mode, saves via commitExtraHours, opens the value editor for Per unit', async () => {
    const modeInput = { value: 'fixed' };
    const row = { querySelector: (q) => (q === '.eh-mode' ? modeInput : null) };
    const view = {};
    const open = jest.fn();
    ctx.inlineEditOpen = open;
    ctx.commitExtraHours = jest.fn(async () => {});
    ctx.document = {
      querySelector: (q) => (q.includes('.ie-view') ? view : { querySelector: () => row }),
    };
    await ctx.setExtraHoursMode(9, 0, 'unit');
    expect(modeInput.value).toBe('unit');
    expect(ctx.commitExtraHours).toHaveBeenCalledWith(9);
    expect(open).toHaveBeenCalledWith(view);
    // same mode again: no write
    ctx.commitExtraHours.mockClear();
    await ctx.setExtraHoursMode(9, 0, 'unit');
    expect(ctx.commitExtraHours).not.toHaveBeenCalled();
  });
});

describe('styles use theme tokens only (all 3 theme blocks inherit them)', () => {
  const block = STYLE_CSS.slice(STYLE_CSS.indexOf('/* Single-line rows (#3946)'), STYLE_CSS.indexOf('.ec-action { width: 36px;'))
    .replace(/\/\*[\s\S]*?\*\//g, '');
  test('no hard-coded colours in the new rules', () => {
    expect(block.length).toBeGreaterThan(200);
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
    for (const t of ['--border', '--primary', '--surface', '--text-muted', '--primary-tint2', '--surface-hover']) {
      expect(block).toContain(`var(${t})`);
    }
  });
});
