'use strict';

/**
 * Parse a BambuLab/OrcaSlicer 3MF file and extract plate data.
 *
 * 3MF files are ZIP archives. Sliced 3MFs contain:
 *   Metadata/slice_info.config — XML with per-plate print time, weight, filaments
 *   Metadata/plate_N.json     — per-plate metadata (object names, bbox)
 *
 * Un-sliced 3MFs have limited data (no print time or weight).
 */

const fs = require('fs');
const path = require('path');

// Use Node's built-in zlib + manual ZIP parsing to avoid dependencies,
// or we can use the unzip approach via child_process for simplicity.
const { execSync } = require('child_process');

/**
 * Parse a 3MF file buffer or path.
 * @param {string|Buffer} input — file path or Buffer
 * @returns {object} { plates: [...], sliced: boolean, raw: string }
 */
function parse3mf(input) {
  let filePath;
  let tempFile = null;

  if (Buffer.isBuffer(input)) {
    // Write to temp file for unzip
    tempFile = path.join(require('os').tmpdir(), `parse3mf_${Date.now()}.3mf`);
    fs.writeFileSync(tempFile, input);
    filePath = tempFile;
  } else {
    filePath = input;
  }

  try {
    const result = { plates: [], sliced: false, printer_model: null, filaments: [] };

    // Try to extract slice_info.config (only present in sliced 3MFs)
    let sliceInfoXml = '';
    try {
      sliceInfoXml = execSync(
        `unzip -p "${filePath}" "Metadata/slice_info.config" 2>/dev/null`,
        { encoding: 'utf-8', timeout: 10000 }
      );
    } catch { /* not sliced */ }

    if (sliceInfoXml && sliceInfoXml.includes('<plate>')) {
      result.sliced = true;
      result.plates = parseSliceInfo(sliceInfoXml);
    }

    // Also try plate_N.json files for object names (works for both sliced and unsliced)
    for (let i = 1; i <= 20; i++) {
      try {
        const json = execSync(
          `unzip -p "${filePath}" "Metadata/plate_${i}.json" 2>/dev/null`,
          { encoding: 'utf-8', timeout: 5000 }
        );
        const data = JSON.parse(json);
        // Merge object names into plate if we have it
        if (result.plates[i - 1]) {
          if (!result.plates[i - 1].objects.length && data.bbox_objects) {
            result.plates[i - 1].objects = data.bbox_objects
              .filter(o => !o.name?.includes('wipe_tower'))
              .map(o => o.name);
          }
        } else if (!result.sliced) {
          // Un-sliced: create plate entry from JSON
          result.plates.push({
            index: i,
            printTimeSeconds: 0,
            printTimeMinutes: 0,
            weightGrams: 0,
            objects: (data.bbox_objects || [])
              .filter(o => !o.name?.includes('wipe_tower'))
              .map(o => o.name),
            filaments: [],
            layerHeight: data.bbox_objects?.[0]?.layer_height || null,
          });
        }
      } catch {
        break; // No more plates
      }
    }

    return result;
  } finally {
    if (tempFile && fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
  }
}

/**
 * Parse the slice_info.config XML (BambuLab/OrcaSlicer format).
 */
function parseSliceInfo(xml) {
  const plates = [];

  // Split by <plate> blocks
  const plateBlocks = xml.split('<plate>').slice(1);

  for (const block of plateBlocks) {
    const plate = {
      index: 0,
      printTimeSeconds: 0,
      printTimeMinutes: 0,
      weightGrams: 0,
      objects: [],
      filaments: [],
      printerModel: null,
    };

    // Extract metadata values
    const metaRegex = /<metadata key="([^"]+)" value="([^"]*)"/g;
    let match;
    while ((match = metaRegex.exec(block)) !== null) {
      const [, key, value] = match;
      switch (key) {
        case 'index':
          plate.index = parseInt(value) || 0;
          break;
        case 'prediction':
          plate.printTimeSeconds = parseInt(value) || 0;
          plate.printTimeMinutes = Math.round(plate.printTimeSeconds / 60 * 100) / 100;
          break;
        case 'weight':
          plate.weightGrams = parseFloat(value) || 0;
          break;
        case 'printer_model_id':
          plate.printerModel = value;
          break;
      }
    }

    // Extract objects
    const objRegex = /<object[^>]+name="([^"]+)"[^>]*\/>/g;
    while ((match = objRegex.exec(block)) !== null) {
      plate.objects.push(match[1]);
    }

    // Extract filament usage
    const filRegex = /<filament([^>]+)\/>/g;
    while ((match = filRegex.exec(block)) !== null) {
      const attrs = match[1];
      const get = (key) => {
        const m = attrs.match(new RegExp(`${key}="([^"]*)"`));
        return m ? m[1] : null;
      };
      plate.filaments.push({
        id: parseInt(get('id')) || 0,
        type: get('type'),
        color: get('color'),
        usedGrams: parseFloat(get('used_g')) || 0,
        usedMeters: parseFloat(get('used_m')) || 0,
      });
    }

    plates.push(plate);
  }

  return plates;
}

module.exports = { parse3mf };
