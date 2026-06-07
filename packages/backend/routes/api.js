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
const { checkCoverageGap, getVisibleSatellites } = require('../services/orbitalSync');
const {
  DEVICE_ONLINE_HOURS,
  DEVICE_STALE_HOURS,
  deviceSeenExpr,
  deviceStatusCase,
  deviceOnlineWhere,
  deviceStaleWhere,
} = require('../services/deviceStatus');

const router = express.Router();

const DEVICE_SEEN_EXPR = deviceSeenExpr('d');
const DEVICE_STATUS_CASE = deviceStatusCase('d');
const CHROMEBOOK_DEVICE_WHERE = `
(
  LOWER(COALESCE(d.device_category, '')) LIKE '%chromebook%'
  OR LOWER(COALESCE(d.device_category, '')) LIKE '%chrome os%'
  OR LOWER(COALESCE(d.os, '')) LIKE '%chrome os%'
  OR LOWER(COALESCE(d.os, '')) LIKE '%chromeos%'
  OR LOWER(COALESCE(d.model, '')) LIKE '%chromebook%'
)`;

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

async function getSiteSignal(siteId) {
  const cached = currentSignal.get(String(siteId));
  if (cached) return cached;

  const { rows } = await pool.query(
    `SELECT pop_latency_ms, snr, obstruction_pct, ping_drop_pct,
            download_mbps, upload_mbps,
            is_snr_above_noise_floor, starlink_alerts, disablement_code, ready_states,
            dl_bandwidth_restricted_reason, ul_bandwidth_restricted_reason,
            dish_uptime_s, dish_bootcount, dish_grpc_reachable, starlink_power_verdict,
            confidence, recorded_at
     FROM signal_readings
     WHERE site_id = $1
       AND recorded_at > NOW() - INTERVAL '2 hours'
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [siteId]
  );
  if (!rows.length) return null;

  const row = rows[0];
  return {
    snr: row.snr == null ? null : Number(row.snr),
    pop_latency_ms: row.pop_latency_ms == null ? null : Number(row.pop_latency_ms),
    obstruction_pct: row.obstruction_pct == null ? null : Number(row.obstruction_pct),
    ping_drop_pct: row.ping_drop_pct == null ? null : Number(row.ping_drop_pct),
    download_mbps: row.download_mbps == null ? null : Number(row.download_mbps),
    upload_mbps: row.upload_mbps == null ? null : Number(row.upload_mbps),
    is_snr_above_noise_floor: row.is_snr_above_noise_floor,
    starlink_alerts: row.starlink_alerts || null,
    disablement_code: row.disablement_code || null,
    ready_states: row.ready_states || null,
    dl_bandwidth_restricted_reason: row.dl_bandwidth_restricted_reason || null,
    ul_bandwidth_restricted_reason: row.ul_bandwidth_restricted_reason || null,
    dish_uptime_s: row.dish_uptime_s == null ? null : Number(row.dish_uptime_s),
    dish_bootcount: row.dish_bootcount == null ? null : Number(row.dish_bootcount),
    dish_grpc_reachable: row.dish_grpc_reachable,
    starlink_power_verdict: row.starlink_power_verdict || null,
    confidence: row.confidence || 'low',
    updatedAt: row.recorded_at,
  };
}

function buildWeatherPredictor(weather) {
  if (!weather) {
    return {
      level: 'unknown',
      label: 'No weather reading yet',
      explanation: 'No recent rain/cloud data has been collected for this site yet.',
      based_on_date: null,
      rainfall_mm: null,
      cloud_cover_pct: null,
    };
  }

  const rain = weather.rainfall_mm;
  const cloud = weather.cloud_cover_pct;

  if (rain != null && rain > 10) {
    return {
      level: 'high',
      label: 'Rain warning (heavy)',
      explanation: `Heavy rain (${rain.toFixed(1)} mm in the last day) can cause packet loss, higher ping, and slower speeds.`,
      based_on_date: weather.date,
      rainfall_mm: rain,
      cloud_cover_pct: cloud,
    };
  }

  if (rain != null && rain > 5) {
    return {
      level: 'medium',
      label: 'Rain warning (moderate)',
      explanation: `Moderate rain (${rain.toFixed(1)} mm in the last day) may cause brief link instability and speed dips.`,
      based_on_date: weather.date,
      rainfall_mm: rain,
      cloud_cover_pct: cloud,
    };
  }

  if (cloud != null && cloud > 85) {
    return {
      level: 'medium',
      label: 'Cloud advisory',
      explanation: `Very dense cloud cover (${Math.round(cloud)}%) may add minor latency or throughput variability.`,
      based_on_date: weather.date,
      rainfall_mm: rain,
      cloud_cover_pct: cloud,
    };
  }

  return {
    level: 'low',
    label: 'Weather risk low',
    explanation: `Rainfall is low (${rain != null ? `${rain.toFixed(1)} mm` : 'no rain data'}) and cloud levels are not currently a strong signal risk.`,
    based_on_date: weather.date,
    rainfall_mm: rain,
    cloud_cover_pct: cloud,
  };
}

function computeSignalScore(sig) {
  if (!sig) return null;
  const pingDrop = Number(sig.ping_drop_pct ?? 0);
  const obstruction = Number(sig.obstruction_pct ?? 0);
  const snr = Number(sig.snr ?? 9.5);
  const latency = Number(sig.pop_latency_ms ?? 35);
  let score = 100;
  score -= Math.min(30, pingDrop * 6);
  score -= Math.min(30, obstruction * 2);
  score -= Math.max(0, (9.5 - snr) * 8);
  score -= Math.max(0, (latency - 35) * 0.3);
  return Math.max(0, Math.min(100, Math.round(score)));
}

async function upsertAlert(client, alert) {
  await client.query(
    `INSERT INTO alert_events
       (active_key, source_type, source_id, site_id, device_id, severity, category, title, message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (active_key) DO UPDATE SET
       source_type = EXCLUDED.source_type,
       source_id = EXCLUDED.source_id,
       site_id = EXCLUDED.site_id,
       device_id = EXCLUDED.device_id,
       severity = EXCLUDED.severity,
       category = EXCLUDED.category,
       title = EXCLUDED.title,
       message = EXCLUDED.message,
       last_seen_at = NOW(),
       status = CASE WHEN alert_events.status = 'resolved' THEN 'open' ELSE alert_events.status END,
       resolved_at = CASE WHEN alert_events.status = 'resolved' THEN NULL ELSE alert_events.resolved_at END,
       metadata = EXCLUDED.metadata`,
    [
      alert.active_key,
      alert.source_type,
      alert.source_id ?? null,
      alert.site_id ?? null,
      alert.device_id ?? null,
      alert.severity,
      alert.category,
      alert.title,
      alert.message,
      JSON.stringify(alert.metadata || {}),
    ]
  );
}

async function syncDerivedAlerts() {
  const client = await pool.connect();
  const activeKeys = [];
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(`
      SELECT
        s.id,
        s.name,
        s.starlink_sn,
        COALESCE(laptops.online_laptops, 0)::INT AS online_laptops,
        sig.pop_latency_ms,
        sig.snr,
        sig.obstruction_pct,
        sig.ping_drop_pct,
        sig.confidence,
        score.date::TEXT AS score_date,
        score.score,
        score.cause,
        score.data_quality,
        score.anomaly,
        score.anomaly_delta,
        weather.date::TEXT AS weather_date,
        weather.rainfall_mm,
        weather.cloud_cover_pct
      FROM sites s
      LEFT JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE ${deviceOnlineWhere('d')}) AS online_laptops
        FROM devices d
        WHERE d.site_id = s.id
      ) laptops ON TRUE
      LEFT JOIN LATERAL (
        SELECT pop_latency_ms, snr, obstruction_pct, ping_drop_pct, confidence
        FROM signal_readings
        WHERE site_id = s.id
          AND recorded_at > NOW() - INTERVAL '2 hours'
        ORDER BY recorded_at DESC
        LIMIT 1
      ) sig ON TRUE
      LEFT JOIN LATERAL (
        SELECT date, score, cause, data_quality, anomaly, anomaly_delta
        FROM daily_scores
        WHERE site_id = s.id
        ORDER BY date DESC
        LIMIT 1
      ) score ON TRUE
      LEFT JOIN LATERAL (
        SELECT date, rainfall_mm, cloud_cover_pct
        FROM weather_log
        WHERE site_id = s.id
        ORDER BY date DESC
        LIMIT 1
      ) weather ON TRUE
      ORDER BY s.id
    `);

    for (const row of rows) {
      const sig = row.confidence
        ? {
            pop_latency_ms: row.pop_latency_ms == null ? null : Number(row.pop_latency_ms),
            snr: row.snr == null ? null : Number(row.snr),
            obstruction_pct: row.obstruction_pct == null ? null : Number(row.obstruction_pct),
            ping_drop_pct: row.ping_drop_pct == null ? null : Number(row.ping_drop_pct),
            confidence: row.confidence,
          }
        : null;
      const score = computeSignalScore(sig);
      const siteLabel = row.name || row.starlink_sn || `Site ${row.id}`;

      if (!sig) {
        const active_key = `site:${row.id}:offline`;
        activeKeys.push(active_key);
        await upsertAlert(client, {
          active_key,
          source_type: 'derived',
          source_id: String(row.id),
          site_id: row.id,
          severity: 'critical',
          category: 'connectivity',
          title: 'Site unreachable',
          message: `${siteLabel} has not reported signal in the last 2 hours.`,
          metadata: { starlink_sn: row.starlink_sn },
        });
      } else if (score != null && score < 60) {
        const active_key = `site:${row.id}:degraded`;
        activeKeys.push(active_key);
        await upsertAlert(client, {
          active_key,
          source_type: 'derived',
          source_id: String(row.id),
          site_id: row.id,
          severity: 'warning',
          category: 'signal',
          title: 'Degraded signal',
          message: `${siteLabel} has degraded signal quality.`,
          metadata: { score, confidence: row.confidence, latency_ms: sig.pop_latency_ms, obstruction_pct: sig.obstruction_pct },
        });
      }

      if (row.anomaly) {
        const active_key = `site:${row.id}:score-anomaly:${row.score_date || 'latest'}`;
        activeKeys.push(active_key);
        await upsertAlert(client, {
          active_key,
          source_type: 'derived',
          source_id: row.score_date || String(row.id),
          site_id: row.id,
          severity: 'warning',
          category: 'anomaly',
          title: 'Signal anomaly',
          message: `${siteLabel} dropped ${Math.abs(Number(row.anomaly_delta ?? 0))} points versus its 7-day average.`,
          metadata: { score: row.score, cause: row.cause, anomaly_delta: row.anomaly_delta, score_date: row.score_date },
        });
      }

      if (row.data_quality === 'low_data') {
        const active_key = `site:${row.id}:low-data:${row.score_date || 'latest'}`;
        activeKeys.push(active_key);
        await upsertAlert(client, {
          active_key,
          source_type: 'derived',
          source_id: row.score_date || String(row.id),
          site_id: row.id,
          severity: 'info',
          category: 'data_quality',
          title: 'Low data quality',
          message: `${siteLabel} has low data quality for the latest score.`,
          metadata: { score_date: row.score_date, cause: row.cause },
        });
      }

      const weather = row.weather_date
        ? {
            date: row.weather_date,
            rainfall_mm: row.rainfall_mm == null ? null : Number(row.rainfall_mm),
            cloud_cover_pct: row.cloud_cover_pct == null ? null : Number(row.cloud_cover_pct),
          }
        : null;
      const predictor = buildWeatherPredictor(weather);
      if (predictor.level === 'high' || predictor.level === 'medium') {
        const active_key = `site:${row.id}:weather:${predictor.based_on_date || 'latest'}:${predictor.level}`;
        activeKeys.push(active_key);
        await upsertAlert(client, {
          active_key,
          source_type: 'derived',
          source_id: predictor.based_on_date || String(row.id),
          site_id: row.id,
          severity: predictor.level === 'high' ? 'warning' : 'info',
          category: 'weather',
          title: predictor.label,
          message: `${predictor.label} at ${siteLabel}: ${predictor.explanation}`,
          metadata: predictor,
        });
      }
    }

    const siteChanges = await client.query(`
      SELECT e.id, e.device_id, e.to_site_id, e.detected_at, e.acknowledged_at, e.acknowledged_by,
             d.hostname, d.windows_sn, ts.name AS to_site_name
      FROM site_change_events e
      JOIN devices d ON d.id = e.device_id
      LEFT JOIN sites ts ON ts.id = e.to_site_id
      WHERE e.detected_at >= NOW() - INTERVAL '30 days'
    `);
    for (const row of siteChanges.rows) {
      const active_key = `site-change:${row.id}`;
      activeKeys.push(active_key);
      await upsertAlert(client, {
        active_key,
        source_type: 'site_change',
        source_id: String(row.id),
        site_id: row.to_site_id,
        device_id: row.device_id,
        severity: 'warning',
        category: 'site_move',
        title: 'Device site changed',
        message: `${row.hostname || row.windows_sn || `Device ${row.device_id}`} moved to ${row.to_site_name || 'another site'}.`,
        metadata: { detected_at: row.detected_at, acknowledged_at: row.acknowledged_at },
      });
      if (row.acknowledged_at) {
        await client.query(
          `UPDATE alert_events
           SET status = 'acknowledged', acknowledged_at = COALESCE(acknowledged_at, $2), acknowledged_by = COALESCE(acknowledged_by, $3)
           WHERE active_key = $1 AND status = 'open'`,
          [active_key, row.acknowledged_at, row.acknowledged_by]
        );
      }
    }

    const derivedKeys = activeKeys.filter(key => key.startsWith('site:'));
    if (derivedKeys.length) {
      await client.query(
        `UPDATE alert_events
         SET status = 'resolved', resolved_at = NOW()
         WHERE source_type = 'derived'
           AND status = 'open'
           AND active_key <> ALL($1::TEXT[])`,
        [derivedKeys]
      );
    } else {
      await client.query(
        `UPDATE alert_events
         SET status = 'resolved', resolved_at = NOW()
         WHERE source_type = 'derived' AND status = 'open'`
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function mapAlertRow(row) {
  return {
    id: row.id,
    severity: row.severity,
    category: row.category,
    source_type: row.source_type,
    source_id: row.source_id,
    site_id: row.site_id,
    device_id: row.device_id,
    title: row.title,
    message: row.message,
    status: row.status,
    detected_at: row.detected_at,
    last_seen_at: row.last_seen_at,
    acknowledged_at: row.acknowledged_at,
    resolved_at: row.resolved_at,
    site_name: row.site_name,
    metadata: row.metadata || {},
    assignee: (row.metadata || {}).assignee || null,
  };
}

// ── GET /api/sites ────────────────────────────────────────────────────────────
// Enriched with throughput (download/upload Mbps), today's data usage, and
// uptime % so the Ranking screen can sort on any metric without more round-trips.
router.get('/sites', async (req, res, next) => {
  try {
    const sitesRes = await pool.query(`SELECT id, site_master_id, name, starlink_sn, starlink_uuid, kit_id, location, district, lat, lng, score_7day_avg FROM sites ORDER BY COALESCE(site_master_id, id), id`);

    // Hydrate uptime + data-today maps in two flat queries (views from migration 015)
    const uptimeRes = await pool.query(`SELECT site_id, uptime_pct FROM site_uptime_today`);
    const dataRes   = await pool.query(`SELECT site_id, data_mb_today FROM site_data_today`);
    const weatherRes = await pool.query(
      `SELECT DISTINCT ON (site_id) site_id, date::text AS date, rainfall_mm, cloud_cover_pct
       FROM weather_log
       ORDER BY site_id, date DESC`
    );
    const uptimeBy  = Object.fromEntries(uptimeRes.rows.map(r => [r.site_id, Number(r.uptime_pct)]));
    const dataBy    = Object.fromEntries(dataRes.rows.map(r => [r.site_id, Number(r.data_mb_today)]));
    const weatherBy = Object.fromEntries(weatherRes.rows.map(r => [r.site_id, {
      date: r.date,
      rainfall_mm: r.rainfall_mm == null ? null : Number(r.rainfall_mm),
      cloud_cover_pct: r.cloud_cover_pct == null ? null : Number(r.cloud_cover_pct),
    }]));

    const sites = await Promise.all(sitesRes.rows.map(async (site) => {
      const signal = await getSiteSignal(site.id);

      const laptopsRes = await pool.query(
        `SELECT COUNT(*) AS total,
                COUNT(*) FILTER (WHERE ${deviceOnlineWhere('d')}) AS online,
                COUNT(*) FILTER (WHERE d.intune_device_id IS NOT NULL) AS total_intune,
                COUNT(*) FILTER (WHERE d.intune_device_id IS NOT NULL AND ${deviceOnlineWhere('d')}) AS online_intune,
                COUNT(*) FILTER (WHERE ${CHROMEBOOK_DEVICE_WHERE}) AS total_chromebooks,
                COUNT(*) FILTER (WHERE ${CHROMEBOOK_DEVICE_WHERE} AND ${deviceOnlineWhere('d')}) AS online_chromebooks
         FROM devices d
         WHERE d.site_id = $1`,
        [site.id]
      );

      // Latest daily score + cause
      const scoreRes = await pool.query(
        `SELECT score, cause FROM daily_scores WHERE site_id = $1 ORDER BY date DESC LIMIT 1`,
        [site.id]
      );

      return {
        ...site,
        score_7day_avg: site.score_7day_avg == null ? null : Number(site.score_7day_avg),
        signal,
        online_laptops: parseInt(laptopsRes.rows[0].online),
        total_laptops:  parseInt(laptopsRes.rows[0].total),
        online_intune_laptops: parseInt(laptopsRes.rows[0].online_intune),
        total_intune_laptops: parseInt(laptopsRes.rows[0].total_intune),
        online_chromebooks: parseInt(laptopsRes.rows[0].online_chromebooks),
        total_chromebooks: parseInt(laptopsRes.rows[0].total_chromebooks),
        score:          scoreRes.rows[0]?.score  ?? null,
        cause:          scoreRes.rows[0]?.cause  ?? null,
        // Ranking metrics
        download_mbps:  signal?.download_mbps ?? null,
        upload_mbps:    signal?.upload_mbps   ?? null,
        data_mb_today:  dataBy[site.id]   ?? 0,
        uptime_pct:     uptimeBy[site.id] ?? null,
        weather:        weatherBy[site.id] ?? null,
        weather_predictor: buildWeatherPredictor(weatherBy[site.id] ?? null),
      };
    }));

    res.json(sites);
  } catch (err) { next(err); }
});

// ── GET /api/sites/:id ────────────────────────────────────────────────────────
router.get('/sites/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const siteRes = await pool.query(`SELECT id, site_master_id, name, starlink_sn, starlink_uuid, kit_id, location, district, lat, lng, score_7day_avg, created_at FROM sites WHERE id = $1`, [id]);
    if (!siteRes.rows.length) return res.status(404).json({ error: 'Site not found' });

    const site    = siteRes.rows[0];
    const signal  = await getSiteSignal(id);
    const weatherRes = await pool.query(
      `SELECT date::text AS date, rainfall_mm, cloud_cover_pct
       FROM weather_log
       WHERE site_id = $1
       ORDER BY date DESC
       LIMIT 1`,
      [id]
    );
    const weather = weatherRes.rows[0]
      ? {
          date: weatherRes.rows[0].date,
          rainfall_mm: weatherRes.rows[0].rainfall_mm == null ? null : Number(weatherRes.rows[0].rainfall_mm),
          cloud_cover_pct: weatherRes.rows[0].cloud_cover_pct == null ? null : Number(weatherRes.rows[0].cloud_cover_pct),
        }
      : null;
    const weatherPredictor = buildWeatherPredictor(weather);

    const laptopsRes = await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE ${deviceOnlineWhere('d')}) AS online,
              COUNT(*) FILTER (WHERE d.intune_device_id IS NOT NULL) AS total_intune,
              COUNT(*) FILTER (WHERE d.intune_device_id IS NOT NULL AND ${deviceOnlineWhere('d')}) AS online_intune,
              COUNT(*) FILTER (WHERE ${CHROMEBOOK_DEVICE_WHERE}) AS total_chromebooks,
              COUNT(*) FILTER (WHERE ${CHROMEBOOK_DEVICE_WHERE} AND ${deviceOnlineWhere('d')}) AS online_chromebooks
       FROM devices d
       WHERE d.site_id = $1`,
      [id]
    );
    const scoreRes = await pool.query(
      `SELECT score, cause FROM daily_scores WHERE site_id = $1 ORDER BY date DESC LIMIT 1`,
      [id]
    );

    const devicesRes = await pool.query(
      `SELECT d.id, d.site_id, d.hostname, d.windows_sn, d.manufacturer, d.model,
              d.intune_device_id, d.role, ${DEVICE_SEEN_EXPR} AS last_seen,
              d.last_seen AS agent_last_seen_at, d.intune_last_sync_at,
              d.intune_enrolled_at, d.last_ingest_ok_at, d.compliance_state,
              d.user_principal_name, d.os, d.os_version,
              d.free_storage_bytes, d.total_storage_bytes,
              dh.battery_pct, dh.battery_health_pct,
              dh.disk_smart_status, dh.disk_smart_predict_failure, dh.disk_media_type,
              ${DEVICE_STATUS_CASE} AS status,
              ROUND(EXTRACT(EPOCH FROM (NOW() - ${DEVICE_SEEN_EXPR})) / 60)::INT AS stale_min
       FROM devices d
       LEFT JOIN LATERAL (
         SELECT battery_pct, battery_health_pct,
                disk_smart_status, disk_smart_predict_failure, disk_media_type
         FROM device_health
         WHERE device_id = d.id
         ORDER BY recorded_at DESC
         LIMIT 1
       ) dh ON TRUE
       WHERE d.site_id = $1`,
      [id]
    );

    res.json({
      ...site,
      score_7day_avg: site.score_7day_avg == null ? null : Number(site.score_7day_avg),
      signal,
      weather,
      weather_predictor: weatherPredictor,
      online_laptops: parseInt(laptopsRes.rows[0].online),
      total_laptops: parseInt(laptopsRes.rows[0].total),
      online_intune_laptops: parseInt(laptopsRes.rows[0].online_intune),
      total_intune_laptops: parseInt(laptopsRes.rows[0].total_intune),
      online_chromebooks: parseInt(laptopsRes.rows[0].online_chromebooks),
      total_chromebooks: parseInt(laptopsRes.rows[0].total_chromebooks),
      score: scoreRes.rows[0]?.score ?? null,
      cause: scoreRes.rows[0]?.cause ?? null,
      download_mbps: signal?.download_mbps ?? null,
      upload_mbps: signal?.upload_mbps ?? null,
      devices: devicesRes.rows,
    });
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
// Optional query param: ?filter=stale  (Intune/agent check-in older than the healthy window)
router.get('/devices', async (req, res, next) => {
  try {
    const staleOnly = req.query.filter === 'stale';
    const whereClause = staleOnly
      ? `AND ${deviceStaleWhere('d')}`
      : '';

    const result = await pool.query(
      `SELECT d.id, d.site_id, d.hostname, d.windows_sn, d.manufacturer, d.model,
              d.intune_device_id, d.role, ${DEVICE_SEEN_EXPR} AS last_seen,
              d.last_seen AS agent_last_seen_at, d.intune_last_sync_at,
              d.intune_enrolled_at, d.last_ingest_ok_at, d.compliance_state,
              d.user_principal_name, d.os, d.os_version, d.device_category,
              d.free_storage_bytes, d.total_storage_bytes,
              s.name AS site_name,
              dh.battery_pct, dh.battery_health_pct,
              dh.disk_smart_status, dh.disk_smart_predict_failure, dh.disk_media_type,
              ${DEVICE_STATUS_CASE} AS status,
              ROUND(EXTRACT(EPOCH FROM (NOW() - ${DEVICE_SEEN_EXPR})) / 60)::INT AS stale_min
       FROM devices d
       LEFT JOIN sites s ON s.id = d.site_id
       LEFT JOIN LATERAL (
         SELECT battery_pct, battery_health_pct,
                disk_smart_status, disk_smart_predict_failure, disk_media_type
         FROM device_health
         WHERE device_id = d.id
         ORDER BY recorded_at DESC
         LIMIT 1
       ) dh ON TRUE
       WHERE 1=1 ${whereClause}
       ORDER BY ${DEVICE_SEEN_EXPR} ASC NULLS LAST`
    );
    res.json(result.rows);
  } catch (err) { next(err); }
});

// ── GET /api/students ─────────────────────────────────────────────────────────
// Circles roster joined to each student's school site. Optional ?site_id=N to
// scope to one campus, ?limit=N (default 1000, max 2000).
router.get('/students', async (req, res, next) => {
  try {
    const params = [];
    let where = '';
    if (req.query.site_id != null && req.query.site_id !== '') {
      params.push(parseInt(req.query.site_id, 10));
      where = `WHERE st.site_id = $${params.length}`;
    }
    const limit = Math.min(parseInt(req.query.limit || '1000', 10), 2000);
    params.push(limit);

    const result = await pool.query(
      `SELECT st.id, st.full_name, st.email, st.school, st.site_id,
              s.name AS site_name
       FROM students st
       LEFT JOIN sites s ON s.id = st.site_id
       ${where}
       ORDER BY st.full_name ASC
       LIMIT $${params.length}`,
      params
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

// ── GET /api/ops/freshness (admin only) ──────────────────────────────────────
// Redacted operational audit for device freshness, ingest health, and Graph setup.
router.get('/ops/freshness', requireAdmin, async (req, res, next) => {
  try {
    const [freshnessRes, sourceRes, ingestRes, triggerRes, agentHealthRes, discoveryRes] = await Promise.all([
      pool.query(
        `SELECT
           NOW() AS db_now,
           COUNT(*)::INT AS total_devices,
           COUNT(*) FILTER (WHERE ${DEVICE_SEEN_EXPR} > NOW() - INTERVAL '${DEVICE_ONLINE_HOURS} hours')::INT AS online_by_latest_seen,
           COUNT(*) FILTER (
             WHERE ${DEVICE_SEEN_EXPR} <= NOW() - INTERVAL '${DEVICE_ONLINE_HOURS} hours'
               AND ${DEVICE_SEEN_EXPR} > NOW() - INTERVAL '${DEVICE_STALE_HOURS} hours'
           )::INT AS stale_by_latest_seen,
           COUNT(*) FILTER (WHERE ${DEVICE_SEEN_EXPR} <= NOW() - INTERVAL '${DEVICE_STALE_HOURS} hours')::INT AS offline_by_latest_seen,
           COUNT(*) FILTER (WHERE ${DEVICE_SEEN_EXPR} IS NULL)::INT AS unknown_latest_seen,
           COUNT(*) FILTER (WHERE intune_device_id IS NOT NULL)::INT AS intune_managed,
           COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '${DEVICE_ONLINE_HOURS} hours')::INT AS agent_seen_recent,
           COUNT(*) FILTER (WHERE intune_last_sync_at > NOW() - INTERVAL '${DEVICE_ONLINE_HOURS} hours')::INT AS intune_seen_recent,
           COUNT(*) FILTER (WHERE last_ingest_ok_at > NOW() - INTERVAL '${DEVICE_ONLINE_HOURS} hours')::INT AS ingest_seen_recent,
           COUNT(*) FILTER (WHERE last_seen IS NOT NULL AND intune_last_sync_at IS NOT NULL AND last_seen > intune_last_sync_at)::INT AS agent_newer_than_intune,
           COUNT(*) FILTER (WHERE site_id IS NULL OR site_id = 0)::INT AS unresolved_site
         FROM devices d`
      ),
      pool.query(
        `SELECT source, bucket, COUNT(*)::INT AS count
         FROM (
           SELECT 'agent_last_seen' AS source,
                  CASE WHEN last_seen IS NULL THEN 'never'
                       WHEN last_seen > NOW() - INTERVAL '${DEVICE_ONLINE_HOURS} hours' THEN 'recent'
                       WHEN last_seen > NOW() - INTERVAL '${DEVICE_STALE_HOURS} hours' THEN 'stale'
                       ELSE 'offline' END AS bucket
           FROM devices
           UNION ALL
           SELECT 'intune_last_sync',
                  CASE WHEN intune_last_sync_at IS NULL THEN 'never'
                       WHEN intune_last_sync_at > NOW() - INTERVAL '${DEVICE_ONLINE_HOURS} hours' THEN 'recent'
                       WHEN intune_last_sync_at > NOW() - INTERVAL '${DEVICE_STALE_HOURS} hours' THEN 'stale'
                       ELSE 'offline' END
           FROM devices
           UNION ALL
           SELECT 'last_ingest_ok',
                  CASE WHEN last_ingest_ok_at IS NULL THEN 'never'
                       WHEN last_ingest_ok_at > NOW() - INTERVAL '${DEVICE_ONLINE_HOURS} hours' THEN 'recent'
                       WHEN last_ingest_ok_at > NOW() - INTERVAL '${DEVICE_STALE_HOURS} hours' THEN 'stale'
                       ELSE 'offline' END
           FROM devices
         ) x
         GROUP BY source, bucket
         ORDER BY source, bucket`
      ),
      pool.query(
        `SELECT metric, latest, rows_24h
         FROM (
           SELECT 'devices.last_seen' AS metric, MAX(last_seen) AS latest, COUNT(*) FILTER (WHERE last_seen > NOW() - INTERVAL '24 hours')::INT AS rows_24h FROM devices
           UNION ALL SELECT 'devices.intune_last_sync_at', MAX(intune_last_sync_at), COUNT(*) FILTER (WHERE intune_last_sync_at > NOW() - INTERVAL '24 hours')::INT FROM devices
           UNION ALL SELECT 'devices.last_ingest_ok_at', MAX(last_ingest_ok_at), COUNT(*) FILTER (WHERE last_ingest_ok_at > NOW() - INTERVAL '24 hours')::INT FROM devices
           UNION ALL SELECT 'signal_readings', MAX(recorded_at), COUNT(*) FILTER (WHERE recorded_at > NOW() - INTERVAL '24 hours')::INT FROM signal_readings
           UNION ALL SELECT 'latency_readings', MAX(recorded_at), COUNT(*) FILTER (WHERE recorded_at > NOW() - INTERVAL '24 hours')::INT FROM latency_readings
           UNION ALL SELECT 'device_health', MAX(recorded_at), COUNT(*) FILTER (WHERE recorded_at > NOW() - INTERVAL '24 hours')::INT FROM device_health
           UNION ALL SELECT 'agent_health_snapshots', MAX(recorded_at), COUNT(*) FILTER (WHERE recorded_at > NOW() - INTERVAL '24 hours')::INT FROM agent_health_snapshots
         ) metrics`
      ),
      pool.query(
        `SELECT type, status, COUNT(*)::INT AS count, MIN(triggered_at) AS oldest, MAX(triggered_at) AS newest
         FROM script_triggers
         WHERE triggered_at > NOW() - INTERVAL '14 days'
         GROUP BY type, status
         ORDER BY newest DESC NULLS LAST`
      ),
      pool.query(
        `WITH latest AS (
           SELECT DISTINCT ON (device_id) device_id, recorded_at, queue_depth, oldest_queue_age_sec,
                  agent_version, last_error, last_success_at
           FROM agent_health_snapshots
           ORDER BY device_id, recorded_at DESC
         )
         SELECT
           COUNT(*)::INT AS reporting_devices,
           MAX(recorded_at) AS latest_report,
           COUNT(*) FILTER (WHERE recorded_at > NOW() - INTERVAL '24 hours')::INT AS reports_24h,
           COUNT(*) FILTER (WHERE queue_depth > 0)::INT AS with_queue,
           MAX(queue_depth)::INT AS max_queue,
           COUNT(*) FILTER (WHERE last_error IS NOT NULL AND last_error <> '')::INT AS with_last_error
         FROM latest`
      ),
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE d.site_id IS NULL OR d.site_id = 0)::INT AS unresolved_total,
           COUNT(*) FILTER (
             WHERE (d.site_id IS NULL OR d.site_id = 0)
               AND d.last_seen > NOW() - INTERVAL '${DEVICE_ONLINE_HOURS} hours'
           )::INT AS unresolved_agent_recent,
           COUNT(*) FILTER (
             WHERE (d.site_id IS NULL OR d.site_id = 0)
               AND d.intune_last_sync_at > NOW() - INTERVAL '${DEVICE_ONLINE_HOURS} hours'
           )::INT AS unresolved_intune_recent,
           COUNT(*) FILTER (
             WHERE (d.site_id IS NULL OR d.site_id = 0)
               AND d.last_lat IS NOT NULL
               AND d.last_lon IS NOT NULL
           )::INT AS unresolved_with_gps,
           COUNT(*) FILTER (
             WHERE (d.site_id IS NULL OR d.site_id = 0)
               AND d.last_gps_at > NOW() - INTERVAL '${DEVICE_ONLINE_HOURS} hours'
           )::INT AS unresolved_fresh_gps,
           (SELECT COUNT(*)::INT FROM site_move_candidates) AS pending_site_move_candidates,
           (SELECT MAX(updated_at) FROM site_move_candidates) AS latest_site_move_candidate
         FROM devices d`
      ),
    ]);

    res.json({
      config: graphClient.getRuntimeConfigStatus(),
      freshness: freshnessRes.rows[0],
      by_source: sourceRes.rows,
      ingest: ingestRes.rows,
      trigger_summary_14d: triggerRes.rows,
      agent_health: agentHealthRes.rows[0],
      discovery: discoveryRes.rows[0],
    });
  } catch (err) { next(err); }
});

// ── POST /api/intune/sync (admin only) ───────────────────────────────────────
router.post('/intune/sync', requireAdmin, async (req, res, next) => {
  try {
    const result = await graphClient.syncManagedDevices();
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// ── GET /api/intune/sync-health (admin only) ─────────────────────────────────
// Validates that the Graph sync is populating key device fields.
router.get('/intune/sync-health', requireAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)::INT AS total_intune_devices,
        COUNT(*) FILTER (WHERE model IS NOT NULL)::INT AS has_model,
        COUNT(*) FILTER (WHERE os IS NOT NULL)::INT AS has_os,
        COUNT(*) FILTER (WHERE os_version IS NOT NULL)::INT AS has_os_version,
        COUNT(*) FILTER (WHERE compliance_state IS NOT NULL)::INT AS has_compliance_state,
        COUNT(*) FILTER (WHERE total_storage_bytes IS NOT NULL)::INT AS has_storage,
        COUNT(*) FILTER (WHERE device_category IS NOT NULL)::INT AS has_device_category,
        COUNT(*) FILTER (WHERE intune_synced_at > NOW() - INTERVAL '24 hours')::INT AS synced_last_24h,
        MAX(intune_synced_at) AS last_sync_at
      FROM devices
      WHERE intune_device_id IS NOT NULL
    `);
    const stats = rows[0];
    const total = stats.total_intune_devices;
    const fields = [
      { field: 'model', populated: stats.has_model, pct: total ? Math.round(stats.has_model / total * 100) : 0 },
      { field: 'os', populated: stats.has_os, pct: total ? Math.round(stats.has_os / total * 100) : 0 },
      { field: 'os_version', populated: stats.has_os_version, pct: total ? Math.round(stats.has_os_version / total * 100) : 0 },
      { field: 'compliance_state', populated: stats.has_compliance_state, pct: total ? Math.round(stats.has_compliance_state / total * 100) : 0 },
      { field: 'storage', populated: stats.has_storage, pct: total ? Math.round(stats.has_storage / total * 100) : 0 },
      { field: 'device_category', populated: stats.has_device_category, pct: total ? Math.round(stats.has_device_category / total * 100) : 0 },
    ];
    const healthy = fields.every(f => f.pct >= 80);
    res.json({
      healthy,
      total_intune_devices: total,
      synced_last_24h: stats.synced_last_24h,
      last_sync_at: stats.last_sync_at,
      fields,
    });
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

function ensureTriggerConfig(res, type) {
  const config = graphClient.validateRemediationConfig(type);
  if (!config.ok) {
    res.status(config.status || 500).json({ error: config.error });
    return false;
  }
  return true;
}

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
    if (!ensureTriggerConfig(res, type)) return;

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
    if (!ensureTriggerConfig(res, type)) return;

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

// ── POST /api/trigger/devices (admin only) ───────────────────────────────────
// Body: { type } → triggers every Intune-managed laptop in the fleet.
router.post('/trigger/devices', requireAdmin, async (req, res, next) => {
  try {
    const { type } = req.body;
    if (!type) {
      return res.status(400).json({ error: 'type is required' });
    }
    if (!TRIGGER_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${TRIGGER_TYPES.join(', ')}` });
    }
    if (!ensureTriggerConfig(res, type)) return;

    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT id
         FROM devices
         WHERE intune_device_id IS NOT NULL
         ORDER BY last_seen DESC NULLS LAST, id ASC`
      );

      const trigger_ids = [];
      for (const row of rows) {
        trigger_ids.push(await createDeviceTrigger(client, row.id, type, req.user.email));
      }

      res.json({ ok: true, type, count: trigger_ids.length, trigger_ids });
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});


// ── GET /api/alerts ───────────────────────────────────────────────────────────
// Durable web-facing alerts. Synchronizes current derived conditions before read.
router.get('/alerts', async (req, res, next) => {
  try {
    await syncDerivedAlerts();
    const status = String(req.query.status || 'open');
    const limit = Math.min(parseInt(req.query.limit || '100', 10), 300);
    const params = [];
    let where = '';
    if (status !== 'all') {
      params.push(status);
      where = `WHERE a.status = $${params.length}`;
    }
    params.push(limit);

    const { rows } = await pool.query(
      `SELECT a.*, s.name AS site_name
       FROM alert_events a
       LEFT JOIN sites s ON s.id = a.site_id
       ${where}
       ORDER BY
         CASE a.severity WHEN 'critical' THEN 3 WHEN 'warning' THEN 2 ELSE 1 END DESC,
         a.last_seen_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(rows.map(mapAlertRow));
  } catch (err) { next(err); }
});

// ── GET /api/alerts/summary ───────────────────────────────────────────────────
// Chart-friendly buckets by day, severity, category, and status.
router.get('/alerts/summary', async (req, res, next) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days || '14', 10), 1), 90);
    const { rows } = await pool.query(
      `SELECT
         date_trunc('day', detected_at)::DATE AS day,
         severity,
         category,
         status,
         COUNT(*)::INT AS count
       FROM alert_events
       WHERE detected_at >= NOW() - ($1::INT * INTERVAL '1 day')
       GROUP BY 1, 2, 3, 4
       ORDER BY 1 ASC, 2 ASC, 3 ASC, 4 ASC`,
      [days]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ── POST /api/alerts/:id/ack (admin only) ─────────────────────────────────────
router.post('/alerts/:id/ack', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE alert_events
       SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $1
       WHERE id = $2 AND status = 'open'
       RETURNING id, source_type, source_id`,
      [req.user.id, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Alert not found or already handled' });
    }

    const row = result.rows[0];
    if (row.source_type === 'site_change' && row.source_id) {
      await pool.query(
        `UPDATE site_change_events
         SET acknowledged_at = COALESCE(acknowledged_at, NOW()), acknowledged_by = COALESCE(acknowledged_by, $1)
         WHERE id = $2`,
        [req.user.id, row.source_id]
      );
    }

    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/alerts/:id/assign (admin only) ──────────────────────────────────
// Stores the assignee name in alert_events.metadata->>'assignee'. No schema
// change needed — metadata is already JSONB. Pass { assignee: null } to clear.
router.post('/alerts/:id/assign', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const raw = req.body && req.body.assignee;
    const assignee = raw == null ? null : String(raw).trim();
    if (assignee !== null && !assignee) {
      return res.status(400).json({ error: 'assignee must be a non-empty string or null' });
    }

    const result = await pool.query(
      assignee === null
        ? `UPDATE alert_events SET metadata = metadata - 'assignee'
           WHERE id = $1 RETURNING id, metadata`
        : `UPDATE alert_events
           SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('assignee', $1::text)
           WHERE id = $2 RETURNING id, metadata`,
      assignee === null ? [id] : [assignee, id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: 'Alert not found' });
    }
    res.json({ ok: true, assignee });
  } catch (err) { next(err); }
});

// Site-change events are now surfaced through the durable alerts API
// (GET /api/alerts, POST /api/alerts/:id/ack). The legacy /site-changes read +
// ack routes were retired once web, mobile, and desktop all moved to /api/alerts.
// The site_change_events table and the alert-engine sync that feeds alert_events
// from it remain unchanged.

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

// ── GET /api/intel/weather ───────────────────────────────────────────────────
// Returns the latest Open-Meteo rainfall/cloud reading per site.
router.get('/intel/weather', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (w.site_id)
              w.site_id, s.name AS site_name, w.date::text AS date, w.rainfall_mm, w.cloud_cover_pct
       FROM weather_log w
       JOIN sites s ON s.id = w.site_id
       ORDER BY w.site_id, w.date DESC`
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

// ── GET /api/intel/satellites ─────────────────────────────────────────────────
// Returns current positions of Starlink satellites visible over a bounding box.
// Defaults to the Rwanda region. Used by the map satellite overlay.
router.get('/intel/satellites', async (req, res, next) => {
  try {
    const minLat = parseFloat(req.query.min_lat ?? '-3.5');
    const maxLat = parseFloat(req.query.max_lat ?? '0.5');
    const minLng = parseFloat(req.query.min_lng ?? '28.0');
    const maxLng = parseFloat(req.query.max_lng ?? '31.5');
    const limit  = Math.min(Math.max(parseInt(req.query.limit || '200', 10), 1), 500);

    const satellites = await getVisibleSatellites(
      { minLat, maxLat, minLng, maxLng },
      limit,
    );

    res.json({
      count: satellites.length,
      computed_at: new Date().toISOString(),
      satellites,
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

// ── SITE CRUD (admin only) ────────────────────────────────────────────────────

// POST /api/sites — create a new site
router.post('/sites', requireAdmin, async (req, res, next) => {
  try {
    const { name, starlink_sn, location, district, lat, lng, kit_id, starlink_uuid } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!starlink_sn || typeof starlink_sn !== 'string' || !starlink_sn.trim()) {
      return res.status(400).json({ error: 'starlink_sn is required' });
    }
    if (lat != null && (typeof lat !== 'number' || lat < -90 || lat > 90)) {
      return res.status(400).json({ error: 'lat must be a number between -90 and 90' });
    }
    if (lng != null && (typeof lng !== 'number' || lng < -180 || lng > 180)) {
      return res.status(400).json({ error: 'lng must be a number between -180 and 180' });
    }

    const { rows } = await pool.query(
      `INSERT INTO sites (name, starlink_sn, location, district, lat, lng, kit_id, starlink_uuid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, name, starlink_sn, location, district, lat, lng, kit_id, starlink_uuid, created_at`,
      [name.trim(), starlink_sn.trim(), location || null, district || null,
       lat ?? null, lng ?? null, kit_id || null, starlink_uuid || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A site with that starlink_sn already exists' });
    next(err);
  }
});

// PATCH /api/sites/:id — update editable metadata
router.patch('/sites/:id', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const allowed = ['name', 'location', 'district', 'lat', 'lng', 'starlink_sn', 'kit_id', 'starlink_uuid'];
    const updates = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        updates[key] = req.body[key];
      }
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    if (updates.name != null && (!updates.name || !String(updates.name).trim())) {
      return res.status(400).json({ error: 'name cannot be empty' });
    }
    if (updates.lat != null && (typeof updates.lat !== 'number' || updates.lat < -90 || updates.lat > 90)) {
      return res.status(400).json({ error: 'lat must be a number between -90 and 90' });
    }
    if (updates.lng != null && (typeof updates.lng !== 'number' || updates.lng < -180 || updates.lng > 180)) {
      return res.status(400).json({ error: 'lng must be a number between -180 and 180' });
    }

    const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
    const values     = Object.values(updates);

    const { rows } = await pool.query(
      `UPDATE sites SET ${setClauses.join(', ')} WHERE id = $1
       RETURNING id, name, starlink_sn, location, district, lat, lng, kit_id, starlink_uuid, created_at`,
      [id, ...values]
    );
    if (!rows.length) return res.status(404).json({ error: 'Site not found' });
    res.json({ ok: true, site: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A site with that starlink_sn already exists' });
    next(err);
  }
});

// ── SITE NOTES ────────────────────────────────────────────────────────────────

// GET /api/sites/:id/notes
router.get('/sites/:id/notes', async (req, res, next) => {
  try {
    const { id } = req.params;
    const limit  = Math.min(parseInt(req.query.limit) || 50, 200);
    const before = req.query.before;

    let query = `SELECT id, site_id, author, body, created_at, updated_at
                 FROM site_notes
                 WHERE site_id = $1`;
    const params = [id];

    if (before) {
      query += ` AND created_at < $${params.length + 1}`;
      params.push(before);
    }
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) { next(err); }
});

// POST /api/sites/:id/notes
router.post('/sites/:id/notes', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { body } = req.body || {};
    if (!body || typeof body !== 'string' || !body.trim()) {
      return res.status(400).json({ error: 'body is required' });
    }
    if (body.length > 10000) {
      return res.status(400).json({ error: 'body must be 10000 characters or fewer' });
    }

    const siteCheck = await pool.query('SELECT id FROM sites WHERE id = $1', [id]);
    if (!siteCheck.rows.length) return res.status(404).json({ error: 'Site not found' });

    const { rows } = await pool.query(
      `INSERT INTO site_notes (site_id, author, body)
       VALUES ($1, $2, $3)
       RETURNING id, site_id, author, body, created_at, updated_at`,
      [id, req.user.email, body.trim()]
    );
    res.status(201).json({ ok: true, note: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/sites/:id/notes/:noteId
router.delete('/sites/:id/notes/:noteId', requireAdmin, async (req, res, next) => {
  try {
    const { id, noteId } = req.params;
    const { rowCount } = await pool.query(
      'DELETE FROM site_notes WHERE id = $1 AND site_id = $2',
      [noteId, id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Note not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── BIWEEKLY USAGE ────────────────────────────────────────────────────────────

// GET /api/sites/:id/biweekly-usage
router.get('/sites/:id/biweekly-usage', async (req, res, next) => {
  try {
    const { id } = req.params;
    const limit  = Math.min(parseInt(req.query.limit) || 12, 52);

    const { rows } = await pool.query(
      `SELECT id, site_id, period_start::text, period_end::text,
              bytes_down, bytes_up, notes, entered_by, entered_at
       FROM site_biweekly_usage
       WHERE site_id = $1
       ORDER BY period_start DESC
       LIMIT $2`,
      [id, limit]
    );
    res.json(rows.map(r => ({
      ...r,
      bytes_down: Number(r.bytes_down),
      bytes_up:   Number(r.bytes_up),
    })));
  } catch (err) { next(err); }
});

// POST /api/sites/:id/biweekly-usage
router.post('/sites/:id/biweekly-usage', requireAdmin, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { period_start, period_end, bytes_down, bytes_up, gb_down, gb_up, gb_total, notes } = req.body || {};

    if (!period_start || !period_end) {
      return res.status(400).json({ error: 'period_start and period_end are required (YYYY-MM-DD)' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(period_start) || !/^\d{4}-\d{2}-\d{2}$/.test(period_end)) {
      return res.status(400).json({ error: 'period_start and period_end must be YYYY-MM-DD' });
    }
    if (period_end <= period_start) {
      return res.status(400).json({ error: 'period_end must be after period_start' });
    }

    const GB = 1024 * 1024 * 1024;
    let down = 0;
    let up   = 0;

    if (bytes_down != null) down = Number(bytes_down);
    else if (gb_down != null) down = Math.round(Number(gb_down) * GB);

    if (bytes_up != null) up = Number(bytes_up);
    else if (gb_up != null) up = Math.round(Number(gb_up) * GB);

    if (down === 0 && up === 0 && gb_total != null) {
      const total = Math.round(Number(gb_total) * GB);
      down = Math.round(total / 2);
      up   = total - down;
    }

    if (!Number.isFinite(down) || down < 0 || !Number.isFinite(up) || up < 0) {
      return res.status(400).json({ error: 'Provide at least one of: bytes_down, bytes_up, gb_down, gb_up, gb_total' });
    }

    const siteCheck = await pool.query('SELECT id FROM sites WHERE id = $1', [id]);
    if (!siteCheck.rows.length) return res.status(404).json({ error: 'Site not found' });

    const { rows } = await pool.query(
      `INSERT INTO site_biweekly_usage (site_id, period_start, period_end, bytes_down, bytes_up, notes, entered_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (site_id, period_start) DO UPDATE SET
         period_end  = EXCLUDED.period_end,
         bytes_down  = EXCLUDED.bytes_down,
         bytes_up    = EXCLUDED.bytes_up,
         notes       = EXCLUDED.notes,
         entered_by  = EXCLUDED.entered_by,
         entered_at  = NOW()
       RETURNING id, site_id, period_start::text, period_end::text,
                 bytes_down, bytes_up, notes, entered_by, entered_at`,
      [id, period_start, period_end, down, up, notes || null, req.user.email]
    );
    const row = rows[0];
    res.status(201).json({
      ok: true,
      entry: { ...row, bytes_down: Number(row.bytes_down), bytes_up: Number(row.bytes_up) },
    });
  } catch (err) { next(err); }
});

// DELETE /api/sites/:id/biweekly-usage/:entryId
router.delete('/sites/:id/biweekly-usage/:entryId', requireAdmin, async (req, res, next) => {
  try {
    const { id, entryId } = req.params;
    const { rowCount } = await pool.query(
      'DELETE FROM site_biweekly_usage WHERE id = $1 AND site_id = $2',
      [entryId, id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Entry not found' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
