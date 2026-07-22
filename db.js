'use strict';

const path = require('path');
const Database = require('better-sqlite3');
// Single source of truth for the margin cap — see calc.js `MAX_MARGIN_PCT`.
const MAX_TARGET_MARGIN_PCT = require('./calc').maxReachableMarginPct();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'calculator.db');

let _db;

function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  bootstrap(_db);
  return _db;
}

/* ------------------------------------------------------------------ */
/*  Schema                                                             */
/* ------------------------------------------------------------------ */
function bootstrap(db) {
  db.exec(`
    /* ---- Authentication ---- */
    CREATE TABLE IF NOT EXISTS sessions (
      token      TEXT PRIMARY KEY,
      expires_at INTEGER NOT NULL
    );

    /* ---- Settings (key-value, JSON values) ---- */
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    /* ---- Printers ---- */
    CREATE TABLE IF NOT EXISTS printers (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL,
      purchase_price    REAL NOT NULL DEFAULT 0,
      expected_prints   INTEGER NOT NULL DEFAULT 5000,
      earn_back_months  INTEGER NOT NULL DEFAULT 24,
      created_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ---- Printer electricity profiles (per material type) ---- */
    CREATE TABLE IF NOT EXISTS printer_electricity (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      printer_id     INTEGER NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
      material_type  TEXT NOT NULL DEFAULT 'PLA',
      kwh_per_hour   REAL NOT NULL DEFAULT 0.11,
      UNIQUE(printer_id, material_type)
    );

    /* ---- Materials / Filaments ---- */
    CREATE TABLE IF NOT EXISTS materials (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      name           TEXT NOT NULL,
      material_type  TEXT NOT NULL DEFAULT 'PLA',
      color          TEXT,
      price_per_kg   REAL NOT NULL DEFAULT 0,
      roll_weight_g  REAL NOT NULL DEFAULT 1000,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ---- Extra cost items (shipping box, sticker, keychain ring…) ---- */
    CREATE TABLE IF NOT EXISTS extra_cost_items (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      name             TEXT NOT NULL,
      price_excl_vat   REAL NOT NULL DEFAULT 0,
      default_included INTEGER NOT NULL DEFAULT 0,
      default_quantity INTEGER NOT NULL DEFAULT 1
    );

    /* ---- Projects ---- */
    CREATE TABLE IF NOT EXISTS projects (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      name               TEXT NOT NULL,
      customer_name      TEXT,
      items_per_set      INTEGER NOT NULL DEFAULT 1,
      actual_sales_price REAL,
      tags               TEXT NOT NULL DEFAULT '',
      notes              TEXT,
      archived           INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ---- Project plates (print jobs) ---- */
    CREATE TABLE IF NOT EXISTS project_plates (
      id                      INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id              INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name                    TEXT,
      print_time_minutes      REAL NOT NULL DEFAULT 0,
      plastic_grams           REAL NOT NULL DEFAULT 0,
      items_per_plate         INTEGER NOT NULL DEFAULT 1,
      risk_multiplier         REAL NOT NULL DEFAULT 1,
      pre_processing_minutes  REAL NOT NULL DEFAULT 0,
      post_processing_minutes REAL NOT NULL DEFAULT 2,
      printer_id              INTEGER REFERENCES printers(id) ON DELETE SET NULL,
      material_id             INTEGER REFERENCES materials(id) ON DELETE SET NULL,
      material_waste_grams    REAL NOT NULL DEFAULT 0,
      notes                   TEXT,
      colors                  TEXT,
      enabled                 INTEGER NOT NULL DEFAULT 1,
      sort_order              INTEGER NOT NULL DEFAULT 0
    );

    /* ---- Project extra costs (per-project overrides) ---- */
    CREATE TABLE IF NOT EXISTS project_extra_costs (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      extra_cost_id   INTEGER NOT NULL REFERENCES extra_cost_items(id) ON DELETE CASCADE,
      quantity        INTEGER NOT NULL DEFAULT 1,
      UNIQUE(project_id, extra_cost_id)
    );

    /* ---- Project extra hours (design / consultation / hand-finishing) ---- */
    CREATE TABLE IF NOT EXISTS project_extra_hours (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      description     TEXT NOT NULL,
      hours           REAL NOT NULL DEFAULT 0,
      hourly_rate     REAL NOT NULL DEFAULT 0,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ---- Project images ---- */
    CREATE TABLE IF NOT EXISTS project_images (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      filename    TEXT NOT NULL,
      filepath    TEXT NOT NULL,
      is_primary  INTEGER NOT NULL DEFAULT 0,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ---- Project file attachments ---- */
    CREATE TABLE IF NOT EXISTS project_files (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      plate_id    INTEGER REFERENCES project_plates(id) ON DELETE CASCADE,
      filename    TEXT NOT NULL,
      filepath    TEXT NOT NULL,
      size_bytes  INTEGER NOT NULL DEFAULT 0,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ---- Design cost free-form extras (custom projects) ---- */
    CREATE TABLE IF NOT EXISTS project_design_extras (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      description TEXT NOT NULL,
      amount      REAL NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ---- Project custom one-off cost lines (project-specific, NOT saved to supplies catalog) ---- */
    CREATE TABLE IF NOT EXISTS project_custom_lines (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label       TEXT NOT NULL,
      amount      REAL NOT NULL DEFAULT 0,
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    /* ---- Test prints — manual entry with estimate (custom projects) ---- */
    CREATE TABLE IF NOT EXISTS project_test_prints (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id     INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      description    TEXT NOT NULL,
      estimated_cost REAL NOT NULL DEFAULT 0,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  migrate(db);
  seedDefaults(db);
}

/* ------------------------------------------------------------------ */
/*  Migrations (add columns to existing tables)                        */
/* ------------------------------------------------------------------ */
function migrate(db) {
  const addCol = (table, col, def) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    if (!cols.includes(col)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
      return true;
    }
    return false;
  };
  addCol('projects', 'tags', "TEXT NOT NULL DEFAULT ''");
  addCol('project_plates', 'notes', 'TEXT');
  addCol('project_plates', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
  addCol('projects', 'notes', 'TEXT');
  addCol('project_plates', 'colors', 'TEXT');
  addCol('project_plates', 'source_plate_index', 'INTEGER');
  addCol('project_plates', 'source_file_id', 'TEXT');
  addCol('projects', 'archived', 'INTEGER NOT NULL DEFAULT 0');
  // Design cost module (2026-06-02)
  addCol('projects', 'is_custom', 'INTEGER NOT NULL DEFAULT 0');
  addCol('project_extra_hours', 'is_design_cost', 'INTEGER NOT NULL DEFAULT 0');
  addCol('project_plates', 'is_test_print', 'INTEGER NOT NULL DEFAULT 0');
  // Design cost enhancements (2026-06-03)
  addCol('projects', 'design_notes', 'TEXT');
  addCol('project_extra_hours', 'actual_hours', 'TEXT');
  addCol('project_plates', 'test_print_id', 'INTEGER');
  // Sliced-vs-model 3MF distinction (NULL = unknown/not a 3MF, 0 = model file, 1 = sliced)
  addCol('project_files', 'is_sliced', 'INTEGER');
  // Margin lock — target margin drives the sales price instead of the reverse (2026-07-22)
  addCol('projects', 'margin_locked', 'INTEGER NOT NULL DEFAULT 0');
  addCol('projects', 'target_margin_pct', 'REAL');
  // Manual image ordering — drag & drop in the Images section (2026-07-22)
  if (addCol('project_images', 'sort_order', 'INTEGER NOT NULL DEFAULT 0')) {
    // Backfill: seed the order every project already sees (primary first, then
    // upload date), so enabling manual ordering does not reshuffle anything.
    const rows = db.prepare(
      'SELECT id, project_id FROM project_images ORDER BY project_id, is_primary DESC, uploaded_at ASC, id ASC'
    ).all();
    const upd = db.prepare('UPDATE project_images SET sort_order = ? WHERE id = ?');
    let currentProject = null;
    let order = 0;
    for (const row of rows) {
      if (row.project_id !== currentProject) { currentProject = row.project_id; order = 0; }
      upd.run(order++, row.id);
    }
  }

  migrateMarginBasisToExVat(db);
}

/**
 * One-shot conversion of the margin basis from incl-VAT to ex-VAT (2026-07-22).
 *
 * Old basis: margin = (price_ex - cost) / price_incl.
 * New basis: margin = (price_ex - cost) / price_ex.
 *
 * The same price reads (1 + vat) times higher on the new basis, so every stored
 * `projects.target_margin_pct` is multiplied by (1 + vat). That is a pin, so
 * this keeps every locked price exactly where it is instead of silently
 * repricing the project. VAT comes from the `vat_rate` setting; there is no
 * per-project VAT column in this schema.
 *
 * The `margin_green_pct` / `margin_orange_pct` colour thresholds are NOT
 * rescaled — Dirk chose clean ex-VAT numbers (40 / 25) over preserving the old
 * colours, accepting that some projects shift. They stay user-editable: the
 * migration writes them once and his own edits win from then on.
 *
 * Guarded by a `margin_basis_ex_vat` settings marker so it runs exactly once,
 * and pins are clamped to the new hard cap.
 */
function migrateMarginBasisToExVat(db) {
  const done = db.prepare("SELECT 1 FROM settings WHERE key = 'margin_basis_ex_vat'").get();
  if (done) return;

  const readNum = (key) => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) return null;
    let v;
    try { v = JSON.parse(row.value); } catch { v = row.value; }
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const vatRate = readNum('vat_rate') ?? 21;
  const factor = 1 + vatRate / 100;

  // The cap is an exclusive bound — `calculateLockedPrice` and the margin-lock
  // route both reject `target >= maxPct`. Clamping to the cap itself would
  // therefore write a value the app's own API would 400 on: the lock stays set,
  // no price can be derived, and the project renders "—". Land strictly below.
  const clampCeiling = MAX_TARGET_MARGIN_PCT - 0.01;

  const pins = db.prepare('SELECT id, target_margin_pct FROM projects WHERE target_margin_pct IS NOT NULL').all();
  const updPin = db.prepare('UPDATE projects SET target_margin_pct = ? WHERE id = ?');
  for (const row of pins) {
    const old = Number(row.target_margin_pct);
    if (!Number.isFinite(old)) continue;
    updPin.run(Math.min(old * factor, clampCeiling), row.id);
  }

  const updSetting = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  for (const [key, value] of Object.entries({ margin_green_pct: '40', margin_orange_pct: '25' })) {
    if (readNum(key) === null) continue; // fresh DB — seedDefaults writes these
    updSetting.run(value, key);
  }

  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('margin_basis_ex_vat', '1')").run();
}

/* ------------------------------------------------------------------ */
/*  Default settings & seed data                                       */
/* ------------------------------------------------------------------ */
function seedDefaults(db) {
  const defaults = {
    hourly_rate:              '40',
    extra_uren_default_rate:  '60',
    design_hourly_rate:       '65',
    electricity_price_kwh:    '0.40',
    vat_rate:                 '21',
    material_profit_pct:      '200',
    processing_profit_pct:    '100',
    electricity_profit_pct:   '0',
    printer_cost_profit_pct:  '50',
    price_rounding:           '0.99',
    // Ex-VAT margin thresholds (Dirk 2026-07-22). Green 40% sits just above the
    // ~37% industrial floor from the margin research; not a rescale of the old
    // incl-VAT 30/5, so some projects legitimately change colour.
    margin_green_pct:         '40',
    margin_orange_pct:        '25',
    currency:                 '"EUR"',
    currency_symbol:          '"\\u20ac"',
  };

  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(defaults)) {
    ins.run(k, v);
  }

  // Seed default printers from spreadsheet if none exist
  const printerCount = db.prepare('SELECT COUNT(*) as c FROM printers').get().c;
  if (printerCount === 0) {
    const seedPrinters = [
      { name: 'MK4S', price: 819, prints: 5000, months: 6 },
      { name: 'BambuLab P1S', price: 812.43, prints: 5000, months: 24 },
      { name: 'BambuLab H2C', price: 1889.92, prints: 10000, months: 24 },
    ];
    const insPrinter = db.prepare('INSERT INTO printers (name, purchase_price, expected_prints, earn_back_months) VALUES (?, ?, ?, ?)');
    const insElec = db.prepare('INSERT INTO printer_electricity (printer_id, material_type, kwh_per_hour) VALUES (?, ?, ?)');

    for (const p of seedPrinters) {
      const r = insPrinter.run(p.name, p.price, p.prints, p.months);
      const pid = r.lastInsertRowid;
      if (p.name === 'MK4S') {
        insElec.run(pid, 'PLA', 0.26);
        insElec.run(pid, 'PETG', 0.26);
        insElec.run(pid, 'ABS', 0.26);
      } else if (p.name === 'BambuLab P1S') {
        insElec.run(pid, 'PLA', 0.11);
        insElec.run(pid, 'PETG', 0.12);
        insElec.run(pid, 'ABS', 0.13);
      } else {
        insElec.run(pid, 'PLA', 0.25);
        insElec.run(pid, 'PETG', 0.38);
        insElec.run(pid, 'ABS', 0.50);
      }
    }
  }

  // Seed default materials from spreadsheet if none exist
  const matCount = db.prepare('SELECT COUNT(*) as c FROM materials').get().c;
  if (matCount === 0) {
    const seedMaterials = [
      ['Bambulab - Generic (PLA Basic)', 'PLA Basic', null, 17.38, 1000],
      ['Bambulab - Generic (PLA Mat)', 'PLA Mat', null, 17.38, 1000],
      ['Bambulab - Generic (ABS)', 'ABS', null, 18.99, 1000],
      ['Prusament - Generic (PETG)', 'PETG', null, 29.99, 1000],
      ['Prusament - Generic (PLA)', 'PLA', null, 29.99, 1000],
      ['Prusament - Galaxy Black (PLA)', 'PLA', 'Galaxy Black', 29.99, 1000],
      ['REAL - Generic (PLA)', 'PLA', null, 29.50, 1000],
      ['REAL - Generic (PETG)', 'PETG', null, 29.50, 1000],
    ];
    const insMat = db.prepare('INSERT INTO materials (name, material_type, color, price_per_kg, roll_weight_g) VALUES (?, ?, ?, ?, ?)');
    for (const m of seedMaterials) insMat.run(...m);
  }

  // Seed default extra cost items from spreadsheet if none exist
  const ecCount = db.prepare('SELECT COUNT(*) as c FROM extra_cost_items').get().c;
  if (ecCount === 0) {
    const seedExtras = [
      ['Box', 1.00, 0, 1],
      ['Bedanktsticker Verzending (30mm)', 0.03, 1, 1],
      ['Sleutelringen met Ketting (25mm)', 0.06, 0, 1],
      ['Enveloppe Bubble', 1.24, 0, 1],
      ['RAJA Shipping Box (10x10x15)', 0.41, 0, 1],
    ];
    const insEC = db.prepare('INSERT INTO extra_cost_items (name, price_excl_vat, default_included, default_quantity) VALUES (?, ?, ?, ?)');
    for (const e of seedExtras) insEC.run(...e);
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function setSetting(db, key, value) {
  const v = typeof value === 'string' ? value : JSON.stringify(value);
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, v);
}

function getAllSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

module.exports = { getDb, getSetting, setSetting, getAllSettings };
