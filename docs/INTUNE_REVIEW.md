# Intune Pipeline Review — Pre-Push Audit
_Reviewed: April 18, 2026 | Scope: packages/agent/*.ps1, services/graph.js, routes/ingest.js, scripts/import_devices.js_

## TL;DR

Two **blocking bugs** in `services/graph.js` that would cause every Graph API remediation call to fail silently. Everything else (agent, detection, ingest) is sound. Recommend patching before pushing, then deploying.

---

## How a Device Gets a Site — End-to-End

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

**Bottom line:** Site assignment is pushed from Intune → agent config → every ingest
payload. It's re-asserted every 5 min, so a laptop moved to a different school
will self-correct as soon as its Intune group changes.

---

## Blocker #1 — graph.js uses the wrong device identifier

**File:** `packages/backend/services/graph.js`, lines 102–104 and 142–146

```js
const devRes = await pool.query(`SELECT windows_sn FROM devices WHERE id = $1`, [device_id]);
const intuneDeviceId = devRes.rows[0].windows_sn;  // ← WRONG
```

- `windows_sn` is the **hardware serial** from the BIOS (e.g. `DZT73D3`)
- Microsoft Graph's `managedDevices/{id}` path expects the **Azure device UUID**
  (e.g. `cf0971fc-f7ca-48d5-b8e4-06c54d21d2d3`)
- Migration 006 added an `intune_device_id` column. `scripts/import_devices.js`
  already populates it correctly. `graph.js` simply reads the wrong column.

Every `triggerRemediationScript()` call currently returns 404, and the trigger
poller silently keeps the row as `running` forever.

**Fix:** change the column in both queries from `windows_sn` to `intune_device_id`.

## Blocker #2 — Wrong Graph endpoint for remediation

**File:** `packages/backend/services/graph.js`, lines 107–117

```js
`https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${intuneDeviceId}/runRemediationScript`
```

- `runRemediationScript` is not a real Graph endpoint
- The body `{scriptType: type}` isn't a real parameter either
- Real flow is **two-step**:
  1. Create a `deviceHealthScript` policy in Intune (done once, in the portal)
  2. Call the beta endpoint:
     `POST /beta/deviceManagement/managedDevices/{id}/initiateOnDemandProactiveRemediation`
     with body `{ "scriptPolicyId": "<policy-guid>" }`

**Fix:** map each internal `type` (e.g. `restart-starlink`, `clear-cache`) to a
pre-provisioned `scriptPolicyId`, then hit the beta endpoint. Requires the
Graph app registration to have `DeviceManagementManagedDevices.PrivilegedOperations.All`.

---

## Non-blocking concerns (ship, but schedule fixes)

| # | Area | Risk | Suggested fix |
|---|------|------|---------------|
| 1 | **JWT in plaintext** on disk (`StarfleetAgent.ps1`) | A non-SYSTEM tool on the same box could read it | DPAPI-encrypt via `ConvertTo-SecureString`; decrypt at run time |
| 2 | **No JWT refresh** | All laptops silently die when token expires | Either 1-year service-account JWT + documented rotation, or `/auth/refresh` endpoint |
| 3 | **Offline queue cap = 1000 files** | ~16h at 5 min × 5 endpoints; a Friday–Monday outage loses telemetry | Raise cap to 3000, or batch multiple payloads per file |
| 4 | **Parallels VMs share BIOS serial** | Current seed already has one (`Parallels-7C939B8B3E…`); colliding serials clobber each other's `site_id` on every heartbeat | Fall back to `Win32_ComputerSystemProduct.UUID` when BIOS serial is empty or starts with `Parallels-` |
| 5 | **No payload idempotency** | Replay queue can double-insert `signal_readings` if the network blips mid-response | Client generates a ULID per payload; server-side `UNIQUE(device_id, ingest_ulid)` |
| 6 | **JWT per-site impersonation** | If one site's token leaks, attacker forges heartbeats for any site | Optional HMAC-sign payload with per-site secret stored in DPAPI blob |
| 7 | **Agent always exits 0** | Scheduled Task never reports failure back to Intune | Track a per-endpoint failure count; exit 2 if >3 consecutive failures |

---

## Files reviewed — status

| File | Verdict |
|------|---------|
| `packages/agent/StarfleetAgent.ps1` | ✅ Solid. Good offline queue, ISO-8601 timestamp, graceful degradation when Starlink dish unreachable |
| `packages/agent/detection.ps1` | ✅ Solid. Uses `ParseExact` with `InvariantCulture` — correctly handles non-English Rwanda Windows installs |
| `packages/agent/remediation.ps1` | ✅ Solid. Validates `$SiteId` is a positive integer before regex-substituting |
| `packages/backend/routes/ingest.js` | ✅ Solid. `autoRegisterDevice` is idempotent; uses `COALESCE` to avoid blanking the hostname |
| `packages/backend/scripts/import_devices.js` | ✅ Solid. Proper CSV parsing with quote handling; transactional |
| `packages/backend/services/graph.js` | 🐛 Blockers #1 and #2 above |
