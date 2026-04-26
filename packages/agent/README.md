# Starfleet Agent - Laptop Data Feed

This package deploys a Windows PowerShell agent that feeds laptop and Starlink
telemetry into the platform through the backend `/ingest/*` endpoints.

## What The Agent Sends

| Endpoint | Data |
|---|---|
| `/ingest/heartbeat` | BIOS/UUID identity, hostname, OS, model, manufacturer, last-seen timestamp |
| `/ingest/health` | Battery, disk, RAM |
| `/ingest/signal` | Starlink GPS, dish ID, alignment, latency, obstruction, drop rate, throughput when the local dish API is reachable |
| `/ingest/latency` | Laptop-side P50/P95 ping latency to the configured probe host |
| `/ingest/usage` | Daily network byte deltas from Windows adapter counters |
| `/ingest/agent-health` | Queue depth, oldest queued age, agent version, last error |

If the backend is unreachable, payloads are written to
`C:\ProgramData\Starfleet\queue` and retried on later cycles.
Each payload now includes idempotency metadata (`payload_id`, `run_id`, `schema_version`)
so replay does not double-write usage metrics.

## Files

| File | Purpose |
|---|---|
| `StarfleetAgent.ps1` | Runtime agent, executed by Task Scheduler |
| `remediation.ps1` | Intune install/update script |
| `detection.ps1` | Intune health check script |
| `test.ps1` | On-laptop diagnostic helper |
| `re-sync.ps1` | Manually replay one queued payload |

## Backend Token

Generate one agent token per site from the production backend:

```bash
curl -X POST "https://api.starfleet.icircles.rw/api/agent-tokens" \
  -H "Authorization: Bearer <ADMIN_DASHBOARD_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"site_id":7,"expires_in":"365d"}'
```

Use the returned token as the remediation `ApiToken`. The token payload uses
`role: "agent"` and `site_id: <site id>`. Avoid tokens generated from a local
`.env` unless that local signing key is exactly the same key used by production.

## Intune Deployment

Create one remediation policy per school or deployment group.

1. In Intune, go to **Devices** -> **Scripts and remediations** -> **Remediations**.
2. Create a remediation package.
3. Upload `detection.ps1` as the detection script.
4. Upload `remediation.ps1` as the remediation script.
5. Run as SYSTEM:
   - **Run this script using logged-on credentials**: No
   - **Run script in 64-bit PowerShell**: Yes
   - **Enforce script signature check**: No, unless you sign these scripts
6. Generate the self-contained upload script with the site token:

```bash
export STARFLEET_AGENT_TOKEN="<site-agent-jwt>"
node packages/agent/build-intune-remediation.mjs --site-id 7
```

Upload `dist/intune/remediation.ps1` as the remediation script. The builder
refuses dashboard tokens, expired tokens, wrong-site tokens, and tokens rejected
by the configured backend before writing the file. The generated remediation
also installs `test.ps1` into `C:\ProgramData\Starfleet` for VM diagnostics.

To generate one remediation script per site from a single dashboard admin token:

```bash
export STARFLEET_ADMIN_TOKEN="<admin-dashboard-jwt>"
node packages/agent/build-intune-remediations.mjs
```

This writes site-specific upload scripts under `dist/intune/sites/`. Each file
contains a different site-scoped agent token, so assign each remediation only to
that site's Intune device group. Site `0` (`Unassigned / Discovery`) is skipped
because it is not a deployable school/device group. The generated files are
ignored by git because they contain secrets.

For a subset:

```bash
node packages/agent/build-intune-remediations.mjs --site-ids 7,12,19
```

If all laptops are enrolled with the same `.ppkg` and site is unknown at first
boot, generate one shared discovery remediation:

```bash
export STARFLEET_ADMIN_TOKEN="<admin-dashboard-jwt>"
node packages/agent/build-intune-discovery-remediation.mjs
```

Upload `dist/intune/discovery-remediation.ps1` to the all-laptops Intune group.
It installs with `SiteId = 0`; after Starlink GPS or dish identity resolves the
real school, the backend returns a site/device-scoped token and the laptop saves
it into `agent.config.json`.

## Local Laptop Paths

| Path | Contents |
|---|---|
| `C:\ProgramData\Starfleet\StarfleetAgent.ps1` | Installed agent |
| `C:\ProgramData\Starfleet\agent.config.json` | API base, site ID, token, probe settings |
| `C:\ProgramData\Starfleet\device.json` | Cached device serial and resolved site |
| `C:\ProgramData\Starfleet\last_heartbeat.txt` | Last successful heartbeat |
| `C:\ProgramData\Starfleet\agent.log` | Agent log, rotated at 5 MB |
| `C:\ProgramData\Starfleet\queue\` | Offline payload queue |
| `C:\ProgramData\Starfleet\usage_baseline.json` | Network usage counter baseline |

## Validation On A Laptop

```powershell
powershell -ExecutionPolicy Bypass -File "C:\ProgramData\Starfleet\StarfleetAgent.ps1"
powershell -ExecutionPolicy Bypass -File ".\test.ps1"
Get-Content "C:\ProgramData\Starfleet\agent.log" -Tail 40
Get-ScheduledTask -TaskName "StarfleetPulse" | Select-Object State, Triggers
```

Manual queue replay:

```powershell
powershell -ExecutionPolicy Bypass -File ".\re-sync.ps1" -QueueFile "C:\ProgramData\Starfleet\queue\<file>.json"
```

## Notes

- Keep JWTs out of git. They belong only in Intune parameters or the installed
  `agent.config.json` on a managed laptop.
- The scheduled task runs every 5 minutes as SYSTEM.
- Usage accounting is Wi-Fi oriented (default-route wireless adapter policy).
- GPS site discovery is backend-led. The agent reports Starlink GPS and dish ID;
  the backend resolves location, applies the two-day move confirmation rule, and
  keeps site-scoped tokens from being invalidated by a single GPS reading.
- Starlink telemetry without `grpcurl` uses the same gRPC-web byte-frame request
  as the laptop validation snippet. If local dish access fails, dish metrics may
  be null for that cycle while heartbeat/usage/latency continue to ingest.
- If the backend `sites.starlink_uuid` column is populated from your Starlink
  inventory, `/ingest/signal` can use the reported dish ID as a site hint when
  GPS is unavailable. The agent sends both the raw gRPC form
  (`ut31c88996-c611791c-599d1851`) and the normalized database form
  (`31c88996-c611791c-599d1851`) when it can read the dish ID.
