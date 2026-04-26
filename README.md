# Isomo Pulse Starfleet Monitor

Starfleet Monitor is the Isomo Pulse operations platform for tracking school
connectivity, Starlink health, laptop status, and site-level service quality.
It combines a Neon PostgreSQL database, a Railway-hosted backend API, a
Vercel-hosted dashboard, a React Native mobile app, and a Windows PowerShell
agent deployed through Microsoft Intune.

The platform is built around one practical question: is each school online,
healthy, and receiving the service it should be receiving?

## Current Architecture

```text
Windows laptops / Intune
  StarfleetAgent.ps1
  laptop health, latency, usage, Starlink gRPC-web telemetry
        |
        v
Railway backend API
  auth, ingest, scoring, site resolution, notifications
        |
        v
Neon PostgreSQL
  sites, devices, signal readings, usage, health, scores
        |
        +--------------------+
        |                    |
        v                    v
Vercel dashboard        React Native mobile app
ops visibility          field/admin companion
```

## Repository Layout

| Path | Purpose |
|---|---|
| `packages/backend` | Express API, ingest endpoints, auth, migrations, scoring, notifications, site resolution |
| `packages/desktop` | React/Electron dashboard for fleet operations |
| `packages/mobile` | React Native mobile app |
| `packages/shared` | Shared TypeScript API client, hooks, and types |
| `packages/agent` | Windows PowerShell agent, Intune detection/remediation scripts, diagnostics |
| `docs` | Architecture notes, rollout docs, requirements, trackers |
| `dist/intune` | Locally generated Intune upload artifacts, ignored by git |

## Main Capabilities

| Capability | Current behavior |
|---|---|
| Laptop heartbeat | Registers/updates Windows devices by BIOS UUID or serial and reports hostname, OS, model, manufacturer, and last seen time |
| Laptop health | Reports battery, disk, RAM, and agent health snapshots |
| Latency monitoring | Measures laptop-side ping latency to the configured probe host |
| Usage tracking | Captures daily network byte deltas with idempotent replay protection |
| Starlink telemetry | Reads local Starlink gRPC-web diagnostics for GPS, alignment, and dish identity when reachable |
| Site inference | Resolves the real site from Starlink UUID inventory first, then GPS proximity, then configured fallback |
| Offline queue | Writes failed agent payloads to `C:\ProgramData\Starfleet\queue` and replays later |
| Dashboard visibility | Shows sites, laptops, usage, signal quality, latency, and agent health |
| Notifications | Supports site change events, email/push plumbing, and WebSocket broadcasts |

## Local Development

Install dependencies from the repo root:

```bash
npm install
```

Run backend and desktop together:

```bash
npm run dev
```

Run only the backend:

```bash
npm run backend:dev
```

Run migrations:

```bash
npm run migrate
```

Run the desktop dashboard:

```bash
npm run desktop
```

## Backend Configuration

The backend expects a PostgreSQL database. Production uses Neon.

Start from:

```text
packages/backend/.env.example
```

Important environment variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Neon/PostgreSQL connection string |
| `JWT_SECRET` or `JWT_PRIVATE_KEY` | Signs dashboard and agent tokens |
| `PORT` | API port, defaults to Railway-provided port in production |
| `ALLOWED_ORIGINS` | Extra CORS origins, including the Vercel dashboard domain |
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | Optional Microsoft Graph/Intune integration |
| `SMTP_*` | Optional email notifications and digest delivery |
| `DASHBOARD_URL` | Public dashboard URL used in emails |
| `OPEN_METEO_ENABLED` | Enables weather correlation without an API key |

## Agent Deployment

The Windows agent should be deployed as one Intune Remediation package.

Use:

| Intune field | Value |
|---|---|
| Detection script | `packages/agent/detection.ps1` |
| Remediation script | `dist/intune/remediation.ps1` generated from the builder |
| Run using logged-on credentials | `No` |
| Enforce signature check | `No`, unless scripts are signed |
| Run in 64-bit PowerShell | `Yes` |

Generate the self-contained remediation upload script:

```bash
export STARFLEET_AGENT_TOKEN="<PASTE_SITE_AGENT_JWT_HERE>"
node packages/agent/build-intune-remediation.mjs --site-id 7
```

Use a site-scoped agent token from the production backend, not a dashboard admin
login token. The builder refuses expired, non-agent, wrong-site, or
production-rejected tokens before writing `dist/intune/remediation.ps1`. Do not
commit generated remediation files that contain real tokens.

For the full step-by-step flow, see:

```text
packages/agent/INTUNE_SETUP.md
```

## Production Deployment

| Layer | Production host |
|---|---|
| Database | Neon PostgreSQL |
| Backend API | Railway |
| Frontend dashboard | Vercel |
| Windows agent rollout | Microsoft Intune Remediations |

Typical backend release flow:

1. Commit backend changes to git.
2. Push to the branch Railway tracks.
3. Railway runs migrations through `npm start`, then starts `server.js`.
4. Verify `https://api.starfleet.icircles.rw/health`.

Typical frontend release flow:

1. Commit dashboard/shared changes to git.
2. Push to the branch Vercel tracks.
3. Verify the dashboard can authenticate and read live API data.

## Operational Checks

On a managed Windows laptop:

```powershell
$dir = "C:\ProgramData\Starfleet"
Get-Content "$dir\install_source.json" -ErrorAction SilentlyContinue | ConvertFrom-Json
Get-Content "$dir\agent.log" -Tail 80
Get-Content "$dir\last_heartbeat.txt" -ErrorAction SilentlyContinue
(Get-ChildItem "$dir\queue" -Filter "*.json" -ErrorAction SilentlyContinue).Count
Get-ScheduledTask -TaskName "StarfleetPulse" | Select-Object TaskName, State
```

Good signs:

```text
install_source = intune_remediation
agent_version = 1.2.0
queue count = 0
last_heartbeat.txt is recent
no 401 Unauthorized ingest failures
```

## Key Documentation

| Document | Purpose |
|---|---|
| `docs/SYSTEM_REQUIREMENTS.md` | Functional, technical, deployment, security, and operational requirements |
| `docs/PROJECT_TRACKER.md` | End-to-end project tracker, status, risks, next milestones |
| `docs/SITE_AUTO_DETECTION.md` | Starlink UUID/GPS based site resolution design |
| `packages/agent/README.md` | Windows agent behavior, files, validation, and notes |
| `packages/agent/INTUNE_SETUP.md` | Intune remediation packaging and verification |

## Current Priorities

1. Finish Intune test rollout on the VM using the self-contained remediation.
2. Confirm ingest succeeds with a site-scoped agent token.
3. Confirm Starlink UUID based site inference works when GPS is unavailable.
4. Cleanly separate manual/legacy agent logs from Intune-managed installs.
5. Continue hardening dashboard and operations views for laptop and site health.

## Security Notes

- Keep JWTs and production secrets out of git.
- Use site-scoped agent tokens for laptops.
- Admin login tokens are for dashboard/API administration and should not be
  embedded in Intune scripts.
- Generated files under `dist/intune` are local deployment artifacts and are
  ignored by git.
- Review Railway, Neon, Vercel, and Intune access regularly.
