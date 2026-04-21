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
