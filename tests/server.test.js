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

// Remove DB file and its WAL/SHM siblings (stale siblings cause login 500)
function removeDbFiles(dbPath) {
  for (const p of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
    fs.rmSync(p, { force: true });
  }
}

// Clean up test DB before each run
beforeAll(() => {
  removeDbFiles(testDbPath);
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
    // New default: extra-uren default rate (Dirk's 2026-05-05 override = 60).
    expect(res.body.extra_uren_default_rate).toBe(60);
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
    // New: extra_hours array shipped (empty by default).
    expect(Array.isArray(res.body.extra_hours)).toBe(true);
    expect(res.body.extra_hours).toHaveLength(0);
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
/*  Project Extra Hours API                                            */
/* ================================================================== */
describe('Project Extra Hours API', () => {
  let pid;

  beforeAll(async () => {
    const res = await request(app).post('/api/projects').set('Cookie', cookie)
      .send({ name: 'Extra-Hours Test', items_per_set: 1 });
    pid = res.body.id;
  });

  afterAll(async () => {
    await request(app).delete(`/api/projects/${pid}`).set('Cookie', cookie);
  });

  test('PUT empty list returns 200 with zero rows', async () => {
    const res = await request(app).put(`/api/projects/${pid}/extra-hours`).set('Cookie', cookie).send([]);
    expect(res.status).toBe(200);
    expect(res.body.extra_hours).toEqual([]);
    expect(res.body.calculation.extraHoursCost).toBe(0);
  });

  test('PUT 2 rows persists, ordered, and surfaces in calculation at cost', async () => {
    const res = await request(app).put(`/api/projects/${pid}/extra-hours`).set('Cookie', cookie).send([
      { description: 'Design', hours: 2, hourly_rate: 60 },
      { description: 'Consultation', hours: 1, hourly_rate: 80 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.extra_hours).toHaveLength(2);
    expect(res.body.extra_hours[0].description).toBe('Design');
    expect(res.body.extra_hours[0].sort_order).toBe(0);
    expect(res.body.extra_hours[1].sort_order).toBe(1);
    // €60 * 2 + €80 * 1 = €200, no margin.
    expect(res.body.calculation.extraHoursCost).toBeCloseTo(200, 4);
    expect(res.body.calculation.pricing.extraHoursCost).toBeCloseTo(200, 4);
  });

  test('PUT replaces (not appends): 2 rows -> 1 row leaves only the new one', async () => {
    const res = await request(app).put(`/api/projects/${pid}/extra-hours`).set('Cookie', cookie).send([
      { description: 'Hand-finishing', hours: 0.5, hourly_rate: 60 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.extra_hours).toHaveLength(1);
    expect(res.body.extra_hours[0].description).toBe('Hand-finishing');
    expect(res.body.calculation.extraHoursCost).toBeCloseTo(30, 4);
  });

  test('PUT drops rows with empty description (mirrors qty=0 skip on /extras)', async () => {
    const res = await request(app).put(`/api/projects/${pid}/extra-hours`).set('Cookie', cookie).send([
      { description: 'Real work', hours: 1, hourly_rate: 60 },
      { description: '', hours: 5, hourly_rate: 999 },         // dropped
      { description: '   ', hours: 5, hourly_rate: 999 },      // dropped (whitespace-only)
    ]);
    expect(res.status).toBe(200);
    expect(res.body.extra_hours).toHaveLength(1);
    expect(res.body.calculation.extraHoursCost).toBeCloseTo(60, 4);
  });

  test('PUT clamps negative hours/rate to zero', async () => {
    const res = await request(app).put(`/api/projects/${pid}/extra-hours`).set('Cookie', cookie).send([
      { description: 'Bad hours', hours: -3, hourly_rate: 60 },
      { description: 'Bad rate', hours: 2, hourly_rate: -10 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.extra_hours[0].hours).toBe(0);
    expect(res.body.extra_hours[1].hourly_rate).toBe(0);
    expect(res.body.calculation.extraHoursCost).toBe(0);
  });

  test('PUT truncates description to 200 chars', async () => {
    const longDesc = 'x'.repeat(500);
    const res = await request(app).put(`/api/projects/${pid}/extra-hours`).set('Cookie', cookie).send([
      { description: longDesc, hours: 1, hourly_rate: 60 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.extra_hours[0].description.length).toBe(200);
  });

  test('GET /api/projects/:id reflects the persisted extra-hours list', async () => {
    // Seed a known list, then GET fresh
    await request(app).put(`/api/projects/${pid}/extra-hours`).set('Cookie', cookie).send([
      { description: 'A', hours: 1, hourly_rate: 60 },
      { description: 'B', hours: 2, hourly_rate: 50 },
    ]);
    const res = await request(app).get(`/api/projects/${pid}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.extra_hours).toHaveLength(2);
    expect(res.body.extra_hours.map(r => r.description)).toEqual(['A', 'B']);
    expect(res.body.calculation.extraHoursCost).toBeCloseTo(160, 4);
  });

  test('PUT on a non-existent project returns 404', async () => {
    const res = await request(app).put('/api/projects/9999999/extra-hours').set('Cookie', cookie).send([]);
    expect(res.status).toBe(404);
  });

  test('PUT requires auth', async () => {
    const res = await request(app).put(`/api/projects/${pid}/extra-hours`).send([]);
    expect(res.status).toBe(401);
  });

  test('regression: extra-hours pricing does NOT scale by items_per_set', async () => {
    // Set items_per_set to 5, add €60 of extra hours → contribution stays €60, not €300.
    await request(app).put(`/api/projects/${pid}`).set('Cookie', cookie).send({
      name: 'Extra-Hours Test', customer_name: null, items_per_set: 5,
      tags: '', notes: null, actual_sales_price: null,
    });
    const res = await request(app).put(`/api/projects/${pid}/extra-hours`).set('Cookie', cookie).send([
      { description: 'Flat', hours: 1, hourly_rate: 60 },
    ]);
    expect(res.body.calculation.extraHoursCost).toBeCloseTo(60, 4);
    expect(res.body.calculation.pricing.extraHoursCost).toBeCloseTo(60, 4);
  });

  // Round 2: the front-end converts H:MM strings to decimal hours BEFORE
  // hitting the API. The DB schema stays decimal — we verify the contract.
  test('PUT decimal 0.75 (front-end converts "0:45") round-trips at €60/h = €45', async () => {
    const res = await request(app).put(`/api/projects/${pid}/extra-hours`).set('Cookie', cookie).send([
      { description: '45-min hand-finishing', hours: 0.75, hourly_rate: 60 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.extra_hours).toHaveLength(1);
    expect(res.body.extra_hours[0].hours).toBeCloseTo(0.75, 6);
    expect(res.body.calculation.extraHoursCost).toBeCloseTo(45, 4);
  });

  // Round 2: addExtraHourRow defaults new row to 1 hour. The PUT carrying that
  // default must round-trip cleanly (acts as the front-end-to-back-end contract
  // test for the new default; addExtraHourRow itself is DOM-bound).
  test('PUT decimal 1 (default new-row hours) round-trips and applies default rate', async () => {
    const res = await request(app).put(`/api/projects/${pid}/extra-hours`).set('Cookie', cookie).send([
      { description: 'New hours', hours: 1, hourly_rate: 60 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.extra_hours).toHaveLength(1);
    expect(res.body.extra_hours[0].hours).toBe(1);
    expect(res.body.extra_hours[0].hourly_rate).toBe(60);
    expect(res.body.calculation.extraHoursCost).toBeCloseTo(60, 4);
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

/* ================================================================== */
/*  Design Cost Module — settings, flag, routes                       */
/* ================================================================== */
describe('Design Cost Module', () => {
  let pid;

  beforeAll(async () => {
    const res = await request(app).post('/api/projects').set('Cookie', cookie)
      .send({ name: 'Design Cost Test', items_per_set: 1 });
    pid = res.body.id;
  });

  afterAll(async () => {
    await request(app).delete(`/api/projects/${pid}`).set('Cookie', cookie);
  });

  test('design_hourly_rate default is 65 in settings', async () => {
    const res = await request(app).get('/api/settings').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.design_hourly_rate).toBe(65);
  });

  test('new project has is_custom=0 and design_hours/design_extras as empty arrays', async () => {
    const res = await request(app).get(`/api/projects/${pid}`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.is_custom).toBe(0);
    expect(Array.isArray(res.body.design_hours)).toBe(true);
    expect(res.body.design_hours).toHaveLength(0);
    expect(Array.isArray(res.body.design_extras)).toBe(true);
    expect(res.body.design_extras).toHaveLength(0);
  });

  test('calculation.designCosts is null when is_custom=0', async () => {
    const res = await request(app).get(`/api/projects/${pid}`).set('Cookie', cookie);
    expect(res.body.calculation.designCosts).toBeNull();
  });

  test('PATCH /api/projects/:id/custom toggles is_custom 0→1', async () => {
    const res = await request(app).patch(`/api/projects/${pid}/custom`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.is_custom).toBe(1);
    const check = await request(app).get(`/api/projects/${pid}`).set('Cookie', cookie);
    expect(check.body.is_custom).toBe(1);
  });

  test('PATCH /api/projects/:id/custom toggles is_custom 1→0', async () => {
    const res = await request(app).patch(`/api/projects/${pid}/custom`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.is_custom).toBe(0);
  });

  test('PATCH /api/projects/:id/custom returns 404 for missing project', async () => {
    const res = await request(app).patch('/api/projects/999999/custom').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });

  test('PUT /api/projects/:id/design-hours persists and shows in calculation.designCosts when custom', async () => {
    // Enable custom
    await request(app).patch(`/api/projects/${pid}/custom`).set('Cookie', cookie);

    const res = await request(app).put(`/api/projects/${pid}/design-hours`).set('Cookie', cookie).send([
      { description: 'CAD work', hours: 3, hourly_rate: 65 },
      { description: 'Slicing', hours: 0.5, hourly_rate: 65 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.design_hours).toHaveLength(2);
    expect(res.body.design_hours[0].description).toBe('CAD work');
    // 3*65 + 0.5*65 = 195 + 32.5 = 227.5
    expect(res.body.calculation.designCosts.designHoursSubtotal).toBeCloseTo(227.5, 4);
    expect(res.body.calculation.designCosts.designTotal).toBeCloseTo(227.5, 4);
  });

  test('PUT /api/projects/:id/design-hours does NOT touch production extra-hours (is_design_cost=0)', async () => {
    // Add production extra hours first
    await request(app).put(`/api/projects/${pid}/extra-hours`).set('Cookie', cookie).send([
      { description: 'Hand-finishing', hours: 1, hourly_rate: 60 },
    ]);

    // Now replace design hours
    await request(app).put(`/api/projects/${pid}/design-hours`).set('Cookie', cookie).send([
      { description: 'New design work', hours: 2, hourly_rate: 65 },
    ]);

    const res = await request(app).get(`/api/projects/${pid}`).set('Cookie', cookie);
    // Production extra hours still there
    expect(res.body.extra_hours).toHaveLength(1);
    expect(res.body.extra_hours[0].description).toBe('Hand-finishing');
    // Design hours replaced
    expect(res.body.design_hours).toHaveLength(1);
    expect(res.body.design_hours[0].description).toBe('New design work');
  });

  test('PUT /api/projects/:id/design-extras persists and adds to designCosts.extrasSubtotal', async () => {
    const res = await request(app).put(`/api/projects/${pid}/design-extras`).set('Cookie', cookie).send([
      { description: 'Logo design', amount: 50 },
      { description: 'Revisions', amount: 25 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.design_extras).toHaveLength(2);
    expect(res.body.calculation.designCosts.extrasSubtotal).toBeCloseTo(75, 4);
  });

  test('PUT /api/projects/:id/design-extras drops empty-description rows', async () => {
    const res = await request(app).put(`/api/projects/${pid}/design-extras`).set('Cookie', cookie).send([
      { description: 'Valid', amount: 10 },
      { description: '', amount: 999 },
      { description: '   ', amount: 999 },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.design_extras).toHaveLength(1);
  });

  test('calculation.designCosts is null when is_custom=0 even with design_hours in DB', async () => {
    // Turn off custom
    await request(app).patch(`/api/projects/${pid}/custom`).set('Cookie', cookie);
    const res = await request(app).get(`/api/projects/${pid}`).set('Cookie', cookie);
    expect(res.body.is_custom).toBe(0);
    expect(res.body.calculation.designCosts).toBeNull();
    // Re-enable for remaining tests
    await request(app).patch(`/api/projects/${pid}/custom`).set('Cookie', cookie);
  });

  test('GET /api/projects/:id/files excludes test-print files', async () => {
    // Create a minimal fake 3mf buffer (invalid 3mf but enough to test file storage)
    const fakeBuf = Buffer.from('PK\x03\x04dummy3mf');
    const res = await request(app)
      .post(`/api/projects/${pid}/test-print`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Filename', 'test.3mf')
      .send(fakeBuf);
    // May be 201 or 500 depending on parse3mf; either way the file should be hidden
    // We only assert files endpoint excludes it
    const files = await request(app).get(`/api/projects/${pid}/files`).set('Cookie', cookie);
    expect(files.status).toBe(200);
    // test-print files must not appear in this list
    // (If test failed due to parse error we can still check the file is absent)
    const hasPlateBound = files.body.find(f => f.filename === 'test.3mf');
    expect(hasPlateBound).toBeUndefined();
  });

  test('POST /api/projects/:id/test-print rejects non-.3mf files', async () => {
    const res = await request(app)
      .post(`/api/projects/${pid}/test-print`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Filename', 'model.stl')
      .send(Buffer.from('solid test'));
    expect(res.status).toBe(400);
  });

  test('POST /api/projects/:id/duplicate carries is_custom and design data', async () => {
    const res = await request(app).post(`/api/projects/${pid}/duplicate`).set('Cookie', cookie);
    expect(res.status).toBe(201);
    expect(res.body.is_custom).toBe(1);
    // Design hours and extras should be copied
    expect(res.body.design_hours.length).toBeGreaterThan(0);
    // Cleanup
    await request(app).delete(`/api/projects/${res.body.id}`).set('Cookie', cookie);
  });
});

/* ================================================================== */
/*  3MF sliced-vs-model detection (is_sliced)                          */
/* ================================================================== */
describe('Files — is_sliced detection', () => {
  let pid;
  beforeAll(async () => {
    const res = await request(app).post('/api/projects').set('Cookie', cookie)
      .send({ name: 'Sliced Detection', customer_name: null, items_per_set: 1 });
    pid = res.body.id;
  });

  test('uploading an unsliced 3MF marks it is_sliced=0 (model file)', async () => {
    // A junk-but-named .3mf has no slice_info.config → parse3mf reports sliced=false
    const res = await request(app)
      .post(`/api/projects/${pid}/files`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Filename', 'model_only.3mf')
      .send(Buffer.from('PK\x03\x04not-really-sliced'));
    expect(res.status).toBe(201);
    expect(res.body.is_sliced).toBe(0);
  });

  test('non-3MF uploads leave is_sliced NULL', async () => {
    const res = await request(app)
      .post(`/api/projects/${pid}/files`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Filename', 'part.stl')
      .send(Buffer.from('solid part'));
    expect(res.status).toBe(201);
    expect(res.body.is_sliced).toBeNull();
  });

  const SLICED_3MF = path.join(__dirname, 'fixtures', 'sliced_multiplate.3mf');
  const hasFixture = fs.existsSync(SLICED_3MF);
  (hasFixture ? test : test.skip)('uploading a sliced 3MF marks it is_sliced=1', async () => {
    const res = await request(app)
      .post(`/api/projects/${pid}/files`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Filename', 'sliced_multiplate.3mf')
      .send(fs.readFileSync(SLICED_3MF));
    expect(res.status).toBe(201);
    expect(res.body.is_sliced).toBe(1);
  });
});

/* ================================================================== */
/*  POST /api/projects/:id/verify-batch                                */
/* ================================================================== */
describe('POST /api/projects/:id/verify-batch', () => {
  let pid;
  let printerId;
  let materialId;

  beforeAll(async () => {
    // Create a project to verify against
    const pr = await request(app).post('/api/projects').set('Cookie', cookie)
      .send({ name: 'Verify Batch Test', items_per_set: 2 });
    pid = pr.body.id;

    // Grab first seeded printer and material ids
    const printerRes  = await request(app).get('/api/printers').set('Cookie', cookie);
    const materialRes = await request(app).get('/api/materials').set('Cookie', cookie);
    printerId  = printerRes.body[0].id;
    materialId = materialRes.body[0].id;
  });

  afterAll(async () => {
    await request(app).delete(`/api/projects/${pid}`).set('Cookie', cookie);
  });

  test('returns 404 for unknown project', async () => {
    const res = await request(app)
      .post('/api/projects/9999999/verify-batch')
      .set('Cookie', cookie)
      .send({ plates: [], preProcessingMinutes: 0, postProcessingMinutes: 0, itemsPerSet: 1,
              projectProductionCost: 10, projectSellingPrice: 20 });
    expect(res.status).toBe(404);
  });

  test('valid input returns totalBatchCost, sellableUnits, vsProductionCost.sign', async () => {
    const res = await request(app)
      .post(`/api/projects/${pid}/verify-batch`)
      .set('Cookie', cookie)
      .send({
        plates: [
          { printer_id: printerId, material_id: materialId,
            print_time_minutes: 120, plastic_grams: 50, items_per_plate: 2 },
          { printer_id: printerId, material_id: materialId,
            print_time_minutes: 60, plastic_grams: 20, items_per_plate: 3 },
        ],
        preProcessingMinutes: 5,
        postProcessingMinutes: 10,
        hourlyRate: 40,
        supplies: [{ price_excl_vat: 0.50, quantity: 2 }],
        itemsPerSet: 2,
        projectProductionCost: 999,  // high → actual cost cheaper → sign '+'
        projectSellingPrice: 1500,
      });

    expect(res.status).toBe(200);
    expect(typeof res.body.totalBatchCost).toBe('number');
    expect(typeof res.body.sellableUnits).toBe('number');
    expect(res.body.sellableUnits).toBe(2); // floor((2+3)/2) = 2
    expect(res.body.vsProductionCost).toBeDefined();
    expect(res.body.vsProductionCost.sign).toBe('+');
    expect(res.body.vsSellingPrice).toBeDefined();
  });

  test('sellableUnits=0 case — actualCostPerUnit is Infinity', async () => {
    const res = await request(app)
      .post(`/api/projects/${pid}/verify-batch`)
      .set('Cookie', cookie)
      .send({
        plates: [
          { printer_id: printerId, material_id: materialId,
            print_time_minutes: 60, plastic_grams: 20, items_per_plate: 1 },
        ],
        preProcessingMinutes: 0,
        postProcessingMinutes: 0,
        hourlyRate: 40,
        supplies: [],
        itemsPerSet: 5,   // 1 piece < 5 per set → 0 sellable units
        projectProductionCost: 10,
        projectSellingPrice: 20,
      });

    expect(res.status).toBe(200);
    expect(res.body.sellableUnits).toBe(0);
    // JSON serializes Infinity as null
    expect(res.body.actualCostPerUnit === null || res.body.actualCostPerUnit === Infinity || !Number.isFinite(res.body.actualCostPerUnit)).toBe(true);
  });

  test('requires auth', async () => {
    const res = await request(app)
      .post(`/api/projects/${pid}/verify-batch`)
      .send({ plates: [], itemsPerSet: 1, projectProductionCost: 10, projectSellingPrice: 20 });
    expect(res.status).toBe(401);
  });

  test('printingCost and postProcessingCost are distinct in response', async () => {
    const res = await request(app)
      .post(`/api/projects/${pid}/verify-batch`)
      .set('Cookie', cookie)
      .send({
        plates: [
          { printer_id: printerId, material_id: materialId,
            print_time_minutes: 120, plastic_grams: 50, items_per_plate: 2 },
        ],
        preProcessingMinutes: 10,
        postProcessingMinutes: 20,
        hourlyRate: 60,
        supplies: [],
        itemsPerSet: 1,
        projectProductionCost: 10,
        projectSellingPrice: 20,
      });

    expect(res.status).toBe(200);
    // printingCost = machine cost only (no time)
    expect(typeof res.body.printingCost).toBe('number');
    expect(res.body.printingCost).toBeGreaterThan(0);
    // postProcessingCost = (10+20)/60 * 60 = 30
    expect(res.body.postProcessingCost).toBeCloseTo(30, 2);
    // printingCost === totalMachineCost
    expect(res.body.printingCost).toBeCloseTo(res.body.totalMachineCost, 6);
    // postProcessingCost === timeCost
    expect(res.body.postProcessingCost).toBeCloseTo(res.body.timeCost, 6);
    // Regression fence: if post-proc were not separated, postProcessingCost would be 0
    expect(res.body.postProcessingCost).toBeGreaterThan(0);
    // totalBatchCost = printing + post-proc + supplies
    expect(res.body.totalBatchCost).toBeCloseTo(
      res.body.printingCost + res.body.postProcessingCost + res.body.suppliesCost, 2
    );
  });

  test('multi-plate summed: 2 plates × 3 items each = 6 total items', async () => {
    const res = await request(app)
      .post(`/api/projects/${pid}/verify-batch`)
      .set('Cookie', cookie)
      .send({
        plates: [
          { printer_id: printerId, material_id: materialId,
            print_time_minutes: 60, plastic_grams: 30, items_per_plate: 3 },
          { printer_id: printerId, material_id: materialId,
            print_time_minutes: 45, plastic_grams: 20, items_per_plate: 3 },
        ],
        preProcessingMinutes: 0, postProcessingMinutes: 0,
        hourlyRate: 40, supplies: [], itemsPerSet: 1,
        projectProductionCost: 10, projectSellingPrice: 20,
      });

    expect(res.status).toBe(200);
    expect(res.body.totalPieces).toBe(6);
    expect(res.body.plateCosts).toHaveLength(2);
    // Regression fence: if only first plate was counted, totalPieces would be 3
    expect(res.body.totalPieces).not.toBe(3);
    // totalMachineCost must be sum of both plate costs
    const sumPlateCosts = res.body.plateCosts.reduce((s, pc) => s + pc.totalPlateCost, 0);
    expect(res.body.totalMachineCost).toBeCloseTo(sumPlateCosts, 2);
  });

  test('actualMarginOnBatch computed when actualSellingTotalInclVat provided', async () => {
    const actualSelling = 60.50; // incl. 21% VAT
    const expectedNet = actualSelling / 1.21;

    const res = await request(app)
      .post(`/api/projects/${pid}/verify-batch`)
      .set('Cookie', cookie)
      .send({
        plates: [
          { printer_id: printerId, material_id: materialId,
            print_time_minutes: 60, plastic_grams: 30, items_per_plate: 2 },
        ],
        preProcessingMinutes: 0, postProcessingMinutes: 0,
        hourlyRate: 40, supplies: [], itemsPerSet: 1,
        projectProductionCost: 5, projectSellingPrice: 10,
        actualSellingTotalInclVat: actualSelling,
      });

    expect(res.status).toBe(200);
    const amb = res.body.actualMarginOnBatch;
    expect(amb).not.toBeNull();
    // netRevenue = actualSelling / 1.21
    expect(amb.netRevenue).toBeCloseTo(expectedNet, 2);
    // absoluteMargin = netRevenue - totalBatchCost
    expect(amb.absoluteMargin).toBeCloseTo(amb.netRevenue - res.body.totalBatchCost, 2);
    // marginPct = absoluteMargin / netRevenue * 100
    expect(amb.marginPct).toBeCloseTo((amb.absoluteMargin / amb.netRevenue) * 100, 2);
    // Regression fence: if margin used inclVat instead of netRevenue, netRevenue would equal actualSelling
    expect(amb.netRevenue).not.toBeCloseTo(actualSelling, 2);
    // indicator is a string
    expect(['green', 'orange', 'red']).toContain(amb.indicator);
  });

  test('actualMarginOnBatch is null when actualSellingTotalInclVat not provided', async () => {
    const res = await request(app)
      .post(`/api/projects/${pid}/verify-batch`)
      .set('Cookie', cookie)
      .send({
        plates: [
          { printer_id: printerId, material_id: materialId,
            print_time_minutes: 60, plastic_grams: 30, items_per_plate: 2 },
        ],
        preProcessingMinutes: 0, postProcessingMinutes: 0,
        hourlyRate: 40, supplies: [], itemsPerSet: 1,
        projectProductionCost: 5, projectSellingPrice: 10,
        // no actualSellingTotalInclVat
      });

    expect(res.status).toBe(200);
    expect(res.body.actualMarginOnBatch).toBeNull();
  });
});

/* ================================================================== */
/*  Test-print processing inputs + risk-lock (task #330)              */
/* ================================================================== */
describe('Test-print processing inputs + risk-lock', () => {
  let pid;
  let tpId;
  let plateId;

  beforeAll(async () => {
    const pr = await request(app).post('/api/projects').set('Cookie', cookie)
      .send({ name: 'TP Processing Test', items_per_set: 1 });
    pid = pr.body.id;

    // Create a test-print entry
    const tp = await request(app).post(`/api/projects/${pid}/test-prints`).set('Cookie', cookie)
      .send({ description: 'Processing test', estimated_cost: 0 });
    expect(tp.status).toBe(201);
    tpId = tp.body.test_prints[0].id;

    // Attach a minimal .3mf buffer
    const fakeBuf = Buffer.from('PK\x03\x04dummy3mf');
    const attach = await request(app)
      .post(`/api/projects/${pid}/test-prints/${tpId}/attach`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Filename', 'part.3mf')
      .send(fakeBuf);
    expect(attach.status).toBe(201);

    // GET the project to find the new plate id from attachmentBreakdowns
    const get = await request(app).get(`/api/projects/${pid}`).set('Cookie', cookie);
    expect(get.status).toBe(200);
    const tp0 = get.body.test_prints.find(t => t.id === tpId);
    expect(tp0).toBeDefined();
    expect(tp0.attachmentBreakdowns.length).toBeGreaterThan(0);
    plateId = tp0.attachmentBreakdowns[0].plateId;
  });

  afterAll(async () => {
    await request(app).delete(`/api/projects/${pid}`).set('Cookie', cookie);
  });

  test('A: post_processing_minutes=2 reaches totalPlateCost in attachmentBreakdown', async () => {
    const patch = await request(app)
      .patch(`/api/projects/${pid}/plates/${plateId}`)
      .set('Cookie', cookie)
      .send({ post_processing_minutes: 2 });
    expect(patch.status).toBe(200);

    const get = await request(app).get(`/api/projects/${pid}`).set('Cookie', cookie);
    expect(get.status).toBe(200);

    const tp0 = get.body.test_prints.find(t => t.id === tpId);
    expect(tp0).toBeDefined();
    const ab = tp0.attachmentBreakdowns[0];
    expect(ab.post_processing_minutes).toBe(2);
    // (0+2)/60 * 40 = 1.333... processing contribution
    expect(ab.totalPlateCost).toBeGreaterThanOrEqual(1.33);
  });

  test('B: risk_multiplier forced to 1 on test-print plates', async () => {
    const patch = await request(app)
      .patch(`/api/projects/${pid}/plates/${plateId}`)
      .set('Cookie', cookie)
      .send({ risk_multiplier: 1.5 });
    expect(patch.status).toBe(200);

    const get = await request(app).get(`/api/projects/${pid}`).set('Cookie', cookie);
    expect(get.status).toBe(200);

    const tp_plate = get.body.test_print_plates.find(pl => pl.id === plateId);
    expect(tp_plate).toBeDefined();
    expect(tp_plate.risk_multiplier).toBe(1);
  });
});

/* ================================================================== */
/*  Test-print 3MF must SUM all plates (not just plate 1)             */
/* ================================================================== */
describe('Test-print 3MF aggregates all plates', () => {
  const os = require('os');
  const { execSync } = require('child_process');
  let pid;

  // Build a synthetic multi-plate sliced 3MF (a ZIP with Metadata/slice_info.config).
  function buildMultiPlate3mf(plates) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tp3mf-'));
    fs.mkdirSync(path.join(dir, 'Metadata'), { recursive: true });
    const plateXml = plates.map(pl => `  <plate>
    <metadata key="index" value="${pl.index}"/>
    <metadata key="prediction" value="${pl.seconds}"/>
    <metadata key="weight" value="${pl.grams}"/>
    <object name="obj${pl.index}" />
  </plate>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${plateXml}\n</config>`;
    fs.writeFileSync(path.join(dir, 'Metadata', 'slice_info.config'), xml);
    execSync('zip -q -r test.3mf Metadata', { cwd: dir, stdio: 'ignore' });
    return fs.readFileSync(path.join(dir, 'test.3mf'));
  }

  beforeAll(async () => {
    const pr = await request(app).post('/api/projects').set('Cookie', cookie)
      .send({ name: 'Multi-plate TP', items_per_set: 1 });
    pid = pr.body.id;
  });

  afterAll(async () => {
    await request(app).delete(`/api/projects/${pid}`).set('Cookie', cookie);
  });

  test('attaching a 3-plate 3MF sums print time + grams across ALL plates', async () => {
    // Plate 1: 3600s=60min, 100g. Plate 2: 1800s=30min, 50g. Plate 3: 600s=10min, 20g.
    // Summed total: 100 min, 170 g. (Plate 1 alone would be 60 / 100.)
    const buf = buildMultiPlate3mf([
      { index: 1, seconds: 3600, grams: 100 },
      { index: 2, seconds: 1800, grams: 50 },
      { index: 3, seconds: 600, grams: 20 },
    ]);

    const tp = await request(app).post(`/api/projects/${pid}/test-prints`).set('Cookie', cookie)
      .send({ description: 'Multi', estimated_cost: 0 });
    expect(tp.status).toBe(201);
    const tpId = tp.body.test_prints[0].id;

    const attach = await request(app)
      .post(`/api/projects/${pid}/test-prints/${tpId}/attach`)
      .set('Cookie', cookie)
      .set('Content-Type', 'application/octet-stream')
      .set('X-Filename', 'multi.3mf')
      .send(buf);
    expect(attach.status).toBe(201);

    const get = await request(app).get(`/api/projects/${pid}`).set('Cookie', cookie);
    expect(get.status).toBe(200);
    const tp0 = get.body.test_prints.find(t => t.id === tpId);
    expect(tp0).toBeDefined();
    expect(tp0.attachmentBreakdowns.length).toBe(1);
    const ab = tp0.attachmentBreakdowns[0];
    // Summed, not just plate 1
    expect(ab.print_time_minutes).toBeCloseTo(100, 5);
    expect(ab.plastic_grams).toBeCloseTo(170, 5);

    // And the stored plate row reflects the sum
    const plate = get.body.test_print_plates.find(p => p.id === ab.plateId);
    expect(plate.print_time_minutes).toBeCloseTo(100, 5);
    expect(plate.plastic_grams).toBeCloseTo(170, 5);
  });
});

/* ================================================================== */
/*  Custom one-off project lines                                      */
/* ================================================================== */
describe('Custom one-off project lines', () => {
  let pid;

  beforeAll(async () => {
    const pr = await request(app).post('/api/projects').set('Cookie', cookie)
      .send({ name: 'Custom line project', items_per_set: 1 });
    pid = pr.body.id;
  });

  afterAll(async () => {
    await request(app).delete(`/api/projects/${pid}`).set('Cookie', cookie);
  });

  test('a custom line adds its amount to the project cost', async () => {
    const before = await request(app).get(`/api/projects/${pid}`).set('Cookie', cookie);
    const beforeExtra = before.body.calculation.extraCostsTotal;
    const beforeProd = before.body.calculation.pricing.productionCost;

    const res = await request(app).put(`/api/projects/${pid}/custom-lines`).set('Cookie', cookie)
      .send([{ label: 'Bespoke acrylic jig', amount: 12.5, sort_order: 0 }]);
    expect(res.status).toBe(200);
    expect(res.body.custom_lines.length).toBe(1);
    expect(res.body.custom_lines[0].label).toBe('Bespoke acrylic jig');

    // Contributes like a supply: extraCostsTotal + productionCost both +12.5
    expect(res.body.calculation.customLinesTotal).toBeCloseTo(12.5, 5);
    expect(res.body.calculation.extraCostsTotal).toBeCloseTo(beforeExtra + 12.5, 5);
    expect(res.body.calculation.pricing.productionCost).toBeCloseTo(beforeProd + 12.5, 5);
  });

  test('a custom line is NOT written to the supplies catalog', async () => {
    const catalog = await request(app).get('/api/extra-costs').set('Cookie', cookie);
    expect(catalog.status).toBe(200);
    const hit = catalog.body.find(e => e.name === 'Bespoke acrylic jig');
    expect(hit).toBeUndefined();
  });

  test('replace-all semantics: empty payload clears custom lines', async () => {
    const res = await request(app).put(`/api/projects/${pid}/custom-lines`).set('Cookie', cookie)
      .send([]);
    expect(res.status).toBe(200);
    expect(res.body.custom_lines.length).toBe(0);
    expect(res.body.calculation.customLinesTotal).toBeCloseTo(0, 5);
  });
});

// Clean up
afterAll(() => {
  removeDbFiles(testDbPath);
});
