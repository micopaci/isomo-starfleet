# Starfleet Web Dashboard

Static browser dashboard/PWA shell for Starfleet Monitor.

## Runtime

This package is intentionally static. There is no package-level build step.
`index.html` contains the dashboard shell, styles, and client-side behavior.

It is served in two contexts:

| Context | How |
|---|---|
| Vercel production | `vercel.json` rewrites `/` and all app routes to `index.html` |
| Backend same-origin dashboard | `packages/backend/server.js` serves `packages/web` at `/` |

## Vercel Routing

`vercel.json` preserves favicon/manifest assets and rewrites all other paths to
`index.html`, allowing direct navigation to dashboard routes without a server.

Security headers:

| Header | Value |
|---|---|
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |

## Operational Notes

- Keep `ALLOWED_ORIGINS` on the backend aligned with the Vercel dashboard domain.
- The web dashboard should use the production API origin unless it is being
  served by the backend for same-origin local testing.
- Static assets referenced by `index.html` should remain under `packages/web`.
