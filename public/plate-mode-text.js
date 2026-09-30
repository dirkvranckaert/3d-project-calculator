'use strict';

/**
 * Plain-language wording for plate mode (#2135). Pure functions, no DOM, so the
 * text that explains the numbers is unit-tested (tests/plate-mode-text.test.js)
 * and app.js only has to escape and place it.
 *
 * The per-plate "charge only the share this set uses" override MUST stay
 * self-explanatory (Dirk: a bare "Proportional override" is meaningless in
 * three months). Every string about it lives here so the label, help text, row
 * badge, tooltip and explanation block cannot drift apart.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PlateModeText = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  const MODES = {
    parts: 'Parts of one item',
    batch: 'Batch run',
  };

  const SHARE_LABEL = 'Charge only the share this set uses (not whole print runs)';

  function gcd(a, b) { return b ? gcd(b, a % b) : a; }

  /** "1/3", "2/3", "4/3", or "1" — reduced. */
  function fraction(num, den) {
    const n = Math.max(1, Math.round(num));
    const d = Math.max(1, Math.round(den));
    const g = gcd(n, d);
    const rn = n / g;
    const rd = d / g;
    return rd === 1 ? String(rn) : `${rn}/${rd}`;
  }

  function modeLabel(mode) { return MODES[mode] || MODES.parts; }

  /** One-paragraph description of what a mode does — used in the dropdown hint. */
  function modeHelp(mode) {
    return mode === 'batch'
      ? 'Every enabled plate is printed exactly once. Totals are the plain sum of the enabled plates; the cost per item is the total divided by the items per set.'
      : 'Every enabled plate is a component of ONE sellable item. Each plate is printed as many whole times as the set needs (a half-filled last plate still costs a full print run).';
  }

  /** Long form for the explanation block. */
  function modeExplanation(mode, setSize) {
    const set = setSize || 1;
    return mode === 'batch'
      ? `Batch run: every enabled plate is printed exactly once, so each total is the plain sum of the enabled plates. `
        + `The cost per item is that total divided by ${set} item${set === 1 ? '' : 's'} per set.`
      : `Parts of one item: every enabled plate is a component of one sellable item. A plate is printed `
        + `as many whole times as it takes to make ${set} (runs = ${set} ÷ #/plate, rounded up), because a half-filled `
        + `last plate still occupies a full print run. That one run count drives time, plastic, material, processing, `
        + `electricity and printer usage alike.`;
  }

  /**
   * The ONE place that decides how the override reads. Three cases:
   *   'none'     set is an exact multiple of #/plate -> override changes nothing
   *   'fraction' set < #/plate (e.g. needs 1, run makes 3) -> 1/3 of ONE run instead of 1 whole run
   *   'multi'    set > #/plate, not a multiple (needs 10, makes 4) -> 2.5 runs instead of 3 whole runs
   * Same "real quotient" rule as calc.js wholeRunsDifferFromShare.
   */
  function shareCase(setSize, ipp) {
    const set = Math.max(1, Math.round(Number(setSize) || 1));
    const per = Math.max(1, Math.round(Number(ipp) || 1));
    const whole = Math.ceil(set / per);
    const kind = whole === set / per ? 'none' : (set < per ? 'fraction' : 'multi');
    const q = set / per;
    const rounded = Math.round(q * 100) / 100;
    const exact = Math.abs(q - rounded) < 1e-9;
    const runsText = `${exact ? '' : 'about '}${rounded}`;
    return { kind, set, per, whole, wholeText: `${whole} whole run${whole === 1 ? '' : 's'}`,
      // "1/3 of one run" or "2.5 runs"
      shareText: kind === 'fraction' ? `${fraction(set, per)} of one run` : `${runsText} run${q === 1 ? '' : 's'}`,
      // badge-length: "1/3 of a run, not 1" / "2.5 runs, not 3"
      badgeText: kind === 'fraction' ? `${fraction(set, per)} of a run, not ${whole}`
        : (kind === 'multi' ? `${runsText} runs, not ${whole}` : `${whole} run${whole === 1 ? '' : 's'}, same as whole`) };
  }

  /** Short badge on the plate row: "1/3 of a run, not 1", "2.5 runs, not 3", "2 runs, same as whole". */
  function shareBadge(num, den) { return shareCase(num, den).badgeText; }

  /** " (€0.13 instead of €0.40)" when both costs are known and differ; else "". */
  function moneyClause(o) {
    const f = o.fmt || (v => String(v));
    return (o.shareCost != null && o.wholeCost != null && f(o.shareCost) !== f(o.wholeCost))
      ? ` (${f(o.shareCost)} instead of ${f(o.wholeCost)})` : '';
  }

  /** The plate's own numbers as one plain statement, shared by help text and tooltip. */
  function shareStatement(o) {
    const c = shareCase(o.setSize, o.ipp);
    const lead = `This plate makes ${c.per} per run and this set needs ${c.set}`;
    if (c.kind === 'none') {
      return `${lead}, which is exactly ${c.whole} whole run${c.whole === 1 ? '' : 's'}, so this override changes nothing for this plate.`;
    }
    return `${lead}, so the set uses ${c.shareText}. With the override on, ${c.shareText} ${c.kind === 'fraction' ? 'is' : 'are'} charged instead of `
      + `${c.wholeText}${moneyClause(o)}.`;
  }

  /**
   * Help text for the override, with the plate's own numbers.
   * @param {object} o { setSize, ipp, shareCost?, wholeCost? , fmt? }
   *   shareCost = what the plate costs on a share basis, wholeCost = with whole
   *   runs. Both omitted for a plate that has no saved costs yet.
   */
  function shareHelp(o) {
    const c = shareCase(o.setSize, o.ipp);
    const advice = c.kind === 'none'
      ? ' It only matters if the set size or #/plate changes later.'
      : ' Turn it on when the leftover pieces will be used in later sets. '
        + 'Leave it off when leftovers are waste or spares, then whole runs are charged.';
    return `${shareStatement(o)}${advice}`;
  }

  /**
   * Costs on a share basis vs whole runs for one plate breakdown `pb` (per-run
   * cost cells), same cents rule as calc.js scaleContribution.
   */
  function shareCosts(pb, setSize, ipp) {
    const c = shareCase(setSize, ipp);
    return {
      shareCost: cents(MONEY_KEYS.reduce((s, k) => s + cents(pb[k] * c.set / c.per), 0)),
      wholeCost: cents(MONEY_KEYS.reduce((s, k) => s + cents(cents(pb[k]) * c.whole), 0)),
    };
  }

  /**
   * Every plate field that moves the plate's cost. The euro example in the help is
   * only true for the SAVED plate, so it is shown only while all of these still
   * equal the saved values. `minutes` is the TOTAL print time (the form splits it
   * into hour and minute inputs and rounds the minute part, so the baseline must
   * never be read back from those controls).
   */
  const COST_FIELDS = ['minutes', 'plastic', 'items', 'risk', 'waste', 'pre', 'post', 'printer', 'material'];

  /** Baseline from the RAW saved plate row, never from rendered form controls. */
  function savedCostFields(plate) {
    return {
      minutes: plate.print_time_minutes, plastic: plate.plastic_grams, items: plate.items_per_plate,
      risk: plate.risk_multiplier, waste: plate.material_waste_grams,
      pre: plate.pre_processing_minutes, post: plate.post_processing_minutes,
      printer: plate.printer_id, material: plate.material_id,
    };
  }

  /** Current values from the form's raw control values ({hours, minutes, plastic, ...}). */
  function formCostFields(f) {
    return {
      minutes: (parseInt(f.hours, 10) || 0) * 60 + (parseInt(f.minutes, 10) || 0), plastic: f.plastic,
      items: f.items, risk: f.risk, waste: f.waste, pre: f.pre, post: f.post,
      printer: f.printer, material: f.material,
    };
  }

  /** True when any cost-driving field differs between two snapshots ({field: value}). */
  function costFieldsChanged(saved, current) {
    return COST_FIELDS.some(k => Number(saved[k] || 0) !== Number(current[k] || 0));
  }

  /**
   * Whole cents, half up, the SAME rule as calc.js roundToCents (tests compare
   * them). The `+ Number.EPSILON` nudge keeps binary half-cents (2.675) rounding
   * up. Every displayed money figure of the plate table, sum row, explanation
   * block and help text goes through this, so a total is always the sum of the
   * cells shown beside it.
   */
  function cents(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER / 100) return n;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  const MONEY_KEYS = ['materialCost', 'processingCost', 'electricityCost', 'printerUsageCost'];

  /** Row total = sum of the four cent-rounded cells shown beside it. */
  function rowTotal(pb) {
    return cents(MONEY_KEYS.reduce((s, k) => s + cents(Number(pb[k]) || 0), 0));
  }

  /** Tooltip for the row badge: the same statement, addressed to that row. */
  function shareTooltip(o) {
    return `Override on. ${shareStatement(o)} Edit the plate to switch it off.`;
  }

  /** How one plate counts, for the explanation block. */
  function countLabel(count) {
    if (!count) return '';
    if (count.mode === 'once') return 'printed once';
    if (count.mode === 'share') {
      const c = shareCase(count.shareNum, count.shareDen);
      const why = `set needs ${c.set}, plate makes ${c.per} per run`;
      return c.kind === 'none'
        ? `${c.whole} run${c.whole === 1 ? '' : 's'} (override on, but it changes nothing: ${why}, an exact multiple)`
        : `${c.shareText} instead of ${c.wholeText} (override on: ${why})`;
    }
    const r = count.runs;
    return `${r} run${r === 1 ? '' : 's'} (${count.shareNum} ÷ ${count.shareDen} = ${
      Math.round(count.shareNum / count.shareDen * 100) / 100}, rounded up)`;
  }

  /**
   * One plain sentence per plate that has the override on (breakdowns already
   * filtered to count.mode === 'share'). plates: [{name, setSize, ipp, shareCost?, wholeCost?}].
   */
  function overrideParagraph(plates, fmt) {
    return plates.map((p) => {
      const c = shareCase(p.setSize, p.ipp);
      if (c.kind === 'none') {
        return `${p.name}: ${c.set} \u00f7 ${c.per} is exactly ${c.whole} whole run${c.whole === 1 ? '' : 's'}, so the override changes nothing here.`;
      }
      return `${p.name}: counts ${c.shareText} instead of ${c.wholeText}${moneyClause({ ...p, fmt })}; `
        + `switch the override off in the plate editor if the leftovers are waste or spares.`;
    });
  }

  /** Batch-mode quantity check. null when nothing to say. */
  function quantityCheckMessage(q) {
    if (!q || q.status === 'ok') return null;
    if (q.status === 'short') {
      return { level: 'short',
        text: `Shortfall: the enabled plates make ${q.onPlates}, this set needs ${q.itemsPerSet} → ${q.shortfall} short. `
          + `Add plates or raise #/plate.` };
    }
    const pct = Math.round(q.sparePct * 10) / 10;
    return { level: 'spare',
      text: `${q.onPlates} on plates for set of ${q.itemsPerSet} → ${q.spare} spare (${pct}%)` };
  }

  const RISK_NOTE = 'The Risk column multiplies each run\'s print time (electricity, printer usage) and plastic (material) '
    + 'by the plate\'s risk factor. It does not multiply processing time, and the Time column shows the raw print time.';

  return { MODES, SHARE_LABEL, COST_FIELDS, savedCostFields, formCostFields, costFieldsChanged, cents, rowTotal, RISK_NOTE, fraction, modeLabel, modeHelp, modeExplanation,
    shareBadge, shareHelp, shareTooltip, shareCase, shareStatement, shareCosts, overrideParagraph, countLabel, quantityCheckMessage };
}));
