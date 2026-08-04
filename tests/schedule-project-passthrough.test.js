'use strict';

/**
 * Coverage for threading the project name into the PrintFarm dispatch.
 *
 * The Schedule Print flow lives in public/app.js (browser-only, DOM-bound), so
 * these are source-level assertions — the same escape hatch the other DOM-only
 * wiring tests in this repo use. They verify:
 *   - the schedule dialog renders a #sp-project input,
 *   - it defaults to the calculator project's own name (editable),
 *   - the X-Schedule payload carries that project through to the planner.
 */

const fs = require('fs');
const path = require('path');

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

describe('calculator -> printfarm project passthrough', () => {
  test('schedule dialog renders an editable project input', () => {
    expect(APP_JS).toContain('id="sp-project"');
  });

  test('project input defaults to the calculator project name', () => {
    expect(APP_JS).toContain('value="${esc(project?.name || \'\')}"');
  });

  test('the X-Schedule payload includes the project', () => {
    expect(APP_JS).toMatch(/X-Schedule[\s\S]*project: document\.getElementById\('sp-project'\)\?\.value\?\.trim\(\) \|\| null/);
  });
});
