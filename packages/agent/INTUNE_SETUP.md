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

Upload the matching generated remediation script to the matching site's Intune
device group. Each generated script contains a different site-scoped token, so
do not reuse one site's file for another site.

For a smaller batch:

```bash
node packages/agent/build-intune-remediations.mjs --site-ids 7,12,19
```

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
agent_version = 1.2.0
queue count = 0
last_heartbeat.txt updated after Intune ran
test.ps1 reports GPS or Starlink ID/UUID
```
