# Starfleet frontend redesign — full restart brief

A complete, self-contained brief to (re)start the Starfleet dashboard redesign in any session.
Hand this to a fresh Claude Code session with the repo checked out and it has everything it needs.

---

## Mission
Rebuild the Starfleet web dashboard **from the ground up** around the information that matters, for
**two audiences** (ops technicians + directors), with strong **readability**. The current dashboard
shows empty/duplicate data, floods users with false "critical" alerts, and is too small / low-contrast.

## Product & org
- **Starfleet 4.0** — fleet management for **41 active Starlink sites** (40 schools + 1 Bridge2Rwanda
  head office) and **~306 managed Windows laptops** across Rwanda. Operated by Isomo EdTech.
- Live: web at `https://starfleet.icircles.rw` (Vercel) → API at `https://api.starfleet.icircles.rw`
  (GCP Cloud Run, project `isomobrain`).

## Tech constraints (must honor)
- The frontend is **one static file**: `packages/web/index.html`. **No build step.** React 18 +
  ReactDOM + Babel Standalone are loaded from unpkg; JSX is compiled in-browser via
  `<script type="text/babel">` blocks. MapLibre GL powers the map. Vercel deploys the static file;
  the backend can also serve it.
- Keep it a **single self-contained `index.html`** — one `<style>`, code in `text/babel` script
  blocks, no bundler, no npm for the web package. Match the existing module pattern
  (`window._SF`, `window._VIEWS`, `window._MAPPERS`, `window._API`, `window._DishDetail`, `window._MapView`).
- **Auth:** `POST /auth/login` → JWT stored in `localStorage.sf_tok`; API base in `localStorage.sf_base`;
  admin vs user role decoded from the JWT. Prefs persist in `localStorage['starfleet.tweaks']`.
- Verify changes in a local static-server preview; screenshot desktop (1280) + mobile (375).

## Data the frontend consumes (real endpoints, already deployed)
- `GET /api/sites` → sites: `{id, name, location, lat, lng, signal{snr, pop_latency_ms,
  obstruction_pct, download_mbps, upload_mbps, anomaly, confidence}, uptime_pct, score,
  weather{rainfall_mm, cloud_cover_pct}, online_laptops/total_laptops, online_intune/total_intune,
  online_chromebooks/total_chromebooks, starlink_usage_daily}`.
- `GET /api/starlink-terminals?days=45` → `{terminals:[{service_line_id, account_id, nickname,
  site_id, current_status (Online|Offline|Unknown), last_seen_utc, latest_ping, latest_usage,
  usage_trend:[{log_date, consumed_gb}], billing_cycle_start}]}` — **authoritative cloud
  connectivity + usage**.
- `GET /api/devices` → laptops: `{id, hostname, windows_sn, model, manufacturer, os, os_version,
  user_principal_name, site_id, site_name, status (online|stale|offline), free_storage_bytes,
  total_storage_bytes, battery_pct, battery_health_pct, last_seen, role}`.
- `GET /api/alerts?status=all&limit=200`, `GET /api/alerts/summary?days=14`.
- `GET /api/sites/:id/starlink-usage?days=62` → `{terminal, active_billing_cycle_start,
  history:[{log_date, consumed_gb}]}`.
- `GET /api/sites/:id/starlink-ping?hours=24` → `{samples:[...]}`.
- `GET /api/starlink-usage?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{rows:[{log_date, service_line_id,
  nickname, site_id, site_name, consumed_gb}]}` — **directors' CSV export source**.
- `GET /api/intel/space-weather` → `[{k_index, condition_label}]` (geomagnetic Kp).
- `POST /api/trigger/site {site_id,type}` and `POST /api/trigger/devices {type}`; types:
  `diagnostics | ping_dish | data_pull | location_refresh | reboot_starlink`.
  `POST /api/intune/sync`. `POST /api/alerts/:id/ack`, `POST /api/alerts/:id/assign`.
- **WebSocket** at the API base (`?token=`): messages `signal_update`, `device_online`, `stale_devices`.

## Domain facts that shape the design
- The **41 dishes span 6 Starlink reseller accounts**; cloud status is derived from **recent
  daily-usage recency** (the portal exposes no real-time `isOffline`). ~190 days of usage history exist
  per dish. `last_seen_utc` is stale/unreliable — **do not present it as "freshness."**
- **Most sites do NOT run the on-site Windows agent.** Agent telemetry (download/upload/latency/snr/
  obstruction, laptop check-ins) exists for only a handful of sites. **Absence = "no data", not "broken."**

## Locked design decisions
- **Scope:** full ground-up redesign.
- **Audience:** both, in two clearly-split workspaces — **Operations** (technicians) and **Reports** (directors).
- **Alerting:** only **real connectivity** (cloud/dish down or degraded) is critical. The current
  `"<site> has not reported signal in the last 2 hours"` alerts come from agent staleness — **drop them
  or demote to a quiet "devices" signal.** ⚠️ This likely needs a **backend watchdog change** too, not
  just frontend filtering — check `packages/backend/services/watchdog.js` (or equivalent) and the alert
  generators; coordinate before assuming the frontend can fix it alone.
- **Visual:** cleaner & lighter — more whitespace, larger type, higher contrast, fewer borders.
- **Readability (SET / display settings):** add **Text size** (Default 16px / Large 18px /
  Extra-large 22px), **Body font** (Sans / Serif incl. **Times New Roman**), **Contrast** (Normal /
  High), alongside existing **Theme** (Light/Dark) and **Accent**. Persist per user in `starfleet.tweaks`.
- **Icons:** one consistent outline set (Tabler/Lucide) at ≥18px; remove hand-drawn SVG icons.
- **Cuts:** remove the separate **Campuses** page (fold rollups into Sites); **hide agent metrics**
  where there's no agent (no "—" walls); **drop Chromebook 0/0** counters; remove duplicate
  Dish/Campus columns; remove inert buttons (e.g. "Open runbook" if it does nothing).

## Problems in the current build (what we're fixing)
- "46 critical" is ~40 false agent-staleness alerts while the dishes are cloud-online.
- The dish drawer is mostly empty tiles, a one-day "active cycle" bar chart, a "no ping samples"
  section, and shows **"Cloud Online" next to "cloud last seen 150d ago"** (contradiction).
- Base text ~13.5px, thin weight, low-contrast grey-on-dark; no size control.
- Duplicate columns and 0-value cards throughout.

## Screens to build
1. **Operations home** — vitals (sites online, data today, updates due, Kp) → **Needs attention**
   (connectivity-only, cause chips + one-tap remediations) → folded **All sites** table (status, usage
   today, 30-day trend, uptime; agent columns only when present; search/sort/filter).
2. **Reports** — uptime, total data this month, **per-school usage with share bars** + trend, uptime
   trend chart, **date-range CSV export** (`/api/starlink-usage`).
3. **Dish detail drawer** — status + consistent cloud status, **real 30-day usage trend**, remediation
   actions; hide empty agent stats; no contradictory freshness line.
4. **Computers** — laptop inventory (drop the always-empty "Assigned to" or make it real; storage/
   battery bars; status; last seen; search/sort/filter).
5. **SET / display settings** — theme, accent, text size, body font (incl. Times), contrast, density.
6. **Map** — keep (sites by region + status).

## Acceptance criteria
- A non-technical director can read it comfortably (16px+, high contrast) and export per-school monthly
  usage in ≤2 clicks.
- A technician sees only **real** outages and can act in one tap.
- Works on a phone with **no horizontal scroll**.
- **No** empty "—" columns, **no** 0/0 counters, **no** false criticals, **no** contradictory fields.

## Keepers from prior work (don't redo)
- Backend cloud-sync is fixed and scheduled (status every 5 min, usage daily midnight Kigali); 41
  terminals seeded; `/api/starlink-usage` works. See `docs/STARLINK_PORTAL_CLOUD_SYNC.md`.
- A date-range CSV export and a working accent picker already exist in PR #5 — fold their logic in
  rather than rewriting.

## Process
Mockup first (see `packages/web/redesign-mockup.html` and `docs/redesign/CLAUDE_DESIGN_PROMPT.md`),
get approval, then implement as the new `index.html`. Keep PRs on `agent/*` branches → PR → Vercel.
