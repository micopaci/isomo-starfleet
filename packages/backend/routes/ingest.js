/**
 * Stage 1B — Ingest API endpoints
 * POST /ingest/heartbeat
 * POST /ingest/signal
 * POST /ingest/latency
 * POST /ingest/health
 * POST /ingest/usage
 */
const express = require('express');
const pool    = require('../db');
const { broadcast } = require('../services/websocket');
const { currentSignal } = require('../services/cache');
const {
  heartbeatLimiter,
  signalLimiter,
  latencyLimiter,
  healthLimiter,
  usageLimiter,
} = require('../middleware/ingestRateLimit');

const router = express.Router();

// ── helpers ──────────────────────────────────────────────────────────────────

function require400(res, body, fields) {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      res.status(400).json({ error: `${f} is required` });
      return false;
    }
  }
  return true;
}

async function autoRegisterDevice(client, device_sn, site_id, hostname) {
  // Upsert device by windows_sn
  const result = await client.query(
    `INSERT INTO devices (windows_sn, site_id, hostname)
     VALUES ($1, $2, $3)
     ON CONFLICT (windows_sn)
     DO UPDATE SET site_id = EXCLUDED.site_id, hostname = COALESCE(EXCLUDED.hostname, devices.hostname)
     RETURNING id`,
    [device_sn, site_id, hostname || null]
  );
  return result.rows[0].id;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── POST /ingest/heartbeat ────────────────────────────────────────────────────
router.post('/heartbeat', heartbeatLimiter, async (req, res, next) => {
  try {
    const { device_sn, site_id, hostname, timestamp_utc } = req.body;
    if (!require400(res, req.body, ['device_sn', 'site_id'])) return;

    const client = await pool.connect();
    try {
      const device_id = await autoRegisterDevice(client, device_sn, site_id, hostname);
      await client.query(
        `UPDATE devices SET last_seen = $1 WHERE id = $2`,
        [timestamp_utc || new Date().toISOString(), device_id]
      );
      broadcast('device_online', { device_id, site_id });
    } finally {
      client.release();
    }

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /ingest/signal ───────────────────────────────────────────────────────
router.post('/signal', signalLimiter, async (req, res, next) => {
  try {
    const { device_sn, site_id, timestamp_utc, pop_latency_ms, snr, obstruction_pct, ping_drop_pct } = req.body;
    if (!require400(res, req.body, ['device_sn', 'site_id'])) return;

    const client = await pool.connect();
    try {
      const device_id = await autoRegisterDevice(client, device_sn, site_id, null);

      // Count unique reporters in last 10 min
      const window = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const reportersRes = await client.query(
        `SELECT COUNT(DISTINCT device_id) AS cnt FROM signal_readings
         WHERE site_id = $1 AND recorded_at > $2`,
        [site_id, window]
      );
      const reporterCount = parseInt(reportersRes.rows[0].cnt) + 1;
      const confidence    = reporterCount === 1 ? 'low' : 'high';

      await client.query(
        `INSERT INTO signal_readings
           (site_id, device_id, recorded_at, pop_latency_ms, snr, obstruction_pct, ping_drop_pct, reporter_count, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [site_id, device_id, timestamp_utc || new Date().toISOString(),
         pop_latency_ms, snr, obstruction_pct, ping_drop_pct, reporterCount, confidence]
      );

      // Compute median across all reporters in last 2 min
      const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const recentRes = await client.query(
        `SELECT pop_latency_ms, snr, obstruction_pct, ping_drop_pct
         FROM signal_readings
         WHERE site_id = $1 AND recorded_at > $2`,
        [site_id, twoMinAgo]
      );
      const rows = recentRes.rows;
      const aggregated = {
        snr:             median(rows.map(r => parseFloat(r.snr)).filter(v => v != null)),
        pop_latency_ms:  median(rows.map(r => parseFloat(r.pop_latency_ms)).filter(v => v != null)),
        obstruction_pct: median(rows.map(r => parseFloat(r.obstruction_pct)).filter(v => v != null)),
        ping_drop_pct:   median(rows.map(r => parseFloat(r.ping_drop_pct)).filter(v => v != null)),
        confidence,
        updatedAt:       new Date().toISOString(),
      };

      // Update in-memory cache
      currentSignal.set(String(site_id), aggregated);

      broadcast('signal_update', { site_id, signal: aggregated });
    } finally {
      client.release();
    }

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /ingest/latency ──────────────────────────────────────────────────────
router.post('/latency', latencyLimiter, async (req, res, next) => {
  try {
    const { device_sn, site_id, timestamp_utc, p50_ms, p95_ms } = req.body;
    if (!require400(res, req.body, ['device_sn', 'site_id', 'p50_ms', 'p95_ms'])) return;

    const client = await pool.connect();
    try {
      const device_id = await autoRegisterDevice(client, device_sn, site_id, null);

      // Check outlier: p50 > 2× site median in last 15 min
      const window15 = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const medRes = await client.query(
        `SELECT p50_ms FROM latency_readings
         WHERE site_id = $1 AND recorded_at > $2`,
        [site_id, window15]
      );
      const siteMedian = median(medRes.rows.map(r => parseFloat(r.p50_ms)));
      const isOutlier  = siteMedian !== null && parseFloat(p50_ms) > 2 * siteMedian;

      // Compute spread = max(p50) - min(p50) across devices in last 15 min
      const spreadRes = await client.query(
        `SELECT MAX(p50_ms) - MIN(p50_ms) AS spread FROM latency_readings
         WHERE site_id = $1 AND recorded_at > $2`,
        [site_id, window15]
      );
      const spread_ms = spreadRes.rows[0].spread ? parseFloat(spreadRes.rows[0].spread) : 0;

      await client.query(
        `INSERT INTO latency_readings (device_id, site_id, recorded_at, p50_ms, p95_ms, spread_ms, is_outlier)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [device_id, site_id, timestamp_utc || new Date().toISOString(),
         p50_ms, p95_ms, spread_ms, isOutlier]
      );

      // Attach spread to site cache entry
      const cached = currentSignal.get(String(site_id)) || {};
      currentSignal.set(String(site_id), { ...cached, spread_ms });

    } finally {
      client.release();
    }

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /ingest/health ───────────────────────────────────────────────────────
router.post('/health', healthLimiter, async (req, res, next) => {
  try {
    const required = ['device_sn', 'site_id'];
    if (!require400(res, req.body, required)) return;

    const { device_sn, site_id, timestamp_utc,
            battery_pct, battery_health_pct, disk_free_gb,
            disk_total_gb, ram_used_mb, ram_total_mb } = req.body;

    const client = await pool.connect();
    try {
      const device_id = await autoRegisterDevice(client, device_sn, site_id, null);

      // Upsert — latest per device
      await client.query(
        `INSERT INTO device_health
           (device_id, recorded_at, battery_pct, battery_health_pct,
            disk_free_gb, disk_total_gb, ram_used_mb, ram_total_mb)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [device_id, timestamp_utc || new Date().toISOString(),
         battery_pct, battery_health_pct, disk_free_gb,
         disk_total_gb, ram_used_mb, ram_total_mb]
      );
    } finally {
      client.release();
    }

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /ingest/usage ────────────────────────────────────────────────────────
router.post('/usage', usageLimiter, async (req, res, next) => {
  try {
    const { device_sn, site_id, date, bytes_down_delta, bytes_up_delta } = req.body;
    if (!require400(res, req.body, ['device_sn', 'site_id', 'date'])) return;

    const client = await pool.connect();
    try {
      const device_id = await autoRegisterDevice(client, device_sn, site_id, null);

      await client.query(
        `INSERT INTO data_usage (device_id, site_id, date, bytes_down, bytes_up)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (device_id, date)
         DO UPDATE SET
           bytes_down = data_usage.bytes_down + EXCLUDED.bytes_down,
           bytes_up   = data_usage.bytes_up   + EXCLUDED.bytes_up`,
        [device_id, site_id, date,
         bytes_down_delta || 0, bytes_up_delta || 0]
      );
    } finally {
      client.release();
    }

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
