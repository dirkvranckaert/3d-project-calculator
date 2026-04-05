'use strict';

require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { getDb, getSetting, setSetting, getAllSettings } = require('./db');
const calc = require('./calc');

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
  const pub = ['/login', '/favicon.svg', '/favicon.ico'];
  if (pub.includes(req.path)) return next();

  const token = parseCookie(req);
  if (!token) {
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
    res.setHeader('Set-Cookie',
      `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_TTL / 1000}; HttpOnly`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.post('/logout', (_req, res) => {
  const token = parseCookie({ headers: { cookie: _req.headers.cookie } });
  if (token) getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly`);
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
  }

  // Project extra costs
  const extras = db.prepare(`
    SELECT pec.*, eci.name, eci.price_excl_vat
    FROM project_extra_costs pec
    JOIN extra_cost_items eci ON pec.extra_cost_id = eci.id
    WHERE pec.project_id = ?
    ORDER BY eci.name
  `).all(project.id);

  // Files
  const files = db.prepare('SELECT * FROM project_files WHERE project_id = ? ORDER BY uploaded_at DESC').all(project.id);

  // Calculate
  const settings = getAllSettings(db);
  const calculation = calc.calculateProject({
    plates,
    extras,
    settings,
    itemsPerSet: project.items_per_set,
    actualSalesPrice: project.actual_sales_price,
  });

  return { ...project, plates, extras, files, calculation };
}

app.get('/api/projects', (_req, res) => {
  const db = getDb();
  const projects = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
  const result = projects.map(p => enrichProject(db, p));
  res.json(result);
});

app.get('/api/projects/:id', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(enrichProject(db, project));
});

app.post('/api/projects', (req, res) => {
  const db = getDb();
  const { name, customer_name = null, items_per_set = 1, tags = '' } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const r = db.prepare('INSERT INTO projects (name, customer_name, items_per_set, tags) VALUES (?,?,?,?)')
    .run(name, customer_name, items_per_set, tags);
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
  const { name, customer_name, items_per_set, actual_sales_price, tags } = req.body;
  db.prepare(`UPDATE projects SET name=?, customer_name=?, items_per_set=?, actual_sales_price=?, tags=?,
    updated_at=datetime('now') WHERE id=?`)
    .run(name, customer_name, items_per_set, actual_sales_price ?? null, tags ?? '', req.params.id);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Not found' });
  res.json(enrichProject(db, project));
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

  const r = db.prepare(`INSERT INTO project_plates
    (project_id, name, print_time_minutes, plastic_grams, items_per_plate,
     risk_multiplier, pre_processing_minutes, post_processing_minutes,
     printer_id, material_id, material_waste_grams, notes, enabled, sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(pid, name, print_time_minutes, plastic_grams, items_per_plate,
      risk_multiplier, pre_processing_minutes, post_processing_minutes,
      printer_id, material_id, material_waste_grams, notes, enabled, maxOrder + 1);

  db.prepare("UPDATE projects SET updated_at=datetime('now') WHERE id=?").run(pid);
  const updatedProject = db.prepare('SELECT * FROM projects WHERE id = ?').get(pid);
  res.status(201).json(enrichProject(db, updatedProject));
});

app.put('/api/projects/:projectId/plates/:plateId', (req, res) => {
  const db = getDb();
  const { name, print_time_minutes, plastic_grams, items_per_plate,
    risk_multiplier, pre_processing_minutes, post_processing_minutes,
    printer_id, material_id, material_waste_grams, notes, enabled, sort_order } = req.body;

  db.prepare(`UPDATE project_plates SET
    name=?, print_time_minutes=?, plastic_grams=?, items_per_plate=?,
    risk_multiplier=?, pre_processing_minutes=?, post_processing_minutes=?,
    printer_id=?, material_id=?, material_waste_grams=?, notes=?, enabled=?, sort_order=?
    WHERE id=? AND project_id=?`)
    .run(name, print_time_minutes, plastic_grams, items_per_plate,
      risk_multiplier, pre_processing_minutes, post_processing_minutes,
      printer_id, material_id, material_waste_grams, notes || null,
      enabled !== undefined ? (enabled ? 1 : 0) : 1,
      sort_order || 0, req.params.plateId, req.params.projectId);

  db.prepare("UPDATE projects SET updated_at=datetime('now') WHERE id=?").run(req.params.projectId);
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Not found' });
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
app.post('/api/projects/:projectId/files', express.raw({ type: 'application/octet-stream', limit: '50mb' }), (req, res) => {
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
  res.json({ version: require('./package.json').version });
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
