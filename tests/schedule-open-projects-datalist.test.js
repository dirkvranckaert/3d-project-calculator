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

// Extract a single-line `function NAME(...) { ... }` definition from app.js source.
function extractOneLiner(name) {
  const re = new RegExp('function ' + name + '\\s*\\([^)]*\\)\\s*\\{[^\\n]*\\}');
  const m = APP_JS.match(re);
  if (!m) throw new Error('Could not locate function ' + name);
  return m[0];
}

// Run the real esc()/escAttr() from app.js in a sandbox with a minimal DOM stub
// that reproduces the browser's textContent->innerHTML escaping (& < > only,
// quotes untouched) — so escAttr's quote handling is exercised faithfully.
function makeEscapers() {
  const sandbox = {
    document: {
      createElement() {
        let _t = '';
        return {
          set textContent(v) { _t = v; },
          get innerHTML() {
            return String(_t)
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;');
          },
        };
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(extractOneLiner('esc') + '\n' + extractOneLiner('escAttr'), sandbox);
  return sandbox;
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

  test('the datalist is rendered and populated from openProjects labels (attribute-safe escape)', () => {
    expect(APP_JS).toContain('<datalist id="sp-project-list">');
    expect(APP_JS).toMatch(/openProjects \|\| \[\]\)\.map\(p => `<option value="\$\{escAttr\(p\.label\)\}"><\/option>`\)/);
  });

  test('open projects are fetched with credentials for the shared-auth cookie', () => {
    expect(APP_JS).toMatch(/fetch\(`\$\{plannerPublicUrl\}\/api\/projects`, \{ credentials: 'include' \}\)/);
  });
});

describe('datalist option value — attribute safety (behavioural)', () => {
  test('a label with a double-quote is encoded, round-trips, and does not break out of the attribute', () => {
    const { escAttr } = makeEscapers();
    const label = 'Pro "24 ject';
    const markup = `<option value="${escAttr(label)}"></option>`;
    // The quote is encoded, not left raw inside the attribute value.
    expect(markup).toBe('<option value="Pro &quot;24 ject"></option>');
    // Capture the attribute value up to the first *raw* delimiter quote.
    const attrValue = markup.match(/value="([^"]*)"/)[1];
    // No break-out: the captured value contains no stray raw quote (it is the full value).
    expect(attrValue).not.toContain('"');
    // Decoding recovers the original label unchanged (true round-trip).
    const decoded = attrValue
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
    expect(decoded).toBe(label);
  });

  test('a single-quote in a label is also attribute-safe', () => {
    const { escAttr } = makeEscapers();
    expect(escAttr("O'Neil plate")).toBe('O&#39;Neil plate');
  });
});

describe('free-typed project name survives to the schedule payload', () => {
  test('a name not present in the open-projects list is scheduled unchanged (datalist only suggests)', () => {
    // Evaluate the exact expression the confirm handler uses to derive the
    // payload's `project` field, against a mocked input holding a free-typed
    // name that is NOT one of the open-project suggestions.
    const m = APP_JS.match(/project:\s*(document\.getElementById\('sp-project'\)\?\.value\?\.trim\(\)\s*\|\|\s*null)/);
    expect(m).not.toBeNull();
    const expr = m[1];

    const typed = 'Totally New Project 42';
    const openProjects = [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }];
    // Precondition: the typed name is not a suggestion.
    expect(openProjects.some(p => p.label === typed)).toBe(false);

    const sandbox = {
      document: {
        getElementById: (id) => (id === 'sp-project' ? { value: '  ' + typed + '  ' } : null),
      },
    };
    vm.createContext(sandbox);
    const project = vm.runInContext(expr, sandbox);
    expect(project).toBe(typed);
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
