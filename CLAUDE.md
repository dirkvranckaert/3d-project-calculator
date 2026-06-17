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
- **Test-print risk locked to 1** — `is_test_print` plates force `risk_multiplier=1` in the plate PATCH route (a test is one print; a failed one just adds another). Per-test-print `pre_/post_processing_minutes` are user-editable in the Setup & Design tab and drive processing cost; new test prints default to 0/0.

## Coding conventions

- **Code, comments, commits, docs:** English
- **UI text:** English (professional/work tool)
- **Tests:** run `npm test` before claiming done. All tests must pass.
- **No CSS framework** — custom CSS with variables. Do not install Tailwind/Bootstrap.
- **No native `confirm()`** — use custom modal dialogs

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
npm test
```

65+ tests covering the calculation engine and all API endpoints.

## Deploy

Deployed via the shared infrastructure repo: `../infrastructure/apps/project-calculator/deploy.sh`

- **Production port:** 3459
- **Domain:** `3dprojects.app3.be` (NOT `calculator.app3.be` — that subdomain 404s)
- **PM2 name:** `project-calculator`
- **Server:** `app3-node-01` (142.93.105.91)

## Gotchas

- **pm2 cwd caching:** pm2 caches cwd at first start. Delete + restart if you change ecosystem.config.js.
- **Service worker:** network-only — the `fetch` handler is a no-op (always hits the network) and `activate` deletes all caches. No asset caching, so frontend changes ship without a cache-version bump.
- **sharp native binaries:** `sharp` downloads platform-specific binaries on `npm install`. If deploying from a different OS/arch than the server, run `npm install` on the target.
- **SQLite WAL mode:** the `data/` directory must be writable and on a local filesystem.
- **Schema migrations are lazy — they run on the FIRST DB-touching request, not at boot.** `getDb()` defers `bootstrap()`/`migrate()` until first call. The deploy health checks (GET `/login`, plus a dummy POST `/login` that 401s against env-var creds) never touch the DB, so after a deploy a new column/migration is still PENDING until the first real authenticated DB request. Don't conclude "the migration failed" if you inspect the DB right after deploy and the column is missing — load any project page (or run `require('./db').getDb()` once) to apply it.
- **Inspecting the live DB: use a normal (read-write) connection, never `readonly`.** Prod runs WAL. A `readonly` better-sqlite3 connection on a WAL DB only sees the last checkpoint in the main `.db` file and misses everything in `-wal` (recent writes, just-applied migrations) — so a `readonly` `PRAGMA table_info` can show a stale schema, and the main `.db` mtime/size can look old while `-wal` holds the live data. Open RW (do only SELECTs) to see true state.

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

**Actual revenue margin (new, task #352):**
- `VERIFY_VAT_RATE = 0.21` — exported constant, Belgian standard VAT rate. Change here only.
- `netRevenue = actualSellingTotalInclVat / (1 + VERIFY_VAT_RATE)`
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

## Architecture guide

The full house-style spec: `/Users/dirkvranckaert/Documents/personal-assistant/docs/app-architecture-guide.md`
