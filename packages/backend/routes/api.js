/**
 * Stage 1C — Read API endpoints
 * GET  /api/sites
 * GET  /api/sites/:id
 * GET  /api/sites/:id/signal
 * GET  /api/sites/:id/latency
 * GET  /api/devices
 * GET  /api/devices/:id
 * POST /api/trigger   (admin only)
 */
const express = require('express');
const pool    = require('../db');
const { requireAdmin }   = require('../middleware/auth');
const { currentSignal }  = require('../services/cache');
const graphClient        = require('../services/graph');
const { checkCoverageGap } = require('../services/orbitalSync');

const router = express.Router();

// ── GET /api/sites ────────────────────────────────────────────────────────────
router.get('/sites', async (req, res, next) => {
  try {
    const sitesRes = await pool.query(`SELECT id, name, starlink_sn, kit_id, location, lat, lng FROM sites ORDER BY id`);

    const sites = await Promise.all(sitesRes.rows.map(async (site) => {
      const signal = currentSignal.get(String(site.id)) || null;

      const laptopsRes = await pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '10 minutes') AS online
         FROM devices WHERE site_id = $1`,
        [site.id]
      );

      // Latest daily score + cause
      const scoreRes = await pool.query(
        `SELECT score, cause FROM daily_scores WHERE site_id = $1 ORDER BY date DESC LIMIT 1`,
        [site.id]
      );

      return {
        ...site,
        signal,
        online_laptops: parseInt(laptopsRes.rows[0].online),
        total_laptops:  parseInt(laptopsRes.rows[0].total),
        score:          scoreRes.rows[0]?.score  ?? null,
        cause:          scoreRes.rows[0]?.cause  ?? null,
      };
    }));

    res.json(sites);
  } catch (err) { next(err); }
});

// ── GET /api/sites/:id ────────────────────────────────────────────────────────
router.get('/sites/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const siteRes = await pool.query(`SELECT id, name, starlink_sn, kit_id, location, created_at FROM sites WHERE id = $1`, [id]);
    if (!siteRes.rows.length) return res.status(404).json({ error: 'Site not found' });

    const site    = siteRes.rows[0];
    const signal  = currentSignal.get(String(id)) || null;

    const devicesRes = await pool.query(
      `SELECT id, hostname, windows_sn, role, last_seen FROM devices WHERE site_id = $1`,
      [id]
    );

    res.json({ ...site, signal, devices: devicesRes.rows });
  } catch (err) { next(err); }
});

// ── GET /api/sites/:id/signal (last 14 days of daily scores) ─────────────────
router.get('/sites/:id/signal', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT date, score, cause, data_quality, anomaly, anomaly_delta
       FROM daily_scores
       WHERE site_id = $1 AND date >= CURRENT_DATE - INTERVAL '14 days'
       ORDER BY date ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ── GET /api/sites/:id/latency ────────────────────────────────────────────────
router.get('/sites/:id/latency', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT DATE(recorded_at) AS date,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY p50_ms) AS p50_ms,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY p95_ms) AS p95_ms
       FROM latency_readings
       WHERE site_id = $1 AND recorded_at >= NOW() - INTERVAL '14 days'
       GROUP BY DATE(recorded_at)
       ORDER BY date ASC`,
      [id]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ── GET /api/devices ──────────────────────────────────────────────────────────
// Optional query param: ?filter=stale  (last_seen > 15 min ago)
router.get('/devices', async (req, res, next) => {
  try {
    const staleOnly = req.query.filter === 'stale';
    const whereClause = staleOnly
      ? `AND d.last_seen < NOW() - INTERVAL '15 minutes'`
      : '';

    const result = await pool.query(
      `SELECT d.id, d.hostname, d.windows_sn, d.manufacturer, d.intune_device_id, d.role, d.last_seen,
              s.name AS site_name,
              CASE
                WHEN d.last_seen > NOW() - INTERVAL '10 minutes' THEN 'online'
                WHEN d.last_seen > NOW() - INTERVAL '15 minutes' THEN 'offline'
                ELSE 'stale'
              END AS status,
              ROUND(EXTRACT(EPOCH FROM (NOW() - d.last_seen)) / 60)::INT AS stale_min
       FROM devices d
       LEFT JOIN sites s ON s.id = d.site_id
       WHERE 1=1 ${whereClause}
       ORDER BY d.last_seen ASC NULLS LAST`
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ── GET /api/devices/:id ──────────────────────────────────────────────────────
router.get('/devices/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const devRes = await pool.query(
      `SELECT d.*, s.name AS site_name FROM devices d
       LEFT JOIN sites s ON s.id = d.site_id WHERE d.id = $1`,
      [id]
    );
    if (!devRes.rows.length) return res.status(404).json({ error: 'Device not found' });

    const healthRes = await pool.query(
      `SELECT * FROM device_health WHERE device_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
      [id]
    );
    const usageRes = await pool.query(
      `SELECT date, bytes_down, bytes_up FROM data_usage
       WHERE device_id = $1 ORDER BY date DESC LIMIT 30`,
      [id]
    );

    res.json({
      ...devRes.rows[0],
      health: healthRes.rows[0] || null,
      usage:  usageRes.rows,
    });
  } catch (err) { next(err); }
});

// ── POST /api/trigger (admin only) ────────────────────────────────────────────
router.post('/trigger', requireAdmin, async (req, res, next) => {
  try {
    const { device_id, type } = req.body;
    if (!device_id || !type) {
      return res.status(400).json({ error: 'device_id and type are required' });
    }
    if (!['location_refresh', 'data_pull'].includes(type)) {
      return res.status(400).json({ error: 'type must be location_refresh or data_pull' });
    }

    const client = await pool.connect();
    try {
      // Insert trigger record
      const triggerRes = await client.query(
        `INSERT INTO script_triggers (device_id, triggered_by, type, status)
         VALUES ($1, $2, $3, 'pending')
         RETURNING id`,
        [device_id, req.user.email, type]
      );
      const trigger_id = triggerRes.rows[0].id;

      // Fire Graph API (non-blocking — errors are logged, not fatal)
      graphClient.triggerRemediationScript(device_id, type, trigger_id).catch(err => {
        console.error(`Graph trigger failed for device ${device_id}:`, err.message);
      });

      res.json({ ok: true, trigger_id });
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});


// ── GET /api/intel/space-weather ──────────────────────────────────────────────
// Returns the last 24 NOAA K-index readings (≈ 3 days at 3-hour cadence).
// Clients use this to overlay geomagnetic activity on the SNR trend charts.
router.get('/intel/space-weather', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT recorded_at, k_index, solar_flux_10cm, condition_label
       FROM space_weather
       ORDER BY recorded_at DESC
       LIMIT 24`
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ── GET /api/intel/coverage/:site_id ─────────────────────────────────────────
// Runs a live SGP4 propagation check and returns the current visible satellite
// count for the given site's GPS coordinates.
router.get('/intel/coverage/:site_id', async (req, res, next) => {
  try {
    const { site_id } = req.params;
    const siteRes = await pool.query(
      'SELECT lat, lng, name FROM sites WHERE id = $1',
      [site_id]
    );
    if (!siteRes.rows.length) {
      return res.status(404).json({ error: 'Site not found' });
    }

    const { lat, lng, name } = siteRes.rows[0];
    if (lat == null || lng == null) {
      return res.json({
        site_id: parseInt(site_id, 10),
        site_name: name,
        visible_satellites: null,
        coverage_gap: false,
        note: 'GPS coordinates not set for this site',
      });
    }

    const visible = await checkCoverageGap(lat, lng);
    res.json({
      site_id:            parseInt(site_id, 10),
      site_name:          name,
      visible_satellites: visible,
      coverage_gap:       visible === 0,
      computed_at:        new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

// ── CSV EXPORT (admin only) ───────────────────────────────────────────────────

function toCSV(rows, fallbackHeaders = []) {
  const headers = rows.length ? Object.keys(rows[0]) : fallbackHeaders;
  if (!headers.length) return '';
  const lines = rows.map(r =>
    Object.values(r).map(v =>
      v === null ? '' : typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v)
    ).join(',')
  );
  return [headers.join(','), ...lines].join('\n');
}

const SIGNAL_HEADERS  = ['recorded_at','site_id','device_id','snr','ping_drop_pct','obstruction_pct','pop_latency_ms','reporter_count','confidence'];
const LATENCY_HEADERS = ['recorded_at','site_id','device_id','p50_ms','p95_ms','spread_ms','is_outlier'];

// GET /api/export/signal?site_id=X&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/export/signal', requireAdmin, async (req, res, next) => {
  try {
    const { site_id, from, to } = req.query;
    if (!site_id || !from || !to) {
      return res.status(400).json({ error: 'site_id, from, and to are required' });
    }
    const { rows } = await pool.query(
      `SELECT sr.recorded_at, sr.site_id, sr.device_id, sr.snr, sr.ping_drop_pct,
              sr.obstruction_pct, sr.pop_latency_ms, sr.reporter_count, sr.confidence
       FROM signal_readings sr
       WHERE sr.site_id = $1
         AND DATE(sr.recorded_at) >= $2
         AND DATE(sr.recorded_at) <= $3
       ORDER BY sr.recorded_at ASC`,
      [site_id, from, to]
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="signal_site${site_id}_${from}_${to}.csv"`);
    res.send(toCSV(rows, SIGNAL_HEADERS));
  } catch (err) { next(err); }
});

// GET /api/export/latency?site_id=X&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/export/latency', requireAdmin, async (req, res, next) => {
  try {
    const { site_id, from, to } = req.query;
    if (!site_id || !from || !to) {
      return res.status(400).json({ error: 'site_id, from, and to are required' });
    }
    const { rows } = await pool.query(
      `SELECT lr.recorded_at, lr.site_id, lr.device_id, lr.p50_ms, lr.p95_ms,
              lr.spread_ms, lr.is_outlier
       FROM latency_readings lr
       WHERE lr.site_id = $1
         AND DATE(lr.recorded_at) >= $2
         AND DATE(lr.recorded_at) <= $3
       ORDER BY lr.recorded_at ASC`,
      [site_id, from, to]
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="latency_site${site_id}_${from}_${to}.csv"`);
    res.send(toCSV(rows, LATENCY_HEADERS));
  } catch (err) { next(err); }
});

module.exports = router;
