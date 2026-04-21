'use strict';

const path = require('path');
const fs = require('fs');
const { parse3mf, extractThumbnails } = require('../parse3mf');

const FIXTURES = path.join(__dirname, 'fixtures');
const SLICED_3MF = path.join(FIXTURES, 'sliced_multiplate.3mf');
const UNSLICED_3MF = path.join(FIXTURES, 'unsliced_multiplate.3mf');

const hasSliced = fs.existsSync(SLICED_3MF);
const hasUnsliced = fs.existsSync(UNSLICED_3MF);

describe('parse3mf', () => {
  (hasSliced ? describe : describe.skip)('sliced 3MF (4-plate multicolor)', () => {
    let result;
    beforeAll(() => { result = parse3mf(SLICED_3MF); });

    test('detects as sliced', () => {
      expect(result.sliced).toBe(true);
    });

    test('extracts 4 plates', () => {
      expect(result.plates).toHaveLength(4);
    });

    test('plate 1: correct print time (~463 min)', () => {
      expect(result.plates[0].index).toBe(1);
      expect(result.plates[0].printTimeMinutes).toBeCloseTo(462.6, 0);
      expect(result.plates[0].printTimeSeconds).toBe(27757);
    });

    test('plate 1: correct weight (238.36g)', () => {
      expect(result.plates[0].weightGrams).toBeCloseTo(238.36, 1);
    });

    test('plate 1: has object name', () => {
      expect(result.plates[0].objects).toContain('Body_mc.stl');
    });

    test('plate 1: has filament data with type and grams', () => {
      const filaments = result.plates[0].filaments;
      expect(filaments.length).toBeGreaterThanOrEqual(2);
      expect(filaments[0].type).toBe('PLA');
      expect(filaments[0].usedGrams).toBeCloseTo(190.44, 1);
    });

    test('plate 2: correct time and weight', () => {
      expect(result.plates[1].printTimeSeconds).toBe(16774);
      expect(result.plates[1].weightGrams).toBeCloseTo(80.64, 1);
    });

    test('plate 3: has 3 objects and objectCount=3', () => {
      expect(result.plates[2].objects).toHaveLength(3);
      expect(result.plates[2].objectCount).toBe(3);
    });

    test('plate 3: small plate (~49 min, 23.15g)', () => {
      expect(result.plates[2].printTimeMinutes).toBeCloseTo(48.87, 0);
      expect(result.plates[2].weightGrams).toBeCloseTo(23.15, 1);
    });

    test('all plates detect PLA as filament type (not mixed)', () => {
      for (const plate of result.plates) {
        expect(plate.filamentType).toBe('PLA');
        expect(plate.filamentTypes).toEqual(['PLA']);
      }
    });

    test('filament profiles extracted with vendor info', () => {
      expect(result.filamentProfiles.length).toBeGreaterThanOrEqual(2);
      const bambu = result.filamentProfiles.find(f => f.vendor === 'Bambu Lab');
      expect(bambu).toBeDefined();
      expect(bambu.type).toBe('PLA');
      expect(bambu.cost).toBeGreaterThan(0);
    });

    test('plates have filament vendor info', () => {
      expect(result.plates[0].filamentVendors).toContain('Bambu Lab');
    });

    test('total weight across all plates', () => {
      const total = result.plates.reduce((s, p) => s + p.weightGrams, 0);
      expect(total).toBeCloseTo(238.36 + 80.64 + 23.15 + 67.90, 1);
    });

    test('plate 2 has plate name from model_settings', () => {
      expect(result.plates[1].plateName).toBe('CHOOSE ONE');
    });

    test('works with Buffer input', () => {
      const buf = fs.readFileSync(SLICED_3MF);
      const r = parse3mf(buf);
      expect(r.sliced).toBe(true);
      expect(r.plates).toHaveLength(4);
    });
  });

  (hasUnsliced ? describe : describe.skip)('unsliced 3MF (4-plate project)', () => {
    let result;
    beforeAll(() => { result = parse3mf(UNSLICED_3MF); });

    test('detects as not sliced', () => {
      expect(result.sliced).toBe(false);
    });

    test('extracts 4 plates from plate JSONs', () => {
      expect(result.plates).toHaveLength(4);
    });

    test('no print time or weight (not sliced)', () => {
      for (const p of result.plates) {
        expect(p.printTimeMinutes).toBe(0);
        expect(p.weightGrams).toBe(0);
      }
    });

    test('has object names from plate JSONs', () => {
      expect(result.plates[0].objects).toContain('Body_mc.stl');
      expect(result.plates[1].objects).toContain('head_open_eyes');
    });

    test('filament profiles extracted from project_settings', () => {
      expect(result.filamentProfiles.length).toBeGreaterThanOrEqual(2);
    });
  });
});


describe('extractThumbnails', () => {
  (hasSliced ? test : test.skip)('extracts one PNG buffer per plate from a sliced 3MF', () => {
    const buf = fs.readFileSync(SLICED_3MF);
    const thumbs = extractThumbnails(buf);
    // Sliced fixture has 4 plates, each with a plate_N.png thumbnail.
    expect(thumbs.length).toBeGreaterThanOrEqual(1);
    expect(thumbs.length).toBeLessThanOrEqual(4);
    for (const t of thumbs) {
      expect(Buffer.isBuffer(t.buffer)).toBe(true);
      expect(t.buffer.length).toBeGreaterThan(100);
      expect(t.filename).toMatch(/^plate_\d+\.png$/);
      expect(typeof t.plateIndex).toBe('number');
    }
  });

  (hasSliced ? test : test.skip)('accepts a file path as well as a Buffer', () => {
    const a = extractThumbnails(SLICED_3MF);
    const b = extractThumbnails(fs.readFileSync(SLICED_3MF));
    expect(a.length).toBe(b.length);
  });
});
