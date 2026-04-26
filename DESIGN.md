# Starfleet Design System

Starfleet is a fleet-monitoring app for Starlink terminals deployed across
Rwandan sites. This document is the canonical reference for the visual language
shared by the **desktop** (Electron + React) and **mobile** (React Native) apps,
and how each surface adapts that language.

The design is internally called the **Isomo palette** — warm off-white and deep
ink, accented with Rwandan terracotta, offset against deep-navy in dark mode.
It is functional-first: borders over shadows, tile grids over hero imagery,
monochrome plus a single accent instead of a rainbow of UI color.

---

## Sources of truth

| Surface  | File                                           | Format                |
|----------|------------------------------------------------|-----------------------|
| Mobile   | `packages/mobile/src/theme/colors.ts`          | TypeScript objects    |
| Desktop  | `packages/desktop/src/styles.css`              | CSS custom properties |
| Web (marketing) | `packages/web/index.html`               | Inline (landing only) |

The two apps currently **duplicate** tokens rather than sharing a package. If
the palette changes, both files must be updated. A future `packages/shared/theme`
would eliminate the drift risk.

---

## 1. Color

### Light mode

| Token      | Hex       | Usage                                               |
|------------|-----------|-----------------------------------------------------|
| `bg`       | `#f6f3ec` | App background — warm off-white                     |
| `bg2`      | `#efeadd` | Secondary surface (hover, nav rails)                |
| `surface`  | `#ffffff` | Cards, panels, active list items                    |
| `surface2` | `#f9f6ef` | Nested surface / table rows                         |
| `ink`      | `#141414` | Primary text, headlines                             |
| `ink2`     | `#3a3a3a` | Body copy                                           |
| `ink3`     | `#6b6b6b` | Secondary labels                                    |
| `muted`    | `#8a867b` | Tertiary / meta text                                |
| `rule`     | `#d9d4c5` | Primary borders                                     |
| `rule2`    | `#e6e1d3` | Subtle dividers                                     |
| `accent`   | `#c8553d` | Terracotta — interactive accent, active-row marker  |
| `accentSoft` | `#f4d9cf` | Tinted accent backgrounds                         |
| `accentInk` | `#8c3422` | Accent text on soft accent backgrounds             |

### Dark mode

| Token      | Hex       | Usage                                               |
|------------|-----------|-----------------------------------------------------|
| `bg`       | `#0b1220` | App background — deep navy ink                     |
| `bg2`      | `#0e1727` | Secondary surface                                   |
| `surface`  | `#111c2e` | Cards, panels                                       |
| `surface2` | `#142339` | Nested surface                                      |
| `ink`      | `#f2ede0` | Primary text (inverted warm off-white)              |
| `ink2`     | `#c9c3b4` | Body copy                                           |
| `ink3`     | `#97917f` | Secondary labels                                    |
| `muted`    | `#7a7665` | Tertiary text                                       |
| `rule`     | `#1e2d46` | Primary borders                                     |
| `rule2`    | `#18253a` | Subtle dividers                                     |
| `accent`   | `#e8856f` | Softened terracotta                                 |
| `accentSoft` | `#3b2019` | Shadowed accent backgrounds                       |
| `accentInk` | `#f7b9a8` | Accent text highlight                              |

### Status colors

Status colors are **chroma-matched** so the system reads as unified — it should
not look like a traffic light. Green / amber / red sit at similar saturation and
lightness in each mode.

| Token      | Light       | Dark        | Meaning                      |
|------------|-------------|-------------|------------------------------|
| `ok`       | `#3e7d4a`   | `#7ab389`   | Online, healthy, score ≥ 80  |
| `okSoft`   | `#d9e8d8`   | `#1d3626`   | OK-tinted surface            |
| `warn`     | `#b7791f`   | `#e6b86b`   | Degraded, score 50–79        |
| `warnSoft` | `#f2e3c4`   | `#3a2c13`   | Warn-tinted surface          |
| `bad`      | `#b13c3c`   | `#e28482`   | Offline, score < 50          |
| `badSoft`  | `#f2d6d3`   | `#3a1b1b`   | Bad-tinted surface           |
| `mute`     | `#9e9a8b`   | `#87826f`   | Unknown / no data            |
| `muteSoft` | `#e7e3d6`   | `#1a2335`   | Mute-tinted surface          |

### Derived helpers

From `packages/mobile/src/theme/colors.ts`:

```ts
scoreColor(score)          // ≥80 → ok, ≥50 → warn, else → bad
latencyColor(ms)           // <40ms → ok, <80ms → warn, else → bad, null → muted
toneColor('ok'|'warn'|'bad'|'mute')
```

Desktop mirrors these rules inline (no shared utility yet).

### Legacy aliases

For backwards compatibility the mobile palette still exposes `text`, `text2`,
`border`, `white`, `online`, `degraded`, `dark` — all alias to canonical tokens.
Prefer the canonical names in new code.

---

## 2. Typography

Three-family stack, used together, never substituted:

| Role        | Family           | Fallback chain                                            |
|-------------|------------------|-----------------------------------------------------------|
| UI          | **Inter**        | `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| Serif title | **Newsreader**   | `'Iowan Old Style', 'Palatino', Georgia, serif`           |
| Telemetry   | **IBM Plex Mono**| `ui-monospace, Menlo, monospace`                          |

### Scale

| Size   | Role                                              |
|--------|---------------------------------------------------|
| 34 px  | Display (hero metrics)                            |
| 28 px  | Page title                                        |
| 18 px  | Section title (often serif)                       |
| 13.5 px| Body / UI default                                 |
| 10.5 px| Meta labels, mono uppercase with `letter-spacing` |

Body default on desktop: `13.5px / line-height 1.45`.

### Usage rules

- **Newsreader** for proper nouns, screen titles, the "S" logo mark — anything
  that wants a bit of editorial weight. Never for data.
- **IBM Plex Mono** for numeric telemetry (latency ms, throughput Mbps, signal
  dB, coordinates) and for uppercase meta labels with `letter-spacing: .14em`
  (e.g. `SITES`, `LAST SEEN`).
- **Inter** for everything else. Never italicize telemetry.

---

## 3. Spacing & layout

Base unit: **4 px**. Most values are multiples of 4.

| Token          | Value             | Role                                  |
|----------------|-------------------|---------------------------------------|
| `--row-pad`    | `14px 16px`       | List rows, table cells                |
| `--panel-pad`  | `20px`            | Card/panel internal padding           |
| `--sidebar-w`  | `232px`           | Desktop sidebar fixed width           |
| `--radius`     | `0px`             | Desktop corner radius — sharp         |
| mobile radius  | `8–10px`          | Mobile corner radius — slightly soft  |

### Radius divergence

This is an **intentional** surface difference:
- **Desktop** uses 0-radius rectangles throughout. Sharp corners reinforce the
  "technical monitoring surface" feel and align with the sans/serif/mono grid.
- **Mobile** softens to 8–10 px because iOS/Android native patterns clash
  visually with hard corners at small sizes, especially on cards that sit near
  the screen edge.

### Elevation

**Borders, not shadows.** All component separation is a 1 px `--rule` border or
a border-bottom on rows. Shadows are reserved for modals/drawers.

Active states use an **inset 2 px accent bar** on the left edge
(`box-shadow: inset 2px 0 0 var(--accent)`) — never a fill.

---

## 4. Components

Shared component DNA across both apps:

| Component     | Desktop file                                     | Mobile file                                   |
|---------------|--------------------------------------------------|-----------------------------------------------|
| Sidebar       | `packages/desktop/src/components/Sidebar.tsx`    | (tab nav + drawer in `navigation/`)           |
| Stat card     | `MetricCards.tsx`                                | `StatCard.tsx` + `MetricTile.tsx`             |
| Status chip   | `StatusChip.tsx`                                 | `StatusChip.tsx`                              |
| Score pill    | (inline)                                         | `ScorePill.tsx`                               |
| Site card     | `FleetOverview.tsx`                              | `SiteCard.tsx`                                |
| Dish row      | `StarlinkCard.tsx`                               | `DishRow.tsx`                                 |
| Sparkline     | `Sparkline.tsx`                                  | `SparkLine.tsx`                               |
| Chart         | `LatencyChart.tsx`, `SignalChart.tsx`            | (Skia-based in `components/`)                 |
| Map           | `MapView.tsx`                                    | `MapView.tsx`                                 |
| Loading       | (inline spinners)                                | `Skeleton.tsx`                                |

### Component conventions

- **StatusChip** — Tone (`ok`/`warn`/`bad`/`mute`) resolves to both background
  (`*Soft`) and text (`*`) colors. Text is uppercase mono 10.5 px.
- **ScorePill / StatCard** — Large value in serif or mono, small label above in
  uppercase mono. Color derived via `scoreColor()` or `latencyColor()`.
- **SiteCard** — Left-edge 2 px colored bar (tone-driven), site name in
  Newsreader, metric strip below in mono.
- **Sidebar site list** — 6 px status dot, then site name. Active row gets the
  inset accent bar and `surface` background.
- **Charts** — Desktop uses a custom SVG Sparkline + Recharts-style LatencyChart.
  Mobile uses `@shopify/react-native-skia` for performance on large sample
  windows. Color per-series uses tone palette, never raw hex.

---

## 5. Iconography & imagery

- **Icons (mobile):** `react-native-vector-icons` — Feather/Ionicons set. 1.5
  stroke weight. Icon color matches `ink2` at rest, `accent` when active.
- **Icons (desktop):** inline SVG, 16 px nominal, 1.5 stroke, same color rules.
- **Logo:** a serif **"S"** (Newsreader, weight 500, letter-spacing -0.02em) in
  a 28 × 28 `ink`-on-`bg` square. No wordmark needed when the serif "S" is
  present.
- **Map:** custom Rwanda SVG (1000 × 800 viewBox) with lakes rendered as
  ellipses and province outlines as path strokes. Sites are 6–10 px accent dots
  with halo on hover. Do not use generic world maps — the map is part of the
  product identity.

---

## 6. Dark mode

Dark is **not** an inversion of light — it is a parallel palette designed from
scratch. Both must ship together for any new component.

Rules when designing a new component:
1. Pick tokens, never literals. If a value doesn't exist as a token, add it to
   both `colors.ts` and `styles.css` before using it.
2. Test in dark mode before shipping. Accent and status colors shift in tone
   (e.g. `accent` softens from `#c8553d` → `#e8856f`), so "looks right in light"
   does not imply "looks right in dark."
3. Soft status backgrounds in dark mode are **shadowed, not lightened** (e.g.
   `okSoft` goes `#d9e8d8` → `#1d3626`). This keeps the status overlay legible
   against a deep navy `bg`.

---

## 7. Design principles

**Functional-over-decorative.** No gradients, no glassmorphism, no gratuitous
animation. Every visual element exists to answer a monitoring question.

**Warm / cool tension.** Light mode is warm (off-white + terracotta). Dark mode
is cool (deep navy + softened terracotta). The terracotta accent is the bridge
between them and the single color the user's eye is trained to track.

**Monochrome status foundation.** Ink-on-off-white (or off-white-on-navy) does
the heavy lifting. Status color appears only where a real status change needs
to be surfaced — a dot, a pill, a chart series. Never for decoration.

**Tile grid.** The overview is a grid of equal-weight tiles, not a dashboard
with a hero chart. Fleet health is aggregate; every site is equally important.

**Dark-mode parity.** Every component must look deliberate in both themes.

**Data-forward typography.** Mono for numbers, serif for names, sans for UI.
The user should be able to distinguish "is this a label or a value" at a glance.

**Rwanda-centric visuals.** Terracotta accent and the custom Rwanda map are
product identity, not decoration. They belong in every surface that shows
geography or branding.

**Status via shape AND color.** A red pill is also always labeled `OFFLINE`.
Color-blind users see the label; sighted users see the color. Never color alone.

**Responsive collapse, not reflow.** The desktop sidebar does not shrink into
icons; it disappears and exposes a top bar with a menu toggle. Mobile replaces
the sidebar with bottom-tab navigation.

**Borders, not shadows, for elevation.** Shadows are reserved for modals and
drawers — anything that should visually float above the app. Everything inline
uses a `--rule` border.

---

## 8. Divergences between desktop and mobile

Things that are deliberately different and not bugs:

| Aspect              | Desktop                      | Mobile                         |
|---------------------|------------------------------|--------------------------------|
| Corner radius       | 0 px                         | 8–10 px                        |
| Nav                 | Fixed 232 px sidebar         | Bottom tabs + drawer           |
| Chart renderer      | SVG / Recharts               | Skia                           |
| Icons               | Inline SVG                   | `react-native-vector-icons`    |
| Base font size      | 13.5 px                      | 14 px (RN default)             |
| Map interaction     | Hover halos, click to select | Tap to select, long-press peek |

Things that must stay **identical**:
- Color tokens (both modes, both palettes)
- Status rules (`scoreColor`, `latencyColor`, tone semantics)
- Typography stack and scale
- Terminology (OFFLINE / DEGRADED / ONLINE / UNKNOWN)

---

## 9. Adding or changing a token

1. Update `packages/mobile/src/theme/colors.ts` (light + dark + legacy alias if
   needed).
2. Update `packages/desktop/src/styles.css` (`:root` + `.dark, [data-theme="dark"]`).
3. Grep for any hardcoded hex values that the new token replaces; swap them.
4. Screenshot both modes on both surfaces. Check status pills, charts, and the
   map — these are where token drift shows up first.
5. Update this document.

---

_Last updated: 2026-04-22._
