# Agent Task: Intune Deployment Validator
<!-- Claude Code task file. Run with: claude --task agents/intune-validator/TASK.md -->

## Objective
Build a **pre-deployment validation gate** that must pass before any provisioning push to the
236-laptop fleet. It validates `autounattend.xml` structure, simulates drive enumeration
to catch the known EFI partition placement failure on multi-drive systems, and cross-checks
Intune policy assignment against target device group membership via Microsoft Graph API.

**This tool produces a structured JSON report. A deployment is GO only if all CRITICAL checks pass.**

---

## Scope

**In scope:**
- `provisioning/validate.ps1` — primary validator script (PowerShell 7.x)
- `provisioning/validate_report_schema.json` — output schema definition
- `provisioning/tests/` — Pester test cases for the validator itself
- Read-only calls to Microsoft Graph API (no writes during validation)

**Out of scope:**
- Modifying `autounattend.xml` or `.ppkg` contents
- Executing Intune deployments
- Any changes to `agent/`, `osint/`, or `db/`

---

## Step-by-Step Build Plan

### Step 1 — Read and Map Existing Files

Read:
- `provisioning/autounattend.xml` — full file
- `provisioning/enrollment.ppkg` — note: binary, do not attempt to parse; just confirm it exists
- `provisioning/policies/` — list all JSON files and read each

Do not modify. Produce a written inventory:
- List of all `<DiskConfiguration>` entries in `autounattend.xml`
- List of all `<Partition>` elements with `Type` and `Order` attributes
- List of policy JSON files found and their `displayName` fields

### Step 2 — Define the Validation Report Schema

Create `provisioning/validate_report_schema.json`:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["run_id", "timestamp", "overall_status", "checks"],
  "properties": {
    "run_id": { "type": "string" },
    "timestamp": { "type": "string", "format": "date-time" },
    "overall_status": { "enum": ["GO", "NO-GO", "WARNING"] },
    "checks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["check_id", "category", "severity", "status", "message"],
        "properties": {
          "check_id":  { "type": "string" },
          "category":  { "enum": ["XML_SCHEMA", "DISK_SIMULATION", "INTUNE_POLICY", "ENROLLMENT"] },
          "severity":  { "enum": ["CRITICAL", "WARNING", "INFO"] },
          "status":    { "enum": ["PASS", "FAIL", "SKIP"] },
          "message":   { "type": "string" },
          "detail":    { "type": "object" }
        }
      }
    }
  }
}
```

`overall_status` logic:
- Any `CRITICAL` + `FAIL` → `NO-GO`
- Any `WARNING` + `FAIL`, no CRITICAL failures → `WARNING`
- All pass → `GO`

### Step 3 — XML Schema Validation (`validate.ps1` — Block A)

**Check XML_001 — Well-formed XML**
```powershell
try {
    [xml]$xml = Get-Content $XmlPath -Raw -Encoding UTF8
    # PASS
} catch {
    # FAIL CRITICAL: "autounattend.xml is not well-formed XML: $_"
}
```

**Check XML_002 — Required components present**
Required `<component>` names (at minimum):
- `Microsoft-Windows-Setup`
- `Microsoft-Windows-Shell-Setup`
- `Microsoft-Windows-International-Core-WinPE`

If any are absent → FAIL CRITICAL.

**Check XML_003 — EFI partition defined**

Parse all `<Partition>` nodes. Confirm at least one has:
```xml
<Type>EFI</Type>
```
If absent → FAIL CRITICAL: "No EFI partition defined. Disk will fail to boot on UEFI systems."

**Check XML_004 — EFI partition is Order="1"**

If EFI partition exists but `<Order>` is not `1` → FAIL CRITICAL:
"EFI partition must be Order=1. Current value: [X]. Known to cause boot failure on NVMe+HDD systems."

**Check XML_005 — MSR partition present**

Confirm a partition with `<Type>MSR</Type>` exists and is `Order="2"`.
If absent → FAIL WARNING: "MSR partition missing or misordered. Recommended for GPT disks."

**Check XML_006 — WipeDisk flag**

Confirm `<WipeDisk>true</WipeDisk>` is present in the primary disk config.
If absent → FAIL WARNING: "WipeDisk not set. Leftover partition tables on target drive may cause enumeration conflicts."

### Step 4 — Drive Enumeration Simulation (`validate.ps1` — Block B)

**Context:** The known failure mode is that on laptops with both an NVMe (primary) and an HDD (secondary), Windows Setup enumerates `Disk 0` as the HDD rather than the NVMe, placing the EFI partition on the wrong drive.

**Check DISK_001 — DiskID zero assumption**

Parse `autounattend.xml` for `<DiskID>` values. If any `<DiskConfiguration>` targets `<DiskID>0` without a `<WipeDisk>true</WipeDisk>` guard:
→ FAIL CRITICAL: "DiskID=0 is non-deterministic on multi-drive hardware. Add WipeDisk=true or use explicit disk selection."

**Check DISK_002 — Simulate multi-drive enumeration**

Implement a simulation function:
```powershell
function Test-MultiDriveEnumeration {
    param([xml]$Xml)

    # Scenario: DiskID 0 = HDD (non-boot), DiskID 1 = NVMe
    # Check: does the XML produce a valid boot partition on DiskID 1?
    $primaryDisk = $Xml.SelectNodes("//DiskConfiguration/Disk") | Where-Object { $_.DiskID -eq 0 }
    $efiOnPrimary = $primaryDisk.CreatePartitions.CreatePartition | Where-Object { $_.Type -eq 'EFI' }

    if ($efiOnPrimary) {
        return @{
            Status  = 'FAIL'
            Severity = 'CRITICAL'
            Message = "EFI partition assigned to DiskID=0. In multi-drive scenario, DiskID=0 may be HDD. EFI must target the OS drive explicitly."
            Detail  = @{ SimulatedDisk0 = 'HDD'; SimulatedDisk1 = 'NVMe' }
        }
    }
    return @{ Status = 'PASS'; Message = "Disk enumeration simulation: EFI not exclusively on DiskID=0." }
}
```

**Check DISK_003 — Partition size sanity**

For each partition, validate:
- EFI: size ≥ 100 MB
- MSR: size ≥ 16 MB
- Windows (Primary): size ≥ 30000 MB

If any are below minimum → FAIL CRITICAL.

### Step 5 — Intune Policy Validation (`validate.ps1` — Block C)

Uses Microsoft Graph API. Requires `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `INTUNE_GROUP_ID`.

**Authentication helper:**
```powershell
function Get-GraphToken {
    $body = @{
        grant_type    = 'client_credentials'
        client_id     = $env:AZURE_CLIENT_ID
        client_secret = $env:AZURE_CLIENT_SECRET
        scope         = 'https://graph.microsoft.com/.default'
    }
    $resp = Invoke-RestMethod -Uri "https://login.microsoftonline.com/$env:AZURE_TENANT_ID/oauth2/v2.0/token" -Method POST -Body $body
    return $resp.access_token
}
```

**Check INTUNE_001 — Target group exists**

GET `https://graph.microsoft.com/v1.0/groups/$env:INTUNE_GROUP_ID`
If 404 → FAIL CRITICAL: "Intune target group not found. Deployment would reach no devices."

**Check INTUNE_002 — Device count in group**

GET `https://graph.microsoft.com/v1.0/groups/$env:INTUNE_GROUP_ID/members/$count`
If count = 0 → FAIL CRITICAL: "Target group has 0 members."
If count > 250 → FAIL WARNING: "Group has [N] members. Exceeds fleet size of 236 — verify scope."

**Check INTUNE_003 — Policy assignments target correct group**

For each policy JSON in `provisioning/policies/`:
- GET `https://graph.microsoft.com/v1.0/deviceManagement/deviceConfigurations/{policyId}/assignments`
- Confirm `$env:INTUNE_GROUP_ID` appears in assignment targets
- If policy exists in local JSON but has NO assignment → FAIL WARNING: "Policy '[name]' exists but is not assigned to target group."

**Check INTUNE_004 — Enrollment profile active**

GET `https://graph.microsoft.com/v1.0/deviceManagement/windowsAutopilotDeploymentProfiles`
Check at least one profile is in `enabled` state.
If none → FAIL WARNING: "No active Autopilot deployment profile found."

**If Graph API is unreachable (no network / bad credentials):**
→ All INTUNE checks → SKIP with message: "Graph API unreachable. Intune checks skipped. Do not deploy without manual verification."
→ `overall_status` cannot be `GO` if any INTUNE check is SKIP (max: WARNING).

### Step 6 — Report Generation

At the end of `validate.ps1`, serialise all check results to JSON and write to:
`provisioning/reports/validation_YYYYMMDD_HHMMSS.json`

Also print a human-readable summary to stdout:
```
=====================================
 STARFLEET DEPLOYMENT VALIDATOR
 Run ID : <uuid>
 Time   : <timestamp>
 Status : GO | NO-GO | WARNING
=====================================
[PASS] XML_001 Well-formed XML
[FAIL] DISK_001 DiskID=0 non-deterministic  ← CRITICAL
[SKIP] INTUNE_001 Graph API unreachable
...
=====================================
 CRITICAL FAILURES : 1
 WARNINGS          : 0
 SKIPPED           : 4
 OVERALL           : NO-GO
=====================================
```

Exit codes:
- `GO` → `exit 0`
- `WARNING` → `exit 1`
- `NO-GO` → `exit 2`

This allows CI/CD or a calling script to gate on exit code.

### Step 7 — Pester Tests (`provisioning/tests/`)

Write Pester 5.x tests covering:
- `Test-MultiDriveEnumeration` with a fixture XML where EFI is on DiskID=0 → expects FAIL
- `Test-MultiDriveEnumeration` with EFI on DiskID=1 → expects PASS
- XML_004 check with Order=2 EFI partition → expects FAIL CRITICAL
- Report JSON matches schema (use `Test-Json` with the schema file)

Run tests:
```powershell
Invoke-Pester provisioning/tests/ -Output Detailed
```

All tests must pass before finalising.

---

## Invocation

```powershell
# Standard pre-deployment run
pwsh provisioning/validate.ps1 -XmlPath provisioning/autounattend.xml

# CI usage (check exit code)
pwsh provisioning/validate.ps1 -XmlPath provisioning/autounattend.xml
if ($LASTEXITCODE -eq 2) { throw "Deployment blocked: NO-GO" }
```

---

## Output Checklist (confirm before closing task)

- [ ] Inventory of current `autounattend.xml` disk config produced and reviewed
- [ ] `validate_report_schema.json` created
- [ ] All XML checks implemented (XML_001 through XML_006)
- [ ] Multi-drive simulation passes with compliant XML, fails with DiskID=0 EFI
- [ ] Intune checks gracefully skip when API is unreachable
- [ ] Report JSON written to `provisioning/reports/`
- [ ] Exit codes 0/1/2 verified
- [ ] Pester tests all passing
- [ ] Zero hardcoded credentials

---

## Known Issues to Encode

The following bugs are already documented in `CLAUDE.md`. The validator must explicitly detect both:

1. **EFI placement on multi-drive systems** → covered by DISK_001 + DISK_002
2. **OOBE interrupted before provisioning completes** → add as Check ENROLLMENT_001 (WARNING only):
   - Inspect `.ppkg` existence and last-modified date
   - If `.ppkg` is older than 90 days → FAIL WARNING: "Enrollment package may be stale. Regenerate from Intune before large-batch deployment."
