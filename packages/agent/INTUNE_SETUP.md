# Starfleet Intune Setup

This agent should be deployed with **one Intune Remediation package**.
Do not split the install across a Remediation and a separate Platform Script.

## Why

Intune Remediations upload a detection script and a remediation script. A
separate Platform Script is a different Intune object and is not placed beside
the remediation script on disk. The Starfleet installer needs to write
`StarfleetAgent.ps1`, config, and the scheduled task as one action, so the
remediation script must be self-contained.

## Generate The Upload Script

From the repo root:

```bash
export STARFLEET_AGENT_TOKEN="<PASTE_SITE_AGENT_JWT_HERE>"
node packages/agent/build-intune-remediation.mjs --site-id 7
```

This writes:

```text
dist/intune/remediation.ps1
```

The generated remediation installs both `StarfleetAgent.ps1` and the diagnostic
helper `test.ps1` into `C:\ProgramData\Starfleet`.

The builder decodes the JWT and calls the production `/api/sites` endpoint
before writing the upload file. It refuses dashboard tokens, expired tokens,
wrong-site tokens, and tokens that production rejects.

Use a site-scoped agent token from the production backend:

```bash
curl -X POST "https://api.starfleet.icircles.rw/api/agent-tokens" \
  -H "Authorization: Bearer <ADMIN_DASHBOARD_JWT>" \
  -H "Content-Type: application/json" \
  -d '{"site_id":7,"expires_in":"365d"}'
```

Do not commit generated scripts with real tokens.

## Generate All Site Upload Scripts

For rollout beyond the test VM, generate one remediation script per site from a
single dashboard admin token:

```bash
export STARFLEET_ADMIN_TOKEN="<ADMIN_DASHBOARD_JWT>"
node packages/agent/build-intune-remediations.mjs
```

This writes:

```text
dist/intune/sites/site-<id>-<name>-remediation.ps1
dist/intune/sites/manifest.json
```

The generator skips site `0` (`Unassigned / Discovery`) because it is not a
deployable school/device group and cannot receive an agent token.

Upload the matching generated remediation script to the matching site's Intune
device group. Each generated script contains a different site-scoped token, so
do not reuse one site's file for another site.

For a smaller batch:

```bash
node packages/agent/build-intune-remediations.mjs --site-ids 7,12,19
```

## Generate One Discovery Upload Script

If laptops are enrolled with the same `.ppkg` and you do not know which school
they are at yet, use one shared discovery remediation instead:

```bash
export STARFLEET_ADMIN_TOKEN="<ADMIN_DASHBOARD_JWT>"
node packages/agent/build-intune-discovery-remediation.mjs
```

This writes:

```text
dist/intune/discovery-remediation.ps1
```

The discovery script installs with `SiteId = 0`. On first run, the agent sends
Starlink GPS/identity to `/ingest/bootstrap-token`. When the backend identifies
the school, it returns a device/site-scoped agent token; the laptop saves that
token in `agent.config.json` and uses it for future telemetry.

## Create The Intune Remediation

Go to:

```text
Intune admin center -> Devices -> Scripts and remediations -> Remediations
```

Create one package:

```text
Name: Starfleet
Detection script file: packages/agent/detection.ps1
Remediation script file: dist/intune/remediation.ps1
```

Settings:

```text
Run this script using the logged-on credentials: No
Enforce script signature check: No
Run script in 64-bit PowerShell: Yes
```

Assignments:

```text
Assign only to the test VM/laptop group first.
```

## Disable The Old Platform Script During Testing

Unassign the separate `IsomoStarfleet` Platform Script while testing this
remediation. Otherwise there are two independent Intune objects touching the
same agent, which makes logs hard to interpret.

## Verify On The VM

After Intune runs:

```powershell
$dir = "C:\ProgramData\Starfleet"
Get-Content "$dir\install_source.json" | ConvertFrom-Json
Get-Content "$dir\agent.log" -Tail 80
Get-Content "$dir\last_heartbeat.txt"
(Get-ChildItem "$dir\queue" -Filter "*.json" -ErrorAction SilentlyContinue).Count
powershell -ExecutionPolicy Bypass -File "$dir\test.ps1"
```

Good signs:

```text
install_source = intune_remediation
agent_version = 1.3.0
queue count = 0
last_heartbeat.txt updated after Intune ran
test.ps1 reports GPS or Starlink ID/UUID
```

## Security Remediations (Defender TVM)

The Starfleet Security page triggers two additional remediation packages via
the same on-demand proactive remediation flow. These scripts take no tokens and
need no build step — upload the files from `packages/agent/` as-is.

### Starfleet - Update Chrome

```text
Intune admin center -> Devices -> Scripts and remediations -> Remediations -> Create

Name: Starfleet - Update Chrome
Detection script file:   packages/agent/chrome-update-detection.ps1
Remediation script file: packages/agent/chrome-update-remediation.ps1
Run this script using the logged-on credentials: No
Enforce script signature check: No
Run script in 64-bit PowerShell: Yes
```

Detection exits 1 when the installed Chrome is older than the latest stable
release (from `versionhistory.googleapis.com`; falls back to Google Update
freshness when offline). Remediation kicks Google Update and, if that fails,
silently installs the latest enterprise MSI. A running Chrome is never killed —
an in-use update stages and applies on relaunch (`pending_relaunch`).

### Starfleet - Windows Update

```text
Name: Starfleet - Windows Update
Detection script file:   packages/agent/windows-update-detection.ps1
Remediation script file: packages/agent/windows-update-remediation.ps1
Run this script using the logged-on credentials: No
Enforce script signature check: No
Run script in 64-bit PowerShell: Yes
```

Detection exits 1 when applicable software updates are pending. Remediation
installs them security-severity first inside a ~20-minute window and **never
reboots** — `reboot_required` is logged and left to an operator.

### Wire The GUIDs Into The Backend

On-demand runs do not require the package to be assigned to a device group, but
an optional daily schedule against a Windows device group is a useful
belt-and-braces for devices that are offline when an on-demand trigger fires.
Chromebooks cannot run proactive remediations; the backend already excludes
non-Windows devices from these two trigger types.

After creating each package, copy its script package GUID from the portal URL
(or `GET /beta/deviceManagement/deviceHealthScripts` in Graph Explorer) and set
on the backend host (Render dashboard):

```text
REMEDIATION_POLICY_CHROME_UPDATE=<guid of Starfleet - Update Chrome>
REMEDIATION_POLICY_WINDOWS_UPDATE=<guid of Starfleet - Windows Update>
```

Until each GUID is set, the matching Security page action returns 503 (the
types deliberately do NOT fall back to the shared `REMEDIATION_POLICY_ID` —
running the generic Starfleet agent package for an update action would execute
the wrong script).
