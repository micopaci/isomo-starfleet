# Portfolio Overview — All 16 Projects

This is the full catalog. Each project has an ID, audience, intern count, rough timeline, impact rating, and the single biggest blocker to starting. The four Phase-1 projects are described in depth in [briefs/](briefs/); everything else has a one-paragraph scope here and a lighter outline in [03-phase2-outlook.md](03-phase2-outlook.md).

---

## A. Flagship AI-powered projects (4)

### PRJ-B — Isomo Brain (harden & ship)
- **Audience:** Staff · **Interns:** 2 · **Timeline:** 6–8 weeks · **Impact:** Foundation
- **What it is:** Isomo Brain is the existing (≈65–75% complete) Retrieval-Augmented-Generation backend: multi-format document ingestion, a BigQuery vector store with namespace/role filtering, a FastAPI layer for chat + RAG + structured data queries, a `query_router.py` for namespace/intent routing, a sandboxed `code_executor.py` for analytics, and a `qa_audit_log`. The job is to **harden it and ship a staff-facing v1** (LibreChat + Telegram), not to add new product surface.
- **Why it matters:** It is the shared backend for PRJ-04, PRJ-05, and PRJ-08. Building those three separately means rebuilding ingestion, embeddings, audit logging, and role-based access three times. Hardening Brain first gets the first student/teacher feature live in ~6–8 weeks instead of ~4 greenfield months.
- **Key blocker:** *Do this first — everything below depends on it.* The pgvector-vs-BigQuery storage decision must be made before namespace-isolation logic can be written.

### PRJ-04 — Isomo AI Tutor
- **Audience:** Students · **Interns:** 2 · **Timeline:** 3–4 months · **Impact:** Massive
- **What it is:** A student-facing tutor (web + React Native) that answers questions against the curriculum namespace and logs every question. Those question logs are upstream data for PRJ-05 (adaptive pathways) and early-warning signals.
- **Key blocker:** Kinyarwanda domain-term validation (math/science terminology degrades); blocked on PRJ-B production stability.

### PRJ-05 — Adaptive learning pathways
- **Audience:** Students · **Interns:** 2 · **Timeline:** 3–4 months · **Impact:** High
- **What it is:** An ML engine + dashboard that builds per-student profiles (from tutor question logs, attendance signals, scores) and recommends learning pathways. Feeds the Opportunity Matcher downstream.
- **Key blocker:** Student PII residency (Rwanda Data Protection Law) + the shared schema. **Blocked until the student-data audit is done** — do not wire real student data in before then.

### PRJ-08 — AI curriculum builder
- **Audience:** Teachers · **Interns:** 2 · **Timeline:** 2–3 months · **Impact:** High
- **What it is:** A teacher tool that generates lesson plans, slides, rubrics, and materials from `{objective, grade, subject, duration}`. Calls the Claude API directly (and later the curriculum namespace), so it can **start in parallel without waiting on PRJ-B**. Most self-contained of the AI projects.
- **Key blocker:** None hard — ships fastest. Needs Google Workspace OAuth consent (admin-gated) and a real-teacher review loop.

---

## B. Pure-tech projects (12, no AI required)

| ID | Project | What it solves | Audience | Interns | Timeline | Impact |
|---|---|---|---|---|---|---|
| PRJ-T01 | Offline-first LMS (PWA) | Students at Starlink sites access content + submit offline via IndexedDB + Background Sync | Students | 2 | 3–4 mo | Massive |
| PRJ-T02 | Attendance + parent SMS | QR-based class register; absence triggers an Africa's Talking SMS to the parent within 15 min | Staff/Ops | 2 | 2–3 mo | High |
| PRJ-T03 | Student fee & MoMo tracker | MTN MoMo collection, PDF receipts, balance dashboard, SMS payment reminders | Ops | 1 | 2–3 mo | High |
| PRJ-T04 | Smart timetable scheduler | OR-Tools constraint solver generates a conflict-free schedule from teacher/room/subject constraints | Ops | 2 | 2–3 mo | High |
| PRJ-T05 | Device asset tracker | Lifecycle layer on Intune: checkout, condition photo, repair tickets, loaner-overdue alerts | IT/Ops | 1 | 6–8 wk | High |
| PRJ-T06 | Offline video library | Self-hosted HLS video + service-worker caching — no YouTube dependency | Students | 2 | 3–4 mo | High |
| PRJ-T07 | Digital exam platform | Intune kiosk-mode exams, auto-scored MCQ, offline fallback, tab-switch detection | Students/Teachers | 2 | 3–4 mo | Massive |
| PRJ-T08 | Alumni outcomes tracker | Annual SMS check-in, cohort outcome dashboard for donor reports | Ops | 1 | 6–8 wk | Medium |
| PRJ-T09 | Facilities & maintenance | Photo-tagged repair tickets, SLA alerting; replaces WhatsApp escalation chains | Staff/Ops | 1 | 6–8 wk | Medium |
| PRJ-T10 | Staff HR & leave portal | Leave requests + approvals with timetable-conflict detection, Google Workspace SSO | Staff | 2 | 3–4 mo | High |
| PRJ-T11 | Peer tutoring matcher | Subject + availability matching between students, session logs, tutor leaderboard | Students | 1 | 6–8 wk | Medium |
| PRJ-T12 | Digital library + resource hub | ISBN-scan catalogue, checkout tracking, overdue SMS; integrates with PRJ-T06 | Students/Staff | 1 | 6–8 wk | Medium |

---

## Strategic notes

### Two axes: depth vs. breadth
The portfolio spans **depth** (infrastructure and data projects that compound in value over time — Isomo Brain, adaptive pathways, the shared schema) and **breadth** (student/teacher-facing apps that generate immediate visible impact — attendance SMS, exam platform, video library). With 6 interns you can run 2–3 in parallel per sprint; the phasing in [01-intern-allocation.md](01-intern-allocation.md) balances one deep project against faster-shipping breadth projects each phase.

### Architecture decision: extend Isomo Brain, don't rebuild PRJ-04/05/08
Isomo Brain is **already the backend** for the three AI projects. The correct move is to harden it first, then add namespaces and frontends — not to spin up three greenfield RAG pipelines.

| Dimension | Build PRJ-04/05/08 separately | Extend Isomo Brain |
|---|---|---|
| RAG backend | 3 new pipelines from scratch | 1 shared (already 65–75% done) |
| Gemini embedding costs | 3× separate pipelines | 1 shared pipeline, namespace-filtered |
| Audit/logging | Build per project | `qa_audit_log` already exists |
| Role-based access | Implement 3× | Namespace filtering already present |
| Time to first student feature | ~4 months greenfield | ~6–8 weeks as an extension |
| Analytics engine | Rebuild for PRJ-05 | `code_executor.py` already built |
| Maintenance | 3 separate deployments | 1 deployment, 3 frontends |
| Risk | High — no proven foundation | Lower — existing codebase |

**Unified architecture (target):**

```
Google Drive (curriculum · policies · reports) ─┐
                                                 ├─▶  ISOMO BRAIN (shared backend, harden first)
Google Sheets / CSV (student performance) ──────┘     ├─ ingest.py     extract · chunk · embed · classify
                                                       ├─ BigQuery      documents · chunks · users · audit · student_data · paths
                                                       ├─ FastAPI       chat · RAG · data-query · reports
                                                       ├─ query_router  namespace + intent routing
                                                       └─ code_executor sandboxed BigQuery analytics
                                                                 │
        ┌────────────────────────────────────────────────────────────────────────┐
        ▼ staff namespace                ▼ curriculum namespace        ▼ analytics namespace
   LibreChat + Telegram          PRJ-04 AI Tutor (web + RN)         PRJ-05 Adaptive Pathways
   (Isomo Brain Staff v1)        PRJ-08 Curriculum Builder          (ML engine + dashboard,
   🟢 in progress                🔵 extend curriculum NS            🟡 blocked — audit student data first)
```

### Inter-project dependency map
```
PRJ-B  (Isomo Brain)
  ├─ PRJ-04 (AI Tutor) ─ question logs ─▶ PRJ-05 (Adaptive Pathways) ─▶ PRJ-06 Early Warning / Opportunity Matcher
  └─ PRJ-08 (Curriculum Builder) ─▶ PRJ-T12 (Library, phase-2 translation module)

PRJ-T02 (Attendance) ─ attendance signals ─▶ PRJ-05 (Adaptive Pathways)
PRJ-T01 (Offline LMS) ─ offline shell reused by ─▶ PRJ-T07 (Exams)
PRJ-T05 (Device Tracker) ─ Starlink/Intune telemetry already flowing → minimal new infra
PRJ-01 Starfleet AIOps (telemetry) ─▶ PRJ-02 IT Helpdesk (diagnosis data)
PRJ-03 Carbon Scheduler ─▶ PRJ-01 AIOps (scheduling constraints)
```

### Cross-cutting constraints & gotchas
- **Shared schema before everything.** ≥10 of 16 projects share `student`, `staff`, `course`, `device`, `payment`, and `document` entities. Agree canonical definitions in one intern-week at the very start — it saves ~3 months of migration pain.
- **Kinyarwanda NLP accuracy is uneven.** The Claude API handles it better than most OSS options, but domain education vocabulary (math/science terms, curriculum-specific phrasing) degrades. Budget a validation pass with Kinyarwanda-fluent reviewers specifically on **PRJ-04** and **PRJ-T12** (translation).
- **Rwanda data residency.** Student PII on Supabase/AWS-style non-local infrastructure may breach the 2021 Data Protection Law. Confirm with legal **before** student records leave an approved jurisdiction.
- **Claude API is a single point of failure** across most AI projects. Build a shared API client with offline-buffered retry queues **from day one**.
- **Intern ramp-up is real.** Budget 2–3 weeks per intern for orientation, tooling, and a first merged PR — roughly 12–18 person-weeks of non-delivery time at the start. Front-load the most-familiar intern onto the highest-complexity work.
- **Student-facing tools need real student UAT** (not just intern testing). Allocate explicit 2–4 week UAT windows with real Isomo students before PRJ-04/PRJ-T06/PRJ-T07 go to production.
- **Community / external-facing projects** carry different SLA, moderation, and support burdens. Don't launch any externally-facing surface until at least 3 internal-facing projects have shipped and stabilized. Sequence them as a reward milestone, not a first sprint.

### Research callouts: PDF assumptions vs. repo reality
The original brainstorm treated all projects as greenfield. Exploration of this repo (the Starlink Fleet Monitor / "Isomo Pulse" monorepo) found otherwise:

- **PRJ-T05 is already ~50% built here.** `packages/backend/migrations/034_device_inventory_management.sql` created the `device_assignments` (custody) and `device_lifecycle_logs` (audit) ledgers plus `hardware_status`/`profile_number` on `devices`; `packages/backend/routes/inventory.js` exposes `GET /api/inventory`, `POST /api/inventory/intake`, `POST /api/inventory/reconcile`; the `DeviceAssignment`/`DeviceLifecycleLog` types exist in `packages/shared/src/types.ts`; and Intune/Graph sync already runs (`packages/backend/services/graph.js`, migrations 020/021). **The work is an extension, not a build.** See [briefs/prj-t05-device-asset-tracker.md](briefs/prj-t05-device-asset-tracker.md).
- **The shared-schema blocker is genuine.** `staff`, `course`, `session`, `attendance`/`attendance_record`, and `payment` do not exist yet — `types.ts` has only Student, Device, Site, and User. The Sprint-0 schema work truly gates the three interns.
- **Isomo Brain is NOT in this repo.** There is no FastAPI/BigQuery/RAG/Python service here (`data_usage/` holds one-off scrapers only). PRJ-B work happens in a **separate system/repo** — this program spans more than one codebase.
- **Migrations run to 037**; Phase-1 schema migrations start at **038**. Auth is JWT (RS256/HS256, `packages/backend/routes/auth.js`); deploy is Cloud Run (backend, push to `main`) + Vercel (web).
