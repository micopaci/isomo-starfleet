# Starfleet Agent — Intune Deployment Guide

This package deploys the Starfleet data collection agent to all Isomo laptops via **Intune Proactive Remediation**.

---

## Files

| File | Purpose |
|---|---|
| `StarfleetAgent.ps1` | The agent itself — collects and POSTs all metrics |
| `detection.ps1` | Tells Intune whether the agent needs re-deploying |
| `remediation.ps1` | Installs the agent and registers the scheduled task |

---

## How Proactive Remediation works

Intune runs `detection.ps1` on a schedule (e.g. every hour).
- **Exit 0** → agent is healthy, nothing happens.
- **Exit 1** → agent is stale or missing, Intune runs `remediation.ps1` automatically.

`remediation.ps1` copies the agent, injects the site-specific token and site ID, registers a Windows Scheduled Task that runs every 5 minutes as SYSTEM, then fires it immediately.

---

## Step-by-step setup in Intune

### 1. Create a Proactive Remediation policy

1. Go to **Microsoft Intune admin center** → **Devices** → **Scripts and remediations** → **Remediations**
2. Click **+ Create** → give it a name like `Starfleet Agent - [School Name]`
3. Under **Settings**:
   - **Detection script**: upload `detection.ps1`
   - **Remediation script**: upload `remediation.ps1`
   - **Run this script using the logged-on credentials**: **No** (runs as SYSTEM)
   - **Enforce script signature check**: **No**
   - **Run script in 64-bit PowerShell**: **Yes**
4. Under **Script parameters** (remediation only), add:
   | Parameter | Value |
   |---|---|
   | `-ApiToken` | The JWT token for this site (generate from backend admin) |
   | `-SiteId` | The numeric site ID (from `/api/sites` endpoint) |
   | `-ApiBase` | `https://starfleet.yourdomain.com` |

> **Important:** Create one Remediation policy per school so each gets its own `$SiteId`.

### 2. Add StarfleetAgent.ps1 to the package

The remediation script copies `StarfleetAgent.ps1` from `$PSScriptRoot`. You need to bundle both files together. The easiest way is to use an **Intune Win32 app** wrapper:

```
# Package both scripts together using IntuneWinAppUtil
IntuneWinAppUtil.exe -c .\packages\agent\ -s remediation.ps1 -o .\dist\
```

Or, for simple PowerShell-only remediations without Win32 packaging, embed the agent content as a here-string inside `remediation.ps1` and write it directly to disk.

### 3. Assign to a device group

1. Create an **Azure AD device group** per school (e.g. `Starfleet-GS-Gihara`)
2. Add all laptops for that school to the group
3. In the Remediation policy → **Assignments** → assign to that group
4. Set **Schedule**: Run every **1 hour** (detection check)

---

## Which script goes where

| Intune field | Script |
|---|---|
| Detection script | `detection.ps1` |
| Remediation script | `remediation.ps1` |

---

## Generating a long-lived JWT for each site

On the backend, run:

```bash
node -e "
  require('dotenv').config();
  const jwt = require('jsonwebtoken');
  const token = jwt.sign(
    { role: 'agent', site_id: SITE_ID },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '365d' }
  );
  console.log(token);
"
```

Replace `SITE_ID` with the integer from `/api/sites`. Use this token as the `-ApiToken` parameter in Intune.

---

## Local paths on each laptop

| Path | Contents |
|---|---|
| `C:\ProgramData\Starfleet\StarfleetAgent.ps1` | The deployed agent |
| `C:\ProgramData\Starfleet\device.json` | Cached device SN and site assignment |
| `C:\ProgramData\Starfleet\last_heartbeat.txt` | Timestamp of last successful heartbeat |
| `C:\ProgramData\Starfleet\agent.log` | Rolling log (max 5 MB, rotates to agent.log.1) |
| `C:\ProgramData\Starfleet\queue\` | Offline queue — JSON payloads pending retry |
| `C:\ProgramData\Starfleet\usage_baseline.json` | Network adapter byte counters baseline |

---

## Troubleshooting

**Agent not sending data**
```powershell
# Run manually to see errors
powershell -ExecutionPolicy Bypass -File "C:\ProgramData\Starfleet\StarfleetAgent.ps1"

# Check log
Get-Content "C:\ProgramData\Starfleet\agent.log" -Tail 30
```

**Scheduled task not running**
```powershell
Get-ScheduledTask -TaskName "StarfleetAgent" | Select-Object State, Triggers
# Expected: State=Ready, Trigger with RepetitionInterval=PT5M
```

**Offline queue growing**
```powershell
# Check queue size
(Get-ChildItem "C:\ProgramData\Starfleet\queue\").Count
# If >0, the backend is unreachable — check $ApiBase and $ApiToken
```
