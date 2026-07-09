# PRJ-B — Isomo Brain (harden & ship)

> **Owner:** Intern 1 (closest mentorship from You) · **Audience:** Staff · **Timeline:** 6–8 weeks (Phase 1) · **Impact:** Foundation

## Context
Isomo Brain is an existing (~65–75% complete) Retrieval-Augmented-Generation backend: multi-format ingestion, a BigQuery vector store with namespace/role filtering, a FastAPI layer (chat · RAG · data-query · reports), a `query_router.py` for namespace + intent routing, a sandboxed `code_executor.py` for analytics, and a `qa_audit_log`. It is **the shared backend for the AI product line** — PRJ-04 (Tutor), PRJ-05 (Adaptive Pathways), and PRJ-08 (Curriculum Builder) all extend it rather than rebuild a RAG pipeline three times.

**Why now:** Everything in the AI track depends on this. Hardening it first gets the first staff feature live in ~6–8 weeks and the first student feature as a ~6–8 week extension, versus ~4 greenfield months per project. The Phase-1 goal is a **hardened, staff-facing v1** (LibreChat + Telegram), not new product surface.

> **Repo note:** Isomo Brain is **not** in this monorepo — it is a separate Python/FastAPI/BigQuery system. This brief plans at the program level; the intern works in that separate repo. Coordinate the shared canonical schema with the Sprint-0 work done here.

## Dependencies
- **Upstream:** the Sprint-0 canonical schema and BigQuery namespaces (`staff`, `curriculum`, `student_data`).
- **Downstream:** PRJ-04, PRJ-05, PRJ-08 — they cannot reach production stability until Brain is stable.
- **Decision gate:** the **pgvector-vs-BigQuery** storage decision must be made in Sprint 0. Namespace-isolation logic cannot be written against an ambiguous backend.

## Scope
**In:** test-suite split (fast offline vs. live-dependency); namespace isolation (mandatory `namespace` filter, no unfiltered fallback); `code_executor` sandbox hardening; health endpoints; cost ceilings; LibreChat + Telegram staff v1; structured staff UAT; admin runbook.
**Out:** student/teacher frontends (those are PRJ-04/05/08); new ingestion sources beyond what exists; net-new analytics features.

## Timeline (mapped to Phase-1 sprints)
| Sprint | Focus |
|---|---|
| 0 | BigQuery audit (row counts for `documents`, `chunks`, `users`, `ingest_run_log`, `qa_audit_log`); vector index status; encoding-artifact inventory; **pgvector decommission yes/no by end of week 1**. |
| 1 | Test-suite split (offline tests in CI, live tests tagged out); namespace isolation enforced on every retrieval. |
| 2 | `code_executor` sandbox hardening (read-only scoped BQ service account, 10k row cap, `maximum_bytes_billed`, `/tmp/workspace`-only writes, no outbound network except BQ + Vertex, full `code_execution_log`); **present threat model to You for sign-off**. |
| 3 | LibreChat auth verification in prod (domain restriction, sessions, no unauth path to RAG); health endpoints (`/health`, `/health/bigquery`, `/health/vector_index`); BigQuery cost alerts. |
| 4 | Structured staff UAT: 5+ users, 20+ gold questions; score citation accuracy, correctness, role-filter enforcement. No closing UAT until P0/P1 = 0. |
| 5 | Production hardening (row counts match staging); admin runbook. **You deploy Brain first** (PRJ-08 may call it). |

## Deliverables
- [ ] Sprint 0: BigQuery audit report; pgvector decommission decision; encoding-artifact file list.
- [ ] Sprint 1: CI green on offline tests with zero live dependencies; namespace filter enforced everywhere.
- [ ] Sprint 2: hardened sandbox + documented threat model signed off by You.
- [ ] Sprint 3: health endpoints live; cost ceiling + alerts configured.
- [ ] Sprint 4: staff UAT scorecard with zero open P0/P1.
- [ ] Sprint 5: admin runbook (ingestion failure, retrieval-quality drop, Telegram-bot silence, zero-result namespace query).

## Acceptance criteria / Definition of Done
- No retrieval query can return unfiltered (cross-namespace) results — verified by test.
- A staff user cannot retrieve student PII from a student-scoped namespace.
- Sandbox executes generated analytics code with no path to write outside `/tmp/workspace` or reach the network beyond BQ/Vertex; every run is logged.
- Health endpoints report BigQuery and vector-index status; cost alerts fire below a defined ceiling.
- Staff UAT passes with zero open P0/P1; admin runbook reviewed by You.

## Risks & gotchas
- **pgvector vs. BigQuery ambiguity** blocks the intern — resolve in Sprint 0.
- **Sandbox threat model** must be signed off by You before staging; misconfigured BQ read perms can expose the whole `student_data` namespace.
- **Claude API is a single point of failure** — the shared retry-buffered API client must be in place from day 1.
- Kinyarwanda domain-term degradation surfaces here first; budget the reviewer pass (also affects PRJ-04).
