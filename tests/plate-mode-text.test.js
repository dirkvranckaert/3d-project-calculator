'use strict';

/** Wording for plate mode (#2135) — the override must explain itself. */

const T = require('../public/plate-mode-text');
const eur = v => `€${v.toFixed(2)}`;

describe('share override wording', () => {
  test('label is self-explanatory, not a bare "proportional override"', () => {
    expect(T.SHARE_LABEL).toMatch(/share this set uses/i);
    expect(T.SHARE_LABEL).not.toMatch(/proportional/i);
  });

  test('help text carries the plate numbers and the impact (Legs: makes 3, set needs 1)', () => {
    const t = T.shareHelp({ setSize: 1, ipp: 3, shareCost: 0.133, wholeCost: 0.40, fmt: eur });
    expect(t).toContain('This plate makes 3 per run and this set needs 1');
    expect(t).toContain('counts 1/3 of the plate');
    expect(t).toContain('€0.13 instead of €0.40 for whole runs');
    expect(t).toMatch(/Leave it off when leftovers are waste or spares/);
  });

  test('help text without saved costs omits the euro clause', () => {
    const t = T.shareHelp({ setSize: 1, ipp: 3 });
    expect(t).toContain('counts 1/3 of the plate');
    expect(t).not.toContain('for whole runs)');
  });

  test('fractions are reduced; set larger than plate reads correctly', () => {
    expect(T.fraction(2, 4)).toBe('1/2');
    expect(T.fraction(4, 3)).toBe('4/3');
    expect(T.shareBadge(1, 3)).toBe('1/3 of plate');
    expect(T.shareBadge(6, 3)).toBe('2 plates');
  });

  test('tooltip repeats the explanation', () => {
    const t = T.shareTooltip({ setSize: 1, ipp: 3 });
    expect(t).toContain('1/3 of plate');
    expect(t).toContain('not a whole print run');
  });

  test('count labels', () => {
    expect(T.countLabel({ mode: 'once' })).toBe('printed once');
    expect(T.countLabel({ mode: 'runs', runs: 3, shareNum: 91, shareDen: 38 })).toMatch(/^3 runs \(91 ÷ 38/);
    expect(T.countLabel({ mode: 'share', shareNum: 1, shareDen: 3 })).toMatch(/share 1\/3 of a run \(override/);
  });
});

describe('mode + quantity wording', () => {
  test('labels', () => {
    expect(T.modeLabel('parts')).toBe('Parts of one item');
    expect(T.modeLabel('batch')).toBe('Batch run');
    expect(T.modeLabel('nonsense')).toBe('Parts of one item');
  });
  test('quantity check messages', () => {
    expect(T.quantityCheckMessage({ status: 'ok' })).toBeNull();
    expect(T.quantityCheckMessage(null)).toBeNull();
    expect(T.quantityCheckMessage({ status: 'spare', onPlates: 45, itemsPerSet: 40, spare: 5, sparePct: 12.5 }))
      .toEqual({ level: 'spare', text: '45 on plates for set of 40 → 5 spare (12.5%)' });
    const short = T.quantityCheckMessage({ status: 'short', onPlates: 30, itemsPerSet: 40, shortfall: 10 });
    expect(short.level).toBe('short');
    expect(short.text).toContain('10 short');
  });
});
