# Starfleet Shared Client

Shared TypeScript package used by the desktop and mobile apps. It keeps API
types, REST calls, WebSocket reconnect behavior, and React hooks in one place so
client surfaces do not drift from the backend contract.

## Contents

| File | Purpose |
|---|---|
| `src/api.ts` | `StarfleetApi` REST client, auth error handling, CSV download helper |
| `src/ws-client.ts` | `StarfleetWS` reconnecting WebSocket client |
| `src/hooks.ts` | Cross-platform React hooks for fleet, site, signal, latency, usage, and devices |
| `src/types.ts` | API response and WebSocket event types |
| `src/utils.ts` | Site status and display helpers |

## Initialization Contract

Apps must create and register API/WS clients before calling shared hooks:

```ts
setSharedApiClient(new StarfleetApi(baseUrl, getToken, onAuthError));

const ws = new StarfleetWS();
ws.connect(baseUrl.replace(/^http/, 'ws'), token);
setSharedWsClient(ws);
```

The desktop app wires this in `packages/desktop/src/store/auth.ts`. The mobile
app wires it in `packages/mobile/src/store/auth.ts`.

## Hook Coverage

| Hook | Backend routes |
|---|---|
| `useFleetSummary` | `GET /api/sites`, WebSocket `device_online`, `signal_update`, `stale_devices` |
| `useSite` | `GET /api/sites/:id`, WebSocket `signal_update`, `stale_devices` |
| `useSignalHistory` | `GET /api/sites/:id/signal` |
| `useLatencyHistory` | `GET /api/sites/:id/latency` |
| `useUsageHistory` | `GET /api/sites/:id/usage` |
| `useDevices` | `GET /api/devices` |
| `useStaleDevices` | `GET /api/devices?filter=stale`, WebSocket `stale_devices` |

## Maintenance Rule

When backend response shapes change, update `src/types.ts`, `src/api.ts`, and
any affected hooks in the same change. Desktop and mobile both consume this
package, so type drift becomes cross-platform drift quickly.
