# Starfleet Platform Technical Guide

Document date: May 26, 2026

This guide maps the current technical shape of Starfleet Monitor across every
platform in this repository. It is intended for maintainers who need to run,
deploy, debug, or extend the system without guessing which package owns which
behavior.

## Platform Matrix

| Platform | Package | Runtime | Primary host | Purpose |
|---|---|---|---|---|
| Backend API | `packages/backend` | Node.js 20, Express, PostgreSQL, WebSocket | GCP Cloud Run | Auth, ingest, scoring, site resolution, Intune/Graph sync, CSV exports |
| Static web dashboard | `packages/web` | Static HTML/CSS/JS | Vercel, also served by backend `/` | Browser operations dashboard and PWA shell |
| Desktop dashboard | `packages/desktop` | Electron 30, Vite, React 18 | Local desktop build | Operator console with live API/WebSocket data |
| Mobile app | `packages/mobile` | React Native 0.74 | Android app package `com.isomo.starfleet` | Field/admin companion app |
| Shared client | `packages/shared` | TypeScript library | Workspace dependency | API client, WebSocket client, hooks, shared types |
| Windows agent | `packages/agent` | Windows PowerShell 5.1 as SYSTEM | Microsoft Intune Remediations | Laptop and Starlink telemetry collection |
| Database | `packages/backend/migrations` | PostgreSQL | GCP Cloud SQL | Sites, devices, telemetry, usage, health, scores, users, events |

## End-to-End Data Flow

```text
Windows laptops
  StarfleetAgent.ps1 every 5 minutes
  heartbeat, health, latency, usage, Starlink signal, agent-health
        |
        v
POST /ingest/* on GCP Cloud Run backend
  JWT agent scope check, dedup, site resolution, live broadcast
        |
        v
GCP Cloud SQL (PostgreSQL)
  devices, sites, signal_readings, latency_readings, data_usage,
  data_usage_archive, device_health, agent_health_snapshots
        |
        +-----------------------------+
        |                             |
        v                             v
REST /api/* + WebSocket          scheduled services
desktop, web, mobile clients     score, watchdog, weather, orbital, digest
```

## Backend API

The backend lives in `packages/backend` and starts with:

```bash
npm run start --workspace=packages/backend
```

Local development:

```bash
npm run dev --workspace=packages/backend
```

Production start runs migrations first:

```bash
node migrate.js && node server.js
```

Core responsibilities:

| Area | Implementation |
|---|---|
| Runtime schema guard | `server.js` ensures required operational columns/tables exist at boot |
| Auth | `/auth/login`, JWT verification in `middleware/auth.js` |
| Agent ingest | `/ingest/bootstrap-token`, `/heartbeat`, `/signal`, `/latency`, `/health`, `/usage`, `/agent-health` |
| Read API | `/api/sites`, `/api/sites/:id`, `/api/devices`, `/api/agent-health` |
| Admin actions | `/api/agent-tokens`, `/api/intune/sync`, `/api/trigger`, `/api/trigger/site` |
| Intelligence | `/api/intel/space-weather`, `/api/intel/weather`, `/api/intel/coverage/:site_id` |
| Usage | `/api/sites/:id/usage`, `/api/usage/monthly-import` |
| Export | Signal, latency, monthly usage, and archived usage CSV endpoints |
| Live updates | Authenticated WebSocket broadcasts for `device_online`, `signal_update`, `stale_devices` |

Important environment variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Cloud SQL PostgreSQL connection string |
| `JWT_SECRET` | HS256 JWT signing key when RSA keys are not configured |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY` | Optional RS256 signing and verification keys |
| `AGENT_TOKEN_TTL` | Agent-token lifetime, defaults to `365d` |
| `ALLOWED_ORIGINS` | Extra browser CORS origins |
| `DEVICE_ONLINE_HOURS` | Online window, defaults to `72` |
| `DEVICE_STALE_HOURS` | Stale window, defaults to `336` |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | Microsoft Graph managed-device sync and remediation triggers |
| `GRAPH_INTUNE_SYNC_ENABLED` | Set to `false` to disable scheduled Intune sync |
| `GRAPH_INTUNE_SYNC_INTERVAL_MIN` | Managed-device sync interval, minimum 5 minutes |
| `REMEDIATION_POLICY_*` | Intune Device Health Script policy IDs for on-demand actions |
| `OPEN_METEO_ENABLED` | Enables weather correlation |
| `SMTP_*`, `DIGEST_*`, `DASHBOARD_URL` | Weekly digest/email notification plumbing |

## API Client And Shared Hooks

`packages/shared` provides the cross-platform client layer. Apps initialize one
`StarfleetApi` and one `StarfleetWS`, then shared hooks read those references.

| Hook/client | Purpose |
|---|---|
| `StarfleetApi` | Typed REST wrapper with JWT auth and 401/403 handling |
| `StarfleetWS` | WebSocket reconnect client that sends `{ type: "auth", token }` after connect |
| `useFleetSummary` | Fleet-wide site list, counts, stale-device count, anomaly count |
| `useSite` | Site detail plus live signal/stale-device updates |
| `useSignalHistory` | 14-day score history and anomaly/low-data flags |
| `useLatencyHistory` | 14-day daily latency aggregates |
| `useUsageHistory` | Managed plus imported monthly Starlink usage |
| `useDevices`, `useStaleDevices` | Full or stale-only device lists |

The desktop and mobile apps both rely on this package, so API response shape
changes should be reflected in `packages/shared/src/types.ts`.

## Web Dashboard

`packages/web` is a standalone static dashboard/PWA shell. It is served two ways:

| Mode | Path |
|---|---|
| Production static site | Vercel uses `packages/web/vercel.json` and rewrites all routes to `index.html` |
| Same-origin local/backend dashboard | `packages/backend/server.js` serves `packages/web` at `/` |

Security headers are configured in `packages/web/vercel.json`.

## Desktop Dashboard

`packages/desktop` is the Electron operator console. It uses Vite for the
renderer, Electron for the desktop shell, and `@starfleet/shared` for API data.

Run locally:

```bash
npm run dev --workspace=packages/desktop
```

Build locally:

```bash
npm run build --workspace=packages/desktop
```

Primary views:

| View | Current function |
|---|---|
| Overview | Fleet summary, diagnostics action, site selection |
| Starlinks | Starlink/site cards, site actions, monthly usage import |
| Computers | Device inventory, stale/online status, Intune metadata |
| Alerts | Site-change and unresolved issue view |
| Map | Rwanda site map with site selection |
| Site detail | Signal, latency, usage, laptop list, per-device actions |
| Students/Campuses | Placeholder routes for future integrations |

Desktop stores the JWT and API base URL in `localStorage`. The default local API
base is `http://localhost:3000`.

## Mobile App

`packages/mobile` is the canonical React Native app package. The older
`packages/mobile/android` tree is the Android native project mirror and should
not be treated as a separate application owner.

Run Metro:

```bash
npm run start --workspace=packages/mobile
```

Run Android:

```bash
npm run android --workspace=packages/mobile
```

Key screens:

| Screen | Purpose |
|---|---|
| Login | JWT login and API-base selection |
| Overview | Fleet health summary for field/admin use |
| Map | Site map |
| Sites stack | Campus list, site detail, laptop/detail drilldown |
| Starlinks | Starlink/site health view |
| Alerts | Site-change alert list with badge count |
| Settings | Account, session expiry, API base URL, app version, sign out |

The mobile app persists `starfleet_token` and `starfleet_api_base` in
`AsyncStorage`. Push/FCM code is intentionally stubbed until Firebase packages
and `google-services.json` are added.

## Windows Agent And Intune

`packages/agent` contains the production telemetry collector and Intune upload
helpers.

| File | Purpose |
|---|---|
| `StarfleetAgent.ps1` | Runtime agent, scheduled every 5 minutes |
| `detection.ps1` | Intune detection script |
| `remediation.ps1` | Source remediation template |
| `build-intune-remediation.mjs` | Generates one site-scoped upload script |
| `build-intune-remediations.mjs` | Generates one upload script per site |
| `build-intune-discovery-remediation.mjs` | Generates shared discovery remediation for unknown first-boot site |
| `test.ps1` | On-device validation helper |
| `re-sync.ps1` | Manual queue replay helper |

The preferred broad rollout is discovery remediation:

```bash
export STARFLEET_ADMIN_TOKEN="<admin-dashboard-jwt>"
node packages/agent/build-intune-discovery-remediation.mjs
```

The laptop installs with `site_id=0`, reads Starlink identity/GPS when possible,
then exchanges the discovery token through `/ingest/bootstrap-token` for a
site/device-scoped token.

## Deployment Summary

| Layer | Deployment path | Verification |
|---|---|---|
| Backend | Push to `main`, Cloud Run deploys to staging, promote to production on approval | `GET https://api.starfleet.icircles.rw/health` |
| Database | Cloud Run migration Job runs before each deploy | `schema_migrations` includes latest SQL filename |
| Web | Push to Vercel-tracked branch/package | Dashboard loads, auth works, API origin allowed |
| Desktop | `npm run build --workspace=packages/desktop` | Built app opens and reads configured API |
| Mobile | React Native Android build/install | Login, tabs, cached API base, site detail |
| Agent | Intune Remediations | `install_source=intune_remediation`, fresh heartbeat, queue depth 0 |

## Maintenance Rules

- Keep API shape changes synchronized across `packages/backend`, `packages/shared`, desktop, mobile, and web.
- Keep `docs/SYSTEM_REQUIREMENTS.md` aligned with implemented requirements and open decisions.
- Keep `docs/RUNBOOK.md` focused on operational steps and incident response.
- Keep generated Intune artifacts under `dist/intune`; do not commit token-bearing scripts.
- Treat `.env` and generated tokens as secrets. Use `.env.example` only for documented variable names.
- Manage production secrets via GCP Secret Manager, not raw Cloud Run env vars.
- Connection pooling: use `@google-cloud/cloud-sql-connector` with `max_connections` capped relative to Cloud Run instance count.
