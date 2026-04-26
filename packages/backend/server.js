/**
 * Starlink Fleet Monitor — Backend Server
 * Node.js 20 + Express + PostgreSQL + WebSocket
 * v5.0 — Stage 5 Signal Intelligence Hardening
 */
require('dotenv').config();

const express = require('express');
const http    = require('http');
const fs      = require('fs');
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

async function runStartupMigrations() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const dir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    const appliedRes = await client.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedRes.rows.map(r => r.filename));
    const pending = files.filter(f => !applied.has(f));

    if (pending.length === 0) {
      console.log('[Migrate] No pending migrations.');
      return;
    }

    console.log(`[Migrate] Applying ${pending.length} pending migration(s)...`);
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      console.log(`[Migrate] -> ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`${file}: ${err.message}`);
      }
    }
    console.log('[Migrate] Complete.');
  } finally {
    client.release();
  }
}

async function ensureRuntimeSchema() {
  const client = await pool.connect();
  try {
    console.log('[SchemaGuard] Ensuring runtime schema compatibility...');
    await client.query('BEGIN');

    await client.query(`
      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS last_ingest_ok_at TIMESTAMPTZ
    `);
    await client.query(`
      ALTER TABLE devices
      ADD COLUMN IF NOT EXISTS model TEXT,
      ADD COLUMN IF NOT EXISTS os TEXT,
      ADD COLUMN IF NOT EXISTS os_version TEXT,
      ADD COLUMN IF NOT EXISTS intune_last_sync_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS intune_enrolled_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS compliance_state TEXT,
      ADD COLUMN IF NOT EXISTS user_principal_name TEXT,
      ADD COLUMN IF NOT EXISTS azure_ad_device_id TEXT,
      ADD COLUMN IF NOT EXISTS device_category TEXT,
      ADD COLUMN IF NOT EXISTS free_storage_bytes BIGINT,
      ADD COLUMN IF NOT EXISTS total_storage_bytes BIGINT,
      ADD COLUMN IF NOT EXISTS intune_synced_at TIMESTAMPTZ
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_devices_intune_last_sync_at
      ON devices(intune_last_sync_at)
    `);

    await client.query(`
      ALTER TABLE sites
      ADD COLUMN IF NOT EXISTS starlink_uuid TEXT
    `);
    await client.query(`
      ALTER TABLE sites
      ADD COLUMN IF NOT EXISTS site_master_id INTEGER
    `);
    await client.query(`
      ALTER TABLE sites
      ADD COLUMN IF NOT EXISTS district TEXT
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_starlink_uuid_lower
      ON sites (LOWER(starlink_uuid))
      WHERE starlink_uuid IS NOT NULL
    `);
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sites_site_master_id
      ON sites(site_master_id)
      WHERE site_master_id IS NOT NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ingest_payload_dedup (
        id          BIGSERIAL PRIMARY KEY,
        endpoint    TEXT NOT NULL,
        device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        payload_id  TEXT NOT NULL,
        received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (endpoint, device_id, payload_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_ingest_payload_dedup_received_at
      ON ingest_payload_dedup(received_at)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS site_move_candidates (
        device_id         INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        from_site_id      INTEGER REFERENCES sites(id) ON DELETE SET NULL,
        to_site_id        INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        first_seen_date   DATE NOT NULL,
        last_seen_date    DATE NOT NULL,
        seen_days         INTEGER NOT NULL DEFAULT 1,
        last_reported_lat NUMERIC,
        last_reported_lon NUMERIC,
        last_distance_km  NUMERIC,
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (device_id, to_site_id)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_site_move_candidates_device
      ON site_move_candidates(device_id)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS site_usage_totals_monthly (
        id          BIGSERIAL PRIMARY KEY,
        site_id     INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        month       DATE NOT NULL,
        bytes_total BIGINT NOT NULL CHECK (bytes_total >= 0),
        source      TEXT NOT NULL DEFAULT 'starlink_portal_manual',
        uploaded_by TEXT,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (site_id, month)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_site_usage_totals_monthly_month
      ON site_usage_totals_monthly(month)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS data_usage_archive (
        id          BIGSERIAL PRIMARY KEY,
        device_id   INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        site_id     INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        date        DATE NOT NULL,
        bytes_down  BIGINT NOT NULL DEFAULT 0,
        bytes_up    BIGINT NOT NULL DEFAULT 0,
        archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (device_id, date)
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_data_usage_archive_site_date
      ON data_usage_archive(site_id, date)
    `);
    await client.query(`
      ALTER TABLE device_health
      ADD COLUMN IF NOT EXISTS disk_usage_pct NUMERIC,
      ADD COLUMN IF NOT EXISTS disk_smart_status TEXT,
      ADD COLUMN IF NOT EXISTS disk_smart_predict_failure BOOLEAN,
      ADD COLUMN IF NOT EXISTS disk_media_type TEXT
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_health_snapshots (
        id                   BIGSERIAL PRIMARY KEY,
        device_id            INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        site_id              INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
        recorded_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        queue_depth          INTEGER,
        oldest_queue_age_sec INTEGER,
        wifi_adapter_count   INTEGER,
        agent_version        TEXT,
        run_id               TEXT,
        last_error           TEXT,
        last_success_at      TIMESTAMPTZ
      )
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_health_device_recorded_at
      ON agent_health_snapshots(device_id, recorded_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_agent_health_site_recorded_at
      ON agent_health_snapshots(site_id, recorded_at DESC)
    `);

    await client.query(`
      CREATE OR REPLACE VIEW site_uptime_today AS
      SELECT
        d.site_id,
        CASE
          WHEN COUNT(*) = 0 THEN 0
          ELSE
            (
              COUNT(*) FILTER (
                WHERE COALESCE(d.intune_last_sync_at, d.last_seen) >= NOW() - INTERVAL '9 hours'
              )
            )::NUMERIC / COUNT(*)::NUMERIC * 100.0
        END AS uptime_pct
      FROM devices d
      GROUP BY d.site_id
    `);

    await client.query('COMMIT');
    console.log('[SchemaGuard] Runtime schema compatibility ensured.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

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

// ── Start ─────────────────────────────────────────────────────────────────────
async function startServer() {
  try {
    await runStartupMigrations();
    await ensureRuntimeSchema();

    scheduleCron();                          // Daily signal score @ 23:55
    scheduleSpaceWeatherCron();              // NOAA K-index sync every 3 hours
    scheduleOrbitalCron();                   // CelesTrak TLE refresh daily @ 02:00
    scheduleWeatherCron();                   // Open-Meteo rainfall sync daily @ 01:00
    scheduleWatchdog();                      // Stale device check every 10 min
    scheduleWeeklyDigest();                  // Email digest Mondays @ 08:00 Kigali
    scheduleIngestDedupPrune();              // Cleanup dedupe keys (default 7d retention)
    scheduleUsageArchive();                  // Move data_usage older than 30d to archive
    graphClient.startTriggerPoller();
    graphClient.scheduleIntuneDeviceSync();

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`Starlink Fleet Monitor backend running on port ${PORT}`);
      console.log(`Dashboard: http://localhost:${PORT}/`);
      console.log(`Health:    http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error('[Startup] Migration/bootstrap failed:', err.message);
    process.exit(1);
  }
}

startServer();
