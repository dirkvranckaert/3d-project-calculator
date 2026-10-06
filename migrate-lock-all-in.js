'use strict';

/**
 * One-shot, price-stable migration for the all-in margin lock (task #2290).
 *
 * Until now `locked_margin_pct` pinned the PRODUCTION-basis margin:
 * price_ex = P / (1 - m). With setup & design (D > 0) the lock now pins the
 * ALL-IN margin (see `calc.calculateLockedPrice`), so a stored production-basis
 * pct would silently re-price every locked project that carries design cost.
 *
 * For each locked project with D > 0 this keeps the price Dirk has today and
 * rewrites the stored pct to the all-in margin of exactly that price (full
 * precision, never rounded to 2 decimals, so the inverse returns the same cent):
 *   old price  = calculateLockedPrice(P, m_old, vat)            (production basis)
 *   R          = old price / (1 + vat)
 *   absorbed:            m_new = (R - P - D) / R * 100
 *   invoiced separately: m_new = (R + D - P) / (R + D) * 100
 * Locked projects with D = 0 and unlocked projects are not touched (unlocked
 * rows keep their stored pct, which only matters at the next lock and is then
 * re-seeded in the prompt from the all-in margin).
 *
 * Guarded by a settings marker so it runs once. A row whose old price cannot
 * be derived (unreachable / no cost) is skipped and reported, never guessed.
 *
 * @param {object} db better-sqlite3 handle
 * @param {(db, project) => object} enrich server `enrichProject` (only
 *   `calculation.pricing.productionCost` and `calculation.designCosts` are read,
 *   neither depends on the lock)
 * @param {object} calc ./calc module
 * @returns {{ migrated: number[], skipped: number[], alreadyDone: boolean }}
 */
function migrateLockedMarginAllIn(db, enrich, calc) {
  const done = db.prepare("SELECT 1 FROM settings WHERE key = 'locked_margin_all_in'").get();
  if (done) return { migrated: [], skipped: [], alreadyDone: true };

  const migrated = [];
  const skipped = [];
  const rows = db.prepare('SELECT * FROM projects WHERE margin_locked = 1').all();
  const vatRow = db.prepare("SELECT value FROM settings WHERE key = 'vat_rate'").get();
  const update = db.prepare('UPDATE projects SET locked_margin_pct = ? WHERE id = ?');

  const run = db.transaction(() => {
    for (const row of rows) {
      const calculation = enrich(db, row).calculation;
      const design = calculation?.designCosts?.designTotal || 0;
      if (!(design > 0)) continue;
      const vat = Number(calculation.settings?.vat_rate ?? vatRow?.value ?? 21);
      const production = calculation.pricing.productionCost;
      // No design arg: the OLD production-basis price Dirk has today.
      const old = calc.calculateLockedPrice(production, row.locked_margin_pct, vat);
      if (old.price === null || !(old.price > 0)) { skipped.push(row.id); continue; }
      const revenue = old.price / (1 + vat / 100);
      const separate = !!row.design_invoiced_separately;
      const basis = separate ? revenue + design : revenue;
      const cost = separate ? production : production + design;
      update.run(((basis - cost) / basis) * 100, row.id);
      migrated.push(row.id);
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('locked_margin_all_in', '1')").run();
  });
  run();
  return { migrated, skipped, alreadyDone: false };
}

module.exports = { migrateLockedMarginAllIn };
