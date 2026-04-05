'use strict';

const path = require('path');
const fs = require('fs');
const { parse3mf } = require('../parse3mf');

const SLICED_3MF = '/Users/dirkvranckaert/Downloads/0_henriegga_multicolor.gcode.3mf';
const UNSLICED_3MF = '/Users/dirkvranckaert/Library/CloudStorage/GoogleDrive-dirk@app3.be/My Drive/Projects/3DPrinting/Subscriptions/LehaDesign Club/Henriegga The Chocolate Egg-Laying Chicken/0_henriegga_multicolor.3mf';

const hasSliced = fs.existsSync(SLICED_3MF);
const hasUnsliced = fs.existsSync(UNSLICED_3MF);

describe('parse3mf', () => {
  (hasSliced ? describe : describe.skip)('sliced 3MF (henriegga gcode)', () => {
    let result;
    beforeAll(() => { result = parse3mf(SLICED_3MF); });

    test('detects as sliced', () => {
      expect(result.sliced).toBe(true);
    });

    test('extracts 4 plates', () => {
      expect(result.plates).toHaveLength(4);
    });

    test('plate 1: correct print time (~463 min)', () => {
      const p = result.plates[0];
      expect(p.index).toBe(1);
      expect(p.printTimeMinutes).toBeCloseTo(462.6, 0);
      expect(p.printTimeSeconds).toBe(27757);
    });

    test('plate 1: correct weight (238.36g)', () => {
      expect(result.plates[0].weightGrams).toBeCloseTo(238.36, 1);
    });

    test('plate 1: has object name', () => {
      expect(result.plates[0].objects).toContain('Body_mc.stl');
    });

    test('plate 1: has filament data', () => {
      const filaments = result.plates[0].filaments;
      expect(filaments.length).toBeGreaterThanOrEqual(2);
      expect(filaments[0].type).toBe('PLA');
      expect(filaments[0].usedGrams).toBeCloseTo(190.44, 1);
    });

    test('plate 2: correct time and weight', () => {
      const p = result.plates[1];
      expect(p.printTimeSeconds).toBe(16774);
      expect(p.weightGrams).toBeCloseTo(80.64, 1);
    });

    test('plate 3: has 3 objects', () => {
      expect(result.plates[2].objects).toHaveLength(3);
    });

    test('plate 3: small plate (~49 min, 23.15g)', () => {
      const p = result.plates[2];
      expect(p.printTimeMinutes).toBeCloseTo(48.87, 0);
      expect(p.weightGrams).toBeCloseTo(23.15, 1);
    });

    test('all plates have filament type PLA', () => {
      for (const plate of result.plates) {
        for (const f of plate.filaments) {
          expect(f.type).toBe('PLA');
        }
      }
    });

    test('total weight across all plates', () => {
      const total = result.plates.reduce((s, p) => s + p.weightGrams, 0);
      expect(total).toBeCloseTo(238.36 + 80.64 + 23.15 + 67.90, 1);
    });

    test('works with Buffer input', () => {
      const buf = fs.readFileSync(SLICED_3MF);
      const r = parse3mf(buf);
      expect(r.sliced).toBe(true);
      expect(r.plates).toHaveLength(4);
    });
  });

  (hasUnsliced ? describe : describe.skip)('unsliced 3MF (henriegga project)', () => {
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
  });
});
