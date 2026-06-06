# Starfleet Design System

Starfleet is a fleet-monitoring app for Starlink terminals deployed across
Rwandan sites. This document is the canonical reference for the visual language
shared by the **desktop** (Electron + React) and **mobile** (React Native) apps,
and how each surface adapts that language.

The design is internally called the **Isomo palette** — warm field paper and
green-black ink, accented with signal green, offset against a green-black
instrument surface in dark mode.
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
| `bg`       | `#f3f6f1` | App background, warm field paper                    |
| `bg2`      | `#e8eee8` | Secondary surface (hover, nav rails)                |
| `surface`  | `#fbfcf8` | Cards, panels, active list items                    |
| `surface2` | `#eef4ee` | Nested surface / table rows                         |
| `ink`      | `#222b27` | Primary text, headlines                             |
| `ink2`     | `#44514b` | Body copy                                           |
| `ink3`     | `#68756e` | Secondary labels                                    |
| `muted`    | `#84908a` | Tertiary / meta text                                |
| `rule`     | `#cfd9d2` | Primary borders                                     |
| `rule2`    | `#dfe6e1` | Subtle dividers                                     |
| `accent`   | `#24825f` | Signal green, interactive accent                    |
| `accentSoft` | `#d7eadf` | Tinted accent backgrounds                         |
| `accentInk` | `#0e3d2b` | Accent text on soft accent backgrounds             |

### Dark mode

| Token      | Hex       | Usage                                               |
|------------|-----------|-----------------------------------------------------|
| `bg`       | `#141f1c` | App background, green-black instrument surface      |
| `bg2`      | `#17251f` | Secondary surface                                   |
| `surface`  | `#1b2b24` | Cards, panels                                       |
| `surface2` | `#22332b` | Nested surface                                      |
| `ink`      | `#e6efe9` | Primary text, soft bone                             |
| `ink2`     | `#b8c5be` | Body copy                                           |
| `ink3`     | `#7c8a84` | Secondary labels                                    |
| `muted`    | `#66746d` | Tertiary text                                       |
| `rule`     | `#33443c` | Primary borders                                     |
| `rule2`    | `#26362f` | Subtle dividers                                     |
| `accent`   | `#34b483` | Signal green                                        |
| `accentSoft` | `#15382a` | Shadowed accent backgrounds                       |
| `accentInk` | `#10241b` | Text on solid accent                               |

### Status colors

Status colors are **chroma-matched** so the system reads as unified — it should
not look like a traffic light. Green / amber / red sit at similar saturation and
lightness in each mode.

| Token      | Light       | Dark        | Meaning                      |
|------------|-------------|-------------|------------------------------|
| `ok`       | `#347a56`   | `#5fc28e`   | Online, healthy, score ≥ 80  |
| `okSoft`   | `#dceade`   | `#183526`   | OK-tinted surface            |
| `warn`     | `#9b6f18`   | `#d9a441`   | Degraded, score 50–79        |
| `warnSoft` | `#eee1bd`   | `#392d14`   | Warn-tinted surface          |
| `bad`      | `#b45142`   | `#cf5b48`   | Offline, score < 50          |
| `badSoft`  | `#edd5d1`   | `#3b1e1a`   | Bad-tinted surface           |
| `mute`     | `#84908a`   | `#7c8a84`   | Unknown / no data            |
| `muteSoft` | `#e4ebe5`   | `#22312b`   | Mute-tinted surface          |

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
| mobile radius  | `0px`             | Mobile also uses sharp rectangles     |

### Radius divergence

All first-party surfaces now use 0-radius rectangles. The product should read
as a serious instrument across desktop, web, and mobile, not as a set of soft
cards.

### Elevation

**Borders, not shadows.** All component separation is a 1 px `--rule` border or
a border-bottom on rows. Shadows are reserved for modals/drawers.

Active states use a 1 px rule and a subtle surface change. Do not use thick
side stripes, halos, glows, or shadows for inline state.

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

- **StatusChip** — Square label with a flat 6 px status dot. Text is uppercase
  mono 10.5 px. Background stays transparent or near-neutral.
- **ScorePill / StatCard** — Large value in serif or mono, small label above in
  uppercase mono. Color derived via `scoreColor()` or `latencyColor()`.
- **SiteCard** — Site name in Newsreader, status dot/label, metric strip below
  in mono. No colored side stripe.
- **Sidebar site list** — 6 px status dot, then site name. Active row gets a
  1 px accent rule and `surface` background.
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
   (e.g. `accent` lifts from `#24825f` to `#34b483`), so "looks right in light"
   does not imply "looks right in dark."
3. Soft status backgrounds in dark mode are **shadowed, not lightened** (e.g.
   `okSoft` goes `#dceade` to `#183526`). This keeps the status overlay legible
   against a green-black `bg`.

---

## 7. Design principles

**Functional-over-decorative.** No gradients, no glassmorphism, no gratuitous
animation. Every visual element exists to answer a monitoring question.

**Field signal tension.** Light mode is warm field paper. Dark mode is
green-black instrument glass without blur or glow. Signal green is the bridge
between them and the single color the user's eye is trained to track.

**Monochrome status foundation.** Ink-on-field-paper (or bone-on-green-black) does
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

**Status via shape AND color.** A red square dot is also always labeled
`OFFLINE`. Color-blind users see the label; sighted users see the color. Never
color alone.

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
| Corner radius       | 0 px                         | 0 px                           |
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

_Last updated: 2026-06-06._
