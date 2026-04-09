'use strict';

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { getDb, getSetting, setSetting, getAllSettings } = require('./db');
const calc = require('./calc');
const { parse3mf, extractThumbnails } = require('./parse3mf');
const sharedAuth = require('./shared-auth');

const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const app = express();
app.use(express.json());

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days
const COOKIE_NAME = 'pc_session';

/* ------------------------------------------------------------------ */
/*  Auth middleware                                                     */
/* ------------------------------------------------------------------ */
function parseCookie(req) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE_NAME + '='));
  return match ? match.split('=')[1] : null;
}

function requireAuth(req, res, next) {
  // Public paths
  const pub = ['/login', '/favicon.svg', '/favicon.ico', '/manifest.json', '/sw.js', '/api/config'];
  if (pub.includes(req.path)) return next();

  const token = parseCookie(req);
  if (!token) {
    // Also accept shared JWT if enabled
    if (sharedAuth.validateSharedToken(req)) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
    return res.redirect('/login');
  }

  const db = getDb();
  const session = db.prepare('SELECT expires_at FROM sessions WHERE token = ?').get(token);
  if (!session || session.expires_at < Date.now()) {
    if (session) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly`);
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Session expired' });
    return res.redirect('/login');
  }

  next();
}

app.use(requireAuth);
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------------------------------------------------ */
/*  Auth routes                                                        */
/* ------------------------------------------------------------------ */
app.get('/login', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_TTL;
    getDb().prepare('INSERT INTO sessions (token, expires_at) VALUES (?, ?)').run(token, expiresAt);
    const cookies = [`${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_TTL / 1000}; HttpOnly`];
    const sharedCookie = sharedAuth.createSharedCookie(username);
    if (sharedCookie) cookies.push(sharedCookie);
    res.setHeader('Set-Cookie', cookies);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/logout', (_req, res) => {
  const token = parseCookie({ headers: { cookie: _req.headers.cookie } });
  if (token) getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
  const cookies = [`${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly`];
  const clearShared = sharedAuth.clearSharedCookie();
  if (clearShared) cookies.push(clearShared);
  res.setHeader('Set-Cookie', cookies);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Settings API                                                       */
/* ------------------------------------------------------------------ */
app.get('/api/settings', (_req, res) => {
  res.json(getAllSettings(getDb()));
});

app.put('/api/settings', (req, res) => {
  const db = getDb();
  const entries = req.body;
  if (typeof entries !== 'object') return res.status(400).json({ error: 'Expected object' });
  for (const [k, v] of Object.entries(entries)) {
    setSetting(db, k, v);
  }
  res.json(getAllSettings(db));
});

app.get('/api/settings/:key', (req, res) => {
  const val = getSetting(getDb(), req.params.key);
  res.json({ key: req.params.key, value: val });
});

app.put('/api/settings/:key', (req, res) => {
  setSetting(getDb(), req.params.key, req.body.value);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Printers API                                                       */
/* ------------------------------------------------------------------ */
app.get('/api/printers', (_req, res) => {
  const db = getDb();
  const printers = db.prepare('SELECT * FROM printers ORDER BY name').all();
  for (const p of printers) {
    p.electricity = db.prepare('SELECT * FROM printer_electricity WHERE printer_id = ? ORDER BY material_type').all(p.id);
  }
  res.json(printers);
});

app.post('/api/printers', (req, res) => {
  const db = getDb();
  const { name, purchase_price = 0, expected_prints = 5000, earn_back_months = 24, electricity = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const r = db.prepare('INSERT INTO printers (name, purchase_price, expected_prints, earn_back_months) VALUES (?, ?, ?, ?)').run(name, purchase_price, expected_prints, earn_back_months);
  const pid = r.lastInsertRowid;
  const ins = db.prepare('INSERT INTO printer_electricity (printer_id, material_type, kwh_per_hour) VALUES (?, ?, ?)');
  for (const e of electricity) {
    ins.run(pid, e.material_type || 'PLA', e.kwh_per_hour || 0);
  }
  const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(pid);
  printer.electricity = db.prepare('SELECT * FROM printer_electricity WHERE printer_id = ?').all(pid);
  res.status(201).json(printer);
});

app.put('/api/printers/:id', (req, res) => {
  const db = getDb();
  const { name, purchase_price, expected_prints, earn_back_months, electricity } = req.body;
  db.prepare('UPDATE printers SET name=?, purchase_price=?, expected_prints=?, earn_back_months=? WHERE id=?')
    .run(name, purchase_price, expected_prints, earn_back_months, req.params.id);
  if (electricity) {
    db.prepare('DELETE FROM printer_electricity WHERE printer_id = ?').run(req.params.id);
    const ins = db.prepare('INSERT INTO printer_electricity (printer_id, material_type, kwh_per_hour) VALUES (?, ?, ?)');
    for (const e of electricity) {
      ins.run(req.params.id, e.material_type || 'PLA', e.kwh_per_hour || 0);
    }
  }
  const printer = db.prepare('SELECT * FROM printers WHERE id = ?').get(req.params.id);
  if (!printer) return res.status(404).json({ error: 'Not found' });
  printer.electricity = db.prepare('SELECT * FROM printer_electricity WHERE printer_id = ?').all(req.params.id);
  res.json(printer);
});

app.delete('/api/printers/:id', (req, res) => {
  getDb().prepare('DELETE FROM printers WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Materials API                                                      */
/* ------------------------------------------------------------------ */
app.get('/api/materials', (_req, res) => {
  res.json(getDb().prepare('SELECT * FROM materials ORDER BY name').all());
});

app.post('/api/materials', (req, res) => {
  const { name, material_type = 'PLA', color = null, price_per_kg = 0, roll_weight_g = 1000 } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const r = getDb().prepare('INSERT INTO materials (name, material_type, color, price_per_kg, roll_weight_g) VALUES (?,?,?,?,?)')
    .run(name, material_type, color, price_per_kg, roll_weight_g);
  res.status(201).json(getDb().prepare('SELECT * FROM materials WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/materials/:id', (req, res) => {
  const { name, material_type, color, price_per_kg, roll_weight_g } = req.body;
  getDb().prepare('UPDATE materials SET name=?, material_type=?, color=?, price_per_kg=?, roll_weight_g=? WHERE id=?')
    .run(name, material_type, color, price_per_kg, roll_weight_g, req.params.id);
  const mat = getDb().prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!mat) return res.status(404).json({ error: 'Not found' });
  res.json(mat);
});

app.delete('/api/materials/:id', (req, res) => {
  getDb().prepare('DELETE FROM materials WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Extra Cost Items API                                               */
/* ------------------------------------------------------------------ */
app.get('/api/extra-costs', (_req, res) => {
  res.json(getDb().prepare('SELECT * FROM extra_cost_items ORDER BY name').all());
});

app.post('/api/extra-costs', (req, res) => {
  const { name, price_excl_vat = 0, default_included = 0, default_quantity = 1 } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const r = getDb().prepare('INSERT INTO extra_cost_items (name, price_excl_vat, default_included, default_quantity) VALUES (?,?,?,?)')
    .run(name, price_excl_vat, default_included ? 1 : 0, default_quantity);
  res.status(201).json(getDb().prepare('SELECT * FROM extra_cost_items WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/extra-costs/:id', (req, res) => {
  const { name, price_excl_vat, default_included, default_quantity } = req.body;
  getDb().prepare('UPDATE extra_cost_items SET name=?, price_excl_vat=?, default_included=?, default_quantity=? WHERE id=?')
    .run(name, price_excl_vat, default_included ? 1 : 0, default_quantity, req.params.id);
  const item = getDb().prepare('SELECT * FROM extra_cost_items WHERE id = ?').get(req.params.id);
  if (!item) return res.status(404).json({ error: 'Not found' });
  res.json(item);
});

app.delete('/api/extra-costs/:id', (req, res) => {
  getDb().prepare('DELETE FROM extra_cost_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Projects API                                                       */
/* ------------------------------------------------------------------ */
function enrichProject(db, project) {
  // Plates with printer + material info
  const plates = db.prepare(`
    SELECT pp.*,
      p.name as printer_name, p.purchase_price as printer_purchase_price,
      p.earn_back_months as printer_earn_back_months, p.expected_prints as printer_expected_prints,
      m.name as material_name, m.material_type, m.price_per_kg as material_price_per_kg
    FROM project_plates pp
    LEFT JOIN printers p ON pp.printer_id = p.id
    LEFT JOIN materials m ON pp.material_id = m.id
    WHERE pp.project_id = ?
    ORDER BY pp.sort_order, pp.id
  `).all(project.id);

  // Add kwh_per_hour for each plate based on printer + material type
  // Tries: exact match → base type (first word) → "PLA" fallback
  for (const plate of plates) {
    plate.printer_kwh_per_hour = 0;
    if (plate.printer_id) {
      const mt = plate.material_type || 'PLA';
      let elec = db.prepare(
        'SELECT kwh_per_hour FROM printer_electricity WHERE printer_id = ? AND material_type = ?'
      ).get(plate.printer_id, mt);
      if (!elec) {
        const baseType = mt.split(/\s/)[0];
        elec = db.prepare(
          'SELECT kwh_per_hour FROM printer_electricity WHERE printer_id = ? AND material_type = ?'
        ).get(plate.printer_id, baseType);
      }
      if (!elec) {
        elec = db.prepare(
          'SELECT kwh_per_hour FROM printer_electricity WHERE printer_id = ? AND material_type = ?'
        ).get(plate.printer_id, 'PLA');
      }
      if (elec) plate.printer_kwh_per_hour = elec.kwh_per_hour;
    }
    // Parse colors JSON
    try { plate.colors = plate.colors ? JSON.parse(plate.colors) : []; } catch { plate.colors = []; }
  }

  // Project extra costs
  const extras = db.prepare(`
    SELECT pec.*, eci.name, eci.price_excl_vat
    FROM project_extra_costs pec
    JOIN extra_cost_items eci ON pec.extra_cost_id = eci.id
    WHERE pec.project_id = ?
    ORDER BY eci.name
  `).all(project.id);

  // Files & images
  const files = db.prepare('SELECT * FROM project_files WHERE project_id = ? ORDER BY uploaded_at DESC').all(project.id);
  const images = db.prepare('SELECT * FROM project_images WHERE project_id = ? ORDER BY is_primary DESC, uploaded_at ASC').all(project.id);

  // Calculate
  const settings = getAllSettings(db);
  const calculation = calc.calculateProject({
    plates,
    extras,
    settings,
    itemsPerSet: project.items_per_set,
    actualSalesPrice: project.actual_sales_price,
  });

  return { ...project, plates, extras, files, images, calculation };
}

app.get('/api/projects/archived-count', (_req, res) => {
  const c = getDb().prepare('SELECT COUNT(*) as count FROM projects WHERE archived = 1').get();
  res.json({ count: c.count });
});

app.get('/api/projects', (req, res) => {
  const db = getDb();
  const includeArchived = req.query.archived === '1';
  const sql = includeArchived
    ? 'SELECT * FROM projects ORDER BY archived ASC, updated_at DESC'
    : 'SELECT * FROM projects WHERE archived = 0 ORDER BY updated_at DESC';
  const projects = db.prepare(sql).all();
  const lite = req.query.lite === '1';
  const result = projects.map(p => lite ? enrichProjectLite(db, p) : enrichProject(db, p));
  res.json(result);
});

function enrichProjectLite(db, project) {
  // Lightweight enrichment for list view — no plate-level details, just totals
  const plates = db.prepare(`
    SELECT pp.*,
      m.material_type, m.price_per_kg as material_price_per_kg,
      p.purchase_price as printer_purchase_price,
      p.earn_back_months as printer_earn_back_months
    FROM project_plates pp
    LEFT JOIN printers p ON pp.printer_id = p.id
    LEFT JOIN materials m ON pp.material_id = m.id
    WHERE pp.project_id = ?
    ORDER BY pp.sort_order, pp.id
  `).all(project.id);

  // Add kwh lookup
  for (const plate of plates) {
    plate.printer_kwh_per_hour = 0;
    if (plate.printer_id) {
      const mt = plate.material_type || 'PLA';
      let elec = db.prepare('SELECT kwh_per_hour FROM printer_electricity WHERE printer_id = ? AND material_type = ?').get(plate.printer_id, mt);
      if (!elec) elec = db.prepare('SELECT kwh_per_hour FROM printer_electricity WHERE printer_id = ? AND material_type = ?').get(plate.printer_id, mt.split(/\s/)[0]);
      if (!elec) elec = db.prepare('SELECT kwh_per_hour FROM printer_electricity WHERE printer_id = ? AND material_type = ?').get(plate.printer_id, 'PLA');
      if (elec) plate.printer_kwh_per_hour = elec.kwh_per_hour;
    }
  }

  const extras = db.prepare(`
    SELECT pec.*, eci.price_excl_vat FROM project_extra_costs pec
    JOIN extra_cost_items eci ON pec.extra_cost_id = eci.id WHERE pec.project_id = ?
  `).all(project.id);

  const images = db.prepare('SELECT id, is_primary FROM project_images WHERE project_id = ? ORDER BY is_primary DESC LIMIT 1').all(project.id);

  const settings = getAllSettings(db);
  const calculation = calc.calculateProject({
    plates, extras, settings,
    itemsPerSet: project.items_per_set,
    actualSalesPrice: project.actual_sales_price,
  });

  return {
    ...project,
    plates: plates.map(p => ({ id: p.id, name: p.name, enabled: p.enabled })),
    images,
    calculation,
  };
}

app.get('/api/projects/:id', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(enrichProject(db, project));
});

app.post('/api/projects', (req, res) => {
  const db = getDb();
  const { name, customer_name = null, items_per_set = 1, tags = '', notes = null } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const r = db.prepare('INSERT INTO projects (name, customer_name, items_per_set, tags, notes) VALUES (?,?,?,?,?)')
    .run(name, customer_name, items_per_set, tags, notes);
  const projectId = r.lastInsertRowid;

  // Auto-add default extra cost items
  const defaults = db.prepare('SELECT id, default_quantity FROM extra_cost_items WHERE default_included = 1').all();
  const insEC = db.prepare('INSERT INTO project_extra_costs (project_id, extra_cost_id, quantity) VALUES (?,?,?)');
  for (const d of defaults) {
    insEC.run(projectId, d.id, d.default_quantity);
  }

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  res.status(201).json(enrichProject(db, project));
});

app.put('/api/projects/:id', (req, res) => {
  const db = getDb();
  const { name, customer_name, items_per_set, actual_sales_price, tags, notes } = req.body;
  db.prepare(`UPDATE projects SET name=?, customer_name=?, items_per_set=?, actual_sales_price=?, tags=?, notes=?,
    updated_at=datetime('now') WHERE id=?`)
    .run(name, customer_name, items_per_set, actual_sales_price ?? null, tags ?? '', notes ?? null, req.params.id);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(enrichProject(db, project));
});

app.post('/api/projects/:id/duplicate', (req, res) => {
  const db = getDb();
  const src = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!src) return res.status(404).json({ error: 'Not found' });

  const r = db.prepare('INSERT INTO projects (name, customer_name, items_per_set, tags, notes) VALUES (?,?,?,?,?)')
    .run(`${src.name} (copy)`, src.customer_name, src.items_per_set, src.tags || '', src.notes);
  const newId = r.lastInsertRowid;

  // Copy plates
  const plates = db.prepare('SELECT * FROM project_plates WHERE project_id = ? ORDER BY sort_order').all(src.id);
  const insPlate = db.prepare(`INSERT INTO project_plates
    (project_id, name, print_time_minutes, plastic_grams, items_per_plate,
     risk_multiplier, pre_processing_minutes, post_processing_minutes,
     printer_id, material_id, material_waste_grams, notes, colors, enabled, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for (const pl of plates) {
    insPlate.run(newId, pl.name, pl.print_time_minutes, pl.plastic_grams, pl.items_per_plate,
      pl.risk_multiplier, pl.pre_processing_minutes, pl.post_processing_minutes,
      pl.printer_id, pl.material_id, pl.material_waste_grams, pl.notes, pl.colors, pl.enabled, pl.sort_order);
  }

  // Copy extras
  const extras = db.prepare('SELECT extra_cost_id, quantity FROM project_extra_costs WHERE project_id = ?').all(src.id);
  const insEC = db.prepare('INSERT INTO project_extra_costs (project_id, extra_cost_id, quantity) VALUES (?,?,?)');
  for (const e of extras) insEC.run(newId, e.extra_cost_id, e.quantity);

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(newId);
  res.status(201).json(enrichProject(db, project));
});

app.patch('/api/projects/:id/archive', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT archived FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE projects SET archived = ? WHERE id = ?').run(project.archived ? 0 : 1, req.params.id);
  res.json({ ok: true, archived: !project.archived });
});

app.delete('/api/projects/:id', (req, res) => {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Project Plates API                                                 */
/* ------------------------------------------------------------------ */
app.post('/api/projects/:projectId/plates', (req, res) => {
  const db = getDb();
  const pid = req.params.projectId;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  // Copy defaults from last plate if exists
  const lastPlate = db.prepare('SELECT * FROM project_plates WHERE project_id = ? ORDER BY sort_order DESC, id DESC LIMIT 1').get(pid);

  const {
    name = req.body.name || null,
    print_time_minutes = 0,
    plastic_grams = 0,
    items_per_plate = 1,
    risk_multiplier = lastPlate ? lastPlate.risk_multiplier : 1,
    pre_processing_minutes = lastPlate ? lastPlate.pre_processing_minutes : 0,
    post_processing_minutes = lastPlate ? lastPlate.post_processing_minutes : 2,
    printer_id = lastPlate ? lastPlate.printer_id : null,
    material_id = lastPlate ? lastPlate.material_id : null,
    material_waste_grams = lastPlate ? lastPlate.material_waste_grams : 0,
  } = req.body;

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM project_plates WHERE project_id = ?').get(pid).m;

  const notes = req.body.notes || null;
  const enabled = req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : 1;
  const colors = req.body.colors ? JSON.stringify(req.body.colors) : null;

  const r = db.prepare(`INSERT INTO project_plates
    (project_id, name, print_time_minutes, plastic_grams, items_per_plate,
     risk_multiplier, pre_processing_minutes, post_processing_minutes,
     printer_id, material_id, material_waste_grams, notes, colors, enabled, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(pid, name, print_time_minutes, plastic_grams, items_per_plate,
      risk_multiplier, pre_processing_minutes, post_processing_minutes,
      printer_id, material_id, material_waste_grams, notes, colors, enabled, maxOrder + 1);

  db.prepare("UPDATE projects SET updated_at=datetime('now') WHERE id=?").run(pid);
  const updatedProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
  res.status(201).json(enrichProject(db, updatedProject));
});

app.put('/api/projects/:projectId/plates/:plateId', (req, res) => {
  const db = getDb();
  const { name, print_time_minutes, plastic_grams, items_per_plate,
    risk_multiplier, pre_processing_minutes, post_processing_minutes,
    printer_id, material_id, material_waste_grams, notes, colors, enabled, sort_order } = req.body;

  db.prepare(`UPDATE project_plates SET
    name=?, print_time_minutes=?, plastic_grams=?, items_per_plate=?,
    risk_multiplier=?, pre_processing_minutes=?, post_processing_minutes=?,
    printer_id=?, material_id=?, material_waste_grams=?, notes=?, colors=?, enabled=?, sort_order=?
    WHERE id=? AND project_id=?`)
    .run(name, print_time_minutes, plastic_grams, items_per_plate,
      risk_multiplier, pre_processing_minutes, post_processing_minutes,
      printer_id, material_id, material_waste_grams, notes || null,
      colors ? JSON.stringify(colors) : null,
      enabled !== undefined ? (enabled ? 1 : 0) : 1,
      sort_order || 0, req.params.plateId, req.params.projectId);

  db.prepare("UPDATE projects SET updated_at=datetime('now') WHERE id=?").run(req.params.projectId);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(enrichProject(db, project));
});

app.patch('/api/projects/:projectId/plates/:plateId', (req, res) => {
  const db = getDb();
  const plate = db.prepare('SELECT * FROM project_plates WHERE id = ? AND project_id = ?')
    .get(req.params.plateId, req.params.projectId);
  if (!plate) return res.status(404).json({ error: 'Not found' });
  const allowed = ['name', 'print_time_minutes', 'plastic_grams', 'items_per_plate',
    'risk_multiplier', 'pre_processing_minutes', 'post_processing_minutes',
    'printer_id', 'material_id', 'material_waste_grams', 'notes', 'colors', 'enabled'];
  const updates = [];
  const values = [];
  for (const [k, v] of Object.entries(req.body)) {
    if (k === 'colors') { updates.push('colors=?'); values.push(v ? JSON.stringify(v) : null); continue; }
    if (allowed.includes(k)) { updates.push(`${k}=?`); values.push(v); }
  }
  if (updates.length === 0) return res.status(400).json({ error: 'No valid fields' });
  values.push(req.params.plateId);
  db.prepare(`UPDATE project_plates SET ${updates.join(', ')} WHERE id=?`).run(...values);
  db.prepare("UPDATE projects SET updated_at=datetime('now') WHERE id=?").run(req.params.projectId);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  res.json(enrichProject(db, project));
});

app.patch('/api/projects/:projectId/plates/:plateId/toggle', (req, res) => {
  const db = getDb();
  const plate = db.prepare('SELECT enabled FROM project_plates WHERE id = ? AND project_id = ?')
    .get(req.params.plateId, req.params.projectId);
  if (!plate) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE project_plates SET enabled = ? WHERE id = ?')
    .run(plate.enabled ? 0 : 1, req.params.plateId);
  db.prepare("UPDATE projects SET updated_at=datetime('now') WHERE id=?").run(req.params.projectId);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  res.json(enrichProject(db, project));
});

app.delete('/api/projects/:projectId/plates/:plateId', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM project_plates WHERE id = ? AND project_id = ?')
    .run(req.params.plateId, req.params.projectId);
  db.prepare("UPDATE projects SET updated_at=datetime('now') WHERE id=?").run(req.params.projectId);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(enrichProject(db, project));
});

/* ------------------------------------------------------------------ */
/*  Project Extra Costs API                                            */
/* ------------------------------------------------------------------ */
app.put('/api/projects/:projectId/extras', (req, res) => {
  const db = getDb();
  const pid = req.params.projectId;
  const items = req.body; // Array of { extra_cost_id, quantity }

  db.prepare('DELETE FROM project_extra_costs WHERE project_id = ?').run(pid);
  const ins = db.prepare('INSERT INTO project_extra_costs (project_id, extra_cost_id, quantity) VALUES (?,?,?)');
  for (const item of items) {
    if (item.quantity > 0) {
      ins.run(pid, item.extra_cost_id, item.quantity);
    }
  }

  db.prepare("UPDATE projects SET updated_at=datetime('now') WHERE id=?").run(pid);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(enrichProject(db, project));
});

/* ------------------------------------------------------------------ */
/*  File uploads                                                       */
/* ------------------------------------------------------------------ */
app.post('/api/projects/:projectId/files', express.raw({ type: 'application/octet-stream', limit: '500mb' }), (req, res) => {
  const db = getDb();
  const pid = req.params.projectId;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const filename = req.headers['x-filename'] || 'upload.3mf';
  const plateId = req.headers['x-plate-id'] ? parseInt(req.headers['x-plate-id']) : null;
  const ext = path.extname(filename).toLowerCase();
  if (!['.3mf', '.stl', '.gcode', '.scad'].includes(ext)) {
    return res.status(400).json({ error: 'Only .3mf, .stl, .gcode, .scad files allowed' });
  }

  const fileId = crypto.randomBytes(8).toString('hex');
  const storedName = `${fileId}${ext}`;
  const filepath = path.join(UPLOADS_DIR, storedName);
  fs.writeFileSync(filepath, req.body);

  const r = db.prepare('INSERT INTO project_files (project_id, plate_id, filename, filepath, size_bytes) VALUES (?,?,?,?,?)')
    .run(pid, plateId, filename, storedName, req.body.length);

  // Auto-extract thumbnails from 3MF files
  if (ext === '.3mf') {
    try {
      const thumbs = extractThumbnails(req.body);
      if (thumbs.length > 0) {
        const hasImages = db.prepare('SELECT COUNT(*) as c FROM project_images WHERE project_id = ?').get(pid).c;
        const insImg = db.prepare('INSERT INTO project_images (project_id, filename, filepath, is_primary) VALUES (?,?,?,?)');
        for (let i = 0; i < thumbs.length; i++) {
          const imgId = crypto.randomBytes(8).toString('hex');
          const imgName = `${imgId}.png`;
          fs.writeFileSync(path.join(UPLOADS_DIR, imgName), thumbs[i].buffer);
          insImg.run(pid, thumbs[i].filename, imgName, (!hasImages && i === 0) ? 1 : 0);
        }
      }
    } catch { /* thumbnail extraction is best-effort */ }
  }

  res.status(201).json(db.prepare('SELECT * FROM project_files WHERE id = ?').get(r.lastInsertRowid));
});

app.get('/api/projects/:projectId/files', (req, res) => {
  const files = getDb().prepare('SELECT * FROM project_files WHERE project_id = ? ORDER BY uploaded_at DESC').all(req.params.projectId);
  res.json(files);
});

app.get('/api/files/:fileId/download', (req, res) => {
  const file = getDb().prepare('SELECT * FROM project_files WHERE id = ?').get(req.params.fileId);
  if (!file) return res.status(404).json({ error: 'File not found' });
  const filepath = path.join(UPLOADS_DIR, file.filepath);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File missing from disk' });
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.sendFile(filepath);
});

app.delete('/api/files/:fileId', (req, res) => {
  const db = getDb();
  const file = db.prepare('SELECT * FROM project_files WHERE id = ?').get(req.params.fileId);
  if (file) {
    const filepath = path.join(UPLOADS_DIR, file.filepath);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    db.prepare('DELETE FROM project_files WHERE id = ?').run(req.params.fileId);
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  Project images                                                     */
/* ------------------------------------------------------------------ */
app.post('/api/projects/:projectId/images', express.raw({ type: 'application/octet-stream', limit: '500mb' }), async (req, res) => {
  const db = getDb();
  const pid = req.params.projectId;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const filename = req.headers['x-filename'] || 'image.png';
  const imgId = crypto.randomBytes(8).toString('hex');
  const ext = path.extname(filename).toLowerCase() || '.png';

  // Convert HEIC/HEIF and other non-web formats to JPEG via sharp
  let storedName, imageBuffer;
  const needsConvert = ['.heic', '.heif', '.tiff', '.tif', '.bmp', '.webp'].includes(ext);
  try {
    if (needsConvert) {
      const sharp = require('sharp');
      imageBuffer = await sharp(req.body).jpeg({ quality: 85 }).toBuffer();
      storedName = `${imgId}.jpg`;
    } else {
      imageBuffer = req.body;
      storedName = `${imgId}${ext}`;
    }
  } catch (err) {
    return res.status(400).json({ error: 'Failed to process image: ' + err.message });
  }

  fs.writeFileSync(path.join(UPLOADS_DIR, storedName), imageBuffer);
  const hasImages = db.prepare('SELECT COUNT(*) as c FROM project_images WHERE project_id = ?').get(pid).c;
  db.prepare('INSERT INTO project_images (project_id, filename, filepath, is_primary) VALUES (?,?,?,?)')
    .run(pid, filename, storedName, hasImages === 0 ? 1 : 0);
  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
  res.status(201).json(enrichProject(db, updated));
});

app.get('/api/images/:imageId', (req, res) => {
  const img = getDb().prepare('SELECT * FROM project_images WHERE id = ?').get(req.params.imageId);
  if (!img) return res.status(404).json({ error: 'Not found' });
  const filepath = path.join(UPLOADS_DIR, img.filepath);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'File missing' });
  const imgExt = path.extname(img.filepath).toLowerCase();
  const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
  res.setHeader('Content-Type', mimeMap[imgExt] || 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filepath);
});

app.delete('/api/images/:imageId', (req, res) => {
  const db = getDb();
  const img = db.prepare('SELECT * FROM project_images WHERE id = ?').get(req.params.imageId);
  if (img) {
    const filepath = path.join(UPLOADS_DIR, img.filepath);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    db.prepare('DELETE FROM project_images WHERE id = ?').run(req.params.imageId);
  }
  res.json({ ok: true });
});

app.patch('/api/images/:imageId/primary', (req, res) => {
  const db = getDb();
  const img = db.prepare('SELECT * FROM project_images WHERE id = ?').get(req.params.imageId);
  if (!img) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE project_images SET is_primary = 0 WHERE project_id = ?').run(img.project_id);
  db.prepare('UPDATE project_images SET is_primary = 1 WHERE id = ?').run(req.params.imageId);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/*  3MF parsing & import                                               */
/* ------------------------------------------------------------------ */

// Parse a 3MF and return extracted plate data (no persistence)
app.post('/api/parse-3mf', express.raw({ type: '*/*', limit: '500mb' }), (req, res) => {
  try {
    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'Empty body — no file received' });
    }
    const result = parse3mf(req.body);
    // Also extract thumbnails as base64 for preview
    const thumbs = extractThumbnails(req.body);
    result.thumbnails = {};
    for (const t of thumbs) {
      result.thumbnails[t.plateIndex] = 'data:image/png;base64,' + t.buffer.toString('base64');
    }
    res.json(result);
  } catch (err) {
    console.error('3MF parse error:', err.message);
    res.status(400).json({ error: 'Failed to parse 3MF: ' + err.message });
  }
});

// Import plates from parsed 3MF data into a project
app.post('/api/projects/:projectId/import-3mf', (req, res) => {
  const db = getDb();
  const pid = req.params.projectId;
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { plates = [] } = req.body;
  // plates is an array of: { name, print_time_minutes, plastic_grams, items_per_plate, printer_id, material_id }

  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order),0) as m FROM project_plates WHERE project_id = ?').get(pid).m;
  const ins = db.prepare(`INSERT INTO project_plates
    (project_id, name, print_time_minutes, plastic_grams, items_per_plate,
     risk_multiplier, pre_processing_minutes, post_processing_minutes,
     printer_id, material_id, material_waste_grams, notes, colors, enabled, sort_order, source_plate_index, source_file_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  for (let i = 0; i < plates.length; i++) {
    const pl = plates[i];
    ins.run(pid, pl.name || `Plate ${maxOrder + i + 1}`,
      pl.print_time_minutes || 0, pl.plastic_grams || 0,
      pl.items_per_plate || 1, pl.risk_multiplier || 1,
      pl.pre_processing_minutes || 0, pl.post_processing_minutes || 2,
      pl.printer_id || null, pl.material_id || null,
      pl.material_waste_grams || 0, pl.notes || null,
      pl.colors ? JSON.stringify(pl.colors) : null, 1, maxOrder + i + 1,
      pl.source_plate_index || null, pl.source_file_id || null);
  }

  db.prepare("UPDATE projects SET updated_at=datetime('now') WHERE id=?").run(pid);
  const updated = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
  res.status(201).json(enrichProject(db, updated));
});

/* ------------------------------------------------------------------ */
/*  Price impact simulation                                            */
/* ------------------------------------------------------------------ */
app.post('/api/materials/:id/price-impact', (req, res) => {
  const db = getDb();
  const material = db.prepare('SELECT * FROM materials WHERE id = ?').get(req.params.id);
  if (!material) return res.status(404).json({ error: 'Material not found' });
  const newPrice = parseFloat(req.body.new_price_per_kg);
  if (isNaN(newPrice)) return res.status(400).json({ error: 'new_price_per_kg required' });

  const oldPrice = material.price_per_kg;
  const allSettings = getAllSettings(db);

  // Find all projects that use this material
  const projectIds = db.prepare(
    'SELECT DISTINCT project_id FROM project_plates WHERE material_id = ?'
  ).all(req.params.id).map(r => r.project_id);

  const impacts = [];
  for (const pid of projectIds) {
    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
    if (!project) continue;
    const enriched = enrichProject(db, project);

    // Calculate with current price
    const currentPricing = enriched.calculation?.pricing;
    if (!currentPricing) continue;

    // Calculate with new price: re-enrich with overridden material price
    // Temporarily override the material price
    db.prepare('UPDATE materials SET price_per_kg = ? WHERE id = ?').run(newPrice, req.params.id);
    const newEnriched = enrichProject(db, db.prepare('SELECT * FROM projects WHERE id = ?').get(pid));
    // Restore original price
    db.prepare('UPDATE materials SET price_per_kg = ? WHERE id = ?').run(oldPrice, req.params.id);

    const newPricing = newEnriched.calculation?.pricing;
    if (!newPricing) continue;

    impacts.push({
      projectId: pid,
      projectName: project.name,
      customerName: project.customer_name,
      archived: !!project.archived,
      actualSalesPrice: project.actual_sales_price,
      current: {
        productionCost: currentPricing.productionCost,
        suggestedPrice: currentPricing.suggestedPrice,
        marginPct: project.actual_sales_price
          ? enriched.calculation.actualMargin?.marginPct
          : currentPricing.suggestedMarginPct,
      },
      simulated: {
        productionCost: newPricing.productionCost,
        suggestedPrice: newPricing.suggestedPrice,
        marginPct: project.actual_sales_price
          ? newEnriched.calculation.actualMargin?.marginPct
          : newPricing.suggestedMarginPct,
      },
    });
  }

  res.json({
    material: { id: material.id, name: material.name, oldPrice, newPrice },
    affectedProjects: impacts.length,
    impacts: impacts.sort((a, b) => (a.simulated.marginPct || 0) - (b.simulated.marginPct || 0)),
  });
});

/* ------------------------------------------------------------------ */
/*  Calculation-only endpoint (no persistence)                         */
/* ------------------------------------------------------------------ */
app.post('/api/calculate', (req, res) => {
  const settings = getAllSettings(getDb());
  const result = calc.calculateProject({ ...req.body, settings });
  res.json(result);
});

/* ------------------------------------------------------------------ */
/*  Export / Import                                                     */
/* ------------------------------------------------------------------ */
app.get('/api/export', (_req, res) => {
  const db = getDb();
  const data = {
    settings: getAllSettings(db),
    printers: db.prepare('SELECT * FROM printers').all().map(p => ({
      ...p,
      electricity: db.prepare('SELECT material_type, kwh_per_hour FROM printer_electricity WHERE printer_id = ?').all(p.id),
    })),
    materials: db.prepare('SELECT * FROM materials').all(),
    extra_cost_items: db.prepare('SELECT * FROM extra_cost_items').all(),
    projects: db.prepare('SELECT * FROM projects').all().map(p => ({
      ...p,
      plates: db.prepare('SELECT * FROM project_plates WHERE project_id = ?').all(p.id),
      extras: db.prepare('SELECT extra_cost_id, quantity FROM project_extra_costs WHERE project_id = ?').all(p.id),
    })),
    exported_at: new Date().toISOString(),
  };
  res.setHeader('Content-Disposition', `attachment; filename=project-calculator-backup-${new Date().toISOString().slice(0,10)}.json`);
  res.json(data);
});

/* ------------------------------------------------------------------ */
/*  Config endpoint                                                    */
/* ------------------------------------------------------------------ */
app.get('/api/config', (_req, res) => {
  res.json({
    version: require('./package.json').version,
    appName: '3D Project Calculator',
    appId: 'project-calculator',
    publicUrl: process.env.PUBLIC_URL || null,
    sharedAuth: sharedAuth.isEnabled(),
  });
});

app.get('/api/discover', async (_req, res) => {
  const apps = {};
  const plannerUrl = process.env.PLANNER_URL || '';
  const filamentUrl = process.env.FILAMENT_URL || '';
  if (plannerUrl) apps.planner = await sharedAuth.discoverApp(plannerUrl);
  if (filamentUrl) apps.filament = await sharedAuth.discoverApp(filamentUrl);
  res.json({ sharedAuth: sharedAuth.isEnabled(), apps });
});

/* ------------------------------------------------------------------ */
/*  Start server                                                       */
/* ------------------------------------------------------------------ */
const PORT = process.env.PORT || 3003;

let server;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    console.log(`Project Calculator running on http://localhost:${PORT}`);
  });
}

module.exports = { app, getDb };
