'use strict';

const { computeDiffs, renderMarkdown } = require('../bin/migrate-colors');

describe('migrate-colors — dry-run diff computation', () => {
  const catalog = [
    { id: 1, brand: 'Bambu Lab', type: 'PLA', colorHex: '#FF0000', colorName: 'Scarlet Red', inStock: 1 },
    { id: 2, brand: 'Polymaker', type: 'PLA', colorHex: '#00AA00', colorName: 'Forest Green', inStock: 1 },
    { id: 3, brand: 'Prusament', type: 'PLA', colorHex: '#0000FF', colorName: 'Azure Blue',  inStock: 1 },
  ];

  // Two projects × three plates each. We intentionally seed a mix of
  // (a) rows that already carry the catalog-matched name/brand,
  // (b) rows whose name is stale,
  // (c) rows whose brand is stale,
  // (d) rows whose hex doesn't match anything in the catalog,
  // (e) a plate with an unparsable `colors` blob.
  const plates = [
    { project_id: 1, project_name: 'Alpha', plate_id: 10, plate_name: 'Front',
      colors: JSON.stringify([
        { color: '#FF0000', name: 'Scarlet Red', brand: 'Bambu Lab' }, // (a) no change
        { color: '#00AA00', name: 'green',       brand: 'Polymaker' }, // (b) name diff
      ]),
    },
    { project_id: 1, project_name: 'Alpha', plate_id: 11, plate_name: 'Back',
      colors: JSON.stringify([
        { color: '#0000FF', name: 'Azure Blue',  brand: 'generic' },    // (c) brand diff
      ]),
    },
    { project_id: 2, project_name: 'Beta', plate_id: 20, plate_name: 'Body',
      colors: JSON.stringify([
        { color: '#111111', name: 'dark grey',   brand: 'generic' },    // (d) no match
      ]),
    },
    { project_id: 2, project_name: 'Beta', plate_id: 21, plate_name: 'Lid',
      colors: 'not-valid-json',                                          // (e) parse error
    },
    { project_id: 2, project_name: 'Beta', plate_id: 22, plate_name: 'Tray',
      colors: JSON.stringify([
        { color: '#FF0000', name: 'red',         brand: '' },            // (b+c) both diff
      ]),
    },
  ];

  test('flags only rows whose name or brand would change', () => {
    const diffs = computeDiffs(plates, catalog);
    expect(diffs).toHaveLength(3);
    expect(diffs[0]).toMatchObject({
      projectName: 'Alpha', plateName: 'Front',
      oldName: 'green', oldBrand: 'Polymaker',
      newName: 'Forest Green', newBrand: 'Polymaker',
      hex: '#00AA00',
    });
    expect(diffs[1]).toMatchObject({
      projectName: 'Alpha', plateName: 'Back',
      oldName: 'Azure Blue', oldBrand: 'generic',
      newName: 'Azure Blue', newBrand: 'Prusament',
      hex: '#0000FF',
    });
    expect(diffs[2]).toMatchObject({
      projectName: 'Beta', plateName: 'Tray',
      oldName: 'red', oldBrand: '',
      newName: 'Scarlet Red', newBrand: 'Bambu Lab',
      hex: '#FF0000',
    });
  });

  test('markdown output matches the expected table', () => {
    const diffs = computeDiffs(plates, catalog);
    const md = renderMarkdown(diffs, { generatedAt: new Date('2026-04-20T00:00:00Z') });
    const expected =
`# Colour-migration dry-run

Generated: 2026-04-20T00:00:00.000Z
Rows listed: 3

| Project | Plate | Old name | Old brand | New name | New brand | Hex |
| --- | --- | --- | --- | --- | --- | --- |
| Alpha | Front | green | Polymaker | Forest Green | Polymaker | #00AA00 |
| Alpha | Back | Azure Blue | generic | Azure Blue | Prusament | #0000FF |
| Beta | Tray | red |  | Scarlet Red | Bambu Lab | #FF0000 |
`;
    expect(md).toBe(expected);
  });

  test('empty-diff markdown includes a placeholder row', () => {
    const md = renderMarkdown([], { generatedAt: new Date('2026-04-20T00:00:00Z') });
    expect(md).toContain('Rows listed: 0');
    expect(md).toContain('_(no rows would change)_');
  });
});

describe('migrate-colors — --commit path', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const Database = require('better-sqlite3');
  const { applyDiffs, computeDiffs, renderMarkdown, todayStamp } = require('../bin/migrate-colors');

  const catalog = [
    { id: 1, brand: 'Bambu Lab', type: 'PLA', colorHex: '#FF0000', colorName: 'Scarlet Red',   inStock: 1 },
    { id: 2, brand: 'Polymaker', type: 'PLA', colorHex: '#00AA00', colorName: 'Forest Green',  inStock: 1 },
    { id: 3, brand: 'Prusament', type: 'PLA', colorHex: '#0000FF', colorName: 'Azure Blue',    inStock: 1 },
  ];

  function seedDb(filePath) {
    const db = new Database(filePath);
    db.exec(`
      CREATE TABLE projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
      CREATE TABLE project_plates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        name TEXT,
        colors TEXT
      );
    `);
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(1, 'Alpha');
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(2, 'Beta');

    const insPlate = db.prepare('INSERT INTO project_plates (id, project_id, name, colors) VALUES (?, ?, ?, ?)');
    // Project 1: stale name, stale brand, already-correct.
    insPlate.run(10, 1, 'Front', JSON.stringify([
      { color: '#FF0000', name: 'red',         brand: '',          extruder: 0 },
      { color: '#00AA00', name: 'green',       brand: 'Polymaker', extruder: 1 },
    ]));
    insPlate.run(11, 1, 'Back', JSON.stringify([
      { color: '#0000FF', name: 'Azure Blue',  brand: 'generic',   extruder: 0 },
    ]));
    insPlate.run(12, 1, 'Side', JSON.stringify([
      { color: '#FF0000', name: 'Scarlet Red', brand: 'Bambu Lab', extruder: 0 }, // no change
    ]));
    // Project 2: mix of changes + no-op.
    insPlate.run(20, 2, 'Body', JSON.stringify([
      { color: '#FF0000', name: 'red',         brand: '',          extruder: 0 },
    ]));
    insPlate.run(21, 2, 'Lid', JSON.stringify([
      { color: '#00AA00', name: 'Forest Green', brand: 'Polymaker', extruder: 0 }, // no change
    ]));
    insPlate.run(22, 2, 'Tray', JSON.stringify([
      { color: '#0000FF', name: 'Azure Blue',  brand: 'generic',   extruder: 0 },
    ]));
    db.close();
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

  let tmpDir;
  let dbFile;
  let logDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-colors-'));
    dbFile = path.join(tmpDir, 'calculator.db');
    logDir = path.join(tmpDir, 'logs');
    seedDb(dbFile);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('applyDiffs updates project_plates.colors inside a transaction, preserving hex + extruder', () => {
    const db = new Database(dbFile);
    const diffs = computeDiffs(loadPlates(db), catalog);
    expect(new Set(diffs.map(d => d.plate_id)).size).toBe(4);

    const rowsUpdated = applyDiffs(db, diffs);
    expect(rowsUpdated).toBe(4);

    const rows = db.prepare('SELECT id, colors FROM project_plates ORDER BY id').all();
    const byId = Object.fromEntries(rows.map(r => [r.id, JSON.parse(r.colors)]));

    expect(byId[10]).toEqual([
      { color: '#FF0000', name: 'Scarlet Red',  brand: 'Bambu Lab', extruder: 0 },
      { color: '#00AA00', name: 'Forest Green', brand: 'Polymaker', extruder: 1 },
    ]);
    expect(byId[11]).toEqual([
      { color: '#0000FF', name: 'Azure Blue',   brand: 'Prusament', extruder: 0 },
    ]);
    expect(byId[12]).toEqual([
      { color: '#FF0000', name: 'Scarlet Red',  brand: 'Bambu Lab', extruder: 0 },
    ]);
    expect(byId[20]).toEqual([
      { color: '#FF0000', name: 'Scarlet Red',  brand: 'Bambu Lab', extruder: 0 },
    ]);
    expect(byId[21]).toEqual([
      { color: '#00AA00', name: 'Forest Green', brand: 'Polymaker', extruder: 0 },
    ]);
    expect(byId[22]).toEqual([
      { color: '#0000FF', name: 'Azure Blue',   brand: 'Prusament', extruder: 0 },
    ]);

    db.close();
  });

  test('applied-markdown carries the Applied-at header and applied title', () => {
    const appliedAt = new Date('2026-04-21T06:00:00Z');
    const md = renderMarkdown(
      [{ plate_id: 1, projectName: 'Alpha', plateName: 'Front',
         oldName: 'red', oldBrand: '', newName: 'Scarlet Red', newBrand: 'Bambu Lab',
         hex: '#FF0000' }],
      { generatedAt: new Date('2026-04-21T06:00:00Z'), appliedAt }
    );
    expect(md).toContain('# Colour-migration applied');
    expect(md).toContain('Applied at: 2026-04-21T06:00:00.000Z');
    expect(md).toContain('| Alpha | Front | red |  | Scarlet Red | Bambu Lab | #FF0000 |');
  });

  test('end-to-end: commit path writes both markdown files and applies the mapping', () => {
    const db = new Database(dbFile);
    const diffs = computeDiffs(loadPlates(db), catalog);

    fs.mkdirSync(logDir, { recursive: true });
    const stamp = todayStamp();
    const dryPath = path.join(logDir, `color-migration-${stamp}.md`);
    const appliedPath = path.join(logDir, `color-migration-${stamp}-applied.md`);

    fs.writeFileSync(dryPath, renderMarkdown(diffs));
    const appliedAt = new Date();
    const rowsUpdated = applyDiffs(db, diffs);
    fs.writeFileSync(appliedPath, renderMarkdown(diffs, { appliedAt }));
    db.close();

    expect(rowsUpdated).toBe(4);
    expect(fs.existsSync(dryPath)).toBe(true);
    expect(fs.existsSync(appliedPath)).toBe(true);
    expect(fs.readFileSync(dryPath, 'utf8')).toMatch(/# Colour-migration dry-run/);
    expect(fs.readFileSync(appliedPath, 'utf8')).toMatch(/Applied at: /);

    // Verify post-write DB state for changed plates — no row still carries
    // an old stale value.
    const verify = new Database(dbFile, { readonly: true });
    const after = verify.prepare('SELECT id, colors FROM project_plates WHERE id IN (10,11,20,22)').all();
    for (const r of after) {
      const cs = JSON.parse(r.colors);
      for (const c of cs) {
        expect(c.name).not.toBe('red');
        expect(c.name).not.toBe('green');
        expect(c.brand).not.toBe('generic');
        expect(c.brand).not.toBe('');
      }
    }
    verify.close();
  });
});
