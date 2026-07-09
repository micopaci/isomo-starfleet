# Intern Allocation & Phasing

Intern-weeks are finite. With a team of "You + 3 technical interns" for the first wave (and 3 more interns in reserve), the portfolio needs explicit phasing — not 16 projects started at once.

> **Roles use placeholders** (You / Intern 1 / Intern 2 / Intern 3). Swap in real names before kickoff. "You" = the architecture lead who already owns the Starfleet/Intune codebase.

---

## Phase 1 (months 1–3): four projects in parallel

| Team | Project | Why now |
|---|---|---|
| A (2 interns capacity → 1 lead intern) | PRJ-B Isomo Brain — harden | Unblocks PRJ-04, 05, 08; longest-running in-flight system |
| B | PRJ-08 Curriculum Builder | Calls the Claude API directly, no PRJ-B dependency — ships fastest |
| C | PRJ-T05 Device asset tracker | Builds on existing Intune + inventory work — shortest scope |
| D | PRJ-T02 Attendance + parent SMS | High operational demand, ~2-month build, Africa's Talking is simple |

For the actual first wave we run a **lean four**, one owner each:

## Phase-1 team assignments

| Person | Owns | Rationale |
|---|---|---|
| **You** | PRJ-T05 Device Tracker **+ Architecture lead** | Extends Starfleet + Intune — your existing codebase, zero onboarding overhead. Fits alongside architecture duties. |
| **Intern 1** | PRJ-B Isomo Brain harden | Python + BigQuery heavy; highest complexity, needs the closest mentorship from you on design decisions. |
| **Intern 2** | PRJ-08 AI Curriculum Builder | Full-stack (Next.js + Claude API + Google APIs). Most self-contained — the intern can move fast with API docs. |
| **Intern 3** | PRJ-T02 Attendance + Parent SMS | Full-stack + Africa's Talking. Well-scoped, clear acceptance criteria, low architectural ambiguity. |

### Cross-cutting (all sprints) — You
- **You own the shared-schema decision.** It is the week-1 blocker for all three interns. No intern writes a migration before the canonical `student`/`staff`/`course`/`session`/`device`/`attendance_record`/`payment` schema is frozen.
- **You review every PR before merge.**
- **You execute all production deployments.** No intern deploys to production unsupervised — set this as a written team norm on day 1.
- **You sign off the `code_executor` sandbox threat model** before any sandboxed code touches real staff data.

---

## Phase 2 (months 3–6): rotate as Phase-1 projects ship

Once Phase-1 projects are live and stable, teams rotate onto the next wave:

- **Teams A + D → PRJ-04 AI Tutor** (PRJ-B is now stable, so the tutor can build on the curriculum namespace).
- **Team B → PRJ-T07 Digital exams** (reuses the offline shell from PRJ-T01 if it has shipped).
- **Team C → PRJ-T03 Fee + MoMo tracker** (MTN MoMo onboarding started early — see gotchas).

The remaining 3 reserve interns are briefed on Phase-2 scope at the Sprint-5 kickoff (Sep 20). Until then they pair with Phase-1 owners during ramp-up to absorb the shared schema and API-client conventions.

See [03-phase2-outlook.md](03-phase2-outlook.md) for scope outlines of the Phase-2 candidates.

---

## Ramp-up note
Budget 2–3 weeks per new intern for orientation, tooling, and a first merged PR before they hit delivery velocity. This is real non-delivery time at sprint start — the Sprint-0 foundation sprint exists precisely to absorb it. Front-load your most Starfleet-familiar intern onto PRJ-B, since it requires understanding existing patterns deeply.
