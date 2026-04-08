# 3D Project Calculator

A web-based cost estimation and pricing tool for 3D printing projects. Calculate material costs, processing time, electricity, printer amortisation, apply profit margins, and determine optimal selling prices.

## Features

- **Multi-plate projects** — Each project can have multiple print plates/jobs, each with different printers, materials, and settings
- **Per-item cost calculation** — Automatically divides plate costs by items per plate for per-item pricing
- **Set pricing** — Sell products in sets (e.g. set of 3) with automatic price scaling
- **Configurable profit margins** — Independent margins for material, processing, electricity, and printer costs
- **Extra cost items** — Add packaging, stickers, hardware costs; defaults auto-added to new projects
- **Smart price rounding** — Rounds up to .99 (or configurable) for retail-friendly pricing
- **Margin indicators** — Green/orange/red visual indicators based on configurable thresholds
- **Actual vs suggested pricing** — Set your real sales price and see the actual margin
- **Include/exclude plates** — Toggle which plates count toward totals for experimentation
- **Settings management** — Configure printers (with per-material electricity profiles), materials, extra costs
- **Day/night theme** — System, light, or dark mode matching PrintFarm Planner aesthetics
- **Persistent sessions** — Sessions survive server restarts (SQLite-backed)
- **Data export** — Full JSON backup of all settings, printers, materials, and projects

## Calculation Formulas

### Per Plate

| Cost Component | Formula |
|---|---|
| **Material** | `(plastic_g × risk + waste_g) × price_per_kg / 1000` |
| **Processing** | `(pre_min + post_min) / 60 × hourly_rate` |
| **Electricity** | `(print_time_h × risk) × kwh_per_hour × electricity_price` |
| **Printer Usage** | `(print_time_h × risk) × purchase_price / (earn_back_months × 720)` |

### Per Item

Each cost component is divided by `items_per_plate` and summed across all included plates.

### Pricing

1. **Production Cost** = sum of all base costs + extra costs (no margins)
2. **Profit Margins** = each cost component × its margin percentage (additive)
3. **Total excl. VAT** = base costs + profits + extras
4. **Total incl. VAT** = total excl. VAT × (1 + VAT%)
5. **Suggested Price** = rounded up to configured decimal (e.g. .99)
6. **Margin %** = `(suggested_excl_vat - production_cost) / suggested_incl_vat × 100`

## Prerequisites

- **Node.js** >= 18
- **npm**

## Quick Start

```bash
cd project-calculator
cp .env.example .env    # Edit credentials if desired
npm install
npm start               # Runs on http://localhost:3003
```

Default login: `admin` / `changeme`

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ADMIN_USER` | `admin` | Login username |
| `ADMIN_PASS` | `changeme` | Login password |
| `PORT` | `3003` | HTTP port |
| `SHARED_AUTH_SECRET` | *(empty)* | JWT secret for cross-app SSO (optional) |
| `SHARED_AUTH_DOMAIN` | *(empty)* | Cookie domain for SSO, e.g. `.app3.be` (optional) |
| `PLANNER_URL` | *(empty)* | PrintFarm Planner URL for discovery (optional) |
| `FILAMENT_URL` | *(empty)* | Filament Manager URL for discovery (optional) |

## Shared Authentication (Optional)

This app can participate in single sign-on (SSO) with other Printseed tools (PrintFarm Planner, Filament Manager). This is **entirely optional** — without configuration, the app works fully standalone.

### How it works

1. Set the same `SHARED_AUTH_SECRET` in all Printseed apps' `.env` files
2. Set `SHARED_AUTH_DOMAIN=.yourdomain.com` if apps are on subdomains
3. Set sibling app URLs (`PLANNER_URL`, `FILAMENT_URL`) for discovery

When enabled:
- **Login to any app** → sets a shared JWT cookie (`shared_session`) alongside the app's own session cookie
- **Visit another app** → the shared JWT is automatically accepted, no re-login needed
- **Logout from any app** → clears both the app session and the shared JWT
- **`GET /api/discover`** → returns which sibling apps are reachable and their versions

### Discovery

Each app exposes `GET /api/config` (public, no auth) returning:
```json
{ "version": "1.0.0", "appName": "3D Project Calculator", "appId": "project-calculator", "sharedAuth": true }
```

And `GET /api/discover` (requires auth) returning:
```json
{ "sharedAuth": true, "apps": { "planner": { "available": true, "version": "1.0.0", "url": "..." } } }
```

## PM2 (Production)

```bash
pm2 start ecosystem.config.js
pm2 save
```

Production port: `3458` (configure Nginx reverse proxy).

## Configuration (via Settings UI)

### General
- **Hourly Rate** — Labour cost for pre/post-processing (default: €40)
- **Electricity Price** — Cost per kWh (default: €0.40)
- **VAT Rate** — Tax percentage (default: 21%)
- **Price Rounding** — Round suggested price to this decimal (default: .99)

### Margins
- **Material Profit** — % added on top of material cost (default: 200%)
- **Processing Profit** — % added on top of processing cost (default: 100%)
- **Electricity Margin** — % added on top of electricity cost (default: 0%)
- **Printer Cost Margin** — % added on top of printer usage cost (default: 50%)
- **Green/Orange Thresholds** — Margin indicator boundaries (default: 30% / 5%)

### Printers
Each printer has:
- Purchase price, expected prints, earn-back period (months)
- Per-material-type electricity profiles (kWh per hour)

### Materials
Each filament/material has:
- Name, type (PLA, ABS, PETG, etc.), optional colour
- Price per kg (excl. VAT), roll weight

### Extra Costs
Packaging, hardware, shipping items:
- Price (excl. VAT), default-included flag, default quantity

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/login` | Authenticate |
| `POST` | `/logout` | End session |
| `GET` | `/api/settings` | Get all settings |
| `PUT` | `/api/settings` | Update multiple settings |
| `GET/PUT` | `/api/settings/:key` | Get/set single setting |
| `GET/POST` | `/api/printers` | List/create printers |
| `PUT/DELETE` | `/api/printers/:id` | Update/delete printer |
| `GET/POST` | `/api/materials` | List/create materials |
| `PUT/DELETE` | `/api/materials/:id` | Update/delete material |
| `GET/POST` | `/api/extra-costs` | List/create extra cost items |
| `PUT/DELETE` | `/api/extra-costs/:id` | Update/delete extra cost item |
| `GET/POST` | `/api/projects` | List/create projects |
| `GET/PUT/DELETE` | `/api/projects/:id` | Get/update/delete project |
| `POST` | `/api/projects/:id/plates` | Add plate to project |
| `PUT/DELETE` | `/api/projects/:id/plates/:plateId` | Update/delete plate |
| `PUT` | `/api/projects/:id/extras` | Set project extra costs |
| `POST` | `/api/calculate` | Stateless calculation |
| `GET` | `/api/export` | Full JSON backup |
| `GET` | `/api/config` | App version |

## Tests

```bash
npm test
```

65 tests covering calculation engine and all API endpoints.

## Tech Stack

- **Backend**: Node.js, Express 5, better-sqlite3
- **Frontend**: Vanilla JS, CSS custom properties (no build step)
- **Database**: SQLite (file-based, WAL mode)
- **Auth**: Cookie-based sessions persisted in SQLite
- **Process Manager**: PM2
