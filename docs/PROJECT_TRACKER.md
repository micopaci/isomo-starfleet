# Isomo Pulse Starfleet Monitor - Project Tracker

Document date: April 26, 2026

## 1. Project Summary

Starfleet Monitor is being built to give Isomo a reliable operational view of
school connectivity. The current push is focused on making the laptop agent
production-ready through Intune, improving backend site inference from Starlink
identity, and making the dashboard reflect real site/device health.

## 2. Current Status

| Workstream | Status | Notes |
|---|---|---|
| Backend API | In progress, deployable | Railway backend is healthy; recent work added Starlink identity site resolution and agent token generation |
| Neon database | In progress, deployable | Migrations include Starlink UUID/site master sheet fields and usage hardening |
| Windows agent | In progress, test-ready | Agent version 1.2.0 supports gRPC-web fallback, Starlink ID extraction, offline queue, and Intune marker |
| Intune deployment | In progress, VM test | Moving from split Platform Script/remediation to one self-contained Remediation package |
| Dashboard | In progress | Sites, laptops, usage, and detail views are evolving |
| Mobile app | Early/in progress | React Native app exists; field/admin workflows still need validation |
| Documentation | In progress | Root README, requirements, tracker, Intune setup, and site detection docs now exist |

## 3. Recently Completed

| Date | Item | Result |
|---|---|---|
| 2026-04-26 | Added backend Starlink identity matching | Backend can normalize `ut31...` to `31...` and match `sites.starlink_uuid` |
| 2026-04-26 | Added admin agent token route | Admin can create site-scoped agent tokens through `/api/agent-tokens` |
| 2026-04-26 | Added Intune remediation builder | `build-intune-remediation.mjs` generates a self-contained upload script |
| 2026-04-26 | Added Intune install marker | Agent install writes `install_source=intune_remediation` and `agent_version=1.2.0` |
| 2026-04-26 | Tightened detection script | Detection now forces remediation for old/manual installs |
| 2026-04-26 | Confirmed VM old install symptoms | Old install lacked marker and showed `401 Unauthorized` ingest failures |

## 4. Next Milestones

| Milestone | Target outcome | Owner | Status |
|---|---|---|---|
| M1: Generate real agent token | Site-scoped token for test site 7 is created from production backend | Admin/Codex | Ready |
| M2: Upload new Intune remediation | Detection uses `packages/agent/detection.ps1`; remediation uses generated `dist/intune/remediation.ps1` with real token | Admin | Ready |
| M3: Validate VM remediation | VM has install marker, version 1.2.0, scheduled task, fresh heartbeat, queue 0, no `401` | Admin/Codex | Pending |
| M4: Confirm platform ingest | Backend receives heartbeat, health, latency, usage, and agent-health from VM | Admin/Codex | Pending |
| M5: Confirm Starlink site inference | Backend maps Starlink UUID to the correct real site when GPS is unavailable | Admin/Codex | Pending |
| M6: Expand pilot | Assign remediation to a small school/device group after VM validation | Admin/Ops | Pending |
| M7: Production rollout | Deploy to all target managed laptops with monitoring and rollback plan | Admin/Ops | Pending |

## 5. Workstream Tracker

### 5.1 Backend And Database

| Task | Priority | Status | Notes |
|---|---|---|---|
| Health endpoint verifies DB | Must | Done | `/health` reports API and DB status |
| Ingest endpoints accept agent payloads | Must | Done | Heartbeat, signal, health, latency, usage, agent-health |
| Idempotent queued payload replay | Must | Done | Payload metadata protects usage writes |
| Starlink UUID site lookup | Must | Done | Uses raw and normalized terminal identities |
| Agent token generation API | Must | Done | Admin route exists and returns site-scoped token |
| Master sheet site import/update | Must | In progress | Site ID, UUID, SN, location, district fields are modeled |
| Token rotation and revocation policy | Should | Not started | Needs operations decision |

### 5.2 Windows Agent

| Task | Priority | Status | Notes |
|---|---|---|---|
| Scheduled task every 5 minutes | Must | Done | `StarfleetPulse` |
| Built-in Starlink gRPC-web probe | Must | Done | Works without `grpcurl` |
| GPS byte-offset fallback | Must | Done | Decodes known diagnostic offsets |
| Starlink ID scanner | Must | Done | Sends `starlink_id` and `starlink_uuid` |
| Offline queue and replay | Must | Done | Queue stored in ProgramData |
| Agent health payload | Must | Done | Version, queue, last error, run ID |
| Intune install marker | Must | Done | Distinguishes new installs from legacy/manual installs |
| VM validation with new token | Must | Pending | Current VM evidence was old token/manual install |

### 5.3 Intune Deployment

| Task | Priority | Status | Notes |
|---|---|---|---|
| Single remediation package pattern | Must | Done | Do not split with Platform Script |
| Detection script forces remediation for old installs | Must | Done | Requires Intune marker and version |
| Self-contained remediation upload script | Must | Done | Generated under `dist/intune` |
| Upload to Intune test VM group | Must | Pending | Needs real token pasted into generated script |
| Verify Intune device status | Must | Pending | Expect detection with issues, remediation fixed, then without issues |
| Disable legacy Platform Script during test | Should | Pending | Avoid duplicate installers touching same files |

### 5.4 Dashboard And Mobile

| Task | Priority | Status | Notes |
|---|---|---|---|
| Sites overview | Must | In progress | Shows site inventory and metrics |
| Laptop list | Must | In progress | Tracks online/stale devices |
| Site detail | Must | In progress | Shows devices and latest signal |
| Usage chart | Should | In progress | New component exists in worktree |
| Alerts/site changes UI | Should | In progress | Backend events available |
| Mobile app field workflows | Should | Not validated | Needs test plan |

## 6. Validation Checklist

### 6.1 Before Uploading To Intune

| Check | Expected |
|---|---|
| Generated remediation has real agent token | `$ApiToken` is not `<PASTE_SITE_AGENT_JWT_HERE>` |
| Detection script is latest | Requires `install_source.json` and version `1.2.0` |
| Legacy Platform Script is unassigned | Only the remediation controls install/update |
| Assignment is scoped to VM test group | No broad production rollout yet |

### 6.2 On The VM After Intune Runs

Run:

```powershell
$dir = "C:\ProgramData\Starfleet"
Test-Path "$dir\install_source.json"
Get-Content "$dir\install_source.json" | ConvertFrom-Json
Select-String -Path "$dir\agent.log" -Pattern "Agent starting version|install_source|401|Cycle complete" | Select-Object -Last 30
Get-Content "$dir\last_heartbeat.txt" -ErrorAction SilentlyContinue
(Get-ChildItem "$dir\queue" -Filter "*.json" -ErrorAction SilentlyContinue).Count
```

Expected:

| Evidence | Good result |
|---|---|
| Install marker | `source = intune_remediation` |
| Agent version | `agent_version = 1.2.0` |
| Log startup | `Agent starting version 1.2.0 ... install_source=intune_remediation` |
| Auth | No `401 Unauthorized` ingest failures |
| Queue | `0` after successful replay |
| Heartbeat | `last_heartbeat.txt` updated after Intune run |

### 6.3 In The Platform

| Check | Expected |
|---|---|
| Device last seen | VM/laptop updates within expected interval |
| Agent health | Version 1.2.0 and queue depth visible |
| Site assignment | Real site is resolved from Starlink UUID/GPS or fallback |
| Usage | Daily usage appears without duplicate spikes |
| Latency | Recent laptop-side latency appears |

## 7. Risks And Blockers

| Risk | Severity | Current mitigation |
|---|---|---|
| Wrong token type used in Intune | High | Use `/api/agent-tokens` to generate site-scoped token; verify no `401` |
| Intune old Platform Script still assigned | Medium | Unassign during test so remediation is the only installer |
| Starlink local API unreachable | Medium | Agent still sends laptop heartbeat/health/usage; next cycle can recover |
| Starlink GPS disabled by update/config | Medium | Backend uses Starlink UUID inventory as primary fallback |
| Generated token script committed | High | `dist/` ignored; review `git status` before commits |
| Incomplete site inventory | Medium | Continue importing Starlink UUID/SN/location/site records |

## 8. Decisions Needed

| Decision | Why it matters | Suggested next step |
|---|---|---|
| Agent token lifetime | Controls security and operational maintenance | Start with 365 days for pilot, define rotation later |
| Production rollout grouping | Controls blast radius | Pilot with VM, then one small school group, then expand |
| Dashboard domain and CORS | Prevents auth/API failures | Confirm final Vercel URL and backend `ALLOWED_ORIGINS` |
| Notification recipients | Determines who gets site move alerts | Define admin/ops recipients and acknowledgement workflow |
| Site master sheet ownership | Prevents stale UUID/location data | Assign one source-of-truth owner |

## 9. Immediate Next Actions

1. Generate a production site-scoped agent token for site 7.
2. Paste it into `dist/intune/remediation.ps1`.
3. Upload latest detection and remediation scripts to the Intune remediation.
4. Sync the VM and wait for remediation status.
5. Run the VM validation commands.
6. Confirm backend/platform shows fresh ingest without `401`.
7. If the VM passes, pilot a small real laptop group.

## 10. Definition Of Done For Current Phase

This phase is complete when:

| Criterion | Target |
|---|---|
| VM install | VM shows Intune marker and agent version 1.2.0 |
| VM ingest | Heartbeat, health, latency, usage, and agent-health ingest without auth failures |
| Starlink mapping | Starlink UUID resolves the correct site when GPS is unavailable |
| Dashboard | Operators can see VM/laptop health and site assignment in the platform |
| Runbook | Intune setup and validation steps are documented and repeatable |

