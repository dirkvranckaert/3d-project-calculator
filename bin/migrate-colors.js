#!/usr/bin/env node
'use strict';

/**
 * Colour-migration script.
 *
 * Walks every row of project_plates, JSON-parses the `colors` blob, and for
 * each colour entry looks up the matching filament in the filament-manager
 * catalog. Produces a markdown report at
 *   logs/color-migration-YYYYMMDD.md
 * listing only the rows whose name/brand would change under the
 * catalog-matched values.
 *
 * Usage:
 *   node bin/migrate-colors.js                 # dry-run (default)
 *   node bin/migrate-colors.js --commit        # apply the mapping to the DB
 *
 * --commit:
 *   Updates each affected plate's `colors` JSON in-place, preserving every
 *   field except `name` and `brand`. Runs as a single better-sqlite3
 *   transaction — any mid-migration error rolls the whole thing back. In
 *   addition to the regular dry-run markdown the script writes
 *   logs/color-migration-YYYYMMDD-applied.md with an `Applied at:` header —
 *   that second file is the audit trail proving the migration actually ran.
 *
 * The catalog is read directly from the filament-manager SQLite DB (cleaner
 * for a batch script than authing against the HTTP proxy). Path can be
 * overridden via FILAMENT_DB_PATH; the default is symlink-layout aware:
 * when the script runs out of /var/www/project-calculator/current/... it
 * targets /var/www/filament-manager/current/data/filaments.db, otherwise it
 * falls back to the sibling-repo layout used in local dev.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { matchFilament } = require('../lib/filament-match');

const CALC_DB_PATH =
  process.env.DB_PATH ||
  path.join(__dirname, '..', 'data', 'calculator.db');

const FILAMENT_DB_PATH =
  process.env.FILAMENT_DB_PATH || resolveDefaultFilamentDbPath();

const LOG_DIR = path.join(__dirname, '..', 'logs');

/**
 * Pick a sensible default for the filament-manager SQLite path.
 *
 * On prod the two apps live side-by-side under /var/www/<app>/current with
 * `current` being a symlink into releases/<ts>/. Resolving `__dirname/..`
 * follows the symlink physically and lands inside
 * /var/www/project-calculator/releases/<ts>/, so the old relative
 * `../../filament-manager/data/filaments.db` overshoots the `current`
 * symlink and misses the real path. Detect that layout and point at the
 * correct `filament-manager/current/data/` explicitly.
 *
 * In local dev (and in unit tests with a stubbed cwd) the sibling-repo
 * layout is preserved as the fallback.
 */
function resolveDefaultFilamentDbPath() {
  try {
    const realBin = fs.realpathSync(__dirname);
    const m = realBin.match(/^(.*)\/([^/]+)\/releases\/[^/]+\//);
    if (m) {
      const base = m[1];
      const siblingCurrent = path.join(base, 'filament-manager', 'current', 'data', 'filaments.db');
      if (fs.existsSync(siblingCurrent)) return siblingCurrent;
    }
  } catch { /* fall through to dev default */ }
  return path.join(__dirname, '..', '..', 'filament-manager', 'data', 'filaments.db');
}

function todayStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

function loadCatalog(dbPath) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Filament catalog DB not found at ${dbPath}. Set FILAMENT_DB_PATH or start filament-manager once to bootstrap it.`);
  }
  const fdb = new Database(dbPath, { readonly: true, fileMustExist: true });
  const rows = fdb.prepare(
    'SELECT id, brand, colorName, type, variant, inStock, colorHex FROM filaments'
  ).all();
  fdb.close();
  return rows;
}

function loadPlates(db) {
  return db.prepare(`
    SELECT pp.id AS plate_id, pp.project_id, pp.name AS plate_name, pp.colors,
           p.name AS project_name
    FROM project_plates pp
    JOIN projects p ON p.id = pp.project_id
    ORDER BY p.id, pp.id
  `).all();
}

function openReadOnly(dbPath) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Calculator DB not found at ${dbPath}. Set DB_PATH.`);
  }
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

function openReadWrite(dbPath) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Calculator DB not found at ${dbPath}. Set DB_PATH.`);
  }
  return new Database(dbPath, { fileMustExist: true });
}

/**
 * Pure function — produces the list of diff rows for a given set of plates
 * + catalog. Exported for Jest. Each diff row is:
 *   { plate_id, projectName, plateName, oldName, oldBrand,
 *     newName, newBrand, hex, nextColors }
 *
 * `nextColors` is the JSON-stringifiable array that would replace the
 * plate's existing `colors` blob if we flushed every diff on that plate.
 * One diff entry per changed colour, but plates with multiple changed
 * colours share the same `nextColors` array (each entry keeps the final
 * target state of its plate — committing the migration de-duplicates on
 * plate_id).
 */
function computeDiffs(plates, catalog) {
  const diffs = [];
  for (const pr of plates) {
    let colors;
    try { colors = JSON.parse(pr.colors || '[]'); } catch { continue; }
    if (!Array.isArray(colors)) continue;

    const nextColors = colors.map(c => ({ ...c }));
    const plateDiffs = [];
    for (let i = 0; i < colors.length; i++) {
      const c = colors[i];
      const match = matchFilament({ color: c.color, brand: c.brand }, catalog);
      if (!match) continue;
      const oldName  = c.name  || '';
      const oldBrand = c.brand || '';
      const newName  = match.colorName || '';
      const newBrand = match.brand || '';
      if (oldName === newName && oldBrand === newBrand) continue;
      nextColors[i] = { ...c, name: newName, brand: newBrand };
      plateDiffs.push({
        plate_id:    pr.plate_id,
        projectName: pr.project_name,
        plateName:   pr.plate_name || `#${pr.plate_id}`,
        oldName, oldBrand,
        newName, newBrand,
        hex: c.color || '',
      });
    }
    for (const d of plateDiffs) {
      d.nextColors = nextColors;
      diffs.push(d);
    }
  }
  return diffs;
}

function renderMarkdown(diffs, { generatedAt = new Date(), appliedAt = null } = {}) {
  const appliedHeader = appliedAt ? `Applied at: ${appliedAt.toISOString()}\n` : '';
  const title = appliedAt ? '# Colour-migration applied' : '# Colour-migration dry-run';
  const header =
`${title}

${appliedHeader}Generated: ${generatedAt.toISOString()}
Rows listed: ${diffs.length}

| Project | Plate | Old name | Old brand | New name | New brand | Hex |
| --- | --- | --- | --- | --- | --- | --- |
`;
  if (!diffs.length) {
    return header + '| _(no rows would change)_ |  |  |  |  |  |  |\n';
  }
  const body = diffs.map(d =>
    `| ${d.projectName} | ${d.plateName} | ${d.oldName} | ${d.oldBrand} | ${d.newName} | ${d.newBrand} | ${d.hex} |`
  ).join('\n') + '\n';
  return header + body;
}

/**
 * Apply the diffs to the calculator DB inside a single transaction. Groups
 * the diffs by plate_id so every plate is written exactly once with the
 * final post-migration `colors` array. Returns the number of rows (plates)
 * updated. Exported for Jest.
 */
function applyDiffs(db, diffs) {
  const byPlate = new Map();
  for (const d of diffs) {
    if (!byPlate.has(d.plate_id)) byPlate.set(d.plate_id, d.nextColors);
  }
  const stmt = db.prepare('UPDATE project_plates SET colors = ? WHERE id = ?');
  const tx = db.transaction(() => {
    let n = 0;
    for (const [plateId, nextColors] of byPlate.entries()) {
      stmt.run(JSON.stringify(nextColors), plateId);
      n++;
    }
    return n;
  });
  return tx();
}

function main(argv) {
  const commit = argv.includes('--commit');

  const catalog = loadCatalog(FILAMENT_DB_PATH);

  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const stamp = todayStamp();
  const dryRunPath = path.join(LOG_DIR, `color-migration-${stamp}.md`);

  if (!commit) {
    const db = openReadOnly(CALC_DB_PATH);
    try {
      const diffs = computeDiffs(loadPlates(db), catalog);
      fs.writeFileSync(dryRunPath, renderMarkdown(diffs));
      // eslint-disable-next-line no-console
      console.log(`Wrote ${diffs.length} row(s) to ${dryRunPath}`);
      return dryRunPath;
    } finally {
      db.close();
    }
  }

  // --commit path
  const db = openReadWrite(CALC_DB_PATH);
  try {
    const diffs = computeDiffs(loadPlates(db), catalog);

    // Always write the dry-run-shaped report alongside the applied report
    // so both files exist for any --commit run.
    fs.writeFileSync(dryRunPath, renderMarkdown(diffs));

    const appliedAt = new Date();
    const rowsUpdated = applyDiffs(db, diffs);

    const appliedPath = path.join(LOG_DIR, `color-migration-${stamp}-applied.md`);
    fs.writeFileSync(appliedPath, renderMarkdown(diffs, { appliedAt }));

    // eslint-disable-next-line no-console
    console.log(`Migration committed. ${rowsUpdated} rows updated.`);
    return { dryRunPath, appliedPath, rowsUpdated };
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = {
  computeDiffs,
  renderMarkdown,
  applyDiffs,
  todayStamp,
  resolveDefaultFilamentDbPath,
};
