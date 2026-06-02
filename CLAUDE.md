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

## Tests

```bash
npm test
```

65+ tests covering the calculation engine and all API endpoints.

## Deploy

Deployed via the shared infrastructure repo: `../infrastructure/apps/project-calculator/deploy.sh`

- **Production port:** 3459
- **Domain:** `calculator.app3.be`
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
- When `is_custom=1`, a collapsible "Design Costs" section appears in the detail view between Extra Hours and Supplies.

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
- `calculateDesignCosts({ designHours, testPrintPlateBreakdowns, designExtras })` — pure function, exported.
- `calculateProject` returns `designCosts: { designHoursSubtotal, testPrintsSubtotal, extrasSubtotal, designTotal }` when `isCustom=true`, else `null`.
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

## Architecture guide

The full house-style spec: `/Users/dirkvranckaert/Documents/personal-assistant/docs/app-architecture-guide.md`
