# Isomo Starfleet — Android Companion App

React Native (TypeScript) companion to the Starfleet web dashboard. Read-mostly
field tool for iCircles staff visiting the 41 sites (40 schools + Bridge2Rwanda
HQ). Runs on Android 9+ (API 28+).

## What it does

| Screen | Purpose |
|---|---|
| **Login** | JWT auth against `POST /auth/login`. Persists token in `AsyncStorage`. |
| **Sites** | Fleet-wide list sorted by health: red → amber → green. Each card shows signal score, predicted cause, laptop counts, last-seen age. Offline-first: falls back to last-saved snapshot. |
| **Site Detail** | Score hero + 4 metric tiles (SNR, Ping Drop, Obstruction, PoP Latency) + 7-day sparkline + laptop list. Admins can tap "Refresh all" to trigger a remediation script on every endpoint. |
| **Laptop Detail** | Per-device history, last heartbeat, script trigger buttons (restart-starlink, clear-cache, reinstall-agent). |
| **Ranking** | Sites sorted by PoP latency — quick sanity check after a space-weather event. |
| **Settings** | User profile, notification toggles, theme preference, cache management, API endpoint, version. |

## Architecture

```
App.tsx
  └─ RootNavigator (Login vs Main tabs)
       └─ AppNavigator (Bottom tabs)
            ├─ SitesStack → Sites → SiteDetail → LaptopDetail
            ├─ RankingScreen
            └─ SettingsScreen
```

- **State**: `@starfleet/shared` hooks (`useFleetSummary`, `useSite`, `useSignalHistory`) from the yarn workspace — reused from the web app.
- **Cache**: `AsyncStorage` keyed by site ID, with `ageLabel()` helper so the offline banner reads "Last updated 4m ago" when serving stale data.
- **Auth**: JWT persisted to `AsyncStorage`, 401 from the API triggers `clearToken()` and bounces the user back to `LoginScreen`.
- **Theme**: `useColorScheme()` picks `light` or `dark` from `theme/colors.ts`. Both palettes mirror the web version's B2R-inspired tokens.
- **Push**: `useFCM` hook registers the device token with the backend; the server fans out site-down and degraded-signal alerts via Firebase Cloud Messaging.

## How site data flows into the phone

```
backend /api/sites
   │  (WebSocket push + REST fallback every 30s)
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
2. Admin remediation trigger (`POST /api/devices/:id/trigger`)
3. FCM token registration (`POST /api/devices/fcm-token`)

## Running locally

```bash
cd packages/android
yarn install
# Requires a running backend (default: https://api.starfleet.icircles.rw)
# Override via EXPO_PUBLIC_API_URL env var
yarn android
```

## Preview

Open [`preview.html`](./preview.html) in a browser to see the four key screens
(Sites list, Site Detail, Ranking, Settings) in both dark and light mode.
The preview uses the same colour tokens the RN app reads from `theme/colors.ts`.

## Files

```
packages/android/
├── App.tsx                        # Root: JWT restore, theme, nav
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
│   │   ├── SiteDetailScreen.tsx
│   │   ├── LaptopDetailScreen.tsx
│   │   ├── RankingScreen.tsx
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
│   │   └── useFCM.ts              # Firebase Cloud Messaging
│   └── theme/
│       └── colors.ts              # light + dark tokens + scoreColor()
├── app.json
├── babel.config.js
├── metro.config.js
├── package.json
└── tsconfig.json
```
