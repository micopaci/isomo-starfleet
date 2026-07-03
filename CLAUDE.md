# Starfleet 4.0 — CLAUDE.md

Fleet management platform for **40 Starlink sites** and **236 managed devices** (Windows + Chromebook) across Rwanda. Operated by Isomo EdTech.
All changes are **production-affecting** unless explicitly scoped to a branch.

---

## Monorepo Layout

```
starlink-fleet-monitor/
├── packages/
│   ├── backend/           ← Express API, migrations, cron services
│   │   ├── server.js      ← Entry point, startup migrations, cron scheduling
│   │   ├── db.js          ← PostgreSQL pool (Cloud SQL connector)
│   │   ├── routes/
│   │   │   ├── api.js     ← Read API + admin actions + CSV exports
│   │   │   ├── auth.js    ← /auth/login
│   │   │   └── ingest.js  ← Agent ingest endpoints (JWT-protected)
│   │   ├── services/      ← Cron jobs, Graph client, WebSocket, caching
│   │   ├── middleware/     ← auth.js (JWT verify), ingestRateLimit.js
│   │   ├── migrations/    ← Sequential SQL files (NNN_description.sql)
│   │   └── scripts/       ← One-off admin scripts
│   ├── web/               ← Static HTML/CSS/JS dashboard (Vercel + backend /)
│   ├── desktop/           ← Electron 30 + Vite + React 18 operator console
│   ├── mobile/            ← React Native 0.74 Android app
│   ├── shared/            ← TypeScript: API client, WS client, hooks, types, theme
│   └── agent/             ← PowerShell 5.1 Windows agent + Intune build scripts
├── agents/                ← Claude Code TASK.md definitions
├── docs/                  ← Technical guides, API reference, runbook
├── .github/workflows/     ← Cloud Run deploy pipeline
└── CLAUDE.md              ← You are here
```

### Package Ownership

| Package | Owns | Does NOT own |
|---|---|---|
| `backend` | All DB writes, all external API polling (NOAA, Open-Meteo, Graph, N2YO), WebSocket broadcast, migration files | Frontend rendering, theme tokens |
| `shared` | TypeScript types, API client, WS client, React hooks, theme tokens | DB access, server-side logic |
| `web` | Static dashboard HTML/CSS/JS, Vercel config | API logic, auth middleware |
| `desktop` | Electron shell, Vite renderer, desktop-specific views | API logic, mobile views |
| `mobile` | React Native screens, Android native project | API logic, desktop views |
| `agent` | PowerShell telemetry collection, Intune build scripts | Backend endpoints, DB schema |

---

## Deployment Targets

| Service | Host | Deploy trigger |
|---|---|---|
| Backend API | GCP Cloud Run (`us-central1`) | Push to `main` → GitHub Actions → build + deploy |
| Database | GCP Cloud SQL (PostgreSQL 15) | Migrations run at backend startup |
| Web dashboard | Vercel | Push to Vercel-tracked branch |
| Secrets | GCP Secret Manager | Referenced in Cloud Run service config |
| Container registry | Artifact Registry (`us-central1-docker.pkg.dev`) | Built by GitHub Actions |

---

## Backend Ingest Contract

Agent `POST /ingest/*` endpoints. All require `Authorization: Bearer <agent-token>`.

| Endpoint | Payload shape | Key fields |
|---|---|---|
| `/ingest/heartbeat` | Device identity | `windows_sn`, `hostname`, `os`, `model`, `manufacturer` |
| `/ingest/signal` | Starlink telemetry | `snr`, `pop_latency_ms`, `obstruction_pct`, `download_mbps`, `upload_mbps`, `starlink_id`, `lat`, `lon` |
| `/ingest/latency` | Ping stats | `p50_ms`, `p95_ms`, `spread_ms` |
| `/ingest/health` | Device health | `battery_pct`, `battery_health_pct`, `disk_usage_pct`, `ram_pct` |
| `/ingest/usage` | Daily bytes | `date`, `bytes_down`, `bytes_up`, `payload_id` |
| `/ingest/agent-health` | Agent meta | `queue_depth`, `oldest_queue_age_sec`, `agent_version`, `run_id` |
| `/ingest/bootstrap-token` | Discovery → site-scoped token exchange | `starlink_uuid` or `lat`/`lon` |

---

## Token Scoping Rules

| Token type | `role` claim | `scope` claim | Allowed endpoints |
|---|---|---|---|
| Admin (dashboard login) | `admin` or `user` | — | `/api/*`, `/internal/*` |
| Agent site-scoped | `agent` | `site` | `/ingest/*` (site_id must match) |
| Agent discovery | `agent` | `discovery` | `/ingest/heartbeat`, `/ingest/bootstrap-token` |

**Off-limits:** Never embed admin tokens in agent scripts or Intune remediations. Never commit tokens to git. The `dist/intune/` directory is gitignored for this reason.

---

## Hard Rules

1. **No secrets in code.** All credentials via environment variables or GCP Secret Manager.
2. **Migrations only.** Never edit `schema.sql` directly. Create `packages/backend/migrations/NNN_description.sql`. NNN is a zero-padded sequential number (e.g., `025_add_kp_index.sql`).
3. **Rollback blocks.** Every migration that `DROP`s or `ALTER`s must include a `-- ROLLBACK:` comment block.
4. **No destructive DB ops** without explicit rollback path.
5. **PowerShell 5.1 compatible.** No aliases (`Get-ChildItem` not `ls`). UTF-8 BOM-free. Exit with `exit $LASTEXITCODE`. Intune runs as 64-bit SYSTEM.
6. **Graceful degradation.** External API callers (Graph, NOAA, Open-Meteo, N2YO) must handle `ConnectionError`/`TimeoutError` without crashing the loop.
7. **Structured JSON logs.** Fields: `timestamp`, `level`, `agent`, `event`, `payload`. Levels: `DEBUG` | `INFO` | `WARN` | `ERROR` | `FATAL`.

---

## Environment Variables

### Required

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Cloud SQL PostgreSQL connection string |
| `JWT_SECRET` | HS256 signing key (or `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY` for RS256) |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins |

### Microsoft Graph (Intune sync + remediation triggers)

| Variable | Purpose |
|---|---|
| `GRAPH_TENANT_ID` | Azure AD tenant |
| `GRAPH_CLIENT_ID` | App registration client ID |
| `GRAPH_CLIENT_SECRET` | App registration secret |
| `GRAPH_INTUNE_SYNC_ENABLED` | `false` to disable scheduled sync |
| `GRAPH_INTUNE_SYNC_INTERVAL_MIN` | Sync interval (min 5 minutes) |

### Remediation Policy GUIDs

| Variable | Intune script |
|---|---|
| `REMEDIATION_POLICY_DIAGNOSTICS` | Full device diagnostics |
| `REMEDIATION_POLICY_LOCATION_REFRESH` | GPS/location refresh |
| `REMEDIATION_POLICY_DATA_PULL` | Force data pull |
| `REMEDIATION_POLICY_PING_DISH` | Starlink dish ping |
| `REMEDIATION_POLICY_STARLINK_REBOOT` | Starlink dish reboot |
| `REMEDIATION_POLICY_CHROME_UPDATE` | Force Chrome update (no shared fallback) |
| `REMEDIATION_POLICY_WINDOWS_UPDATE` | Windows Update scan+install (no shared fallback) |

### Defender for Endpoint TVM (see docs/DEFENDER_TVM.md)

| Variable | Purpose |
|---|---|
| `DEFENDER_TVM_SYNC_ENABLED` | `false` to disable vulnerability sync |
| `DEFENDER_TVM_SYNC_INTERVAL_MIN` | Sync interval (default 360, min 30) |
| `DEFENDER_API_BASE_URL` | Geo override (`api-eu`/`api-us`) if global host 403s |
| `SECURITY_NOTIFY_ENABLED` | `false` to disable new-vulnerability email/push |
| `SECURITY_ALERT_MIN_SEVERITY` | Min severity for alert rows (default `high`; zero-days always alert) |
| `OPENAI_API_KEY` | OpenAI/Codex API key for AI mitigation guidance (skipped when unset) |
| `OPENAI_BASE_URL` | Optional OpenAI base URL override (Azure/gateway/proxy) |
| `AI_MITIGATION_ENABLED` | `false` to disable AI guidance |
| `AI_MITIGATION_MODEL` | Model override (default `gpt-4o`) |

### Optional services

| Variable | Purpose |
|---|---|
| `OPEN_METEO_ENABLED` | Enable weather correlation |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | Email notifications |
| `DIGEST_RECIPIENTS`, `DASHBOARD_URL` | Weekly digest |
| `INSTANCE_CONNECTION_NAME` | Cloud SQL instance for `@google-cloud/cloud-sql-connector` |

---

## Coding Conventions

- **Commits:** `[scope] verb: description` — e.g., `[backend] feat: add Kp index threshold alerting`. Do **NOT** append `Co-Authored-By:` trailers to any commit message.
- **Branches:** `agent/<task-name>` for Claude Code sessions
- **Types:** Keep `packages/shared/src/types.ts` in sync with API response shapes
- **No `print()` in Python** — use `logging`
- **No inline `pip install`** — use `requirements.txt` or `pyproject.toml`

---

## Active Claude Code Agents

| Agent | Task file | Purpose |
|---|---|---|
| TLE + Space Weather OSINT Loop | `agents/tle-osint-loop/TASK.md` | Scheduled TLE fetch + Kp correlation |
| Intune Deployment Validator | `agents/intune-validator/TASK.md` | Validate autounattend.xml + .ppkg |

---

## Known Issues / Technical Debt

- `autounattend.xml`: EFI partition placement fails on multi-drive systems (non-deterministic drive enumeration with secondary HDD + NVMe).
- Intune `.ppkg` bulk enrollment: intermittent first-boot failure if OOBE is interrupted before provisioning completes.
- Cloud Run cold starts can cause the first ingest request after scale-to-zero to timeout. `--cpu-boost --no-cpu-throttling` flags mitigate but don't eliminate this.
- Connection pooling: Cloud SQL TCP connection limit (100/instance) can be exhausted when Cloud Run scales multiple instances. Use `@google-cloud/cloud-sql-connector` with capped `max_connections`.
