# Phase 2 Outlook — Remaining Projects (months 3–6+)

These are the projects beyond the Phase-1 four. Detail is deliberately lighter than [02-phase1-timeline.md](02-phase1-timeline.md): they are months out, dependencies will shift as Phase-1 ships, and over-specifying now produces stale plans. Each entry gives scope, audience, rough staffing/timeline, impact, key deliverables, and what it depends on.

> Sequencing principle: rotate teams onto these only after their Phase-1 project is live and stable. Student-facing apps (PRJ-04, T01, T06, T07) need a real 2–4 week student UAT window before production. Any externally/community-facing surface waits until ≥3 internal projects are stable.

---

## Continuing AI flagship

### PRJ-04 — Isomo AI Tutor
- **Audience:** Students · **~2 interns · 3–4 months · Impact: Massive**
- **Scope:** Student-facing tutor (web + React Native) over the curriculum namespace, logging every question for downstream use.
- **Key deliverables:** curriculum-namespace chat with citations; question-logging pipeline; Kinyarwanda domain-term validation pass; React Native client; student UAT sign-off.
- **Depends on:** PRJ-B in production; Kinyarwanda reviewer budget; student PII residency decision.

### PRJ-05 — Adaptive learning pathways
- **Audience:** Students · **~2 interns · 3–4 months · Impact: High**
- **Scope:** ML engine + dashboard building per-student profiles from tutor logs, attendance signals, and scores; recommends pathways.
- **Key deliverables:** student-data audit (residency) sign-off; profile feature store in `student_data` namespace; pathway recommendation model; teacher/student dashboard; ingestion from PRJ-04 question logs and PRJ-T02 attendance.
- **Depends on:** PRJ-B; PRJ-04 question logs; PRJ-T02 attendance export; **student-data audit (hard blocker)**.

---

## Pure-tech (Phase-2 candidates)

### PRJ-T01 — Offline-first LMS (PWA)
- **Audience:** Students · **~2 interns · 3–4 months · Impact: Massive**
- **Scope:** PWA letting students at Starlink sites access content and submit work offline via IndexedDB + Background Sync.
- **Key deliverables:** offline shell + service worker with a max cache quota (fail gracefully); IndexedDB content store; Background Sync submission queue; conflict handling on reconnect; site-level content packs.
- **Depends on:** shared schema; the offline shell is **reused by PRJ-T07 (exams)** — build it to be reusable. Watch IndexedDB storage limits (Chromium grants up to 60% of disk; laptop disk sizes are heterogeneous).

### PRJ-T03 — Student fee & MoMo tracker
- **Audience:** Ops · **1 intern · 2–3 months · Impact: High**
- **Scope:** MTN MoMo collection, PDF receipts, balance dashboard, SMS payment reminders.
- **Key deliverables:** MoMo collection integration; `payment` ledger; PDF receipt generation; balance dashboard; reminder SMS via the shared Africa's Talking layer.
- **Depends on:** **MTN MoMo business registration + sandbox approval — start the application early (2–6 weeks lead time)**; shared `payment` schema; Africa's Talking layer from PRJ-T02.

### PRJ-T04 — Smart timetable scheduler
- **Audience:** Ops · **~2 interns · 2–3 months · Impact: High**
- **Scope:** OR-Tools constraint solver that generates a conflict-free schedule from teacher/room/subject constraints.
- **Key deliverables:** constraint model (CSP, not a greedy heuristic); solver service (verify Python 3.9+); schedule editor UI; published timetable API consumed by PRJ-T10.
- **Depends on:** shared `course`/`session`/`staff` schema. **Build this before PRJ-T10** so the leave portal can flag affected sessions.

### PRJ-T06 — Offline video library
- **Audience:** Students · **~2 interns · 3–4 months · Impact: High**
- **Scope:** Self-hosted HLS video with service-worker caching — no YouTube dependency.
- **Key deliverables:** HLS transcode pipeline; self-hosted streaming; service-worker cache with quota management; catalogue UI; integrates with PRJ-T12.
- **Depends on:** PRJ-T01 offline-shell patterns; storage/bandwidth budget at sites.

### PRJ-T07 — Digital exam platform
- **Audience:** Students/Teachers · **~2 interns · 3–4 months · Impact: Massive**
- **Scope:** Intune kiosk-mode exams, auto-scored MCQ, offline fallback, tab-switch detection.
- **Key deliverables:** Intune kiosk config profile (≈30-min Intune task — document alongside the platform); exam authoring + auto-scoring; offline fallback (reuse PRJ-T01 shell); integrity signals (tab-switch detection); teacher results view.
- **Depends on:** PRJ-T01 offline shell; Intune (already managed in this repo); student + teacher UAT.

### PRJ-T08 — Alumni outcomes tracker
- **Audience:** Ops · **1 intern · 6–8 weeks · Impact: Medium**
- **Scope:** Annual SMS check-in, cohort outcome dashboard for donor reports.
- **Key deliverables:** alumni contact store; annual SMS check-in flow; outcome data capture; cohort dashboard + donor-report export.
- **Depends on:** shared Africa's Talking layer; `student`/alumni schema.

### PRJ-T09 — Facilities & maintenance
- **Audience:** Staff/Ops · **1 intern · 6–8 weeks · Impact: Medium**
- **Scope:** Photo-tagged repair tickets with SLA alerting; replaces WhatsApp escalation chains.
- **Key deliverables:** ticket model with photo attachment; SLA timer + escalation alerts; assignment workflow; staff dashboard. (Mirrors the PRJ-T05 repair-ticket pattern — reuse it.)
- **Depends on:** shared `staff` schema; reuse PRJ-T05 ticket/photo patterns.

### PRJ-T10 — Staff HR & leave portal
- **Audience:** Staff · **~2 interns · 3–4 months · Impact: High**
- **Scope:** Leave requests + approvals with timetable-conflict detection, Google Workspace SSO.
- **Key deliverables:** leave request/approval workflow; **timetable-conflict detection (consumes PRJ-T04 API)**; Google Workspace SSO; manager dashboard.
- **Depends on:** **PRJ-T04 timetable API (hard) — a leave approval that doesn't flag affected class sessions is half a product**; Google Workspace OAuth (already set up for PRJ-08).

### PRJ-T11 — Peer tutoring matcher
- **Audience:** Students · **1 intern · 6–8 weeks · Impact: Medium**
- **Scope:** Subject + availability matching between students, session logs, tutor leaderboard.
- **Key deliverables:** matching algorithm (subject + availability); session logging; tutor leaderboard; student-facing UI.
- **Depends on:** shared `student`/`course` schema.

### PRJ-T12 — Digital library + resource hub
- **Audience:** Students/Staff · **1 intern · 6–8 weeks · Impact: Medium**
- **Scope:** ISBN-scan catalogue, checkout tracking, overdue SMS; integrates with PRJ-T06.
- **Key deliverables:** ISBN-scan cataloguing; checkout/return ledger; overdue SMS reminders; integration with PRJ-T06 video library; (Phase-2 translation module ties to PRJ-08 — Kinyarwanda validation applies).
- **Depends on:** shared Africa's Talking layer; PRJ-T06; PRJ-08 for the translation module.

---

## Phase-2 sequencing dependencies (build order matters)
- **PRJ-T04 before PRJ-T10** — the leave portal needs the timetable API.
- **PRJ-T01 before PRJ-T07** — the exam platform reuses the offline shell.
- **PRJ-B + PRJ-04 before PRJ-05** — adaptive pathways needs tutor question logs and the curriculum namespace.
- **PRJ-T02 before PRJ-05** — adaptive pathways consumes the attendance export.
- **Start MTN MoMo registration early** if PRJ-T03 is in scope — it has weeks of lead time.
