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

The fixed local test port is **3010** (not 3003). A pm2 entry named `project-calculator` runs the server locally in development mode.

- **pm2 process name:** `project-calculator`
- **Local test port:** 3010
- **Config:** `.env` must have `PORT=3010` and `NODE_ENV=development`
- **Prod port on app3-node:** 3459 (unchanged — do not touch)
- **Bare `npm start` default:** 3003 (no `.env` override)

Restart command:
```bash
PATH="/opt/homebrew/bin:$PATH" pm2 restart project-calculator
```

To start from scratch (e.g. after cwd change):
```bash
PATH="/opt/homebrew/bin:$PATH" pm2 delete project-calculator
cd /Users/dirkvranckaert/Documents/app3/printseed/project-calculator
PATH="/opt/homebrew/bin:$PATH" PORT=3010 NODE_ENV=development pm2 start server.js --name project-calculator
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
- **Service worker:** cache-first strategy. Bump cache version in `public/sw.js` to force updates.
- **sharp native binaries:** `sharp` downloads platform-specific binaries on `npm install`. If deploying from a different OS/arch than the server, run `npm install` on the target.
- **SQLite WAL mode:** the `data/` directory must be writable and on a local filesystem.

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

### Calc engine — `calculateVerification(opts)`
New pure function exported from `calc.js`. Orchestrates batch cost independently of `calculateProject` (no project, no DB).

**opts:**
- `plates` — array of enriched plate objects with embedded `printer_purchase_price`, `printer_earn_back_months`, `printer_kwh_per_hour`, `material_price_per_kg`, `print_time_minutes`, `plastic_grams`, `items_per_plate`
- `preProcessingMinutes`, `postProcessingMinutes` — batch-level (not per plate)
- `hourlyRate` — €/h for time cost
- `supplies` — `Array<{price_excl_vat, quantity}>`
- `itemsPerSet` — pieces per sellable unit; `sellableUnits = Math.floor(totalPieces / itemsPerSet)`
- `projectProductionCost`, `projectSellingPrice` — reference values passed in from the frontend
- `settings` — for `electricity_price_kwh`; `risk_multiplier` defaults to 1; `material_waste_grams` defaults to 0

**Returns:**
`{ plateCosts, totalMachineCost, timeCost, suppliesCost, totalBatchCost, totalPieces, sellableUnits, actualCostPerUnit (Infinity when 0 sellable), vsProductionCost, vsSellingPrice }`

Each `vs*` comparison: `{ reference, delta (reference − actual; positive = cheaper), deltaPct, sign ('+'/'-'), indicator ('green'/'red') }`.

### Backend — `POST /api/projects/:projectId/verify-batch`
Sits behind `requireAuth`. No persistence.

**Body:** `{ plates: Array<{printer_id, material_id, print_time_minutes, plastic_grams, items_per_plate}>, preProcessingMinutes, postProcessingMinutes, hourlyRate, supplies, itemsPerSet, projectProductionCost, projectSellingPrice }`

Route looks up printer and material from DB, calls `resolveKwh` (module-scope helper extracted to avoid duplication with `buildTestPrints`), then calls `calc.calculateVerification` and returns the result.

### Frontend
- **Modal:** `<div id="verify-modal">` added to `index.html`, same `.modal-overlay` + `.modal-header` + `[data-close]` + Escape pattern as other modals.
- **Trigger:** "Verify batch" button in `renderPricingSection()`.
- **State:** `verifyProjectId`, `verifyProjectRef`, `verifyPlates[]`, `verifySupplies[]`, `verifyPreMinutes`, `verifyPostMinutes`, `verifyHourlyRate` in module-level state.
- **Functions:** `openVerifyModal(projectId)`, `renderVerifyModal()`, `verifyHandleFiles(fileList)`, `runVerification()`, `renderVerifyResult(result, ref)` — plus small helpers for plate/supply CRUD.
- **3MF parsing:** each uploaded file is POSTed to `POST /api/parse-3mf` (existing endpoint, no storage); printer and material are auto-matched using the same `norm()` fuzzy logic as the Import 3MF dialog.
- **`resolveKwh(db, printerId, materialType)`:** extracted as a module-scope function in `server.js` (was previously inlined inside `buildTestPrints`). The `buildTestPrints` inner usage was updated to call the module-scope version.

## Architecture guide

The full house-style spec: `/Users/dirkvranckaert/Documents/personal-assistant/docs/app-architecture-guide.md`
