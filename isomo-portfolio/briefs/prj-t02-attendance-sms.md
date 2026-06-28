# PRJ-T02 — Attendance + Parent SMS

> **Owner:** Intern 3 · **Audience:** Staff/Ops · **Timeline:** 2–3 months (Phase 1) · **Impact:** High

## Context
Teachers take attendance on paper; parents find out about absences late or never. This project makes attendance a QR-based class register: each session shows a QR code, students scan to mark present, and if a student is absent the system fires an SMS to the parent within 15 minutes via Africa's Talking.

**Why now:** High operational demand, a clean ~2-month build, well-scoped acceptance criteria, and low architectural ambiguity — a good fit for an intern working semi-independently. Its attendance data is also upstream signal for PRJ-05 (Adaptive Pathways).

## Dependencies
- **Upstream:** Africa's Talking account + Rwanda sender-ID registration; shared `student`/`class_session`/`attendance_record` schema; guardian phone numbers.
- **Downstream:** daily `attendance_record` export to BigQuery feeds **PRJ-05**.
- **Gating item:** **Rwanda sender-ID registration takes 7–14 days.** Initiate it on day 1 of Sprint 0. If not approved by Sprint 2, test with a personal number in sandbox (acceptable in sandbox, not production).

## Scope
**In:** `class_session` + `attendance_record` tables; HMAC-signed time-bound QR tokens; scan endpoint with server-side single-scan enforcement; absence-trigger SMS; offline QR fallback; daily PDF register to Drive; BigQuery export; staff training doc + parent communication template.
**Out:** grading, timetabling (PRJ-T04), payments, a parent-facing app (SMS only).

## Timeline (mapped to Phase-1 sprints)
| Sprint | Focus |
|---|---|
| 0 | Africa's Talking sandbox creds (prod pending sender ID); design `attendance_record` + `class_session` per shared schema; select QR library (`qrcode` + `html5-qrcode`); confirm PostgreSQL instance (shared vs. project — decision from You). |
| 1 | Each `class_session` issues a time-bound HMAC token (60-min TTL); scan endpoint validates token, checks duplicate scan by `student_id`, writes `attendance_record`. **Server-side single-scan enforcement** (vertical-slice gate). |
| 2 | Africa's Talking SMS integration; absence trigger (no `attendance_record` for a session started >30 min ago → SMS to `guardian_phone`); daily Google Workspace PDF register per class to a shared Drive folder. **Real SMS in staging.** |
| 3 | Edge cases: no-phone students (graceful skip + log), session with no enrolled students (warning not error), Starlink outage (offline QR fallback → localStorage, sync on reconnect). Daily `attendance_record` → BigQuery for PRJ-05. **Passes Your security review.** |
| 4 | Staff UAT with real sessions; parent-alert testing with real numbers (consent); verify SMS latency < 15 min; verify Drive folder structure/permissions; confirm PRJ-05 can query `attendance_record`. |
| 5 | Production deploy; staff training doc; parent communication template. |

## Deliverables
- [ ] Sprint 1: working QR scan → `attendance_record` write with server-side single-scan enforcement.
- [ ] Sprint 2: absence-triggered SMS in staging + daily PDF register to Drive.
- [ ] Sprint 3: edge-case handling + offline fallback + BigQuery export for PRJ-05; security review passed.
- [ ] Sprint 4: UAT with SMS latency < 15 min verified.
- [ ] Sprint 5: production deploy + staff training doc + parent SMS template.

## Acceptance criteria / Definition of Done
- A student scans once per session; a replayed scan is rejected **server-side**, not just in the UI.
- An absence reliably fires an SMS to the guardian within 15 minutes (verified in UAT).
- A Starlink outage does not lose attendance — scans queue offline and sync on reconnect.
- Daily `attendance_record` rows land in BigQuery and PRJ-05 can query them.
- Production uses an approved sender ID (not a personal number).

## Risks & gotchas
- **Single-scan enforcement must be server-side.** The server checks `EXISTS(SELECT 1 FROM attendance_record WHERE session_id = ? AND student_id = ?)` before writing — frontend-only enforcement is replayable.
- **Sender-ID lead time** (7–14 days) — initiate day 1; personal number is sandbox-only.
- **Offline-first at sites** — Starlink outages are expected; design the fallback, don't bolt it on.
- Guardian-consent and PII handling fall under Rwanda's Data Protection Law — coordinate with the residency decision.
