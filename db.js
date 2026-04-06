'use strict';

const path = require('path');
const Database = require('better-sqlite3');

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
    }
  };
  addCol('projects', 'tags', "TEXT NOT NULL DEFAULT ''");
  addCol('project_plates', 'notes', 'TEXT');
  addCol('project_plates', 'enabled', 'INTEGER NOT NULL DEFAULT 1');
  addCol('projects', 'notes', 'TEXT');
  addCol('project_plates', 'colors', 'TEXT');
  addCol('projects', 'archived', 'INTEGER NOT NULL DEFAULT 0');
}

/* ------------------------------------------------------------------ */
/*  Default settings & seed data                                       */
/* ------------------------------------------------------------------ */
function seedDefaults(db) {
  const defaults = {
    hourly_rate:              '40',
    electricity_price_kwh:    '0.40',
    vat_rate:                 '21',
    material_profit_pct:      '200',
    processing_profit_pct:    '100',
    electricity_profit_pct:   '0',
    printer_cost_profit_pct:  '50',
    price_rounding:           '0.99',
    margin_green_pct:         '30',
    margin_orange_pct:        '5',
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
