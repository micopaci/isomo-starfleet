# Isomo AI/Tech Project Portfolio

> Preliminary program plan for Isomo EdTech's intern-built AI & technology projects.
> **Status:** Draft / preliminary · **Last updated:** 2026-06-23 · **Owner:** Architecture lead ("You") + 3 technical interns

---

## What this is

Isomo wants to use AI and modern tooling to **ease the team's work** and **improve how students learn**. We have 6 interns who can code and do data analysis, and a window of access to strong AI models. This folder turns an exploratory brainstorm into an executable plan: a catalogue of **16 projects**, a two-phase delivery shape, and a sprint-level timeline with concrete deliverables for the first four projects.

Not every project is "AI-powered" — most are plain tech that removes manual work or paper processes. The AI projects are sequenced so they build on a shared backend rather than three teams reinventing the same RAG pipeline.

## How to read this folder

| File | What's in it |
|---|---|
| [00-portfolio-overview.md](00-portfolio-overview.md) | The full catalogue of all 16 projects, the "extend Isomo Brain" architecture decision, the dependency map, and cross-cutting constraints. **Start here for the big picture.** |
| [01-intern-allocation.md](01-intern-allocation.md) | Phasing, who owns what, and cross-cutting responsibilities. |
| [02-phase1-timeline.md](02-phase1-timeline.md) | The deep plan: 6 sprints (Jun 29 → Sep 20, 2026), gates, and per-person deliverables. **Start here to execute.** |
| [03-phase2-outlook.md](03-phase2-outlook.md) | Lighter scope/deliverable outlines for the remaining projects (months 3–6). |
| [briefs/](briefs/) | Deep per-project briefs for the four Phase-1 projects. |

## The 16 projects at a glance

**Flagship (AI-powered) — Phase-1 priority in bold**

| ID | Project | Audience | Interns | Timeline | Impact |
|---|---|---|---|---|---|
| **PRJ-B** | **Isomo Brain — harden & ship** | Staff | 2 | 6–8 weeks | Foundation |
| PRJ-04 | Isomo AI Tutor | Students | 2 | 3–4 months | Massive |
| PRJ-05 | Adaptive learning pathways | Students | 2 | 3–4 months | High |
| **PRJ-08** | **AI curriculum builder** | Teachers | 2 | 2–3 months | High |

**Pure tech (no AI required) — Phase-1 priority in bold**

| ID | Project | Audience | Interns | Timeline | Impact |
|---|---|---|---|---|---|
| PRJ-T01 | Offline-first LMS (PWA) | Students | 2 | 3–4 months | Massive |
| **PRJ-T02** | **Attendance + parent SMS** | Staff/Ops | 2 | 2–3 months | High |
| PRJ-T03 | Student fee & MoMo tracker | Ops | 1 | 2–3 months | High |
| PRJ-T04 | Smart timetable scheduler | Ops | 2 | 2–3 months | High |
| **PRJ-T05** | **Device asset tracker** | IT/Ops | 1 | 6–8 weeks | High |
| PRJ-T06 | Offline video library | Students | 2 | 3–4 months | High |
| PRJ-T07 | Digital exam platform | Students/Teachers | 2 | 3–4 months | Massive |
| PRJ-T08 | Alumni outcomes tracker | Ops | 1 | 6–8 weeks | Medium |
| PRJ-T09 | Facilities & maintenance | Staff/Ops | 1 | 6–8 weeks | Medium |
| PRJ-T10 | Staff HR & leave portal | Staff | 2 | 3–4 months | High |
| PRJ-T11 | Peer tutoring matcher | Students | 1 | 6–8 weeks | Medium |
| PRJ-T12 | Digital library + resource hub | Students/Staff | 1 | 6–8 weeks | Medium |

## The shape of delivery

- **Phase 1 (months 1–3):** four projects run in parallel — **PRJ-B, PRJ-08, PRJ-T05, PRJ-T02** — owned by You (architecture lead, PRJ-T05) and three interns. This is the focus of [02-phase1-timeline.md](02-phase1-timeline.md).
- **Phase 2 (months 3–6):** teams rotate onto the next wave once Phase-1 projects ship and stabilize.

## Three rules that override everything

1. **Shared schema before any code.** At least 10 of the 16 projects share `student`, `staff`, `course`, and `document` entities. One week of canonical schema design up front saves three months of migrations later. You own this decision in week 1.
2. **The Claude API is a single point of failure** across most AI projects. A rate-limit incident or outage cascades across the whole product suite. Build a shared API client with offline-buffered retry queues **from day one**, not as a later refactor.
3. **Rwanda data residency.** Student PII on non-local cloud infrastructure may have compliance implications under Rwanda's 2021 Data Protection Law. Confirm the storage jurisdiction with Bridge2Rwanda's legal side before any student records leave an approved location.

> **Reality check (from repo research):** PRJ-T05 is already ~50% built in this repo, Isomo Brain (PRJ-B) lives in a separate system, and the shared `staff`/`course`/`session`/`attendance`/`payment` entities do not exist yet. See the "Research callouts" in [00-portfolio-overview.md](00-portfolio-overview.md#research-callouts-pdf-assumptions-vs-repo-reality) for how this changes the estimates.
