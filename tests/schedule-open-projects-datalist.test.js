'use strict';

/**
 * Coverage for the "suggest open PrintFarm projects" enhancement to the
 * Schedule Print dialog. The wiring lives in public/app.js (browser-only,
 * DOM-bound), so these mix:
 *   - source-level assertions (the same escape hatch the other schedule DOM
 *     tests use) for the datalist markup + the input binding, and
 *   - a behavioural test of fetchOpenPlannerProjects, extracted into a vm
 *     sandbox with a mocked fetch (same pattern as schedule-copies-order).
 *
 * It proves the datalist is populated from the fetched OPEN projects and that
 * closed projects are excluded, and that any fetch error fails soft to [].
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP_JS = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');

function extractFn(name) {
  const re = new RegExp('async function ' + name + '\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}', 'm');
  const m = APP_JS.match(re);
  if (!m) throw new Error('Could not locate function ' + name);
  return m[0];
}

function makeHelper(fetchImpl) {
  const sandbox = {
    plannerPublicUrl: 'https://planner.example',
    fetch: fetchImpl,
    console: { warn() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractFn('fetchOpenPlannerProjects'), sandbox);
  return sandbox.fetchOpenPlannerProjects;
}

describe('schedule dialog — open-project datalist wiring (source)', () => {
  test('the project input is bound to a datalist', () => {
    expect(APP_JS).toContain('id="sp-project" list="sp-project-list"');
  });

  test('the datalist is rendered and populated from openProjects labels (escaped)', () => {
    expect(APP_JS).toContain('<datalist id="sp-project-list">');
    expect(APP_JS).toMatch(/openProjects \|\| \[\]\)\.map\(p => `<option value="\$\{esc\(p\.label\)\}"><\/option>`\)/);
  });

  test('open projects are fetched with credentials for the shared-auth cookie', () => {
    expect(APP_JS).toMatch(/fetch\(`\$\{plannerPublicUrl\}\/api\/projects`, \{ credentials: 'include' \}\)/);
  });
});

describe('fetchOpenPlannerProjects', () => {
  test('returns only OPEN projects, excluding closed ones', async () => {
    const projects = [
      { id: 'a', label: 'Alpha', status: 'open' },
      { id: 'b', label: 'Beta', status: 'closed' },
      { id: 'c', label: 'Gamma', status: 'open' },
    ];
    const fetchOpenPlannerProjects = makeHelper(async () => ({ ok: true, json: async () => projects }));
    const out = await fetchOpenPlannerProjects();
    expect(out.map(p => p.label)).toEqual(['Alpha', 'Gamma']);
    expect(out.some(p => p.status === 'closed')).toBe(false);
  });

  test('fails soft to [] on a non-ok response', async () => {
    const fetchOpenPlannerProjects = makeHelper(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    expect(await fetchOpenPlannerProjects()).toEqual([]);
  });

  test('fails soft to [] when the fetch throws (planner unreachable / CORS)', async () => {
    const fetchOpenPlannerProjects = makeHelper(async () => { throw new Error('network'); });
    expect(await fetchOpenPlannerProjects()).toEqual([]);
  });

  test('tolerates a non-array body', async () => {
    const fetchOpenPlannerProjects = makeHelper(async () => ({ ok: true, json: async () => ({ oops: true }) }));
    expect(await fetchOpenPlannerProjects()).toEqual([]);
  });
});
