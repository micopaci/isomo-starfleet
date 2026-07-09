# PRJ-08 — AI Curriculum Builder

> **Owner:** Intern 2 · **Audience:** Teachers · **Timeline:** 2–3 months (Phase 1) · **Impact:** High

## Context
Teachers spend hours building lesson plans, slides, materials, and rubrics by hand. This tool generates all of them from a small input — `{objective, grade, subject, duration}` — producing a lesson plan, a Google Slides deck, a formatted Google Doc, and a 4-criterion rubric, aligned to the Rwanda curriculum.

**Why now:** It is the **most self-contained AI project** — it calls the Claude API directly and uses Google Workspace APIs, so it has **no hard dependency on PRJ-B** and ships fastest. It gives a fast, visible win for teachers in Phase 1 while Brain is still hardening. (Later it can read from the curriculum namespace once Brain is stable.)

## Dependencies
- **Upstream:** Claude API (shared retry-buffered client); Google Workspace OAuth consent; the Rwanda curriculum document/summary (Sprint 3).
- **Downstream:** feeds PRJ-T12's phase-2 translation module.
- **Gating item:** the **Google OAuth consent screen** requires Your Workspace-admin account to register the app as internal. **Start this on day 1 of Sprint 0** — external verification takes weeks. Stub Google calls with fixtures meanwhile.

## Scope
**In:** Next.js + TypeScript app; lesson-plan generation endpoint with Zod-validated structured output; Slides/Docs/PDF generation from one request; curriculum-alignment validation; rubric generation; teacher UAT; onboarding guide.
**Out:** student-facing surfaces; grading/marking workflows; LMS integration; offline support.

## Timeline (mapped to Phase-1 sprints)
| Sprint | Focus |
|---|---|
| 0 | Next.js + TS scaffold; Claude API auth (env injection, streaming); **flag OAuth consent to You day 1**; stub Google APIs with fixtures. |
| 1 | `POST {objective, grade, subject, duration_minutes}` → streamed Claude response as `{lesson_plan, materials, teacher_notes}`, Zod-validated. Raw JSON, no UI yet (vertical-slice gate). |
| 2 | Google Slides API (slide per section, real API calls not template fill); Google Docs API (formatted Doc); PDF via Drive export endpoint (`/export?mimeType=application/pdf`) — **no PDF library**. All three outputs from one request. |
| 3 | Rwanda curriculum alignment (extract subject/grade/standard hierarchy; validate generated objectives against it); rubric generation (4 criteria + descriptor levels); **one real teacher reviews full output, written feedback**. |
| 4 | Teacher UAT (≥3 teachers, different subjects): plan-vs-time fit, Slides usable as-is?, rubric grading-ready? Iterate the Claude prompt until feedback is net-positive; document the shipping prompt version. |
| 5 | Production deploy; 2-page teacher onboarding guide; hand curriculum-alignment data to the Isomo academic team. |

## Deliverables
- [ ] Sprint 1: structured, Zod-validated lesson-plan JSON from the generation endpoint.
- [ ] Sprint 2: Slides + Docs + PDF, all from a single generation request.
- [ ] Sprint 3: curriculum-alignment validation + 4-criterion rubric; written teacher feedback.
- [ ] Sprint 4: teacher UAT net-positive; documented shipping prompt version.
- [ ] Sprint 5: production deploy + onboarding guide + academic-team handoff.

## Acceptance criteria / Definition of Done
- One request yields a lesson plan, a Slides deck, a formatted Doc, and a rubric — no manual stitching.
- Generated objectives validate against the Rwanda curriculum hierarchy.
- ≥3 teachers across subjects rate the output net-positive in UAT.
- Outputs land in the correct Google Workspace location with correct sharing.
- 2-page onboarding guide ships; deployed by You.

## Risks & gotchas
- **OAuth consent screen** is the schedule risk — admin-gated, weeks of lead time. Day-1 item.
- **Claude API single point of failure** — use the shared retry-buffered client from day 1.
- Kinyarwanda/curriculum phrasing degrades model quality — the teacher-review loop is the mitigation; budget prompt iteration.
- Use the Drive export endpoint for PDF; do not add a PDF library.
