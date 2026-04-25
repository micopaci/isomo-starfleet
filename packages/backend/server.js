/**
 * Starlink Fleet Monitor — Backend Server
 * Node.js 20 + Express + PostgreSQL + WebSocket
 * v5.0 — Stage 5 Signal Intelligence Hardening
 */
require('dotenv').config();

const express = require('express');
const http    = require('http');
const path    = require('path');
const pool    = require('./db');

const { authMiddleware }  = require('./middleware/auth');
const authRoutes          = require('./routes/auth');
const ingestRoutes        = require('./routes/ingest');
const apiRoutes           = require('./routes/api');
const wsService           = require('./services/websocket');
const graphClient         = require('./services/graph');
const { scheduleCron }              = require('./services/scoreCron');
const { scheduleSpaceWeatherCron }  = require('./services/spaceWeather');
const { scheduleOrbitalCron }       = require('./services/orbitalSync');
const { scheduleWeatherCron }       = require('./services/weatherCorrelation');
const { scheduleWatchdog }          = require('./services/watchdog');
const { scheduleWeeklyDigest }      = require('./services/weeklyDigest');
const { scheduleIngestDedupPrune }  = require('./services/ingestDedup');
const { scheduleUsageArchive }      = require('./services/usageArchive');

const app    = express();
const server = http.createServer(app);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());

// CORS — allow the Vercel frontend and local dev to call this API
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(s => s.trim()).filter(Boolean)
  .concat([
    'https://starfleet.icircles.rw',
    'https://starfleet-icircles.vercel.app',  // Vercel preview URL
    'http://localhost:8080',
    'http://localhost:5173',
    'http://localhost:3000',
  ]);

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// ── Web dashboard (static) ────────────────────────────────────────────────────
// Serve packages/web/index.html at GET / so the dashboard runs at the same
// origin as the API — eliminates CORS friction when running locally.
app.use(express.static(path.resolve(__dirname, '../web')));
app.get('/', (req, res) =>
  res.sendFile(path.resolve(__dirname, '../web/index.html'))
);

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch {
    res.status(500).json({ status: 'ok', db: 'error' });
  }
});

// ── Auth (public) ─────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);

// ── Ingest (JWT-protected) ────────────────────────────────────────────────────
app.use('/ingest', authMiddleware, ingestRoutes);

// ── Read API + trigger (JWT-protected) ───────────────────────────────────────
app.use('/api', authMiddleware, apiRoutes);

// ── Internal — force-run score cron (JWT-protected, admin) ───────────────────
const { runScoreCron } = require('./services/scoreCron');
app.post('/internal/run-score-cron', authMiddleware, async (req, res, next) => {
  try {
    await runScoreCron();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Internal — force-run space weather sync ───────────────────────────────────
const { fetchSpaceWeather } = require('./services/spaceWeather');
app.post('/internal/run-space-weather', authMiddleware, async (req, res, next) => {
  try {
    await fetchSpaceWeather();
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── Error handler ─────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

// ── WebSocket ─────────────────────────────────────────────────────────────────
wsService.init(server);

// ── Cron jobs ─────────────────────────────────────────────────────────────────
scheduleCron();                          // Daily signal score @ 23:55
scheduleSpaceWeatherCron();              // NOAA K-index sync every 3 hours
scheduleOrbitalCron();                   // CelesTrak TLE refresh daily @ 02:00
scheduleWeatherCron();                   // Open-Meteo rainfall sync daily @ 01:00
scheduleWatchdog();                      // Stale device check every 10 min
scheduleWeeklyDigest();                  // Email digest Mondays @ 08:00 Kigali
scheduleIngestDedupPrune();              // Cleanup dedupe keys (default 7d retention)
scheduleUsageArchive();                  // Move data_usage older than 30d to archive
graphClient.startTriggerPoller();

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Starlink Fleet Monitor backend running on port ${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/`);
  console.log(`Health:    http://localhost:${PORT}/health`);
});
