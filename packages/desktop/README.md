# Starfleet Desktop Dashboard

Electron/Vite/React operator dashboard for Starfleet Monitor. The desktop app
uses `@starfleet/shared` for REST/WebSocket data and mirrors the same operational
views used by the web dashboard.

## Run

From the repo root:

```bash
npm run desktop
```

or:

```bash
npm run dev --workspace=packages/desktop
```

The Electron main process loads `http://localhost:5173` during development.
Run the backend separately or use root `npm run dev` to start backend and
desktop together.

## Build

```bash
npm run build --workspace=packages/desktop
```

Build output:

| Output | Purpose |
|---|---|
| `dist/` | Renderer bundle |
| `dist-electron/` | Compiled Electron main/preload files |
| Electron Builder output | Platform installer/package |

## App Surfaces

| View | Purpose |
|---|---|
| Overview | Fleet summary, site selection, fleet diagnostics |
| Starlinks | Starlink/site status, site remediation actions, monthly usage import |
| Computers | Managed-device inventory with online/stale/offline status |
| Alerts | Site-change and issue review |
| Map | Rwanda site map |
| Site detail | Signal, latency, usage, laptop list, and per-device actions |
| Students/Campuses | Placeholder areas for future data integrations |

## Auth And API Base

The desktop app stores:

| Key | Storage | Purpose |
|---|---|---|
| `starfleet_token` | `localStorage` | Dashboard JWT |
| `starfleet_base_url` | `localStorage` | Backend API origin |

Default API base for development is `http://localhost:3000`.

## Electron Notes

| File | Purpose |
|---|---|
| `electron/main.ts` | BrowserWindow setup, production auto-updater, dark-mode IPC |
| `electron/preload.ts` | Exposes `electronAPI` with dark-mode helpers |
| `src/App.tsx` | Authenticated dashboard shell and tab routing |
| `src/styles.css` | Desktop design-system tokens and layout |

Production auto-update runs only when the app is packaged.
