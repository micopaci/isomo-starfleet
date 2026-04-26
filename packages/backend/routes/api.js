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
const jwt     = require('jsonwebtoken');
const pool    = require('../db');
const { requireAdmin }   = require('../middleware/auth');
const { currentSignal }  = require('../services/cache');
const graphClient        = require('../services/graph');
const { checkCoverageGap } = require('../services/orbitalSync');

const router = express.Router();

function parseMonthStart(raw) {
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}$/.test(raw) ? `${raw}-01` : raw;
  const dt = new Date(normalized);
  if (Number.isNaN(dt.getTime())) return null;
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function getAgentTokenSignOptions() {
  if (process.env.JWT_PRIVATE_KEY && process.env.JWT_PRIVATE_KEY.startsWith('-----BEGIN')) {
    return { key: process.env.JWT_PRIVATE_KEY, options: { algorithm: 'RS256' } };
  }
  return { key: process.env.JWT_SECRET || 'dev-secret-change-me', options: { algorithm: 'HS256' } };
}

function normalizeAgentTokenTtl(raw) {
  const value = String(raw || process.env.AGENT_TOKEN_TTL || '365d').trim();
  if (/^\d+[dh]$/.test(value)) return value;
  return '365d';
}

// ── GET /api/sites ────────────────────────────────────────────────────────────
// Enriched with throughput (download/upload Mbps), today's data usage, and
// uptime % so the Ranking screen can sort on any metric without more round-trips.
router.get('/sites', async (req, res, next) => {
  try {
    const sitesRes = await pool.query(`SELECT id, site_master_id, name, starlink_sn, starlink_uuid, kit_id, location, district, lat, lng FROM sites ORDER BY COALESCE(site_master_id, id), id`);

    // Hydrate uptime + data-today maps in two flat queries (views from migration 015)
    const uptimeRes = await pool.query(`SELECT site_id, uptime_pct FROM site_uptime_today`);
    const dataRes   = await pool.query(`SELECT site_id, data_mb_today FROM site_data_today`);
    const uptimeBy  = Object.fromEntries(uptimeRes.rows.map(r => [r.site_id, Number(r.uptime_pct)]));
    const dataBy    = Object.fromEntries(dataRes.rows.map(r => [r.site_id, Number(r.data_mb_today)]));

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
        // Ranking metrics
        download_mbps:  signal?.download_mbps ?? null,
        upload_mbps:    signal?.upload_mbps   ?? null,
        data_mb_today:  dataBy[site.id]   ?? 0,
        uptime_pct:     uptimeBy[site.id] ?? null,
      };
    }));

    res.json(sites);
  } catch (err) { next(err); }
});

// ── GET /api/sites/:id ────────────────────────────────────────────────────────
router.get('/sites/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const siteRes = await pool.query(`SELECT id, site_master_id, name, starlink_sn, starlink_uuid, kit_id, location, district, lat, lng, created_at FROM sites WHERE id = $1`, [id]);
    if (!siteRes.rows.length) return res.status(404).json({ error: 'Site not found' });

    const site    = siteRes.rows[0];
    const signal  = currentSignal.get(String(id)) || null;

    const devicesRes = await pool.query(
      `SELECT id, hostname, windows_sn, role, last_seen, last_ingest_ok_at,
              CASE
                WHEN last_seen IS NULL THEN 'unknown'
                WHEN last_seen > NOW() - INTERVAL '10 minutes' THEN 'online'
                WHEN last_seen > NOW() - INTERVAL '15 minutes' THEN 'offline'
                ELSE 'stale'
              END AS status,
              ROUND(EXTRACT(EPOCH FROM (NOW() - last_seen)) / 60)::INT AS stale_min
       FROM devices
       WHERE site_id = $1`,
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
              d.last_ingest_ok_at,
              s.name AS site_name,
              CASE
                WHEN d.last_seen IS NULL THEN 'unknown'
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
    const healthMetaRes = await pool.query(
      `SELECT queue_depth, oldest_queue_age_sec, wifi_adapter_count, agent_version, run_id, last_error, last_success_at, recorded_at
       FROM agent_health_snapshots
       WHERE device_id = $1
       ORDER BY recorded_at DESC
       LIMIT 1`,
      [id]
    );

    res.json({
      ...devRes.rows[0],
      health: healthRes.rows[0] || null,
      usage:  usageRes.rows,
      agent_health: healthMetaRes.rows[0] || null,
    });
  } catch (err) { next(err); }
});

// ── GET /api/agent-health ─────────────────────────────────────────────────────
// Latest health snapshot per device; optional ?site_id=N filter.
router.get('/agent-health', async (req, res, next) => {
  try {
    const siteId = req.query.site_id ? Number(req.query.site_id) : null;
    const where = Number.isFinite(siteId) ? 'WHERE d.site_id = $1' : '';
    const params = Number.isFinite(siteId) ? [siteId] : [];

    const { rows } = await pool.query(
      `SELECT d.id AS device_id, d.hostname, d.windows_sn, d.site_id, d.last_seen, d.last_ingest_ok_at,
              ah.queue_depth, ah.oldest_queue_age_sec, ah.wifi_adapter_count,
              ah.agent_version, ah.run_id, ah.last_error, ah.last_success_at, ah.recorded_at
       FROM devices d
       LEFT JOIN LATERAL (
         SELECT queue_depth, oldest_queue_age_sec, wifi_adapter_count, agent_version,
                run_id, last_error, last_success_at, recorded_at
         FROM agent_health_snapshots
         WHERE device_id = d.id
         ORDER BY recorded_at DESC
         LIMIT 1
       ) ah ON TRUE
       ${where}
       ORDER BY d.id ASC`,
      params
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/agent-tokens (admin only) ──────────────────────────────────────
// Generates a site-scoped JWT using the same production signing key as login.
router.post('/agent-tokens', requireAdmin, async (req, res, next) => {
  try {
    const rawSiteId = req.body?.site_id;
    const discovery = rawSiteId === 0 || rawSiteId === '0' || req.body?.scope === 'discovery';
    const siteId = discovery && (rawSiteId === undefined || rawSiteId === null || rawSiteId === '')
      ? 0
      : Number(rawSiteId);
    if (!Number.isInteger(siteId) || siteId < 0) {
      return res.status(400).json({ error: 'site_id must be 0 for discovery or a positive integer' });
    }

    let siteName = 'Unassigned / Discovery';
    if (!discovery) {
      const siteRes = await pool.query(`SELECT id, name FROM sites WHERE id = $1`, [siteId]);
      if (!siteRes.rows.length) {
        return res.status(404).json({ error: 'Site not found' });
      }
      siteName = siteRes.rows[0].name;
    }

    const expiresIn = normalizeAgentTokenTtl(req.body?.expires_in);
    const { key, options } = getAgentTokenSignOptions();
    const subject = discovery ? 'agent-discovery' : `agent-site-${siteId}`;
    const token = jwt.sign(
      {
        sub: subject,
        email: `${subject}@starfleet.local`,
        role: 'agent',
        site_id: siteId,
        scope: discovery ? 'discovery' : 'site',
      },
      key,
      { ...options, expiresIn },
    );

    res.json({
      token,
      token_type: 'Bearer',
      role: 'agent',
      site_id: siteId,
      site_name: siteName,
      scope: discovery ? 'discovery' : 'site',
      expires_in: expiresIn,
    });
  } catch (err) { next(err); }
});

const TRIGGER_TYPES = [
  'location_refresh',
  'data_pull',
  'diagnostics',
  'ping_dish',
  'reboot_starlink',
];

async function createDeviceTrigger(client, device_id, type, email) {
  const triggerRes = await client.query(
    `INSERT INTO script_triggers (device_id, triggered_by, type, status)
     VALUES ($1, $2, $3, 'pending')
     RETURNING id`,
    [device_id, email, type]
  );
  const trigger_id = triggerRes.rows[0].id;

  graphClient.triggerRemediationScript(device_id, type, trigger_id).catch(async err => {
    console.error(`Graph trigger failed for device ${device_id}:`, err.message);
    await pool.query(
      `UPDATE script_triggers SET status = 'failed', result = $1 WHERE id = $2`,
      [JSON.stringify({ error: err.message }), trigger_id]
    ).catch(updateErr => {
      console.error(`Failed to mark trigger ${trigger_id} as failed:`, updateErr.message);
    });
  });

  return trigger_id;
}

// ── POST /api/trigger (admin only) ────────────────────────────────────────────
router.post('/trigger', requireAdmin, async (req, res, next) => {
  try {
    const { device_id, type } = req.body;
    if (!device_id || !type) {
      return res.status(400).json({ error: 'device_id and type are required' });
    }
    if (!TRIGGER_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${TRIGGER_TYPES.join(', ')}` });
    }

    const client = await pool.connect();
    try {
      const trigger_id = await createDeviceTrigger(client, device_id, type, req.user.email);
      res.json({ ok: true, trigger_id });
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

// ── POST /api/trigger/site (admin only) ───────────────────────────────────────
// Body: { site_id, type } → triggers every Intune-managed laptop at that site.
router.post('/trigger/site', requireAdmin, async (req, res, next) => {
  try {
    const { site_id, type } = req.body;
    const siteId = Number(site_id);
    if (!Number.isInteger(siteId) || siteId <= 0 || !type) {
      return res.status(400).json({ error: 'site_id and type are required' });
    }
    if (!TRIGGER_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${TRIGGER_TYPES.join(', ')}` });
    }

    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT id
         FROM devices
         WHERE site_id = $1
           AND intune_device_id IS NOT NULL
         ORDER BY last_seen DESC NULLS LAST, id ASC`,
        [siteId]
      );

      const trigger_ids = [];
      for (const row of rows) {
        trigger_ids.push(await createDeviceTrigger(client, row.id, type, req.user.email));
      }

      res.json({ ok: true, site_id: siteId, type, count: trigger_ids.length, trigger_ids });
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});


// ── GET /api/site-changes ─────────────────────────────────────────────────────
// List recent site-change events for the admin UI.
// Query:  ?unack=1   → only unacknowledged events
//         ?limit=N   → default 50, max 200
router.get('/site-changes', async (req, res, next) => {
  try {
    const unack = req.query.unack === '1';
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const where = unack ? 'WHERE e.acknowledged_at IS NULL' : '';
    const result = await pool.query(
      `SELECT e.id, e.device_id, e.from_site_id, e.to_site_id,
              e.reported_lat, e.reported_lon, e.distance_km,
              e.detected_at, e.notified_at, e.acknowledged_at, e.acknowledged_by,
              d.hostname, d.windows_sn,
              fs.name AS from_site_name,
              ts.name AS to_site_name
       FROM site_change_events e
       JOIN devices d      ON d.id = e.device_id
       LEFT JOIN sites fs  ON fs.id = e.from_site_id
       LEFT JOIN sites ts  ON ts.id = e.to_site_id
       ${where}
       ORDER BY e.detected_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ── POST /api/site-changes/:id/ack (admin only) ───────────────────────────────
router.post('/site-changes/:id/ack', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE site_change_events
       SET acknowledged_at = NOW(), acknowledged_by = $1
       WHERE id = $2 AND acknowledged_at IS NULL
       RETURNING id`,
      [req.user.id, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Event not found or already acknowledged' });
    }
    res.json({ ok: true });
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

// ── GET /api/sites/:id/usage ─────────────────────────────────────────────────
// Returns monthly managed usage + imported site totals + estimated unmanaged.
router.get('/sites/:id/usage', async (req, res, next) => {
  try {
    const siteId = Number(req.params.id);
    const months = Math.max(1, Math.min(Number(req.query.months || 6), 24));
    if (!Number.isInteger(siteId) || siteId <= 0) {
      return res.status(400).json({ error: 'Invalid site id' });
    }

    const { rows } = await pool.query(
      `WITH month_grid AS (
         SELECT (date_trunc('month', CURRENT_DATE) - (g.n || ' months')::interval)::date AS month
         FROM generate_series($2 - 1, 0, -1) AS g(n)
       ),
       managed AS (
         SELECT date_trunc('month', date)::date AS month,
                SUM(bytes_down + bytes_up) / (1024.0 * 1024.0) AS managed_mb
         FROM (
           SELECT date, bytes_down, bytes_up FROM data_usage WHERE site_id = $1
           UNION ALL
           SELECT date, bytes_down, bytes_up FROM data_usage_archive WHERE site_id = $1
         ) u
         GROUP BY 1
       ),
       totals AS (
         SELECT month,
                bytes_total / (1024.0 * 1024.0) AS total_mb
         FROM site_usage_totals_monthly
         WHERE site_id = $1
       )
       SELECT mg.month,
              ROUND(COALESCE(m.managed_mb, 0)::numeric, 2) AS managed_mb,
              ROUND(t.total_mb::numeric, 2) AS total_mb,
              CASE
                WHEN t.total_mb IS NULL THEN NULL
                ELSE ROUND(GREATEST(t.total_mb - COALESCE(m.managed_mb, 0), 0)::numeric, 2)
              END AS unmanaged_est_mb
       FROM month_grid mg
       LEFT JOIN managed m ON m.month = mg.month
       LEFT JOIN totals t  ON t.month = mg.month
       ORDER BY mg.month ASC`,
      [siteId, months]
    );

    res.json(rows.map(r => ({
      month: r.month,
      managed_mb: Number(r.managed_mb || 0),
      total_mb: r.total_mb == null ? null : Number(r.total_mb),
      unmanaged_est_mb: r.unmanaged_est_mb == null ? null : Number(r.unmanaged_est_mb),
      confidence: r.total_mb == null ? 'managed_only' : 'estimated_unmanaged',
    })));
  } catch (err) { next(err); }
});

// ── POST /api/usage/monthly-import (admin only) ──────────────────────────────
// Body: { month: "YYYY-MM", entries: [{ site_id, bytes_total|mb_total|gb_total }] }
router.post('/usage/monthly-import', requireAdmin, async (req, res, next) => {
  try {
    const { month, entries, source } = req.body || {};
    const monthStart = parseMonthStart(month);
    if (!monthStart) {
      return res.status(400).json({ error: 'month must be YYYY-MM or YYYY-MM-DD' });
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries[] is required' });
    }

    const client = await pool.connect();
    let inserted = 0;
    try {
      await client.query('BEGIN');
      for (const entry of entries) {
        const siteId = Number(entry.site_id);
        if (!Number.isInteger(siteId) || siteId <= 0) continue;

        let bytes = null;
        if (entry.bytes_total != null) bytes = Number(entry.bytes_total);
        else if (entry.mb_total != null) bytes = Math.round(Number(entry.mb_total) * 1024 * 1024);
        else if (entry.gb_total != null) bytes = Math.round(Number(entry.gb_total) * 1024 * 1024 * 1024);
        if (!Number.isFinite(bytes) || bytes < 0) continue;

        await client.query(
          `INSERT INTO site_usage_totals_monthly (site_id, month, bytes_total, source, uploaded_by)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (site_id, month)
           DO UPDATE SET
             bytes_total = EXCLUDED.bytes_total,
             source = EXCLUDED.source,
             uploaded_by = EXCLUDED.uploaded_by,
             uploaded_at = NOW()`,
          [
            siteId,
            monthStart,
            bytes,
            source || 'starlink_portal_manual',
            req.user?.email || null,
          ]
        );
        inserted += 1;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true, month: monthStart, imported: inserted });
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
const MONTHLY_TOTAL_HEADERS = ['site_id','month','bytes_total','source','uploaded_by','uploaded_at'];
const USAGE_ARCHIVE_HEADERS = ['date','site_id','device_id','bytes_down','bytes_up','archived_at'];

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

// GET /api/export/site-usage-monthly?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/export/site-usage-monthly', requireAdmin, async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to are required' });
    }
    const { rows } = await pool.query(
      `SELECT site_id, month, bytes_total, source, uploaded_by, uploaded_at
       FROM site_usage_totals_monthly
       WHERE month >= $1::date AND month <= $2::date
       ORDER BY month ASC, site_id ASC`,
      [from, to]
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="site_usage_monthly_${from}_${to}.csv"`);
    res.send(toCSV(rows, MONTHLY_TOTAL_HEADERS));
  } catch (err) { next(err); }
});

// GET /api/export/usage-archive?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/export/usage-archive', requireAdmin, async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to are required' });
    }
    const { rows } = await pool.query(
      `SELECT date, site_id, device_id, bytes_down, bytes_up, archived_at
       FROM data_usage_archive
       WHERE date >= $1::date AND date <= $2::date
       ORDER BY date ASC, site_id ASC, device_id ASC`,
      [from, to]
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="usage_archive_${from}_${to}.csv"`);
    res.send(toCSV(rows, USAGE_ARCHIVE_HEADERS));
  } catch (err) { next(err); }
});

module.exports = router;
