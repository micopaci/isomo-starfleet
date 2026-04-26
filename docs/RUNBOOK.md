# Starfleet Operations Runbook

## Intune agent rollout

Use the discovery remediation package for broad deployment. It installs the agent with `site_id=0`, lets the laptop read the Starlink dish identity and GPS, then exchanges the discovery token for a site-scoped token.

Check a laptop with:

```powershell
Get-Content C:\ProgramData\Starfleet\agent.log -Tail 80
powershell.exe -ExecutionPolicy Bypass -File C:\ProgramData\Starfleet\test.ps1
```

Healthy bootstrap lines look like:

```text
GPS resolved site 41 at 0.146 km.
Bootstrap resolved site 41 via starlink_identity; saving site-scoped agent token.
```

## Unauthorized ingest

Run `test.ps1` first. It reports token role, site, and expiry. The agent needs a token with `role=agent`; admin JWTs are refused for Intune packages and should only be used by the platform UI.

If `agent.config.json` is stale, rerun the remediation from Intune or manually run:

```powershell
powershell.exe -ExecutionPolicy Bypass -File C:\ProgramData\Starfleet\remediation.ps1
```

## Platform actions

The desktop buttons write `script_triggers` records immediately. Microsoft Graph launches the matching on-demand remediation only when the backend has a policy GUID configured for that action.

Required environment variables:

```text
REMEDIATION_POLICY_DIAGNOSTICS
REMEDIATION_POLICY_LOCATION_REFRESH
REMEDIATION_POLICY_DATA_PULL
REMEDIATION_POLICY_PING_DISH
REMEDIATION_POLICY_REBOOT_STARLINK
```

`REMEDIATION_POLICY_RESTART_STARLINK` is also accepted as a fallback for reboot.

## Monthly Starlink data

On the Starlinks page, upload a CSV with:

```csv
site_id,gb_total
41,823.4
7,512.8
```

The importer also accepts `mb_total` or `bytes_total` instead of `gb_total`.
