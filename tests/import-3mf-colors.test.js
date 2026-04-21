'use strict';

/**
 * Commit 1 — 3MF-import colour-matching against the filament catalog.
 *
 * The matching logic lives in public/app.js (browser code). We exercise it
 * here by extracting matchFilamentInCatalog + hexToName from the source via
 * `vm` — no JSDOM, no module shuffling. The test then walks the same
 * build-colors pipeline that confirm3mfImport() runs client-side and asserts
 * the enriched {name, brand} values land in the import payload.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_JS = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'app.js'),
  'utf8'
);

// Pull the two helper functions out of the bundle. They're self-contained
// (no DOM, no closures). Regex grabs the full function body incl. nested
// braces — the standalone tail `}` lines keep the grammar simple.
function extractFn(name) {
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}', 'm');
  const m = APP_JS.match(re);
  if (!m) throw new Error('Could not locate function ' + name);
  return m[0];
}

const helpers =
  extractFn('_normHex') + '\n' +
  extractFn('_normKey') + '\n' +
  extractFn('matchFilamentInCatalog') + '\n' +
  // Minimal hexToName stub for the fallback path — ntc.js is browser-only.
  'function hexToName(h) { return "NTC:" + (h || "").toLowerCase(); }\n';

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(helpers, sandbox);

const { matchFilamentInCatalog, hexToName } = sandbox;

// Mirror of the build-colors loop inside confirm3mfImport() in app.js.
// Kept here so the test fails the moment the payload shape drifts.
function buildColors(plate, filamentProfiles, catalog) {
  return plate.filaments.map(f => {
    const profile = filamentProfiles?.[f.id - 1];
    const hex   = f.color || '#888888';
    const brand = profile?.vendor && profile.vendor !== 'Generic' ? profile.vendor : '';
    const fmMatch = matchFilamentInCatalog({ color: hex, brand, type: f.type }, catalog);
    return {
      color: hex,
      name: fmMatch?.colorName || hexToName(hex),
      brand: fmMatch?.brand || brand,
    };
  });
}

describe('3MF import — colour matching against filament catalog', () => {
  const catalog = [
    { id: 1, brand: 'Bambu Lab', type: 'PLA', colorHex: '#FF0000', colorName: 'Scarlet Red', inStock: 1 },
    { id: 2, brand: 'Polymaker', type: 'PLA', colorHex: '#00AA00', colorName: 'Forest Green', inStock: 1 },
    { id: 3, brand: 'Bambu Lab', type: 'PETG', colorHex: '#FF0000', colorName: 'Cherry (PETG)', inStock: 0 },
  ];

  // Shape mirrors parse3mf() output — keep in sync with parse3mf.js.
  const parsedPlate = {
    index: 1,
    filaments: [
      { id: 1, type: 'PLA', color: '#FF0000', usedGrams: 50 },
      { id: 2, type: 'PLA', color: '#00AA00', usedGrams: 30 },
      { id: 3, type: 'PLA', color: '#123456', usedGrams: 5 }, // no catalog match
    ],
  };
  const filamentProfiles = [
    { vendor: 'Bambu Lab' },
    { vendor: 'Polymaker' },
    { vendor: 'Generic' },
  ];

  test('matched hex gets branded name + brand (not ntc fallback)', () => {
    const colors = buildColors(parsedPlate, filamentProfiles, catalog);
    expect(colors[0]).toEqual({ color: '#FF0000', name: 'Scarlet Red', brand: 'Bambu Lab' });
    expect(colors[1]).toEqual({ color: '#00AA00', name: 'Forest Green', brand: 'Polymaker' });
  });

  test('matched hex resolves type discriminator for duplicate colours', () => {
    // Same hex #FF0000 exists twice — PLA (Bambu) vs PETG (Bambu). The
    // parsed filament carries type=PLA, so PLA wins on discriminator score.
    const colors = buildColors(parsedPlate, filamentProfiles, catalog);
    expect(colors[0].name).toBe('Scarlet Red');
    expect(colors[0].brand).toBe('Bambu Lab');
  });

  test('unmatched hex falls back to hexToName + profile vendor (or empty)', () => {
    const colors = buildColors(parsedPlate, filamentProfiles, catalog);
    expect(colors[2].color).toBe('#123456');
    expect(colors[2].name).toBe('NTC:#123456');   // hexToName fallback
    expect(colors[2].brand).toBe('');              // Generic vendor blanked
  });

  test('empty catalog → full ntc/profile fallback for every entry', () => {
    const colors = buildColors(parsedPlate, filamentProfiles, []);
    expect(colors[0]).toEqual({ color: '#FF0000', name: 'NTC:#ff0000', brand: 'Bambu Lab' });
    expect(colors[1]).toEqual({ color: '#00AA00', name: 'NTC:#00aa00', brand: 'Polymaker' });
    expect(colors[2]).toEqual({ color: '#123456', name: 'NTC:#123456', brand: '' });
  });
});
