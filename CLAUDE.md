# 3D Project Calculator — Claude Code Context

## What this is

A web-based cost estimation and pricing tool for 3D printing projects. Part of the Printseed product suite (three apps under APP3 BV). Calculates material costs, processing time, electricity, printer amortisation, applies profit margins, and determines optimal selling prices.

## Who uses it

Dirk (primary), potentially other Printseed users running a 3D printing business. Accessed via browser.

## Tech stack

- **Node 20+**, Express 5, better-sqlite3 (WAL mode), pm2 (fork, single instance)
- **Auth:** session cookie (`pc_session`) with 7-day TTL + shared JWT for cross-app SSO
- **Image processing:** `sharp` for thumbnail extraction from .3mf files
- **Frontend:** vanilla HTML/JS/CSS, service worker, no build step
- **Tests:** Jest 29 + supertest (65+ tests)

## Project structure

```
project-calculator/
├── server.js            # Express app, all HTTP routes, session auth
├── db.js                # SQLite setup, schema, settings helpers
├── calc.js              # Cost calculation engine (pure functions)
├── parse3mf.js          # Extract metadata + thumbnails from .3mf files
├── shared-auth.js       # Cross-app JWT validation (Printseed SSO)
├── lib/
│   └── release-info.js  # Read release.env for version display
├── ecosystem.config.js  # PM2 production config (port 3459)
├── package.json
├── .env                 # ADMIN_USER, ADMIN_PASS, JWT_SECRET (git-ignored)
├── data/                # SQLite DB + uploads (git-ignored)
│   └── uploads/         # Uploaded project photos/thumbnails
├── public/
│   ├── app.js           # Frontend logic
│   ├── sw.js            # Service worker
│   ├── ntc.js           # Name That Color
│   └── heic2any.min.js  # HEIC conversion for iPhone photos
└── tests/
    ├── server.test.js
    ├── calc.test.js
    ├── parse3mf.test.js
    └── release-info.test.js
```

## Key modules

| File | Purpose |
|------|---------|
| `calc.js` | Pure calculation engine: material cost, processing, electricity, printer amortisation, margins, rounding. No side effects, fully testable. |
| `server.js` | Express app with all routes, auth middleware, CORS for cross-app |
| `db.js` | SQLite schema + `getSetting`/`setSetting`/`getAllSettings` helpers |
| `shared-auth.js` | Validates cross-app JWT tokens for Printseed SSO |
| `parse3mf.js` | Extracts metadata and thumbnails from .3mf 3D print files |

## Key decisions

- **Shared auth (JWT)** — all three Printseed apps share a JWT secret for SSO. Configured via `SHARED_AUTH_SECRET` and `SHARED_AUTH_DOMAIN` in `.env`.
- **Calculation engine separated** — `calc.js` contains all cost formulas as pure functions, making them independently testable without HTTP/DB.
- **Schema inline in db.js** — tables created via `CREATE IF NOT EXISTS` at boot.
- **sharp for thumbnails** — `sharp` is used to process images from .3mf files. It requires native binaries (installed automatically via npm).
- **Detail view tabs** — tab state in `currentDetailTab` module variable (`'print'`|`'design'`), default `'print'`; survives `reloadSingleProject`; non-custom projects show no tab bar; toggling Custom off while on design tab resets to `'print'`; "Setup & Design" is a UI label only, DB/routes/keys unchanged.
- **Per-plate total is cost-only** — the per-plate number shown in BOTH the print-project plates list and the test-prints (Setup & Design) tab is raw `totalPlateCost` (material+processing+electricity+printer). Profit **margin is applied only at project level** (`calculateFinalPricing`), never per-plate. Don't add `applyProfitMargins` to any per-plate path. Test prints live in `project_plates` (`is_test_print=1`); `buildTestPrints().computePlateCost` must mirror `calculateProject`'s settings normalization exactly so both tabs agree.
- **`hourly_rate || 40` quirk** — `calculateProject` (and `computePlateCost`) normalize `Number(hourly_rate) || 40`, so an intentional `hourly_rate=0` is silently billed at €40/h (adds processing cost). Kept deliberately for tab-consistency; if changing to honor 0, change BOTH paths together (use a `Number.isFinite` guard, not `|| 40`).
- **All project lookups go through `findProject(id)`** (`public/app.js`) — invariant, not a convenience. It falls back to `detachedProject`, which holds an archived project loaded directly by URL and therefore absent from the `projects` list. Never write a raw `projects.find(p => p.id === ...)`: on an archived detail page it resolves to `undefined`, and the page still renders but is inert (no error, no clue). Writes into `projects` go only through `storeLoadedProject`, which returns the live object — so in-place mutation of that return value also reaches the detached copy. This pair is the whole reason archived detail pages work, and it is easy to break silently.
- **Test-print risk locked to 1** — `is_test_print` plates force `risk_multiplier=1` in the plate PATCH route (a test is one print; a failed one just adds another). Per-test-print `pre_/post_processing_minutes` are user-editable in the Setup & Design tab and drive processing cost; new test prints default to 0/0.

## Coding conventions

- **Code, comments, commits, docs:** English
- **UI text:** English (professional/work tool)
- **Tests:** run `npm test` before claiming done. All tests must pass.
- **No CSS framework** — custom CSS with variables. Do not install Tailwind/Bootstrap.
- **No native `confirm()`** — use custom modal dialogs

## MR & review process (2026-09-24)

Canonical process: `/Users/dirkvranckaert/Documents/personal-assistant/logs/process/mr-review-process.md`.
Supersedes the 2026-07-21 "dev merges, no PR" ship order — this repo now works
through GitHub PRs (§11 "Out of scope — old way": class **autonomous**, PRs
since 2026-09-24). Host: GitHub. Target: PR → `main`. CI: no.

- **Old way** applies (GitHub, not `git.app3.be`): the reviewer returns the
  full review text; the PM relays or acts on it and merges. The dev never
  merges or approves its own PR.
- **Deploy stays Senne's**, unchanged: `../infrastructure/apps/project-calculator/deploy.sh`
  under standing auto-deploy authority, after merge.
- Scoped to `project-calculator`. Do not assume it holds for the other Printseed repos.

## Running locally

```bash
npm install
cp .env.example .env    # ADMIN_USER, ADMIN_PASS, SHARED_AUTH_SECRET, etc.
npm start               # default port 3003
```

Open http://localhost:3003

## Local test server (pm2)

A pm2 entry named `project-calculator` runs the server locally in development mode.

- **pm2 process name:** `project-calculator`
- **Local test port:** no fixed value — **3010 is taken by the Haply app** (persistent, always on). Starting on 3010 causes `EADDRINUSE` / crash-loop. Use a free port instead (e.g. 3011).
- **Config:** `.env` must have `PORT=<free-port>` and `NODE_ENV=development`
- **Prod port on app3-node:** 3459 (set server-side in the ecosystem/.env — unaffected by local config; do not touch)
- **Bare `npm start` default:** 3003 (no `.env` override)

Before picking a local port, verify it is free:
```bash
lsof -nP -iTCP:<port> -sTCP:LISTEN
```

Restart with a specific port (e.g. 3011):
```bash
PATH="/opt/homebrew/bin:$PATH" PORT=3011 pm2 restart project-calculator --update-env
```

To start from scratch (e.g. after cwd change):
```bash
PATH="/opt/homebrew/bin:$PATH" pm2 delete project-calculator
cd /Users/dirkvranckaert/Documents/app3/printseed/project-calculator
PATH="/opt/homebrew/bin:$PATH" PORT=3011 NODE_ENV=development pm2 start server.js --name project-calculator
PATH="/opt/homebrew/bin:$PATH" pm2 save
```

## Tests

```bash
npx jest --runInBand    # serial — less flaky, still not deterministic
npm test                # parallel — flakiest, see below
```

Tests cover the calculation engine and all API endpoints.

**Test totals depend on fixtures — reconcile nothing.** 24 tests are gates on gitignored fixtures (22 in `parse3mf`, 2 in `server`). Dirk's checkout has those fixtures, so there the suite reports **544 passed / 0 skipped**; a fixture-less checkout reports **520 passed / 24 skipped**. Same coverage, different totals — a changed skip count is not a regression signal.

**Coverage stops at the backend.** The Jest suite is effectively backend-only — `public/app.js` frontend code is not covered, and `node --check` catches syntax only. A logic break there (infinite recursion, wrong lookup) passes both gates and ships. Escape hatch, already used by `tests/tags-widget.test.js`, `tests/hours-format.test.js`, `tests/import-3mf-colors.test.js` and `tests/preserved-project-fields.test.js`: extract a **named, DOM-free** function in `public/app.js` and pull it out via `vm` in the test. Anonymous click handlers are unreachable that way — name the function first. Follow this pattern whenever frontend logic needs coverage.

**Parallel runs are flaky (pre-existing, 2026-07-09).** The full parallel `jest` run fails a rotating handful of `server.test.js` cases with `socket hang up` / 404. Cause: the integration suites share one SQLite/WAL test DB + express socket lifecycle across jest's parallel workers.

**Serial is less flaky, NOT deterministic (measured 2026-09-01, release `20260901-200036`).** The shared-DB + socket-lifecycle flake survives `--runInBand`. Full suite on `main`, 5× serial: runs 1, 3, 4 green (544/544); runs 2 and 5 red — 5 failures, then 1. The failing cast rotates across unrelated suites (image ordering, margin-lock reads) and is shaped like infra flake (HTTP 501, `undefined` body fields), not logic errors. The previous release commit `59f1b25`, 5× serial in a throwaway worktree: 4 green, 1 red on yet another unrelated test (`Custom one-off project lines`) — so the flake **predates** the margin-cap merge and was already live in production. Practical rule: reproduce a failure across **several** serial runs before treating it as real, and read a rotating cast of unrelated failing suites as flake, not as a regression from your diff.

**Mechanism (reproduced 2026-07-24):** an aborted or concurrent jest run leaves dirty state in the shared test DB; the *next* run trips over it. Kill a run mid-flight → next run 23 failures → run again 1 failure → run again green. So a red parallel run says more about the previous run than about your diff.

**Sharp edge:** `"test": "jest --verbose"` in `package.json` is still the parallel — i.e. flaky — variant, while the coding conventions above say "run `npm test` before claiming done". Pinning `--runInBand` in the `test` script lines the two up, but only lowers the flake rate — it does not remove it. Real fix (**unassigned**): give each worker its own `DB_PATH`. That is now the fix for the serial flake too, not just the parallel one.

## Deploy

Deployed via the shared infrastructure repo: `../infrastructure/apps/project-calculator/deploy.sh`

- **Production port:** 3459
- **Domain:** `3dprojects.app3.be` (NOT `calculator.app3.be` — that subdomain 404s)
- **PM2 name:** `project-calculator`
- **Server:** `app3-node-01` (142.93.105.91)
- **Auto-deploy is standing-authorised** (Dirk, 2026-07-09): merged + pushed work ships to production without a per-deploy confirmation, unless he asks to hold. This authority starts *after* a reviewer returns `APPROVED` — see "Ship order"; it is not a licence to push unreviewed work. Always push to `origin/main` before deploying — the engine rsyncs the working tree, so an unpushed tree silently ships something `origin` doesn't have.
- rsync-releases pattern (no server-side `git pull`): rsync → `releases/<ts>/` → `npm ci --omit=dev` → flip `current` symlink → pm2 `delete + start` (not restart) → health check `/login` 200 + dummy-creds POST 401. **Auto-rollback on a failed health check**; manual rollback via `deploy.sh --rollback`.
- Prod `.env` and `data/` are symlinked from `shared/` and are never overwritten by a deploy.
- **Static assets sit behind auth — a 302 is not a failed deploy.** A public `GET https://3dprojects.app3.be/app.js` returns **302** (redirect to login), never the file, so you cannot smoke-test new frontend code over plain HTTP. Verify server-side over ssh instead: compare the sha256 of the deployed `public/app.js` against the local one. Don't read a 302 as "the deploy didn't take".
- **A green health check proves almost nothing.** `GET /login` 200 + dummy-creds `POST /login` 401 both run entirely off env-var creds and never touch the DB (see Gotchas: lazy migrations) and never touch the frontend bundle. Green means "the process boots and serves", not "migrations applied" and not "the new `app.js` shipped". **The only real frontend verification is the server-side sha256 of `current/public/app.js` vs the local file.** No cache-bump step is needed — the service worker is network-only.

## Gotchas

- **pm2 cwd caching:** pm2 caches cwd at first start. Delete + restart if you change ecosystem.config.js.
- **Service worker:** network-only — the `fetch` handler is a no-op (always hits the network) and `activate` deletes all caches. No asset caching, so frontend changes ship without a cache-version bump.
- **sharp native binaries:** `sharp` downloads platform-specific binaries on `npm install`. If deploying from a different OS/arch than the server, run `npm install` on the target.
- **SQLite WAL mode:** the `data/` directory must be writable and on a local filesystem.
- **Schema migrations are lazy — they run on the FIRST DB-touching request, not at boot.** `getDb()` defers `bootstrap()`/`migrate()` until first call. The deploy health checks (GET `/login`, plus a dummy POST `/login` that 401s against env-var creds) never touch the DB, so after a deploy a new column/migration is still PENDING until the first real authenticated DB request. Don't conclude "the migration failed" if you inspect the DB right after deploy and the column is missing — load any project page (or run `require('./db').getDb()` once) to apply it.
- **Undefined CSS custom properties fail silently — a whole bug class.** `var(--undefined-token, #f7f7f8)` always resolves to the light fallback, in *every* theme, so the element renders light in dark mode with no error in console, build or tests. Without a fallback the entire declaration is invalid and the property drops, also silently. Four undefined tokens shipped live here (`--bg-muted`, `--bg-subtle`, `--bg-card`, `--red`). Sweep for them by comparing every `var(--x)` reference in `public/app.js`, `public/style.css`, `public/index.html` and `public/login.html` against the tokens actually defined in `style.css`. A token counts as defined only when it is in all three theme blocks: `:root`, the `prefers-color-scheme: dark` media query, and `[data-theme="dark"]`.
- **Inspecting the live DB: use a normal (read-write) connection, never `readonly`.** Prod runs WAL. A `readonly` better-sqlite3 connection on a WAL DB only sees the last checkpoint in the main `.db` file and misses everything in `-wal` (recent writes, just-applied migrations) — so a `readonly` `PRAGMA table_info` can show a stale schema, and the main `.db` mtime/size can look old while `-wal` holds the live data. Open RW (do only SELECTs) to see true state.
- **`esc()` is UNSAFE in HTML attribute context.** `esc()` (`public/app.js`, textContent→innerHTML) escapes only `& < >`, NOT quotes → `value="${esc(...)}"` breaks out on a `"` in the value. For attribute context use `escAttr()` = `esc(s).replace(/"/g,'&quot;').replace(/'/g,'&#39;')`. Datalist option in the schedule dialog uses `escAttr`. KNOWN DEBT: plain `esc()` still used in other `value="${esc(...)}"` sites repo-wide (house convention) — repo-wide attr-safe audit is a pending task, not yet done.

## Files section — sliced vs model 3MF (added 2026-06-17)

- `project_files.is_sliced` (INTEGER, nullable): `NULL`=unknown/non-3mf, `0`=model file (raw, no slice data), `1`=sliced. Set on upload via `parse3mf()` (content-based — presence of `Metadata/slice_info.config`, NOT filename); `backfillSliced()` lazily fills pre-existing `NULL` rows inside `enrichProject` and `GET /files`.
- Frontend (`renderFilesSection`): "Map Plates" / "Schedule Print" render only when `is_sliced===1`; an unsliced 3MF (`===0`) shows a muted `Model file` badge instead. Detection is content-based, so a `.3mf` without `.gcode` in its name can still be sliced (→ buttons).

## Design cost module (added 2026-06-02)

### Settings
- `design_hourly_rate` (default 65): hourly rate for the design-hours sub-table in custom projects. Distinct from `extra_uren_default_rate` (60) which is the fallback for the production Extra Hours section.

### Project flag — `is_custom`
- `projects.is_custom` (INTEGER DEFAULT 0): marks a project as a custom/one-off design commission.
- Toggled via `PATCH /api/projects/:id/custom` (same toggle pattern as archive).
- When `is_custom=1`, the detail view gains a 2-tab bar: "Print Project" (default) contains all production sections; "Setup & Design" contains the design-cost module (design hours, test prints, other costs, totals). When `is_custom=0`, no tab bar is shown.

### Plate flag — `is_test_print`
- `project_plates.is_test_print` (INTEGER DEFAULT 0): marks a plate as a test-print (uploaded via `POST /api/projects/:id/test-print`).
- Test-print plates are **excluded** from `enabledPlates` in `calculateProject` (don't affect unit pricing).
- Their `totalPlateCost` feeds `designCosts.testPrintsSubtotal` when `isCustom=true`.
- Each test-print row in the Design Costs section exposes an inline Printer and Material `<select>` (persisted via `PATCH /api/projects/:projectId/plates/:plateId`). Cost is €0 until both are set.
- Test-print files are excluded from `GET /api/projects/:id/files` (hidden from the regular files section).
- Test-print upload does **not** extract thumbnails or insert `project_images` rows.

### Extra hours flag — `is_design_cost`
- `project_extra_hours.is_design_cost` (INTEGER DEFAULT 0): separates production extra hours (0) from design-cost hours (1).
- `PUT /api/projects/:id/extra-hours` only touches `is_design_cost=0` rows.
- `PUT /api/projects/:id/design-hours` only touches `is_design_cost=1` rows.

### New table — `project_design_extras`
- Free-form one-time cost lines (id, project_id, description, amount, sort_order, created_at).
- Managed via `PUT /api/projects/:id/design-extras`.

### Calc engine
- `calculateDesignCosts({ designHours, testPrints, designExtras })` — pure function, exported.
  - `testPrints`: `Array<{estimated_cost, attachmentBreakdowns: Array<{totalPlateCost}>}>`
  - Returns `{ designHoursSubtotal, testPrintsSubtotal, testPrintDetails, extrasSubtotal, designTotal }`
  - `testPrintsSubtotal = SUM(estimated_cost)` — NOT the computed plate costs.
  - `testPrintDetails`: per-entry `{ estimated, actual, attachmentCount }` for variance display.
- `calculateProject` accepts `testPrints = []` in opts; passes them to `calculateDesignCosts`.
- `calculateProject` returns `designCosts: { designHoursSubtotal, testPrintsSubtotal, testPrintDetails, extrasSubtotal, designTotal }` when `isCustom=true`, else `null`.
- `designTotal` is **never** added to `productionCost`, `totalExclVat`, or `suggestedPrice`.

## What NOT to do

- Do not remove `shared-auth.js` — other Printseed apps depend on cross-app JWT validation
- Do not install CSS frameworks
- Do not use `confirm()` or `alert()`
- Do not commit `.env`, `data/`, or `logs/`
- Do not change the production port (3459) without updating the infrastructure repo
- Do not modify `calc.js` without updating `tests/calc.test.js`

## Shared infrastructure

Deploy scripts, nginx configs, and runbooks live in `../infrastructure/`. That repo's `apps/project-calculator/deploy.sh` is a thin wrapper around `apps/_template/deploy.sh`.

## Design cost module enhancements (2026-06-03)

### projects.design_notes
- `TEXT` column (nullable). Separate from `projects.notes` (Print tab).
- Saved on blur via `saveDesignNotes()` in the Setup & Design tab.
- Included in `PUT /api/projects/:id`, `POST /api/projects`, and `POST /:id/duplicate`.

### project_extra_hours.actual_hours
- `TEXT` column (nullable). Stores actual hours worked (decimal, same unit as `hours`).
- Informational only — not used in cost calculation. `designHoursSubtotal` uses billed `hours * hourly_rate`.
- UI: editable H:MM input in the Design Hours table. Δ column shows `billed - actual` (green=billed>actual, red=billed<actual, muted=empty).
- `commitDesignHours`, `addDesignHourRow`, and `removeDesignHourRow` all preserve `actual_hours`.

### project_test_prints table
- `(id, project_id, description, estimated_cost, sort_order, created_at)` — one row per manual test-print entry.
- `project_plates.test_print_id INTEGER` — nullable FK linking an uploaded plate to its parent test print.
- Orphan handling: `is_test_print=1` plates with `test_print_id IS NULL` are synthesised on read as virtual entries (`isOrphan: true, estimated_cost = computed`). Rendered read-only; deleted via existing plate delete.
- `buildTestPrints(db, projectId, settings)` — server helper; builds `{ testPrints, testPrintPlates }` combining real rows + orphans; called by `enrichProject` and `enrichProjectLite`.

### testPrintsSubtotal = SUM(estimated_cost)
- The test-prints subtotal is the sum of `project_test_prints.estimated_cost`, NOT the sum of attached plate computed costs.
- `attachmentBreakdowns` expose the actual computed cost for each attached .3mf plate (for Δ indicator only).

### New routes (test prints)
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/projects/:id/test-prints` | Create test print entry |
| `PATCH` | `/api/projects/:id/test-prints/:tpId` | Update description/estimated_cost |
| `DELETE` | `/api/projects/:id/test-prints/:tpId` | Delete entry + attached plates |
| `POST` | `/api/projects/:id/test-prints/:tpId/attach` | Upload .3mf attachment (octet-stream) |

Old `POST /:id/test-print` still works for back-compat (creates orphan plate).

### calculateDesignCosts signature change
- Old: `testPrintPlateBreakdowns: Array<{totalPlateCost}>` — computed sum fed subtotal.
- New: `testPrints: Array<{estimated_cost, attachmentBreakdowns}>` — `estimated_cost` feeds subtotal; `attachmentBreakdowns` populate `testPrintDetails[].actual`.

## Test-print attachment row enhancements (2026-06-03 v2)

### Server-side auto-fill on attach
`POST /api/projects/:projectId/test-prints/:tpId/attach` now auto-fills `printer_id` and `material_id` on the newly created plate after parsing the uploaded .3mf.

- `normName(s)` helper (module-level, before `buildTestPrints`): lowercases, strips `[\s\-_]+`, strips literal `"lab"`. Mirrors the client-side `norm()` function in `app.js`'s Import-3MF dialog.
- `parse3mf(req.body)` is called **once** (result lifted into `parsedResult`); used for both time/grams write and the new auto-fill — not called twice.
- **Printer match:** `parsedResult.printerName` → `normName` → fuzzy `includes` against all rows in `printers` table → `UPDATE project_plates SET printer_id`. NULL on no match (current behaviour preserved).
- **Material match:** `parsedResult.plates[0].filamentType` (skipped if null or `"Mixed"`) → `toLowerCase()` → match against `materials.material_type` using `mt.includes(ft) || ft.includes(mt.split(/\s/)[0])` → `UPDATE project_plates SET material_id`. NULL on no match.
- Both writes are wrapped in the existing best-effort try/catch — a parse failure leaves printer and material as NULL.
- Auto-fill is **not** added to the legacy `POST /:id/test-print` route.

### buildTestPrints now surfaces print_time_minutes, plastic_grams, file_id, filename
The `attachmentBreakdowns` array (both real and orphan entries) now includes:
- `print_time_minutes` — from `project_plates.print_time_minutes`
- `plastic_grams` — from `project_plates.plastic_grams`
- `file_id` — from `project_files WHERE plate_id = ? LIMIT 1` (null if no file row)
- `filename` — from the same file row (null if no file row)

### Read-only time · grams caption in the Estimated column
Client (`renderDesignCostSection` attachment sub-row): the Estimated `<td>` (previously empty) now shows a muted non-editable `<span>` with `fmtTime(ab.print_time_minutes || 0) · fmtGrams(ab.plastic_grams || 0)` when either value is non-null. Rendered only as a caption — not an `<input>`.

### Per-attachment download link
Client: each attachment sub-row's last `<td>` (the Remove-button cell) now also contains a download icon `<a href="/api/files/${ab.file_id}/download" …>` placed **before** the Remove button, using the existing `/api/files/:id/download` route. The cell gets `white-space:nowrap`. No new CSS. `ab.file_id` null → no link rendered.

### Main Files list still excludes test-print files (intentional)
`GET /api/projects/:id/files` filters `pp.is_test_print = 0` — unchanged. Test-print files appear **only** via the per-attachment download link, not in the main Files section.

## Production Verification Tool (added 2026-06-03)

### Purpose
Ephemeral spot-check from a project detail page: upload one or more .3mf files, assign printer and material, enter processing time and packaging costs, and see whether the actual batch cost per sellable unit is above or below the reference production cost and selling price. Nothing is persisted.

### Calc engine — `calculateVerification(opts)` (updated task #352)
Pure function exported from `calc.js`. Orchestrates batch cost independently of `calculateProject` (no project, no DB).

**Cost model (as of task #352):**
- `printingCost` = Σ per-plate `calculatePlateCosts(plate, printer, material, s)` with `pre/post = 0` (machine amortisation + electricity + plastic only, **no time component**)
- `postProcessingCost` = `((preProcessingMinutes + postProcessingMinutes) / 60) * hourlyRate`
- `suppliesCost` = Σ `price_excl_vat * quantity`
- `totalBatchCost` = `printingCost + postProcessingCost + suppliesCost`
- `totalPieces` = Σ `items_per_plate` across **all** plates (multi-file × multi-plate aggregation)
- `sellableUnits` = `Math.floor(totalPieces / itemsPerSet)`
- `actualCostPerUnit` = `totalBatchCost / sellableUnits` (Infinity when 0 sellable)

**Actual revenue margin (task #352; VAT source fixed 2026-07-09):**
- VAT rate comes from the `vat_rate` **setting** (percentage, e.g. `21`), same source as `calculateProject`. The old hardcoded `VERIFY_VAT_RATE = 0.21` constant is **removed** — do not reintroduce it.
- `netRevenue = actualSellingTotalInclVat / (1 + vat_rate / 100)` — note `/100`: setting is a percentage, not a fraction.
- `absoluteMargin = netRevenue - totalBatchCost`
- `marginPct = absoluteMargin / netRevenue * 100`
- `actualMarginOnBatch = null` when `actualSellingTotalInclVat` is 0 or not provided.

**opts:**
- `plates` — array of enriched plate objects with embedded `printer_purchase_price`, `printer_earn_back_months`, `printer_kwh_per_hour`, `material_price_per_kg`, `print_time_minutes`, `plastic_grams`, `items_per_plate`
- `preProcessingMinutes`, `postProcessingMinutes` — batch-level (all plates combined)
- `hourlyRate` — €/h for time cost
- `supplies` — `Array<{price_excl_vat, quantity}>`
- `itemsPerSet` — pieces per sellable unit
- `projectProductionCost`, `projectSellingPrice` — reference values passed in from the frontend
- `actualSellingTotalInclVat` — Dirk's actual invoice total for the batch, incl. 21% VAT (optional; 0 = skip margin block)
- `settings` — for `electricity_price_kwh` and `margin_green/orange_pct`; `risk_multiplier` defaults to 1; `material_waste_grams` defaults to 0

**Returns:**
`{ plateCosts, totalMachineCost, printingCost, timeCost, postProcessingCost, suppliesCost, totalBatchCost, totalPieces, sellableUnits, actualCostPerUnit, vsProductionCost, vsSellingPrice, actualMarginOnBatch }`

`printingCost` and `totalMachineCost` are identical (aliases). `postProcessingCost` and `timeCost` are identical (aliases). Kept for backward compatibility.

Each `vs*` comparison: `{ reference, delta (reference − actual; positive = cheaper), deltaPct, sign ('+'/'-'), indicator ('green'/'red') }`.

`actualMarginOnBatch`: `{ actualSellingInclVat, netRevenue, absoluteMargin, marginPct, indicator }` or `null`.

### Backend — `POST /api/projects/:projectId/verify-batch`
Sits behind `requireAuth`. No persistence.

**Body:** `{ plates: Array<{printer_id, material_id, print_time_minutes, plastic_grams, items_per_plate}>, preProcessingMinutes, postProcessingMinutes, hourlyRate, supplies, itemsPerSet, projectProductionCost, projectSellingPrice, actualSellingTotalInclVat? }`

Route looks up printer and material from DB, calls `resolveKwh`, calls `calc.calculateVerification`, returns the result.

### Frontend (updated task #352)
- **State (new):** `verifyActualSelling` — Dirk's actual batch selling price incl. VAT (reset to 0 in `openVerifyModal`).
- **Multi-plate data model:** `verifyPlates` entries are now `{ filename, parsedResult, printerId, materialId, plateItems: number[] }`. `plateItems[i]` is the editable item count for `parsedResult.plates[i]`. Previously `itemsPerPlate` (single number, first plate only) — that was the bug.
- **Per-plate breakdown table:** one file-level row (printer + material selects) followed by per-plate sub-rows (read-only print time + weight, editable item count). Header columns: File/Plate, Printer, Material, Print time, Weight, Items.
- **"Total items in print file(s)":** summary line below the table showing Σ of all `plateItems` values across all files.
- **"My Actual Selling Price" input:** new form group added to the modal; label "Whole batch, incl. VAT (€)"; stored in `verifyActualSelling`; sent as `actualSellingTotalInclVat` in the POST body.
- **`verifySetPlateItemCount(fileIdx, plateIdx, value)`:** new helper to update `plateItems[plateIdx]` on a given file entry.
- **Payload building:** `verifyRecompute` and `runVerification` now use `verifyPlates.flatMap(...)` to expand each file into per-plate rows — one row per plate per file, using that plate's own `printTimeMinutes` + `weightGrams`. Old code read only `parsedResult.plates[0]`.
- **Label rename:** project's calculated/suggested price was labelled "Actual selling price" — renamed to **"Calculated selling price"** (task #352 requirement).
- **Result display:** `renderVerifyResult` shows printing vs post-processing split in the cost sub-line (replacing Machine/Time/Supplies with Printing/Post-proc/Supplies). When `result.actualMarginOnBatch` is non-null, a prominent block with net revenue, absolute margin, and margin % is rendered above the comparison grid.
- **`resolveKwh(db, printerId, materialType)`:** extracted as a module-scope function in `server.js` (was previously inlined inside `buildTestPrints`). The `buildTestPrints` inner usage was updated to call the module-scope version.

## Material Required + Total Print Time + VAT labeling (2026-07-09)

### VAT model (whole app)
Every **cost input** is excl. VAT. Margins apply on the excl. base. VAT applied **once**, at the end → suggested/actual selling price is **incl. VAT**. `projects.actual_sales_price` and the Verify "actual selling total" are incl. VAT (both divided by `1 + vat_rate/100`). All money inputs, table headers, section totals and summary cards carry an explicit `excl. VAT` / `incl. VAT` label. Deliberately unlabeled: per-plate cost columns (cards above already say it), gram-only figures, catalog-picker dropdown prices.

**Invariant — adjacent big numbers must share one VAT base.** The labeling rule is not cosmetic. An unlabeled large amount sitting next to a card that says "(INCL. VAT)" invites the reader to add across two different VAT bases; that is exactly how the "wrong price" report on project 20 arose (a €539,83 incl. figure added to a €200 excl. figure — no calculation bug). New summary cards: big amount **incl. VAT**, excl. underneath, per-item lines showing both bases.

**Data pitfall — setup/design amounts entered 2026-06-02 … 2026-07-09 may be wrong data.** The Design Cost Module landed in `4a95168` (2026-06-02); the `(excl. VAT)` labels on the design input fields only landed in `218dcdc` (2026-07-09). Code always treated those amounts as excl. VAT, but during that window the form never said so — so a value may have been typed as incl. VAT. Since the labeling fix this shows up loudly (the card renders a visibly too-high incl. amount) instead of computing quietly wrong. When an old project's setup/design cost looks off, check this first: it is a **data correction, not a code fix**.

### `materialRequirements` — grams per brand + type + colour
`calc.js` `aggregateMaterialRequirements(enabledPlates, itemsPerSet)`, returned by `calculateProject`. Enabled non-test plates only (`enabled && !isTestPrint`), same filter and same `(totalPlasticGrams / items_per_plate) × itemsPerSet` scaling as Material Cost.

- **The plate total is authoritative.** Per-filament `used_g` values only set the **ratio** by which a plate's grams split across colours (`plateGrams × grams_i / Σgrams`). So purge/flush/rounding waste can never drift the cost total, and Σ colour grams === plate `plastic_grams` by construction.
- **Two DB shapes coexist** (capture-only rollout, no backfill — Dirk's call 2026-07-09):
  - `project_plates.colors[]` **with** `grams` → one row per colour.
  - `colors[]` **without** `grams` (legacy plates) → single row keyed on `material_id`, old behaviour. Never divided evenly, never dropped. Rendered with a hatched placeholder swatch + "re-import this plate to split by colour" tooltip.
  - Old plates only gain the split when their .3mf is **re-imported**.
- Grams captured at import in `public/app.js` (`colors.map` in both the import path and the planner path — keep the two in sync). `parse3mf.js` has always produced `filaments[].usedGrams`; it used to be discarded.
- Sort order: `materials.material_type` → `materials.name` → colour name → `colorHex`. Null keys sort after named ones (`nullRank`), so a type never fragments.
- Spool estimate uses `materials.roll_weight_g` (default 1000) and is only shown from ≥0.1 roll.

### `totalPrintTimeMinutes`
`calc.js` `calculateTotalPrintTime(plates, itemsPerSet)`, rendered as a 5th summary card. Enabled non-test plates only.

**Plate-print count is `Math.ceil(itemsPerSet / items_per_plate)`** — a partly-filled final plate still runs a full print (100 items @ 8/plate = 13 prints, not 12.5). This **deliberately diverges** from grams/cost, which scale linearly. Dirk confirmed 2026-07-09.

### `fmtTime`
Single shared helper (`public/app.js`). ≥24h → `Dd Hh Mm` with zero components dropped (`485h 46m` → `20d 5h 46m`, `48h` → `2d`). <24h unchanged. `formatHoursMinutes` (H:MM rate inputs) is a separate concern — leave it alone.

## Schedule dialog → planner (items + project datalist)

- **X-Schedule payload** sends per-plate `items: pl.objectCount ?? null` (planner import sets `job.items`).
- **`#sp-project`** in the schedule dialog is free-text AND offers a `<datalist>` of OPEN planner projects, fetched via `GET ${plannerPublicUrl}/api/projects` (`credentials:'include'`, fail-soft → `[]` on any error; filter `status !== 'closed'`). Datalist options use `escAttr` (see Gotchas).
- Planner side needs no change — `GET /api/projects` already CORS-allowed for the calculator origin.

## Target-margin cap — exclusive 100% (2026-09-01, merge `a444769`, release `20260901-200036`)

- **Cap is an exclusive 100, not 95.** `calc.js` `MAX_MARGIN_PCT = 100`, exposed as `maxReachableMarginPct()`; HTML/UI inputs use `max="99.99" step="0.01"`.
- **The bound is mathematical, not stylistic.** Margin is an ex-VAT **revenue** margin: `priceExVat = productionCost / ((100 - target) / 100)`. At 100 the denominator is 0 → infinite price; above 100 → negative price. The old 95 was an arbitrary "sane practical stop well short of the asymptote"; the asymptote at 100 is not arbitrary. Do not lower the cap back to a round number.
- **`>= 100` is rejected everywhere now.** Engine (`calculateLockedPrice` → `reason: 'unreachable'`), **both** server routes — `PUT /api/projects/:id` (project target) and the margin settings incl. `default_target_margin_pct` / `lowest_target_margin_pct` — and both UI entry points. Before this release the server routes had **no cap at all**: enforcement was UI-only, and an over-cap value silently fell back to legacy component pricing.
- **Margin ≠ markup.** Dirk asked for 150; 150 is a **markup** (profit/cost) and cannot exist as a revenue margin. Convert: `margin = markup / (100 + markup) * 100` → 150% markup = 60% margin. A markup-mode input was proposed and Dirk **declined** it (2026-09-01, "nothing for now") — considered and rejected, do not re-propose. Do not "fix" the cap to accommodate a markup number.
- **`tests/margin-cap-mirror.test.js` pins the layers together** — engine ↔ `public/app.js` `MAX_MARGIN_PCT` ↔ the HTML `max=` attribute. A half-applied cap change fails loudly. Change all layers, not one.
- **Migration clamp gotcha (fixed in `0837c39`).** The margin-basis migration (`db.js`) used to clamp **every** converted pin to `MAX - 0.01`, not only the ones reaching the cap: a legal old pin of 82.64% converts to 99.9944% — priceable — and got cut to 99.99%, a silent **44% price drop** on a not-yet-migrated DB. It now clamps only pins that actually reach the cap, and skips a pin whose conversion overflows rather than writing ±Infinity.

## Architecture guide

The full house-style spec: `/Users/dirkvranckaert/Documents/personal-assistant/docs/app-architecture-guide.md`
