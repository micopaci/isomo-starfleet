# Isomo Starfleet — Android Companion App

React Native (TypeScript) companion to the Starfleet dashboard. Read-mostly
field/admin tool for Isomo staff visiting schools and reviewing fleet health.
The canonical package path is `packages/mobile`; the checked-in
`packages/mobile/android` tree is the Android native project, not a separate app.

## What it does

| Screen | Purpose |
|---|---|
| **Login** | JWT auth against `POST /auth/login`. Persists token in `AsyncStorage`. |
| **Overview** | Fleet-wide summary using `useFleetSummary()`: sites, status counts, laptop totals, Intune and Chromebook counts. |
| **Map** | Field map view for site selection and geographic context. |
| **Sites / Campuses** | Fleet-wide campus list sorted by health. Cards show score, signal, laptop counts, and cached/offline state. |
| **Site Detail** | Score hero, metric tiles, signal history, latency/usage context, and laptop list. |
| **Laptop Detail** | Per-device status, last heartbeat/check-in, health, usage, and admin trigger actions where enabled. |
| **Starlinks** | Starlink/site health view for throughput, signal, and service status. |
| **Alerts** | Site-change alerts with a badge for unacknowledged items. |
| **Settings** | Account, role, session expiry, API endpoint, app version, and sign out. |

## Architecture

```
App.tsx
  └─ RootNavigator (Login vs Main tabs)
       └─ AppNavigator (Bottom tabs)
            ├─ OverviewScreen
            ├─ MapScreen
            ├─ SitesStack → Sites → SiteDetail → LaptopDetail
            ├─ StarlinksScreen
            ├─ AlertsScreen
            └─ SettingsScreen
```

- **State**: `@starfleet/shared` hooks (`useFleetSummary`, `useSite`, `useSignalHistory`) from the yarn workspace — reused from the web app.
- **Cache**: `AsyncStorage` keyed by site ID, with `ageLabel()` helper so the offline banner reads "Last updated 4m ago" when serving stale data.
- **Auth**: JWT persisted to `AsyncStorage`, 401 from the API triggers `clearToken()` and bounces the user back to `LoginScreen`.
- **Theme**: `useColorScheme()` picks `light` or `dark` from `theme/colors.ts`. Both palettes mirror the web version's B2R-inspired tokens.
- **Push**: Firebase messaging is intentionally omitted for now. `useFCM` is a
  placeholder until `@react-native-firebase/app`, messaging, and
  `android/app/google-services.json` are added.

## How site data flows into the phone

```
backend /api/sites
   │  (REST fetch + WebSocket signal/stale-device updates)
   ▼
@starfleet/shared useFleetSummary()
   │
   ▼
SitesScreen
   │  onPress site
   ▼
useSite(siteId) + useSignalHistory(siteId) → SiteDetail
   │  onPress laptop
   ▼
useDevice(deviceId) → LaptopDetail
```

The phone is read-mostly — the only writes are:
1. Login (`POST /auth/login`)
2. Admin device remediation trigger (`POST /api/trigger`)
3. Admin site remediation trigger (`POST /api/trigger/site`)
4. Alert acknowledgement (`POST /api/site-changes/:id/ack`) when enabled in UI flows

## Running locally

```bash
cd packages/mobile
npm install
npm run start
npm run android
```

Default API base is currently `https://starfleet.yourdomain.com`. Use the
Settings screen to point a device at production or a reachable development API.

## Preview

Open [`preview.html`](./preview.html) in a browser to see the four key screens
(Sites list, Site Detail, Ranking, Settings) in both dark and light mode.
The preview uses the same colour tokens the RN app reads from `theme/colors.ts`.

## Files

```
packages/mobile/
├── src/App.tsx                    # Root: JWT restore, theme, nav
├── index.js                       # React Native Android entry point
├── src/
│   ├── components/
│   │   ├── SiteCard.tsx           # Fleet list row
│   │   ├── ScorePill.tsx          # 0–100 colored pill (sm + lg)
│   │   ├── MetricTile.tsx         # 2x2 grid tile on SiteDetail
│   │   ├── SparkLine.tsx          # SVG 7-day trend
│   │   └── OfflineBanner.tsx      # Amber strip when serving cache
│   ├── screens/
│   │   ├── LoginScreen.tsx
│   │   ├── SitesScreen.tsx
│   │   ├── OverviewScreen.tsx
│   │   ├── MapScreen.tsx
│   │   ├── StarlinksScreen.tsx
│   │   ├── AlertsScreen.tsx
│   │   ├── SiteDetailScreen.tsx
│   │   ├── LaptopDetailScreen.tsx
│   │   └── SettingsScreen.tsx
│   ├── navigation/
│   │   ├── RootNavigator.tsx      # Login vs Main
│   │   ├── AppNavigator.tsx       # Bottom tabs
│   │   ├── SitesStack.tsx         # Sites → Detail → Laptop
│   │   └── types.ts               # Navigation prop types
│   ├── store/
│   │   ├── auth.ts                # JWT + API client wiring
│   │   └── cache.ts               # AsyncStorage site snapshots
│   ├── hooks/
│   │   └── useFCM.ts              # Push placeholder
│   └── theme/
│       └── colors.ts              # light + dark tokens + scoreColor()
├── app.json
├── babel.config.js
├── metro.config.js
├── package.json
└── tsconfig.json
```
