# Intune Pipeline Review
_Reviewed: April 30, 2026 | Scope: packages/agent/*.ps1, services/graph.js, routes/ingest.js, backend Intune routes_

## TL;DR

The previous Graph blockers have been addressed: `services/graph.js` now uses
`devices.intune_device_id` for Microsoft Graph managed-device calls and the
on-demand remediation path uses the beta
`initiateOnDemandProactiveRemediation` endpoint with policy GUIDs from
`REMEDIATION_POLICY_*` environment variables.

The remaining Intune work is operational validation: configure real policy GUIDs
in production, run one device-level trigger, then run one site-level trigger
after the single-device path is confirmed.

---

## How a Device Gets a Site — End-to-End

There are two supported assignment modes:

| Mode | Use |
|---|---|
| Discovery remediation | Preferred broad rollout when a laptop does not know its school at first boot |
| Site-scoped remediation | Targeted rollout when the Intune group already represents one known school |

Discovery mode installs with `site_id=0`, reads Starlink identity/GPS, then
exchanges the discovery token through `/ingest/bootstrap-token` for a real
site/device-scoped token. Site-scoped mode still bakes a known site ID into the
generated remediation package.

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Intune Admin                                                  │
│    • Creates a Device Group per school (e.g. "ES-Juru-Laptops") │
│    • Targets remediation.ps1 at that group                      │
│    • Sets script param  -SiteId = 7  (the school's row in DB)   │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Intune Service (cloud)                                        │
│    • Runs detection.ps1 on every targeted laptop on a schedule   │
│    • If detection exits 1 → runs remediation.ps1 -SiteId 7 ...   │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. remediation.ps1 (on the laptop, as SYSTEM)                    │
│    • Copies StarfleetAgent.ps1 → C:\ProgramData\Starfleet\       │
│    • Regex-substitutes $SiteId = "SITE_ID_PLACEHOLDER"           │
│                    →  $SiteId = "7"                              │
│    • Registers Scheduled Task: repeat every 5 min, run as SYSTEM │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. StarfleetAgent.ps1 (every 5 min)                              │
│    • device_sn = Get-CimInstance Win32_BIOS .SerialNumber        │
│    • site_id   = 7  (baked in)                                   │
│    • POST /ingest/heartbeat { device_sn, site_id, hostname, ts } │
└─────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. routes/ingest.js → autoRegisterDevice()                       │
│    INSERT INTO devices (windows_sn, site_id, hostname)           │
│    ON CONFLICT (windows_sn) DO UPDATE                            │
│      SET site_id = EXCLUDED.site_id                              │
│    → Device's site is (re)asserted on every heartbeat.           │
└─────────────────────────────────────────────────────────────────┘
```

**Bottom line:** For site-scoped remediation, site assignment is pushed from
Intune to agent config to every ingest payload. For discovery remediation, the
backend resolves the real site from Starlink identity/GPS and returns a
site-scoped token. In both modes, the backend keeps site-scoped agent tokens from
writing data into the wrong school.

---

## Resolved — graph.js uses the Intune device identifier

**File:** `packages/backend/services/graph.js`

Graph calls now read `intune_device_id`, not `windows_sn`. This matches the
`managedDevices/{id}` path requirement and aligns with the Graph managed-device
sync that upserts Intune metadata into `devices`.

## Resolved — On-demand remediation endpoint

**File:** `packages/backend/services/graph.js`

The backend maps internal trigger types to pre-provisioned Intune Device Health
Script policy GUIDs, then calls:

```text
POST /beta/deviceManagement/managedDevices/{id}/initiateOnDemandProactiveRemediation
```

The Graph app registration still needs
`DeviceManagementManagedDevices.PrivilegedOperations.All`.

---

## Non-blocking concerns (ship, but schedule fixes)

| # | Area | Risk | Suggested fix |
|---|------|------|---------------|
| 1 | **JWT in plaintext** on disk (`StarfleetAgent.ps1`) | A non-SYSTEM tool on the same box could read it | DPAPI-encrypt via `ConvertTo-SecureString`; decrypt at run time |
| 2 | **No JWT refresh** | All laptops silently die when token expires | Either 1-year service-account JWT + documented rotation, or `/auth/refresh` endpoint |
| 3 | **Offline queue cap = 1000 files** | ~16h at 5 min × 5 endpoints; a Friday–Monday outage loses telemetry | Raise cap to 3000, or batch multiple payloads per file |
| 4 | **Parallels VMs share BIOS serial** | Colliding serials can merge VM test records | Prefer hardware UUID when BIOS serial is empty or known virtualized |
| 5 | **Payload idempotency coverage** | Mostly handled by `payload_id`, but older queued payloads may lack it | Keep agent and server payload schema aligned; prune old queues before broad rollout |
| 6 | **JWT per-site impersonation** | If one site's token leaks, attacker forges heartbeats for any site | Optional HMAC-sign payload with per-site secret stored in DPAPI blob |
| 7 | **Agent always exits 0** | Scheduled Task never reports failure back to Intune | Track a per-endpoint failure count; exit 2 if >3 consecutive failures |

---

## Files reviewed — status

| File | Verdict |
|------|---------|
| `packages/agent/StarfleetAgent.ps1` | ✅ Solid. Good offline queue, ISO-8601 timestamp, graceful degradation when Starlink dish unreachable |
| `packages/agent/detection.ps1` | ✅ Solid. Uses `ParseExact` with `InvariantCulture` — correctly handles non-English Rwanda Windows installs |
| `packages/agent/remediation.ps1` | ✅ Solid. Validates `$SiteId` is a positive integer before regex-substituting |
| `packages/backend/routes/ingest.js` | ✅ Solid. Agent scope enforcement, dedup, bootstrap-token, signal, latency, health, usage, and agent-health routes are present |
| `packages/backend/services/graph.js` | ✅ Updated. Uses `intune_device_id`, syncs managed-device metadata, and triggers proactive remediation by policy GUID |
