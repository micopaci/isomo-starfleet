# Starfleet Design System

Starfleet is the Isomo fleet-operations interface for Starlink terminals,
laptop inventory, alerts, and school-site telemetry across Rwanda. This file is
the canonical product-design reference. The executable TypeScript source for
platform-neutral tokens lives in `packages/shared/src/theme/tokens.ts`; web and
desktop mirror those values into CSS custom properties.

The current visual direction is **Field Green**: warm field-paper light mode,
green-black instrument dark mode, and signal green as the primary operational
accent. The interface should feel like a serious monitoring surface: dense,
quiet, bordered, data-forward, and Rwanda-specific.

No default SaaS gloss. No purple-blue gradients. No rounded card soup. No hero
layout where an operator needs a working console.

---

## Sources of Truth

| Layer | File | Role |
|-------|------|------|
| Product design | `DESIGN.md` | Human-readable design contract |
| Shared TypeScript tokens | `packages/shared/src/theme/tokens.ts` | Platform-neutral colors, fonts, layout constants, score/latency helpers |
| Web TypeScript app | `packages/web/src/styles/tokens.css` | CSS token runtime, palettes, density, contrast, accent overrides |
| Web app structure | `packages/web/src/App.tsx`, `packages/web/src/layouts/*` | Routes, shell, sidebar, bottom nav, settings drawer |
| Web base components | `packages/web/src/styles/global.css`, `packages/web/src/components/*` | Panels, tables, KPI strips, drawers, modals, status chips |
| Desktop app | `packages/desktop/src/styles.css` | Electron CSS mirror of the token system |
| Mobile app | `packages/mobile/src/theme/colors.ts` | Mobile-compatible aliases re-exported from `@starfleet/shared` |

The old statement that desktop and mobile fully duplicate tokens is stale.
Mobile now imports `@starfleet/shared`; web and desktop still maintain CSS
mirrors because they need runtime custom properties and palette overrides.

`packages/web/index.html` is no longer the web design implementation. It only
loads fonts, Tabler icon CSS, Leaflet CSS, favicons, and the pre-React theme
boot script that applies saved display settings before hydration.

---

## Product Surfaces

### Web TypeScript app

The current web version is a Vite + React + TypeScript operations console. It
uses React Router with an auth guard and these routes:

| Route | Screen | Purpose |
|-------|--------|---------|
| `/login` | `Login.tsx` | Auth form, stores `sf_token` and `sf_auth` |
| `/overview` | `Overview.tsx` | Fleet-wide Starlink, device, alert, and attention summary |
| `/starlinks` | `Starlinks.tsx` | Terminal registry, status filters, searchable table, diagnostic drawer |
| `/computers` | `Computers.tsx` | Computer fleet registry and intake/edit workflow |
| `/alerts` | `Alerts.tsx` | Alert feed, acknowledgement, inventory-mismatch resolution |
| `/campuses` | `Campuses.tsx` | Region/campus grouping of sites and device counts |
| `/map` | `MapView.tsx` | Rwanda-centered Leaflet map with status markers |
| `/inventory` | `Inventory.tsx` | Hardware lifecycle: intake, repair, reissue, mismatch handling |
| `/report` | `FleetReport.tsx` | Biweekly fleet report layout and exports |

The shell uses a fixed left sidebar on desktop, an icon-only rail below 900 px,
and bottom navigation below 720 px. The web UI is built from global class
patterns (`sf-view`, `panel`, `kpi-strip`, `tbl`, `seg`, `toolbar`, `sf-drawer`,
`sf-modal`) rather than a component library.

Current data state is mixed: `DataContext.tsx` maps live `/api/alerts`,
`/api/sites`, and `/api/inventory` responses into web view models, while some
screens still make direct `fetch()` calls or retain mock-assisted report and
prototype behavior. Design should treat those as transitional implementation
details, not new visual patterns.

### Desktop and mobile

Desktop and mobile remain first-party surfaces and should stay visually aligned
with the web TypeScript app. Desktop uses the same CSS-token vocabulary as web.
Mobile consumes shared TypeScript colors and exposes legacy aliases for older
React Native screens.

---

## 1. Color

### Canonical Field Green

The platform-neutral colors below come from
`packages/shared/src/theme/tokens.ts`. CSS mirrors use kebab-case names:
`bg2` becomes `--rail`, `surface2` becomes `--surface-2`, and `accentInk`
becomes `--accent-ink`.

### Light mode

| Token | CSS | Hex | Usage |
|-------|-----|-----|-------|
| `bg` | `--bg` | `#f3f6f1` | App background, warm field paper |
| `bg2` | `--rail` | `#e8eee8` | Sidebar/rail, secondary background |
| `surface` | `--surface` | `#fbfcf8` | Panels, active rows, cards |
| `surface2` | `--surface-2` | `#eef4ee` | Nested surfaces, table headers, hovers |
| `ink` | `--ink` | `#222b27` | Primary text |
| `ink2` | `--ink-2` | `#44514b` | Body copy |
| `ink3` | `--ink-3` | `#68756e` | Secondary labels |
| `muted` | `--muted` | `#84908a` | Tertiary/meta text |
| `rule` | `--rule` | `#cfd9d2` | Primary borders |
| `rule2` | `--rule-2` | `#dfe6e1` | Subtle dividers |
| `accent` | `--accent` | `#24825f` | Signal green, primary actions, active state |
| `accentSoft` | `--accent-soft` | `#d7eadf` | Soft accent backgrounds |
| `accentInk` | `--accent-ink` | `#0e3d2b` | Accent foreground/strong accent text |

### Dark mode

| Token | CSS | Hex | Usage |
|-------|-----|-----|-------|
| `bg` | `--bg` | `#141f1c` | Green-black instrument background |
| `bg2` | `--rail` | `#17251f` | Sidebar/rail |
| `surface` | `--surface` | `#1b2b24` | Panels and cards |
| `surface2` | `--surface-2` | `#22332b` | Nested surfaces |
| `ink` | `--ink` | `#e6efe9` | Primary text, soft bone |
| `ink2` | `--ink-2` | `#b8c5be` | Body copy |
| `ink3` | `--ink-3` | `#7c8a84` | Secondary labels |
| `muted` | `--muted` | `#66746d` | Tertiary/meta text |
| `rule` | `--rule` | `#33443c` | Primary borders |
| `rule2` | `--rule-2` | `#26362f` | Subtle dividers |
| `accent` | `--accent` | `#34b483` | Signal green |
| `accentSoft` | `--accent-soft` | `#15382a` | Shadowed accent backgrounds |
| `accentInk` | `--accent-ink` | `#10241b` | Text on solid accent |

### Status colors

Status colors are chroma-matched so they read as one system, not a raw traffic
light. They appear only where state needs to be recognized quickly.

| Token | Light | Dark | Meaning |
|-------|-------|------|---------|
| `ok` | `#347a56` | `#5fc28e` | Online, healthy, score >= 80 |
| `okSoft` | `#dceade` | `#183526` | OK-tinted surface |
| `warn` | `#9b6f18` | `#d9a441` | Degraded, score 50-79 |
| `warnSoft` | `#eee1bd` | `#392d14` | Warn-tinted surface |
| `bad` | `#b45142` | `#cf5b48` | Offline, score < 50 |
| `badSoft` | `#edd5d1` | `#3b1e1a` | Bad-tinted surface |
| `mute` | `#84908a` | `#7c8a84` | Unknown or no data |
| `muteSoft` | `#e4ebe5` | `#22312b` | Muted surface |

Web and desktop also define `--info` for neutral informational telemetry. It is
not yet in `ColorTokens`; promote it to shared TypeScript before treating it as
platform-neutral.

### Web palette system

The TypeScript web app supports runtime display customization through
`ThemeContext.tsx` and data attributes on `<html>`.

| Setting | Values | Stored key |
|---------|--------|------------|
| Palette | `field-green`, `navy`, `carbon`, `slate`, `warm-paper`, `chalk`, `stone` | `sf_palette` |
| Theme | `dark`, `light` | `sf_theme` |
| Typeset | `editorial`, `compact`, `fun` | `sf_typeset` |
| Density | `comfortable`, `compact`, `large` | `sf_density` |
| Contrast | `normal`, `high` | `sf_contrast` |
| Accent | `signal-green`, `indigo`, `terracotta`, `ochre`, `plum` | `sf_accent` |

`field-green` is the default. `warm-paper`, `chalk`, and `stone` default to
light mode; the others default to dark mode. Accent overrides change `--accent`,
`--accent-2`, and in most cases `--accent-soft`, without changing semantic
status colors.

These palettes are operator preferences, not separate brand systems. New
product screenshots and implementation work should default to Field Green.

### Derived helpers

From `@starfleet/shared`:

```ts
scoreToHex(score)      // >= 80 -> ok, >= 50 -> warn, else -> bad
latencyToHex(ms)      // null -> muted, <40 -> ok, <80 -> warn, else -> bad
statusToHex(status)   // online -> ok, degraded -> warn, dark -> bad
```

From mobile aliases:

```ts
scoreColor(score)
latencyColor(ms)
toneColor('ok' | 'warn' | 'bad' | 'mute')
```

Mobile still exposes legacy aliases (`text`, `text2`, `border`, `white`,
`online`, `degraded`, `dark`) for older screens. New code should use canonical
tokens unless it is adapting an existing mobile component.

---

## 2. Typography

Three families define the product. Use them together; do not replace the system
with a single default sans stack.

| Role | Family | Fallback chain |
|------|--------|----------------|
| UI | **Inter** | `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` |
| Editorial names/titles | **Newsreader** | `"Iowan Old Style", "Palatino", Georgia, serif` |
| Telemetry | **IBM Plex Mono** | `ui-monospace, Menlo, monospace` |

The web app loads these through `packages/web/index.html`. Shared TypeScript
exports the same stacks as `fonts.ui`, `fonts.serif`, and `fonts.mono`.

### Scale

| Size | Role |
|------|------|
| 34 px | Web view titles |
| 28 px | Mobile/narrow title fallback |
| 26 px | KPI values, drawer titles |
| 17-18 px | Panel titles and named entities |
| 13-13.5 px | Body and UI default |
| 10-10.5 px | Uppercase meta labels |
| 9-9.5 px | Dense nav labels and table headings |

### Usage rules

- Newsreader is for screen titles, school/site names, drawer titles, and the
  "S" brand mark.
- IBM Plex Mono is for numbers, timestamps, telemetry units, table metadata,
  profile numbers, serials, and uppercase labels.
- Inter is for controls, prose, table body text, and forms.
- Telemetry should never be italicized.
- Letter spacing belongs on uppercase meta labels, not body text or numbers.

---

## 3. Layout and Spacing

Base unit: **4 px**. Most spacing values should land on the 4 px grid.

| Token | Value | Role |
|-------|-------|------|
| `--row-pad` | `14px 16px` | Rows and table cells |
| `--panel-pad` | `20px` | Panel internals |
| `--sidebar-w` | Web `228px`, shared layout `232` | Desktop sidebar width |
| `--radius` | `0px` | All first-party surfaces |

All first-party surfaces use square corners. `global.css` enforces
`border-radius: 0 !important` globally in the web app.

### Web responsive shell

| Breakpoint | Behavior |
|------------|----------|
| Default | Two-column grid: sidebar + main content |
| `max-width: 900px` | Sidebar collapses to a 64 px icon rail; brand text, nav labels, counts, and mini HUD are hidden |
| `max-width: 720px` | Sidebar disappears; fixed bottom nav appears; views gain bottom safe-area padding |
| `max-width: 480px` | Tighter view padding and 28 px titles |

Responsive behavior should collapse navigation, not turn dense operational
tables into decorative cards. Tables can scroll horizontally when needed.

### Density

Web density settings change vertical rhythm only:

- `compact`: smaller view gaps, tighter table rows, shorter panels and buttons.
- `comfortable`: default.
- `large`: larger panel headers, rows, buttons, and view padding.

Density is an accessibility and operator-preference control. It should not
change terminology, information hierarchy, or status semantics.

### Elevation

Use borders, not shadows. Inline surfaces use `1px solid var(--rule)` and row
dividers use `var(--rule-2)`. Shadows are reserved for surfaces that truly float
above the app, such as modals or drawers, and even there the current web app
mostly relies on scrims, borders, and motion.

Active states use a subtle surface shift plus a narrow accent rule. In the web
sidebar, active nav rows use a 2 px left border and `surface` background.

---

## 4. Web TypeScript Components

The web TypeScript app uses CSS class primitives more than isolated component
abstractions. New web work should reuse these patterns before inventing new
ones.

| Pattern | File/Class | Purpose |
|---------|------------|---------|
| Shell | `Shell.tsx`, `.sf-shell`, `.sf-main` | Page frame and routing outlet |
| Sidebar | `Sidebar.tsx`, `.sf-sidebar`, `.sf-nav-item` | Desktop operations nav, reports nav, mini HUD, settings |
| Bottom nav | `BottomNav.tsx`, `.sf-bottom-nav` | Mobile navigation |
| Settings drawer | `ThemePanel.tsx`, `.sf-drawer`, `.sf-set-option`, `.sf-swatch`, `.sf-seg-ctrl` | Palette, typography, density, contrast, accent |
| View header | `.sf-view`, `.sf-view-head`, `.sf-view-title`, `.sf-timecode` | Consistent page framing |
| KPI strip | `StatCard.tsx`, `.kpi-strip`, `.kpi` | Equal-weight metrics |
| Status chip | `StatusChip.tsx`, `.status-cell`, `.dot` | Labeled status with shape and color |
| Panels | `.panel`, `.panel-head` | Bordered content modules |
| Tables | `.tbl`, `.table-scroll` | Dense searchable/filterable registries |
| Segmented controls | `.seg`, `.seg-btn` | Status/category filters |
| Drawer | `Drawer.tsx`, `.sf-drawer`, `.sf-scrim` | Detail and settings overlays |
| Modal | `.sf-modal` | Hardware intake and focused forms |
| Flow rows | `.flow-list`, `.flow-row` | Attention queues and mismatch resolution |

### Component conventions

- Status is always label plus shape plus color. A red dot must still say
  `OFFLINE`, `BROKEN`, `CRITICAL`, or equivalent.
- KPI values are mono, large, and tabular; labels are uppercase mono.
- Tables are the default for registries. Use cards only for campus grids,
  repeated compact summaries, drawers, or modals.
- Rows are clickable only when they open a meaningful detail drawer.
- Search sits on the right of filter toolbars on desktop and should wrap below
  the filters on narrow screens.
- Destructive or urgent controls use `bad`/`badSoft`; primary operational
  controls use `accent`.

---

## 5. Navigation and Information Architecture

The left rail groups work by operator task:

- **Operations:** Overview, Starlinks, Computers, Alerts, Campuses, Map,
  Inventory.
- **Reports:** Fleet Report.

Counts in the sidebar are currently hardcoded display hints. Do not treat them
as design-source data. When those counts become live, preserve the compact mono
badge shape.

The web app keeps display settings in the sidebar footer, not in the main IA.
That is correct: settings alter the operator's view, they are not operational
fleet objects.

---

## 6. Map and Geography

The current web TypeScript map uses Leaflet, Carto dark tiles, and a Rwanda
center/zoom. Site state is represented by circular markers:

- online: signal green
- degraded: amber
- offline: red

Clicking a marker opens a right-side summary with status, latency, download,
laptop count, uptime, and rain. The map is a Rwanda fleet map, not a generic
world-map decoration.

Older design notes that required a custom Rwanda SVG are no longer accurate for
the web TypeScript implementation. A custom SVG may still be appropriate for a
static report or offline mode, but the live web map source is Leaflet.

---

## 7. Iconography and Imagery

- Web uses Tabler Icons via the `ti` webfont classes loaded in
  `packages/web/index.html`.
- Desktop currently uses inline SVG patterns in several components.
- Mobile uses `react-native-vector-icons` where applicable.
- Icons are functional controls or labels, not decorative filler.
- Icon weight should stay close to a 1.5 px stroke. Use `ink-2`/`muted` at rest
  and `accent` for active states.
- The brand mark is a serif "S" in a 28 x 28 square. In the web sidebar it is
  rendered as white on `accent`.

---

## 8. Dark Mode and Accessibility

Dark mode is not an inversion of light mode. It is a green-black instrument
surface with deliberately shifted accents and softer foregrounds.

Rules for new components:

1. Use tokens, not literals, unless integrating an external library that cannot
   accept CSS variables.
2. Test Field Green light and dark.
3. Test at least one non-default web palette if the component uses accent
   color heavily.
4. Test high contrast if the component introduces new borders, text hierarchy,
   or focus states.
5. Never rely on color alone for status.

Web high contrast currently overrides ink and rule tokens. It does not redesign
the interface; it increases text and border legibility within the same layout.

---

## 9. Design Principles

**Operational density.** The product is used to scan and act. Prefer compact
tables, KPI strips, and flow rows over promotional layouts.

**Field signal tension.** Warm field paper in light mode, green-black instrument
surface in dark mode, signal green as the eye-training accent.

**Borders before shadows.** Most hierarchy is grid, border, and typography.
Shadows should be rare enough that they mean "this floats above the workflow."

**Data-forward typography.** Mono for numbers, serif for names and titles, sans
for controls and prose. The operator should instantly know whether text is a
label, value, or entity name.

**Rwanda-specific context.** Region names, campus groupings, and the Rwanda map
are product structure, not decoration.

**Status via shape and label.** A status color must have a dot, chip, badge, or
label that carries the same meaning.

**Preference without fragmentation.** Palette, density, contrast, and accent
controls help operators work comfortably. They must not create separate product
identities or divergent component behavior.

---

## 10. Surface Divergences

Things that are deliberately different and not bugs:

| Aspect | Web TypeScript | Desktop | Mobile |
|--------|----------------|---------|--------|
| Nav | Sidebar, icon rail, bottom nav | Sidebar | Bottom tabs + drawer |
| Runtime theming | CSS variables + HTML data attributes | CSS variables | Shared TS tokens mapped to RN values |
| Icons | Tabler webfont | Inline SVG | `react-native-vector-icons` |
| Map | Leaflet live map | Custom/React map component | Native-style map screen |
| Table density | CSS density setting | Fixed desktop density | RN list/card density |
| Base font size | 13.5 px | 13.5 px | RN defaults around 14 px |

Things that must stay identical:

- Field Green canonical colors.
- Status semantics: `ok`, `warn`, `bad`, `mute`.
- Score and latency thresholds.
- Typography roles.
- Core terminology: `ONLINE`, `DEGRADED`, `OFFLINE`, `UNKNOWN`,
  `WORKING`, `BROKEN`, `READY`, `DECOMMISSIONED`.

---

## 11. Adding or Changing a Token

1. If the token is platform-neutral, add it to
   `packages/shared/src/theme/tokens.ts` first.
2. Mirror it in `packages/web/src/styles/tokens.css` for `:root`,
   `[data-theme="dark"]`, and any relevant palette/accent overrides.
3. Mirror it in `packages/desktop/src/styles.css` if desktop uses it.
4. Expose a mobile alias in `packages/mobile/src/theme/colors.ts` only if an
   existing RN component needs the old name.
5. Grep for hardcoded hex values that should become tokens.
6. Verify Field Green light/dark, a light alternate palette, high contrast, and
   the narrow mobile web layout.
7. Update this document in the same change.

---

_Last updated: 2026-06-16._
