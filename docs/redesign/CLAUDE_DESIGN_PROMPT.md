# Claude Design prompt — Starfleet dashboard mockups

Paste this into a fresh Claude (or any design tool) to generate high-fidelity UI mockups.
It is self-contained; it does not assume access to the codebase.

---

You are a senior product designer. Produce high-fidelity, **mockups first** (not production code)
for a ground-up redesign of an operations dashboard called **Starfleet**. Render the mockups as
clean HTML/CSS I can preview in a browser. Mock the screens listed below; iterate with me before
any real implementation.

## The product
Starfleet monitors a fleet of **41 Starlink internet sites** (40 schools + 1 head office) and
**~306 managed Windows laptops** across Rwanda, for an education nonprofit (Isomo). Operators use it
to keep schools online and to report data usage to leadership.

## Two audiences — design two clearly-split workspaces (top-level switch: "Operations" / "Reports")
- **Operations (technicians):** "What is actually down right now, and let me fix it." Triage real
  connectivity outages and run one-tap remediations (reboot dish, ping, diagnostics, push laptop updates).
- **Reports (directors/leadership):** uptime and Starlink **data usage per school**, month-to-date,
  with a one-click CSV export. Calm, at-a-glance, print-friendly.

## Screens to mock
1. **Operations home** — a row of large vital numbers (sites online e.g. 40/41, data used today,
   laptop updates due, geomagnetic Kp); a **"Needs attention"** list that contains **only real
   connectivity problems** (each row: site, plain-language problem, cause chips like "rain 8.5mm",
   and one-tap actions); then a single **"All sites"** table (status, usage today, 30-day usage
   sparkline, uptime).
2. **Reports** — uptime %, total data this month, per-school **data usage with share-of-fleet bars**,
   an uptime trend line, and a prominent **date-range → Download CSV** export.
3. **Dish detail drawer** — opens from a site row: status, real **30-day usage trend**, remediation
   buttons. Show network stats (download/upload/latency) **only if present**, never as empty dashes.
4. **Display settings ("SET") panel** — Theme (Light/Dark), Accent color, **Text size
   (Default / Large / Extra-large)**, **Body font (Sans / Serif incl. Times New Roman)**,
   **Contrast (Normal / High)**.

## Visual direction
- **Cleaner and lighter**: warm off-white page, white cards, generous whitespace, few thin borders.
- **Highly readable**: base body text **16px**, scalable to 22px via SET; **serif headlines**
  (Newsreader/Georgia/Times); strong near-black text on light — no grey-on-grey.
- **Calm color**: a single field-green accent for primary actions and active states; status colors
  green = online, amber = degraded, red = down. Avoid rainbow.
- **Icons**: one consistent outline set (Tabler/Lucide) at ≥18px. No hand-drawn icons.
- **Phone-friendly**: everything reflows to a single column with large tap targets; no horizontal scroll.

## Hard requirements (these are the point of the redesign)
- **Connectivity-only alerting.** A site is "critical" only when its Starlink is genuinely down or
  degraded. Do NOT raise criticals just because a laptop/agent has gone quiet.
- **No empty UI.** Hide any metric that has no data instead of showing "—" or "0/0". Cut duplicate
  columns. Remove anything shown "for the sake of it."
- **No contradictions.** Never show "Online" next to "last seen 150 days ago."

## Use realistic data
Sites: ENDP, ASYV, GS Gihara, GS Kinigi (currently offline), GS St Mathieu (offline), Ecole des
sciences Gisenyi, Bridge2Rwanda – Headoffice, Lycee de St Jerome Janja, GS Mubuga II, GS Remera
Protestant, CIC Muramba. Daily usage per site ranges ~5–200 GB; monthly totals into the TBs.

## Deliverable
Start with the **Operations home** and **Reports** mockups (desktop + a mobile width), plus the SET
panel and dish drawer. Show me, take feedback, refine. Do not build the real app until the look is approved.
