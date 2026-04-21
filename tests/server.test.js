'use strict';

const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Use test database (separate from production)
const testDbPath = path.join(__dirname, '..', 'data', 'test-calculator.db');
process.env.NODE_ENV = 'test';
process.env.ADMIN_USER = 'testadmin';
process.env.ADMIN_PASS = 'testpass';
process.env.DB_PATH = testDbPath;

// Ensure test data directory exists
const dataDir = path.dirname(testDbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

// Clean up test DB before each run
beforeAll(() => {
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
});

const { app } = require('../server');

let cookie;

/* ================================================================== */
/*  Auth                                                               */
/* ================================================================== */
describe('Authentication', () => {
  test('POST /login with wrong creds returns 401', async () => {
    const res = await request(app).post('/login')
      .send({ username: 'wrong', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('POST /login with correct creds returns 200 + cookie', async () => {
    const res = await request(app).post('/login')
      .send({ username: 'testadmin', password: 'testpass' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // Extract cookie
    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    cookie = setCookie[0].split(';')[0];
  });

  test('GET /api/settings without auth returns 401', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(401);
  });

  test('GET /api/settings with auth returns 200', async () => {
    const res = await request(app).get('/api/settings').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('hourly_rate');
  });
});

/* ================================================================== */
/*  Settings API                                                       */
/* ================================================================== */
describe('Settings API', () => {
  test('GET /api/settings returns all defaults', async () => {
    const res = await request(app).get('/api/settings').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.hourly_rate).toBe(40);
    expect(res.body.vat_rate).toBe(21);
    expect(res.body.electricity_price_kwh).toBe(0.40);
  });

  test('PUT /api/settings/:key updates value', async () => {
    const res = await request(app).put('/api/settings/hourly_rate')
      .set('Cookie', cookie)
      .send({ value: 50 });
    expect(res.status).toBe(200);

    const check = await request(app).get('/api/settings/hourly_rate').set('Cookie', cookie);
    expect(check.body.value).toBe(50);

    // Reset
    await request(app).put('/api/settings/hourly_rate')
      .set('Cookie', cookie).send({ value: 40 });
  });

  test('PUT /api/settings updates multiple values', async () => {
    const res = await request(app).put('/api/settings')
      .set('Cookie', cookie)
      .send({ hourly_rate: 45, vat_rate: 19 });
    expect(res.status).toBe(200);
    expect(res.body.hourly_rate).toBe(45);
    expect(res.body.vat_rate).toBe(19);

    // Reset
    await request(app).put('/api/settings').set('Cookie', cookie)
      .send({ hourly_rate: 40, vat_rate: 21 });
  });
});

/* ================================================================== */
/*  Printers API                                                       */
/* ================================================================== */
describe('Printers API', () => {
  test('GET /api/printers returns seeded printers', async () => {
    const res = await request(app).get('/api/printers').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(3);
    const p1s = res.body.find(p => p.name === 'BambuLab P1S');
    expect(p1s).toBeDefined();
    expect(p1s.electricity).toBeDefined();
    expect(p1s.electricity.length).toBeGreaterThanOrEqual(2);
  });

  let testPrinterId;
  test('POST /api/printers creates printer', async () => {
    const res = await request(app).post('/api/printers').set('Cookie', cookie)
      .send({
        name: 'Test Printer',
        purchase_price: 500,
        expected_prints: 3000,
        earn_back_months: 12,
        electricity: [
          { material_type: 'PLA', kwh_per_hour: 0.15 },
          { material_type: 'ABS', kwh_per_hour: 0.20 },
        ],
      });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Printer');
    expect(res.body.electricity).toHaveLength(2);
    testPrinterId = res.body.id;
  });

  test('PUT /api/printers/:id updates printer', async () => {
    const res = await request(app).put(`/api/printers/${testPrinterId}`).set('Cookie', cookie)
      .send({
        name: 'Updated Printer',
        purchase_price: 600,
        expected_prints: 4000,
        earn_back_months: 18,
        electricity: [{ material_type: 'PLA', kwh_per_hour: 0.18 }],
      });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Printer');
    expect(res.body.electricity).toHaveLength(1);
  });

  test('DELETE /api/printers/:id removes printer', async () => {
    const res = await request(app).delete(`/api/printers/${testPrinterId}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
  });
});

/* ================================================================== */
/*  Materials API                                                      */
/* ================================================================== */
describe('Materials API', () => {
  let testMatId;

  test('GET /api/materials returns seeded materials', async () => {
    const res = await request(app).get('/api/materials').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(5);
  });

  test('POST /api/materials creates material', async () => {
    const res = await request(app).post('/api/materials').set('Cookie', cookie)
      .send({ name: 'Test Filament', material_type: 'TPU', price_per_kg: 35 });
    expect(res.status).toBe(201);
    expect(res.body.material_type).toBe('TPU');
    testMatId = res.body.id;
  });

  test('PUT /api/materials/:id updates material', async () => {
    const res = await request(app).put(`/api/materials/${testMatId}`).set('Cookie', cookie)
      .send({ name: 'Updated Filament', material_type: 'TPU', color: 'Red', price_per_kg: 40, roll_weight_g: 750 });
    expect(res.status).toBe(200);
    expect(res.body.color).toBe('Red');
    expect(res.body.roll_weight_g).toBe(750);
  });

  test('DELETE /api/materials/:id removes material', async () => {
    await request(app).delete(`/api/materials/${testMatId}`).set('Cookie', cookie);
    const check = await request(app).get('/api/materials').set('Cookie', cookie);
    expect(check.body.find(m => m.id === testMatId)).toBeUndefined();
  });
});

/* ================================================================== */
/*  Extra Costs API                                                    */
/* ================================================================== */
describe('Extra Costs API', () => {
  let testEcId;

  test('GET /api/extra-costs returns seeded items', async () => {
    const res = await request(app).get('/api/extra-costs').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
  });

  test('POST /api/extra-costs creates item', async () => {
    const res = await request(app).post('/api/extra-costs').set('Cookie', cookie)
      .send({ name: 'Test Item', price_excl_vat: 0.50, default_included: true, default_quantity: 2 });
    expect(res.status).toBe(201);
    expect(res.body.default_included).toBe(1);
    expect(res.body.default_quantity).toBe(2);
    testEcId = res.body.id;
  });

  test('DELETE /api/extra-costs/:id removes item', async () => {
    await request(app).delete(`/api/extra-costs/${testEcId}`).set('Cookie', cookie);
    const check = await request(app).get('/api/extra-costs').set('Cookie', cookie);
    expect(check.body.find(e => e.id === testEcId)).toBeUndefined();
  });
});

/* ================================================================== */
/*  Projects API — Full lifecycle                                      */
/* ================================================================== */
describe('Projects API', () => {
  let projectId;
  let plateId;

  test('POST /api/projects creates project with default extras', async () => {
    const res = await request(app).post('/api/projects').set('Cookie', cookie)
      .send({ name: 'Test Product', customer_name: 'John Doe', items_per_set: 1 });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Product');
    expect(res.body.customer_name).toBe('John Doe');
    // Should have default extras auto-added
    expect(res.body.extras.length).toBeGreaterThanOrEqual(1);
    // Should have calculation even with no plates
    expect(res.body.calculation).toBeDefined();
    projectId = res.body.id;
  });

  test('GET /api/projects returns list', async () => {
    const res = await request(app).get('/api/projects').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].calculation).toBeDefined();
  });

  test('POST /api/projects/:id/plates adds plate', async () => {
    // Get first printer and material IDs
    const printers = await request(app).get('/api/printers').set('Cookie', cookie);
    const materials = await request(app).get('/api/materials').set('Cookie', cookie);
    const printerId = printers.body[0].id;
    const materialId = materials.body[0].id;

    const res = await request(app).post(`/api/projects/${projectId}/plates`).set('Cookie', cookie)
      .send({
        name: 'Main Part',
        print_time_minutes: 120,
        plastic_grams: 50,
        items_per_plate: 1,
        risk_multiplier: 1,
        pre_processing_minutes: 0,
        post_processing_minutes: 2,
        printer_id: printerId,
        material_id: materialId,
        material_waste_grams: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.plates).toHaveLength(1);
    expect(res.body.plates[0].name).toBe('Main Part');
    plateId = res.body.plates[0].id;

    // Calculation should now have real values
    expect(res.body.calculation.perItemCosts.totalPerItem).toBeGreaterThan(0);
    expect(res.body.calculation.pricing.suggestedPrice).toBeGreaterThan(0);
  });

  test('second plate inherits settings from first', async () => {
    const res = await request(app).post(`/api/projects/${projectId}/plates`).set('Cookie', cookie)
      .send({ name: 'Second Part', print_time_minutes: 60, plastic_grams: 20 });
    expect(res.status).toBe(201);
    expect(res.body.plates).toHaveLength(2);
    // Second plate should inherit printer_id and material_id from first
    expect(res.body.plates[1].printer_id).toBe(res.body.plates[0].printer_id);
    expect(res.body.plates[1].material_id).toBe(res.body.plates[0].material_id);
  });

  test('PUT /api/projects/:id/plates/:plateId updates plate', async () => {
    const printers = await request(app).get('/api/printers').set('Cookie', cookie);
    const materials = await request(app).get('/api/materials').set('Cookie', cookie);

    const res = await request(app).put(`/api/projects/${projectId}/plates/${plateId}`).set('Cookie', cookie)
      .send({
        name: 'Updated Part',
        print_time_minutes: 180,
        plastic_grams: 75,
        items_per_plate: 2,
        risk_multiplier: 1.5,
        pre_processing_minutes: 5,
        post_processing_minutes: 3,
        printer_id: printers.body[0].id,
        material_id: materials.body[0].id,
        material_waste_grams: 2,
      });
    expect(res.status).toBe(200);
    const plate = res.body.plates.find(p => p.id === plateId);
    expect(plate.name).toBe('Updated Part');
    expect(plate.items_per_plate).toBe(2);
    expect(plate.risk_multiplier).toBe(1.5);
  });

  test('PUT /api/projects/:id updates project', async () => {
    const res = await request(app).put(`/api/projects/${projectId}`).set('Cookie', cookie)
      .send({ name: 'Updated Product', customer_name: 'Jane', items_per_set: 2, actual_sales_price: 15.99 });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Product');
    expect(res.body.actual_sales_price).toBe(15.99);
    expect(res.body.calculation.actualMargin).not.toBeNull();
  });

  test('PUT /api/projects/:id/extras updates project extras', async () => {
    const extras = await request(app).get('/api/extra-costs').set('Cookie', cookie);
    const items = extras.body.slice(0, 2).map(e => ({ extra_cost_id: e.id, quantity: 3 }));

    const res = await request(app).put(`/api/projects/${projectId}/extras`).set('Cookie', cookie)
      .send(items);
    expect(res.status).toBe(200);
    expect(res.body.extras.length).toBe(2);
    expect(res.body.extras[0].quantity).toBe(3);
  });

  test('DELETE /api/projects/:id/plates/:plateId removes plate', async () => {
    const res = await request(app).delete(`/api/projects/${projectId}/plates/${plateId}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.plates.find(p => p.id === plateId)).toBeUndefined();
  });

  test('GET /api/projects/:id returns single project', async () => {
    const res = await request(app).get(`/api/projects/${projectId}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Product');
  });

  test('DELETE /api/projects/:id removes project', async () => {
    const res = await request(app).delete(`/api/projects/${projectId}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    const check = await request(app).get(`/api/projects/${projectId}`).set('Cookie', cookie);
    expect(check.status).toBe(404);
  });
});

/* ================================================================== */
/*  Export API                                                         */
/* ================================================================== */
describe('Export API', () => {
  test('GET /api/export returns full backup', async () => {
    const res = await request(app).get('/api/export').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('settings');
    expect(res.body).toHaveProperty('printers');
    expect(res.body).toHaveProperty('materials');
    expect(res.body).toHaveProperty('extra_cost_items');
    expect(res.body).toHaveProperty('projects');
    expect(res.body).toHaveProperty('exported_at');
  });
});

/* ================================================================== */
/*  Calculate API (stateless)                                          */
/* ================================================================== */
describe('Calculate API', () => {
  test('POST /api/calculate returns calculation without persistence', async () => {
    const res = await request(app).post('/api/calculate').set('Cookie', cookie)
      .send({
        plates: [{
          print_time_minutes: 120,
          plastic_grams: 50,
          items_per_plate: 1,
          risk_multiplier: 1,
          pre_processing_minutes: 0,
          post_processing_minutes: 2,
          material_waste_grams: 1,
          printer_purchase_price: 812.43,
          printer_earn_back_months: 24,
          printer_kwh_per_hour: 0.11,
          material_price_per_kg: 17.38,
        }],
        extras: [{ price_excl_vat: 0.06, quantity: 1 }],
        itemsPerSet: 1,
      });
    expect(res.status).toBe(200);
    expect(res.body.perItemCosts.totalPerItem).toBeGreaterThan(0);
    expect(res.body.pricing.suggestedPrice).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/*  Tags API                                                           */
/* ================================================================== */
describe('GET /api/tags', () => {
  let idsToClean = [];

  beforeAll(async () => {
    const seeds = [
      { tags: 'gift, keychain' },
      { tags: 'Gift, prototype,' },      // comma trailer + case variant
      { tags: '  keychain ,  custom ' },  // whitespace
      { tags: '' },                       // empty
    ];
    for (let i = 0; i < seeds.length; i++) {
      const r = await request(app).post('/api/projects').set('Cookie', cookie)
        .send({ name: 'Tag seed ' + i, items_per_set: 1, tags: seeds[i].tags });
      idsToClean.push(r.body.id);
    }
  });

  test('returns a deduped + case-insensitive sorted list', async () => {
    const res = await request(app).get('/api/tags').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // "Gift" + "gift" should both survive (case-sensitive dedup); order is
    // case-insensitive alphabetical so they sit next to each other.
    expect(res.body).toEqual(expect.arrayContaining(['custom', 'keychain', 'prototype']));
    // "keychain" must only appear once even though two projects seeded it.
    expect(res.body.filter(t => t === 'keychain')).toHaveLength(1);
    // Check case-insensitive sort: lowercase 'custom' before 'gift' before 'keychain' before 'prototype'.
    const lower = res.body.map(t => t.toLowerCase());
    const sorted = lower.slice().sort();
    expect(lower).toEqual(sorted);
  });

  test('requires auth', async () => {
    const res = await request(app).get('/api/tags');
    expect(res.status).toBe(401);
  });

  afterAll(async () => {
    for (const id of idsToClean) {
      await request(app).delete('/api/projects/' + id).set('Cookie', cookie);
    }
  });
});

/* ================================================================== */
/*  Images-from-3MF (thumbnails-only drop path)                        */
/* ================================================================== */
describe('POST /api/projects/:projectId/images-from-3mf', () => {
  const SLICED_3MF = path.join(__dirname, 'fixtures', 'sliced_multiplate.3mf');
  const hasFixture = fs.existsSync(SLICED_3MF);
  let pid;

  beforeAll(async () => {
    const res = await request(app).post('/api/projects').set('Cookie', cookie)
      .send({ name: 'Thumb Test', customer_name: null, items_per_set: 1 });
    pid = res.body.id;
  });

  (hasFixture ? test : test.skip)('creates project_images rows and zero file/plate rows', async () => {
    const buf = fs.readFileSync(SLICED_3MF);
    const res = await request(app)
      .post(`/api/projects/${pid}/images-from-3mf`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Filename', 'sliced_multiplate.3mf')
      .send(buf);
    expect(res.status).toBe(201);
    expect(res.body.count).toBeGreaterThan(0);

    // Project should now carry images but NO files and NO plates.
    const full = await request(app).get(`/api/projects/${pid}`).set('Cookie', cookie);
    expect(full.status).toBe(200);
    expect(Array.isArray(full.body.images)).toBe(true);
    expect(full.body.images.length).toBe(res.body.count);
    expect(full.body.plates || []).toHaveLength(0);

    const files = await request(app).get(`/api/projects/${pid}/files`).set('Cookie', cookie);
    expect(files.status).toBe(200);
    expect(files.body).toHaveLength(0);
  });

  test('rejects empty body with 400', async () => {
    const res = await request(app)
      .post(`/api/projects/${pid}/images-from-3mf`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.alloc(0));
    expect(res.status).toBe(400);
  });

  test('returns 404 for missing project', async () => {
    const res = await request(app)
      .post('/api/projects/999999/images-from-3mf')
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('x'));
    expect(res.status).toBe(404);
  });
});

// Clean up
afterAll(() => {
  if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
});
