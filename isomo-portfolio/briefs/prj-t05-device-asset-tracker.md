# PRJ-T05 — Device Asset Tracker

> **Owner:** You (architecture lead) · **Audience:** IT/Ops · **Timeline:** 6–8 weeks (Phase 1) · **Impact:** High

## Context
Isomo manages ~236 Windows + Chromebook devices across 40 sites via Intune. Intune tells you *compliance and telemetry* but not *custody and condition*: who holds a laptop, when it was checked out, whether it's broken, where it is in a repair cycle, and whether a loaner is overdue. Today that lifecycle lives in spreadsheets and WhatsApp. This project puts a custody-and-condition layer on top of the Intune data already flowing into this repo.

**Why now:** It is the shortest-scope Phase-1 project, it extends a codebase you already own (zero onboarding), and shipping it to production first gives the interns a reference deployment. It is the Sprint-3 production milestone that the other three projects are measured against.

## Current state — this is an extension, not a greenfield build
Verified in the repo. A meaningful foundation already exists:

| Layer | What exists | Path |
|---|---|---|
| Schema | `devices.hardware_status` (`working_in_use`/`intake_broken`/`in_repair`/`ready_for_reissue`/`decommissioned`) + `devices.profile_number` (unique, e.g. `LAP-001`) | `packages/backend/migrations/034_device_inventory_management.sql` |
| Custody ledger | `device_assignments` (device_id, assignee_email, assignee_type `student`/`staff`/`pool`, site_id, assigned_at, unassigned_at, status, unassign_reason) | migration 034 |
| Audit trail | `device_lifecycle_logs` (operator_email, action_type, previous/new_state JSONB, symptom_tags[], repair_details, client_transaction_uuid for idempotency) | migration 034 |
| API | `GET /api/inventory`, `POST /api/inventory/intake`, `POST /api/inventory/reconcile` | `packages/backend/routes/inventory.js` |
| Types | `DeviceAssignment`, `DeviceLifecycleLog`, `OfflineTransaction` | `packages/shared/src/types.ts` |
| Intune sync | Graph client + managed-device ingest already running | `packages/backend/services/graph.js`, migrations 020/021 |

**Gaps to close (the actual work):**
- No explicit **assign / unassign / repair-start / repair-complete** endpoints — only `intake` and `reconcile` exist, and `reconcile` hard-codes `assignee_type='student'` (no staff/pool assignment path).
- No **checkout UI** — the frontend inventory view is mocked (`packages/web/src/data/mockData.ts`).
- No **condition-photo** capture, no **QR/barcode scan**, no **overdue-loaner alerting**.
- No `REPAIR_START`/`REPAIR_COMPLETE` lifecycle action handling end-to-end.

## Dependencies
- **Upstream:** Intune/Graph telemetry already flows — minimal new infra. Shared `student`/`staff` schema (Sprint 0) so assignees resolve to real people, not just emails.
- **Downstream:** PRJ-T09 (Facilities) reuses the repair-ticket + photo pattern.
- **Hard constraint:** PRJ-T05 and Starfleet **share the Intune Graph app registration**. Document the exact permission set both systems need in Sprint 0; do not rotate the service principal without verifying Starfleet's existing calls still work.

## Scope
**In:** assign/unassign/repair endpoints; checkout UI (search by serial/asset tag → link to student/staff → write `device_assignments`); condition-photo upload (resize to ≤800px, never store originals); repair-ticket flow (submit → assign → resolve with notes + cost); overdue-loaner alert (email + dashboard flag after X days); staff-assignee support; runbook.
**Out:** procurement/purchasing, depreciation accounting, non-Intune device types, mobile-native app (web + existing dashboard only).

## Timeline (mapped to Phase-1 sprints)
| Sprint | Focus |
|---|---|
| 0 | Confirm Graph scopes (`DeviceManagementManagedDevices.Read.All` + `.ReadWrite.All`) without breaking Starfleet; document shared permission set; align assignee on shared `student`/`staff` schema. |
| 1 | Checkout UI vertical slice: search → link to student → write `device_assignments`. |
| 2 | Repair-ticket flow; condition-photo upload (≤800px); overdue alert; `REPAIR_START`/`REPAIR_COMPLETE` lifecycle handling. **Code-complete by Aug 9.** |
| 3 | **Production deployment (Aug 23).** Write the runbook. Then pivot to cross-project architecture review. |
| 4–5 | In production; you shift to reviewing the three intern projects and PRJ-B deploy config. |

## Deliverables
- [ ] Sprint 1: working checkout UI writing real `device_assignments` rows (vertical slice gate).
- [ ] Sprint 2: assign/unassign/repair-start/repair-complete endpoints; condition-photo upload pipeline (resize, no originals); overdue-loaner email + dashboard flag; staff-assignee path.
- [ ] Sprint 3: production deployment; device-tracker runbook (intake, repair, reassign, decommission, overdue flows).
- [ ] All lifecycle actions write to `device_lifecycle_logs` with idempotency via `client_transaction_uuid`.

## Acceptance criteria / Definition of Done
- An operator can check a device out to a student or staff member, see it in the dashboard, and the custody change is logged.
- A broken device can be taken through intake → repair → ready-for-reissue, each step audited.
- A loaner unreturned past the threshold raises an email + dashboard flag automatically.
- Condition photos are stored resized (≤800px); no original-resolution images persisted.
- Starfleet's existing Graph calls still pass after any credential/permission change.
- Runbook reviewed by you; deployed by you.

## Risks & gotchas
- **Shared Graph permissions with Starfleet** — the top risk. Treat the Entra app registration as shared infrastructure.
- Photo storage growth — enforce resize-on-upload and a storage budget.
- `reconcile` currently assumes student assignees; generalize before staff devices flow through it.
- Migrations continue from **038** (034 is taken; latest in repo is 037).
