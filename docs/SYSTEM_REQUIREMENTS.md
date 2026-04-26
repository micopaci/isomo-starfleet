# Isomo Pulse Starfleet Monitor - System Requirements

Document date: April 26, 2026

## 1. Purpose

Starfleet Monitor provides operational visibility for Isomo school connectivity.
It collects laptop health, local network quality, Starlink telemetry, and site
metadata so administrators can understand which schools are online, which
devices are healthy, and where intervention is needed.

## 2. System Scope

The system includes:

| Component | Scope |
|---|---|
| Windows agent | Collects laptop, latency, usage, and Starlink telemetry from managed laptops |
| Backend API | Receives ingest payloads, authenticates users/agents, resolves sites, stores data, and serves dashboard/mobile clients |
| Database | Stores sites, devices, telemetry, usage, health, scores, users, and site change events |
| Dashboard | Provides operations visibility for sites, Starlinks, laptops, charts, and alerts |
| Mobile app | Provides field/admin companion access |
| Intune deployment | Installs and updates the Windows agent through remediation scripts |

Out of scope for this document:

| Item | Notes |
|---|---|
| Starlink account billing management | The platform observes service health but does not manage Starlink billing |
| Intune tenant governance | The platform provides scripts and guidance, but tenant policy ownership remains with the admin |
| Physical installation | Dish placement, power, cabling, and school network layout are operational responsibilities |

## 3. Users And Roles

| Role | Responsibilities |
|---|---|
| Admin | Manage platform access, generate agent tokens, review all sites, acknowledge issues |
| Operations user | Monitor school health, investigate failures, act on site changes and stale laptops |
| Field user | Review site/device status from the mobile app during support visits |
| Managed laptop | Runs the agent as SYSTEM through Windows Task Scheduler |

## 4. Functional Requirements

### 4.1 Site And Starlink Inventory

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-001 | Store school/site records with name, location, district, coordinates, Starlink serial, Starlink UUID, and kit ID | Must | Implemented |
| FR-002 | Return site inventory through authenticated API endpoints | Must | Implemented |
| FR-003 | Support import/update from the Starlink management master sheet | Must | In progress |
| FR-004 | Preserve stable internal site IDs while also storing master sheet IDs | Should | Implemented |

### 4.2 Laptop Agent

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-010 | Run automatically on Windows laptops every 5 minutes | Must | Implemented |
| FR-011 | Report heartbeat with device identity, hostname, OS, model, and manufacturer | Must | Implemented |
| FR-012 | Report battery, disk, and memory health | Must | Implemented |
| FR-013 | Report ping latency percentiles to a configured host | Must | Implemented |
| FR-014 | Report daily network usage deltas | Must | Implemented |
| FR-015 | Queue failed ingest payloads and replay later without double-counting usage | Must | Implemented |
| FR-016 | Report agent health including version, queue depth, last error, and run ID | Must | Implemented |
| FR-017 | Distinguish Intune-managed installs from manual/legacy installs | Must | Implemented |

### 4.3 Starlink Telemetry

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-020 | Read local Starlink gRPC-web diagnostics when `192.168.100.1:9201` is reachable | Must | Implemented |
| FR-021 | Extract GPS coordinates, azimuth, and elevation from diagnostics byte offsets when protobuf decoding is incomplete | Must | Implemented |
| FR-022 | Extract raw Starlink terminal ID in `ut...` format when available | Must | Implemented |
| FR-023 | Send both raw `starlink_id` and normalized `starlink_uuid` to backend | Must | Implemented |
| FR-024 | Continue laptop heartbeat/usage/latency ingest even when Starlink telemetry is unavailable | Must | Implemented |

### 4.4 Site Resolution

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-030 | Resolve site from Starlink UUID inventory when terminal identity is available | Must | Implemented |
| FR-031 | Resolve site from GPS proximity when valid coordinates are available | Must | Implemented |
| FR-032 | Fall back to configured `site_id` when identity and GPS are unavailable | Must | Implemented |
| FR-033 | Avoid false site moves using movement thresholds and event logging | Should | Implemented |

### 4.5 Dashboard And Mobile

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-040 | Show site inventory, online laptop counts, signal metrics, score, and usage | Must | Implemented |
| FR-041 | Show laptop list with health and stale status | Must | Implemented |
| FR-042 | Show site detail with connected devices and latest signal | Must | Implemented |
| FR-043 | Show historical latency, signal, and usage charts | Should | In progress |
| FR-044 | Support mobile field/admin workflows | Should | In progress |

### 4.6 Authentication And Authorization

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-050 | Authenticate dashboard users through `/auth/login` | Must | Implemented |
| FR-051 | Require signed tokens for API access | Must | Implemented |
| FR-052 | Generate site-scoped agent tokens for Intune deployment | Must | Implemented |
| FR-053 | Reject agent ingest when token site scope does not match posted site hint | Must | Implemented |
| FR-054 | Avoid embedding admin tokens in agent or Intune scripts | Must | Required operating practice |

## 5. Non-Functional Requirements

| Category | Requirement |
|---|---|
| Availability | Backend should remain available for laptop ingest and dashboard reads during normal school operations |
| Offline tolerance | Agent must preserve data locally while backend or network is unavailable |
| Idempotency | Retried payloads must not double-count usage metrics |
| Security | Production secrets, JWTs, and generated Intune scripts with real tokens must not be committed |
| Observability | Agent logs and backend health endpoint must provide enough signal for field diagnosis |
| Maintainability | Migrations must be versioned and run automatically in production deploys |
| Portability | Agent must run under Windows PowerShell 5.1 as SYSTEM |
| Privacy | Store operational telemetry required for fleet support, not user content |

## 6. Infrastructure Requirements

### 6.1 Production Services

| Service | Requirement |
|---|---|
| Neon PostgreSQL | PostgreSQL database reachable through `DATABASE_URL` with SSL |
| Railway | Node.js 20 or newer backend runtime with environment variables configured |
| Vercel | Dashboard deployment with API base URL and allowed CORS origin configured |
| Microsoft Intune | Windows Remediation package assigned to test and production device groups |

### 6.2 Backend Runtime

| Requirement | Value |
|---|---|
| Node.js | 20 or newer |
| Package manager | npm/yarn compatible workspace install |
| Start command | `npm start` in `packages/backend` |
| Migration command | `node migrate.js` |
| Health check | `GET /health` returns API and DB status |

### 6.3 Windows Agent Runtime

| Requirement | Value |
|---|---|
| OS | Windows 10/11 managed by Intune |
| PowerShell | Windows PowerShell 5.1 |
| Execution context | SYSTEM |
| Install directory | `C:\ProgramData\Starfleet` |
| Scheduled task | `StarfleetPulse` |
| Frequency | Every 5 minutes |
| Network | Access to backend API and local Starlink dish IP when on site |

## 7. Data Requirements

| Data set | Required fields |
|---|---|
| Sites | ID, master sheet ID, name, district, location, latitude, longitude, Starlink UUID, Starlink serial, kit ID |
| Devices | Windows serial/UUID, hostname, OS, model, manufacturer, site ID, last seen, last ingest success |
| Signal readings | Site ID, device ID, timestamp, latency, SNR, obstruction, drop rate, throughput, GPS |
| Usage readings | Device ID, date, bytes down, bytes up, payload identity |
| Health readings | Device ID, timestamp, battery, disk, RAM |
| Agent health | Device ID, version, queue depth, last error, run ID, last success |
| Site changes | Device ID, from site, to site, distance, evidence, acknowledgement |

## 8. Deployment Requirements

### 8.1 Backend

1. Merge backend changes to the Railway-tracked branch.
2. Railway runs migrations and starts the API.
3. Verify `GET https://api.starfleet.icircles.rw/health`.
4. Verify `/api/agent-tokens` returns `401 Unauthorized` without auth and works with admin auth.

### 8.2 Dashboard

1. Merge frontend/shared changes to the Vercel-tracked branch.
2. Confirm the dashboard uses the production API base URL.
3. Verify login, sites, laptops, and site detail screens.

### 8.3 Agent

1. Generate a site-scoped agent token through the backend.
2. Generate the Intune remediation upload file.
3. Paste the agent token into the generated remediation file.
4. Upload `packages/agent/detection.ps1` and `dist/intune/remediation.ps1`.
5. Configure Intune to run as SYSTEM in 64-bit PowerShell.
6. Assign to the test VM before broad deployment.
7. Confirm `install_source=intune_remediation`, agent version, heartbeat, and no `401` ingest errors.

## 9. Acceptance Criteria

| Area | Acceptance criteria |
|---|---|
| Agent install | Intune creates `C:\ProgramData\Starfleet`, writes config, writes install marker, creates scheduled task |
| Agent ingest | Heartbeat succeeds and updates `last_heartbeat.txt`; queue drains to zero |
| Auth | Agent token is site-scoped and accepted by ingest endpoints; admin login token is not used by agent |
| Starlink identity | Backend maps `ut31...` to stored UUID `31...` and resolves the correct site |
| GPS fallback | Backend can resolve site from coordinates when identity is missing |
| Dashboard | Operators can see current sites, laptops, status, usage, and alerts |
| Production health | Railway health endpoint reports API and DB healthy |

## 10. Key Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Wrong token embedded in Intune script | Agent receives `401 Unauthorized` and cannot ingest | Generate site-scoped agent token, verify logs before broad rollout |
| Starlink GPS disabled | GPS-based site inference stops working | Use Starlink UUID inventory as primary identity fallback |
| Separate Intune platform script remains assigned | Old and new installers can conflict | Use one remediation package and unassign legacy script during testing |
| Generated token-bearing script committed | Credential exposure | Keep `dist/` ignored and review git status before commits |
| Local dish API unreachable from laptop | Starlink metrics missing for that cycle | Continue heartbeat/health/usage ingest and rely on next cycle |

## 11. Open Decisions

| Decision | Owner | Notes |
|---|---|---|
| Agent token rotation interval | Admin/Ops | Current default is long-lived site token; define rotation policy |
| Production Intune grouping | Admin/Ops | Decide school-by-school rollout groups after VM validation |
| Notification recipient model | Admin/Ops | Confirm email/push recipients and acknowledgement workflow |
| Dashboard public URL | Admin/Ops | Confirm final Vercel domain and CORS entry |

