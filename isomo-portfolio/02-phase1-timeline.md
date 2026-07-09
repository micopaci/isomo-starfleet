# Phase 1 Timeline — Sprints 0–5

**Scope:** PRJ-B (Isomo Brain harden), PRJ-08 (Curriculum Builder), PRJ-T05 (Device Tracker), PRJ-T02 (Attendance + SMS).
**Team:** You (PRJ-T05 + architecture lead), Intern 1 (PRJ-B), Intern 2 (PRJ-08), Intern 3 (PRJ-T02).
**Anchor:** Sprint 0 starts **Mon Jun 29, 2026** (the Monday after this plan was written). Sprints are two weeks each. Every date below is a relative offset — shift the anchor and the rest follows.

| Sprint | Dates (2026) | Theme | Gate to pass |
|---|---|---|---|
| 0 | Jun 29 – Jul 12 | Foundation | Shared schema doc frozen; all API accounts active; all 3 interns have working dev envs and can run their project locally. |
| 1 | Jul 13 – Jul 26 | Core build | Each project has a working vertical slice — one real end-to-end user action that touches the database. |
| 2 | Jul 27 – Aug 9 | Feature completion | PRJ-T05 code-complete; PRJ-B generated code runs in the sandbox; PRJ-08 produces a Google Slides file; PRJ-T02 sends a real SMS in staging. |
| 3 | Aug 10 – Aug 23 | Integration & hardening | PRJ-T05 in production; PRJ-B in staging with real staff accounts; PRJ-08 output reviewed by a real teacher; PRJ-T02 passes your security review. |
| 4 | Aug 24 – Sep 6 | UAT | UAT sign-off from real users; no open P0/P1 bugs; all projects in staging pointed at production-equivalent data. |
| 5 | Sep 7 – Sep 20 | Production deploy | All Phase-1 projects live; runbooks written; Phase-2 kickoff meeting scheduled. |

---

## Sprint 0 — Foundation (Jun 29 – Jul 12)
**Gate:** Shared schema doc frozen. All API accounts active. All three interns have working dev environments and can run their project locally.

| Person | Deliverables |
|---|---|
| **You** | Write the canonical entity schema (`student`, `staff`, `course`, `session`, `device`, `attendance_record`) and get it agreed before any intern writes a migration. Set up BigQuery namespaces (`staff`, `curriculum`, `student_data`). Create shared Google Cloud service accounts with least-privilege roles. Provision the Africa's Talking account and initiate Rwanda sender-ID registration (takes 1–2 weeks — start day 1). |
| **Intern 1 (PRJ-B)** | Run a BigQuery audit: document actual row counts for `documents`, `chunks`, `users`, `ingest_run_log`, `qa_audit_log`. Check vector index status (`VECTOR_INDEX_STATUS`). Inventory all encoding artifacts (mojibake in comments/strings) — output a file-by-file list. Confirm whether the pgvector Docker service is still active and raise a yes/no decommission decision to you by end of week 1. |
| **Intern 2 (PRJ-08)** | Set up the Next.js project with TypeScript. Get Claude API auth working (env-var injection, streaming response handler). Navigate the Google Workspace OAuth consent screen — **this needs your Workspace admin access, flag it immediately**. Do not block on it: stub the Google API calls with fixtures and continue. |
| **Intern 3 (PRJ-T02)** | Configure Africa's Talking sandbox credentials (prod account pending sender ID). Design the `attendance_record` and `class_session` tables in line with your shared schema. Evaluate and select a QR library (`qrcode` + `html5-qrcode` for scanning). Confirm the PostgreSQL instance (shared vs. project-specific — get a decision from you). |

---

## Sprint 1 — Core build (Jul 13 – Jul 26)
**Gate:** Each project has a working vertical slice — one real end-to-end user action that touches the database.

| Person | Deliverables |
|---|---|
| **You (PRJ-T05)** | Confirm the Microsoft Graph service principal scopes (`DeviceManagementManagedDevices.Read.All` and `.ReadWrite.All`) — **without breaking Starfleet's existing Graph calls**. Build the device-checkout UI: search by serial/asset tag, link to a student record, write to `device_assignments`. (Foundation already exists — migration 034 + `routes/inventory.js` — so this sprint extends, not bootstraps.) |
| **Intern 1 (PRJ-B)** | Split the test suite: fast offline tests (chunking logic, query routing, prompt assembly, path library) run in CI with zero live dependencies; live tests (Gemini, BigQuery, Drive) tagged separately and excluded from CI. Implement namespace isolation — every retrieval query must include a `namespace` filter, with no fallback to unfiltered results. |
| **Intern 2 (PRJ-08)** | Lesson-plan generation endpoint: `POST {objective, grade, subject, duration_minutes}` → streamed Claude API response structured as `{lesson_plan, materials, teacher_notes}`. Validate with Zod. Return raw JSON — no UI yet. |
| **Intern 3 (PRJ-T02)** | QR generation: each `class_session` generates a time-bound token (HMAC-signed, 60-minute TTL). The scan endpoint validates the token, checks for a duplicate scan by the same `student_id`, and writes an `attendance_record`. Single-scan enforcement is a **security requirement, not optional**. |

---

## Sprint 2 — Feature completion (Jul 27 – Aug 9)
**Gate:** PRJ-T05 code-complete. PRJ-B generated code runs in a sandboxed environment. PRJ-08 produces a Google Slides file. PRJ-T02 sends a real SMS in staging.

| Person | Deliverables |
|---|---|
| **You (PRJ-T05)** | Repair-ticket flow (submit → assign → resolve with notes + cost field). Condition-photo upload (resize to max 800px before storage — do not store originals). Automated overdue alert (loaner devices not returned after X days → email + dashboard flag). Write the `device_lifecycle` schema additions for `REPAIR_START`/`REPAIR_COMPLETE`. Sign off on Intern 1's `code_executor` sandbox threat model before it goes to staging. |
| **Intern 1 (PRJ-B)** | `code_executor` sandbox hardening: dedicated read-only BigQuery service account scoped to allowed datasets only; max row return 10,000; query cost limit via `maximum_bytes_billed`; no filesystem writes outside `/tmp/workspace`; no outbound network except BigQuery and Vertex AI endpoints. Every execution writes to `code_execution_log` (script, stdout, stderr, runtime_ms, user_id, status). Present the threat model to you for sign-off. |
| **Intern 2 (PRJ-08)** | Google Slides API: generate a slide per lesson section using proper API calls (not template fill). Google Docs API: lesson plan as a formatted Doc. PDF: use the Drive export endpoint (`/export?mimeType=application/pdf`) — do not install a PDF library. All three output types from one generation request. |
| **Intern 3 (PRJ-T02)** | Africa's Talking SMS integration (if sender ID approved — if not, use a personal number in sandbox). Absence trigger: if a student has no `attendance_record` for a session that started more than 30 minutes ago, fire an SMS to `guardian_phone`. Daily Google Workspace export: write a PDF register per class to a shared Drive folder. |

---

## Sprint 3 — Integration & hardening (Aug 10 – Aug 23)
**Gate:** PRJ-T05 in production. PRJ-B in staging with real staff accounts. PRJ-08 output reviewed by a real teacher. PRJ-T02 passes your security review.

| Person | Deliverables |
|---|---|
| **You (PRJ-T05)** | Production deployment. Write the device-tracker runbook. Begin cross-project architecture review — confirm all three intern projects are on the shared PostgreSQL schema, not parallel databases. Review the PRJ-T02 QR security model in depth (time-bound token, single-scan enforcement, rate limiting on the scan endpoint). Review PRJ-B's sandbox threat-model output from Sprint 2. |
| **Intern 1 (PRJ-B)** | LibreChat auth verification in prod: confirm domain restriction, session handling, and that unauthenticated requests cannot reach the RAG endpoint. Add health-monitoring endpoints (`/health`, `/health/bigquery`, `/health/vector_index`). Set up BigQuery query-cost alerts — you need a ceiling before real users hit the data-query path. |
| **Intern 2 (PRJ-08)** | Rwanda curriculum alignment: get the official curriculum document (or a summary), extract the subject/grade/standard hierarchy, and add a validation step that checks generated lesson objectives against it. Rubric generation: given the lesson plan, generate a 4-criterion rubric with descriptor levels. Have one real Isomo teacher review the full output — get written feedback. |
| **Intern 3 (PRJ-T02)** | Edge-case hardening: no-phone-number students (graceful skip + log), session created but no students enrolled (warning state, not error), Starlink outage during a session (offline QR fallback — write to localStorage, sync on reconnect). BigQuery export: pipe daily `attendance_record` rows to BigQuery as structured data for PRJ-05 downstream. |

---

## Sprint 4 — UAT (Aug 24 – Sep 6)
**Gate:** UAT sign-off from real users. No open P0 or P1 bugs. All projects in staging pointed at production-equivalent data.

| Person | Deliverables |
|---|---|
| **You** | PRJ-B production deployment config (not the deploy — that's Sprint 5). Set up monitoring: BigQuery slot-usage alerts, Gemini API error-rate dashboard, Telegram bot status. Run a cost projection based on Sprint-4 usage patterns — flag to Bridge2Rwanda leadership if the monthly API cost is above threshold. |
| **Intern 1 (PRJ-B)** | Structured staff UAT: 5+ staff users, 20+ questions from a gold question set (verified answers known in advance). Score: citation accuracy, answer correctness, role-filter enforcement (no staff user should retrieve student PII from a student-scoped namespace). Document all failures — no closing UAT until the P0/P1 rate is zero. |
| **Intern 2 (PRJ-08)** | Teacher UAT: minimum 3 teachers across different subjects. Capture: does the lesson plan match the actual time available? Is the Google Slides output usable as-is or does it need significant editing? Is the rubric grading-ready? Iterate on the Claude prompt until teacher feedback is net-positive. Document the prompt version that ships. |
| **Intern 3 (PRJ-T02)** | Staff UAT with real teachers running real class sessions. Parent-alert testing: use real phone numbers (with consent). Verify SMS delivery latency is under 15 minutes. Verify the Google Workspace Drive folder structure is correct and accessible to the right people. Run the BigQuery export and confirm PRJ-05 can query the `attendance_record` table. |

---

## Sprint 5 — Production deploy (Sep 7 – Sep 20)
**Gate:** All Phase-1 projects live. Runbooks written. Phase-2 kickoff meeting scheduled.

| Person | Deliverables |
|---|---|
| **You** | Production push for PRJ-B, PRJ-08, PRJ-T02 (in that order — Brain first since PRJ-08 may call it). Review all three intern runbooks before deploying. Set up unified error alerting (one Slack/email channel for all four projects). Brief the remaining 3 interns on Phase-2 scope. |
| **Intern 1 (PRJ-B)** | Production hardening: confirm BigQuery row counts post-deploy match staging. Write the admin runbook: what to do when ingestion fails, when retrieval quality drops, when the Telegram bot goes silent, when a namespace query returns zero results. |
| **Intern 2 (PRJ-08)** | Production deploy. Write the teacher onboarding guide (2 pages max — input fields, what each output type looks like, how to regenerate). Hand off the Rwanda curriculum-alignment data to the Isomo academic team for ongoing updates. |
| **Intern 3 (PRJ-T02)** | Production deploy. Write the staff training doc (how to start a session, what the QR looks like, what happens when a student can't scan). Write the parent communication template explaining what the SMS alerts mean and how to respond. |

---

## Milestones

| Date (2026) | Milestone | Owner | Risk if missed |
|---|---|---|---|
| Jul 12 | Schema frozen, all API accounts active, all dev envs running | You | All 3 interns blocked — no parallel work possible |
| Aug 9 | PRJ-T05 code-complete | You | Delays your Sprint-3 cross-project review bandwidth |
| Aug 23 | PRJ-T05 in production | You | No production reference point before other deployments |
| Sep 6 | All projects in staging, UAT started | All | Compresses Sprint 5 — no buffer before Sep 20 |
| Sep 20 | Phase 1 complete, Phase 2 kickoff | All | 3 idle interns waiting on Phase-2 scope |

---

## Sprint-0 critical-path gotchas (start these on day 1)

- **Google OAuth consent screen gates Intern 2.** It requires your Google Workspace admin account to add the app as an internal application; external verification takes weeks. Do this on day 1 of Sprint 0, not when Intern 2 hits it in week 3.
- **Africa's Talking sender-ID registration in Rwanda is not instant** (7–14 days). Initiate it the same day you create the account. If it isn't approved by Sprint 2, PRJ-T02 SMS testing uses a personal number — acceptable in sandbox, not in production.
- **The pgvector-vs-BigQuery decision must be made in Sprint 0, not Sprint 2.** Intern 1 cannot write namespace-isolation logic against an ambiguous storage backend. Decision: decommission pgvector or give it an explicit current job. There is no third option.
- **Your architecture bandwidth in weeks 1–2 is the top project risk.** If you get pulled into a Starlink site outage or an Intune emergency, the schema decision slips and all three interns have no ground to build on. Block your calendar for a minimum of half-days on schema and API-account work during Sprint 0. This is not optional time.
- **The `code_executor` sandbox threat model requires your explicit sign-off before staging.** Do not let Intern 1 promote sandboxed code execution to any environment with real staff data without a documented threat model you have reviewed. Misconfigured read permissions on BigQuery can expose the entire `student_data` namespace.
- **PRJ-T02 QR tokens must be time-bound and single-use on the server side, not just client-side.** If single-scan enforcement is frontend-only, a student can replay the request. The server must check `EXISTS(SELECT 1 FROM attendance_record WHERE session_id = ? AND student_id = ?)` before writing.
- **PRJ-T05 and Starfleet share Intune Graph API permissions.** If you rotate the service principal or change the Entra app registration for PRJ-T05, verify it does not break Starfleet's existing Graph calls. Document the exact permission set required for both systems in Sprint 0 before touching credentials.
- **No intern deploys to production unsupervised.** All Sprint-5 production pushes are executed by you, after reviewing the intern's staging environment directly. Set this as a written team norm on day 1.
