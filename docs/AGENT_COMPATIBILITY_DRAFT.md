# Starfleet Agent Compatibility Draft (v0.1)

Date: 2026-04-25
Scope: Make the Windows laptop agent fully compatible with current `backend`, `shared`, `desktop`, `mobile`, and `web` packages.
Assumption: No router can be inserted between Starlink and LAN. Device-level visibility for unmanaged devices must use endpoint-side or residual methods.

## 1. Current Contract Snapshot (from code)

### 1.1 Agent -> Backend ingest endpoints
- `POST /ingest/heartbeat`
- `POST /ingest/signal`
- `POST /ingest/latency`
- `POST /ingest/health`
- `POST /ingest/usage`

### 1.2 Required payload fields in backend
- Heartbeat requires: `device_sn`, `site_id`
- Signal requires: `device_sn`, `site_id`
- Latency requires: `device_sn`, `site_id`, `p50_ms`, `p95_ms`
- Health requires: `device_sn`, `site_id`
- Usage requires: `device_sn`, `site_id`, `date`

### 1.3 Auth model in code today
- All ingest endpoints are JWT-protected (`Authorization: Bearer <token>`).
- Backend currently accepts token, but does not enforce token `site_id` against payload `site_id`.
- Agent token generator exists (`packages/backend/scripts/generate_agent_token.js`) and includes claims:
  - `role: "agent"`
  - `site_id: <id>`

### 1.4 Device liveness logic consumed by product UIs
- `devices.last_seen` is updated by heartbeat.
- Device status in API:
  - `online`: `last_seen > now - 10m`
  - `offline`: `last_seen > now - 15m`
  - `stale`: older than 15m
- Watchdog cron broadcasts stale devices every 10 minutes.

### 1.5 Data usage logic consumed by product UIs
- Agent computes daily deltas from Windows adapter counters.
- Backend accumulates `bytes_down` and `bytes_up` in `data_usage` per `(device_id, date)`.
- Site-level ranking uses `site_data_today` view (sum of all device usage rows for site/date).

## 2. Compatibility Goals (target state)

1. Agent payloads remain valid under current backend API with zero schema break.
2. Agent identity is stable enough for device continuity across reinstalls/BIOS edge cases.
3. Usage metrics are deterministic and auditable even across reboot/counter reset scenarios.
4. Queue/replay is safe against duplicate data inflation.
5. Site assignment behavior is explicit and secure (token scope vs GPS override rules).
6. Agent output supports existing UI expectations without frontend schema changes.

## 3. Known Gaps That Affect Full Compatibility

1. No ingest idempotency key today.
- Risk: queue replay can over-count usage if duplicate payloads are accepted.

2. No token-to-site enforcement on ingest.
- Risk: a valid agent token can submit payload with a different `site_id`.

3. Usage source ambiguity.
- Current logic sums all adapter counters from `Get-NetAdapterStatistics`.
- Needs final policy for virtual adapters, VPN adapters, disconnected adapters, and reset events.

4. No first-class unmanaged-device accounting path.
- Without router/gateway telemetry, unmanaged clients cannot be identified per-device with certainty.
- Only residual estimation is possible if total Starlink usage is imported.

5. No explicit ingest schema versioning.
- Current payloads are implicit contract; no `schema_version` marker.

## 4. Proposed Agent v1.1 Contract (draft)

### 4.1 Envelope fields for every ingest payload
- `schema_version`: `"1.1"`
- `sent_at_utc`: ISO timestamp generated at send time
- `collected_at_utc`: ISO timestamp of metric collection
- `agent_version`: semantic version string
- `run_id`: UUID for one execution cycle
- `payload_id`: UUID unique per endpoint payload (idempotency candidate)

### 4.2 Identity fields
- `device_sn` remains primary backend key.
- Add optional `device_guid` (stable UUID persisted in `device.json`) for future migration.
- Add optional `windows_sid_hash` (if security policy allows) for collision detection.

### 4.3 Usage payload hardening
- Keep existing required fields:
  - `device_sn`, `site_id`, `date`, `bytes_down_delta`, `bytes_up_delta`
- Add optional diagnostics:
  - `adapter_policy`: `"all_up_adapters" | "default_route_only" | "allowlist"`
  - `adapter_count_included`
  - `counter_reset_detected` (boolean)
  - `sample_window_sec`

### 4.4 Replay/idempotency behavior
- Send `payload_id` header or body field.
- Backend should reject duplicate `payload_id` for same endpoint+device within retention window.
- Queue replay should be at-least-once transport but exactly-once write at backend.

## 5. Unmanaged Device Usage Strategy (No Router Constraint)

Because no inline router is possible, exact unmanaged per-device usage is not available from laptops alone.

### 5.1 Practical approach
1. Keep laptop agent usage as ground truth for managed devices.
2. Ingest site-level total usage from Starlink portal export/API if available.
3. Compute residual:
- `unmanaged_estimated = starlink_total_site_usage - sum(managed_laptop_usage)`
4. Surface residual as `Unmanaged/Unknown` bucket.

### 5.2 Data model extension (draft)
- New table: `site_usage_total` (`site_id`, `date`, `bytes_total`, `source`, `imported_at`).
- Derived view: `site_usage_residual_today`.
- UI: show Managed, Estimated Unmanaged, and Unattributed delta.

## 6. Implementation Queue (Agent-first)

### P0
1. Add envelope metadata (`schema_version`, `agent_version`, `run_id`, `payload_id`) in `StarfleetAgent.ps1`.
2. Add backend ingest validation for optional new fields and safe ignore for old clients.
3. Decide and enforce adapter selection policy for usage computation.
4. Add token site-scope enforcement (or explicit exception policy) in ingest routes.

### P1
1. Add ingest idempotency key handling in backend.
2. Add queue replay observability: queue depth, oldest queued age, replay success/fail counters.
3. Add structured logs from agent with endpoint-level result codes.

### P2
1. Add portal total-usage importer path for residual unmanaged estimate.
2. Add UI panel for managed vs unmanaged estimated usage.
3. Add operational runbook for token rotation and site re-assignment.

## 7. Questions Required To Finalize Agent Compatibility

Please answer these so we can lock the final agent spec before coding.

### 7.1 Identity and site assignment
1. Should site assignment be strictly token-bound (`token.site_id` must equal payload `site_id`) or can GPS override site assignment?
2. If GPS override is allowed, should it require an admin-approved allowlist of destination site IDs?
3. Do you want one token per site, one token per device, or one token per deployment batch?
4. What token TTL do you want in production (for example 30d, 90d, 365d)?
5. Should expired tokens fail closed immediately, or allow a temporary grace period?

### 7.2 Usage accounting policy
6. For `Get-NetAdapterStatistics`, should we include:
- only adapters that are `Up`,
- only default-route adapter,
- or an explicit allowlist (Ethernet/Wi-Fi only)?
7. Should VPN/tunnel/virtual adapters always be excluded?
8. On counter reset or wrap-around, should we:
- drop that cycle,
- clamp to zero,
- or emit a reset event and continue?
9. Should usage be sampled every 5 min as now, or different interval?
10. Should we retain local per-adapter snapshots for audit/debug?

### 7.3 Unmanaged usage and portal data
11. Can we access Starlink portal data via API, CSV export, or manual upload only?
12. If manual upload is needed, who performs it and how often (daily, weekly)?
13. Should unmanaged usage be shown as one residual bucket, or split by confidence (high/low confidence estimate)?
14. Do you need alerts when unmanaged estimated usage exceeds threshold?
15. What threshold logic do you want (absolute GB/day, percentage of total, or both)?

### 7.4 Agent runtime and deployment
16. Is Intune the only deployment path, or do we need standalone MSI/ZIP install support?
17. Should the scheduled task stay at 5 min, or be dynamic by policy?
18. Do you require proxy support for school networks?
19. Do you require certificate pinning or custom CA support for backend TLS?
20. Should the agent auto-update itself, or only via Intune remediation rollout?

### 7.5 Observability and supportability
21. Where should agent logs be centralized, if anywhere (local only, backend upload, SIEM)?
22. Do you want a backend endpoint that returns current queue depth and last successful post per device?
23. Should failed payload bodies be retained encrypted on disk for forensic replay?
24. Do you want a dedicated `agent_health` endpoint beyond current heartbeat logic?
25. Should watchdog stale threshold stay 15 min or be configurable per environment?

### 7.6 Compatibility with existing frontend packages
26. Do you want any new UI fields now (agent version, queue depth, last usage sample time)?
27. Should desktop/mobile show explicit `managed` vs `estimated unmanaged` usage lines?
28. Do we need push notifications for agent-specific failures (auth fail, queue growth, stale > X)?
29. Should frontend continue using current status buckets (`online/offline/stale`) or add `unknown`?
30. Do you want site-level uptime to be based on heartbeats instead of signal_readings in the current view definition?

### 7.7 Security and compliance
31. Is storing raw JWT in `agent.config.json` acceptable, or do you require Windows Credential Manager/DPAPI storage?
32. Should device serials be hashed before transport/storage for compliance?
33. Do you require signed PowerShell scripts in production?
34. What is your required data retention period for local queue and logs?
35. Are there any school/partner compliance constraints (for example GDPR-like requirements) we must encode now?

## 8. Recommended Decisions If You Want Fastest Implementation

If you want me to proceed immediately after your answers, I recommend:
1. Token per site with strict site binding and no cross-site writes.
2. Usage policy: include only active physical adapters (Ethernet/Wi-Fi), exclude virtual/tunnel.
3. Add ingest idempotency using `payload_id` within 7-day dedupe window.
4. Keep 5-minute schedule.
5. Add manual daily Starlink total usage import initially, then automate.

## 9. Deliverables After You Answer

I will then implement:
1. Agent payload/schema updates.
2. Backend ingest compatibility and validation updates.
3. Idempotency and usage hardening.
4. Optional residual unmanaged usage pipeline scaffold.
5. Updated docs and verification scripts.

## 10. Decision Register (User Input 2026-04-25)

### 10.1 Confirmed by user
1. Laptops can change sites when replaced.
2. Site change should be confirmed only after location is reported on at least two different days.
3. Retention target: 30 days in primary storage, then backup export for offline keeping.
4. Usage source policy: wireless adapter only.
5. Alerts for unmanaged usage: yes.
6. Unmanaged usage threshold style: GB/day.
7. Deployment paths: Intune and autounattend bootstrap are available.
8. Agent telemetry/log destination: both local and centralized.
9. Backend should expose agent health telemetry (queue depth, etc.): yes.
10. Frontend should show managed vs estimated unmanaged usage: yes.
11. Keep/extend status buckets and include unknown state: yes.
12. Uptime should be heartbeat-based (not signal-based): yes.
13. Device identifier hashing is not required now.
14. No additional compliance constraints were declared.

### 10.2 Recommended defaults pending user confirmation
1. Token scope model: per-site token (recommended), with strict site binding.
2. Cross-site movement rule:
- Allow site move only when GPS evidence is observed on two distinct days and distance threshold passes.
- Record event for admin audit.
3. Expiry behavior: fail closed immediately on token expiry (no grace), but queue and retry after token rotation.
4. Adapter filters:
- Include only active Wi-Fi interface tied to default route.
- Exclude VPN/tunnel/virtual adapters.
5. Counter reset handling:
- Emit `counter_reset_detected=true`.
- Skip usage write for that cycle (prevents false spikes).
6. Sampling interval: keep 5 minutes.
7. Per-adapter audit snapshots: keep minimal local snapshot for 7 days.
8. Site total usage ingestion (if available): monthly manual import initially.
9. Unmanaged presentation: single residual bucket first, then confidence bands later.
10. Idempotency:
- Implement now (P0).
- Deduplication window: 7 days by `payload_id` + `endpoint` + `device`.

### 10.3 Starlink full-usage note (question 11)
1. Current agent already captures dish throughput (down/up bps) through local dish gRPC when reachable.
2. Full account/site usage totals are generally surfaced in Starlink App/Portal for eligible plans, but there is no stable public official API contract in this repo today.
3. Practical path for now:
- Continue current managed-device path.
- Add optional daily site-total import (manual first) and compute unmanaged residual.

## 11. Progress and Status Update (2026-04-26)

### 11.1 Completed in codebase
1. Backend runtime compatibility hardening merged:
- Startup migration guard now runs on boot.
- Missing DB objects for ingest compatibility were added.
- Startup now reports no pending migrations and schema guard completion.
2. Agent ingest transport path remains operational:
- Heartbeat, health, latency, usage, and queue replay path still function.
- No regressions reported for auth flow after recent fixes.
3. Starlink fallback path was expanded:
- Added grpc-web request path to `/SpaceX.API.Device.Device/Handle`.
- Added protobuf parsing path for `dishGetDiagnostics`.
- Added offset-based decoder fallback using observed binary offsets.

### 11.2 Current status (open issue)
1. Starlink dish telemetry fallback is still not reliable on target laptops.
2. Latest field outcome from user validation: direct ad-hoc PowerShell request can extract location, but integrated agent flow still fails in production run.
3. Compatibility status: **PARTIAL**.
- Backend compatibility: **GREEN**
- Agent ingest compatibility: **GREEN**
- Starlink telemetry compatibility without `grpcurl`: **AMBER / IN PROGRESS**

### 11.3 Immediate next actions
1. Align agent request/response handling exactly with the proven working PowerShell snippet (same payload bytes, content decoding path, and extraction order).
2. Add guarded diagnostic logs around binary response length/type and decode branch selected.
3. Re-run on affected laptop and require one successful cycle with non-null lat/lon before marking Starlink fallback as GREEN.

### 11.4 Current turn update (2026-04-26)
1. Agent gRPC-web path now mirrors the working laptop snippet:
- `Invoke-WebRequest` to `http://192.168.100.1:9201/SpaceX.API.Device.Device/Handle`
- byte payload `00 00 00 00 04 82 F7 02 00`
- `application/grpc-web+proto`, `X-Grpc-Web: 1`, and ISO-8859-1 conversion when PowerShell returns response content as a string
- GPS/alignment offset extraction at latitude `96`, longitude `105`, azimuth `144`, elevation `149`
2. Agent no longer locally changes its cached `site_id` from GPS on every cycle when a site is already configured/cached. It reports GPS evidence and leaves reassignment to backend two-day confirmation.
3. Agent now includes optional `starlink_id`, `azimuth_deg`, and `elevation_deg` on `/ingest/signal`.
4. Backend now supports optional `sites.starlink_uuid` and uses `starlink_id`/`starlink_uuid`/`starlink_sn`/`kit_id` as a site hint when GPS is missing or inconclusive.

### 11.5 Starlink ID fallback update (2026-04-26)
1. Backend Starlink identity matching normalizes both forms:
- gRPC value: `ut31c88996-c611791c-599d1851`
- database value: `31c88996-c611791c-599d1851`
2. Neon lookup was verified for Bridge2Rwanda:
- raw gRPC ID `ut31c88996-c611791c-599d1851`
- matched `sites.starlink_uuid = 31c88996-c611791c-599d1851`
- resolved DB site id `41`, mastersheet Site_ID `2`
3. Agent now sends both `starlink_id` and normalized `starlink_uuid` on `/ingest/signal` when the ID is available.
4. Agent gRPC-web fallback now scans raw binary diagnostics for a `ut...` ID, so location can still be inferred from the Starlink inventory if Starlink removes location/GPS fields from the gRPC diagnostic response.
