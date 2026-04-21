#!/usr/bin/env node
'use strict';

/**
 * Dry-run colour-migration script.
 *
 * Walks every row of project_plates, JSON-parses the `colors` blob, and
 * for each colour entry looks up the matching filament in the
 * filament-manager catalog. Produces a markdown report at
 *   logs/color-migration-YYYYMMDD.md
 * listing only the rows whose name/brand would change under the
 * catalog-matched values.
 *
 * Usage:
 *   node bin/migrate-colors.js                 # dry-run → writes the report
 *   node bin/migrate-colors.js --commit        # NOT IMPLEMENTED — throws
 *
 * The catalog is read directly from the filament-manager SQLite DB
 * (cleaner for a batch script than authing against the HTTP proxy).
 * Path can be overridden via FILAMENT_DB_PATH; defaults to the sibling
 * app's data/ folder.
 *
 * Per Dirk's 2026-04-20 decision we ship dry-run only; actually writing
 * the migrated rows back requires a follow-up design review, not a
 * last-minute flag flip.
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { matchFilament } = require('../lib/filament-match');

const CALC_DB_PATH =
  process.env.DB_PATH ||
  path.join(__dirname, '..', 'data', 'calculator.db');

const FILAMENT_DB_PATH =
  process.env.FILAMENT_DB_PATH ||
  path.join(__dirname, '..', '..', 'filament-manager', 'data', 'filaments.db');

const LOG_DIR = path.join(__dirname, '..', 'logs');

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

function loadPlates(dbPath) {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Calculator DB not found at ${dbPath}. Set DB_PATH.`);
  }
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const rows = db.prepare(`
    SELECT pp.id AS plate_id, pp.project_id, pp.name AS plate_name, pp.colors,
           p.name AS project_name
    FROM project_plates pp
    JOIN projects p ON p.id = pp.project_id
    ORDER BY p.id, pp.id
  `).all();
  db.close();
  return rows;
}

/**
 * Pure function — produces the list of diff rows for a given set of plates
 * + catalog. Exported for Jest. Each diff row is:
 *   { projectName, plateName, oldName, oldBrand, newName, newBrand, hex }
 */
function computeDiffs(plates, catalog) {
  const diffs = [];
  for (const pr of plates) {
    let colors;
    try { colors = JSON.parse(pr.colors || '[]'); } catch { continue; }
    if (!Array.isArray(colors)) continue;
    for (const c of colors) {
      const match = matchFilament({ color: c.color, brand: c.brand }, catalog);
      if (!match) continue;
      const oldName  = c.name  || '';
      const oldBrand = c.brand || '';
      const newName  = match.colorName || '';
      const newBrand = match.brand || '';
      if (oldName === newName && oldBrand === newBrand) continue;
      diffs.push({
        projectName: pr.project_name,
        plateName:   pr.plate_name || `#${pr.plate_id}`,
        oldName, oldBrand,
        newName, newBrand,
        hex: c.color || '',
      });
    }
  }
  return diffs;
}

function renderMarkdown(diffs, { generatedAt = new Date() } = {}) {
  const header =
`# Colour-migration dry-run

Generated: ${generatedAt.toISOString()}
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

function main(argv) {
  const commit = argv.includes('--commit');
  if (commit) {
    // TODO: design review + confirmation UX before wiring this up. Until
    // then we refuse rather than silently no-op so an operator doesn't
    // assume the migration ran.
    throw new Error('--commit not implemented; dry-run only per Dirk 2026-04-20');
  }

  const catalog = loadCatalog(FILAMENT_DB_PATH);
  const plates  = loadPlates(CALC_DB_PATH);
  const diffs   = computeDiffs(plates, catalog);

  const md = renderMarkdown(diffs);
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const outPath = path.join(LOG_DIR, `color-migration-${todayStamp()}.md`);
  fs.writeFileSync(outPath, md);

  // eslint-disable-next-line no-console
  console.log(`Wrote ${diffs.length} row(s) to ${outPath}`);
  return outPath;
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
  todayStamp,
};
