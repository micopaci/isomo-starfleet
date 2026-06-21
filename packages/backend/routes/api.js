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
const { classifyAttribution, activeAlertNames } = require('../services/starlinkTelemetry');
const { computeSnapshotDailyTotal } = require('../services/starlinkPortalUsage');
const { sendEmail } = require('../services/notifier');
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

function requireAdminOrStarlinkCollector(req, res, next) {
  if (!req.user || !['admin', 'starlink_collector'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden — admin or starlink_collector role required' });
  }
  next();
}

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

function parseDateOnly(raw) {
  if (!raw) return null;
  const value = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const dt = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  const normalized = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  if (normalized !== value) return null;
  return value;
}

function bytesFromUsageEntry(entry = {}, field = 'bytes_total') {
  let bytes = null;
  if (entry[field] != null) bytes = Number(entry[field]);
  else if (entry.mb_total != null) bytes = Math.round(Number(entry.mb_total) * 1024 * 1024);
  else if (entry.gb_total != null) bytes = Math.round(Number(entry.gb_total) * 1024 * 1024 * 1024);
  else if (entry.mb_used_cumulative != null) bytes = Math.round(Number(entry.mb_used_cumulative) * 1024 * 1024);
  else if (entry.gb_used_cumulative != null) bytes = Math.round(Number(entry.gb_used_cumulative) * 1024 * 1024 * 1024);

  if (!Number.isFinite(bytes) || bytes < 0) return null;
  return Math.round(bytes);
}

function safeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mapDailyUsageRow(row) {
  if (!row) return null;
  const bytes = Number(row.bytes_total || 0);
  return {
    date: row.date,
    bytes_total: bytes,
    gb_total: Math.round((bytes / (1024 * 1024 * 1024)) * 100) / 100,
    source: row.source,
    confidence: row.confidence,
    service_line_id: row.service_line_id || null,
    starlink_identifier: row.starlink_identifier || null,
    billing_period_start: row.billing_period_start || null,
    billing_period_end: row.billing_period_end || null,
    scraped_at: row.scraped_at || null,
    uploaded_at: row.uploaded_at || null,
  };
}

function sqlNameKey(expr) {
  return `regexp_replace(lower(coalesce(${expr}, '')), '[^a-z0-9]+', '', 'g')`;
}

function sqlSiteAliasKey(siteAlias = 's') {
  return `regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(${siteAlias}.name, '')), '^es[[:space:]]+', 'ecole des sciences ', 'i'),
      '^gs[[:space:]]+',
      'groupe scolaire ',
      'i'
    ),
    '[^a-z0-9]+',
    '',
    'g'
  )`;
}

function sqlTerminalSiteMatch(siteAlias = 's', terminalAlias = 'st') {
  const siteKey = sqlNameKey(`${siteAlias}.name`);
  const siteAliasKey = sqlSiteAliasKey(siteAlias);
  const terminalKey = sqlNameKey(`${terminalAlias}.nickname`);
  return `(
    ${terminalKey} <> ''
    AND (
      ${terminalKey} = ${siteKey}
      OR ${terminalKey} = ${siteAliasKey}
      OR (length(${siteKey}) > 5 AND ${terminalKey} LIKE '%' || ${siteKey} || '%')
      OR (length(${terminalKey}) > 5 AND ${siteKey} LIKE '%' || ${terminalKey} || '%')
      OR (length(${siteAliasKey}) > 5 AND ${terminalKey} LIKE '%' || ${siteAliasKey} || '%')
      OR (length(${terminalKey}) > 5 AND ${siteAliasKey} LIKE '%' || ${terminalKey} || '%')
    )
  )`;
}

function mapStarlinkTerminalRow(row) {
  if (!row) return null;
  const consumedGb = row.latest_consumed_gb == null ? null : Number(row.latest_consumed_gb);
  const usageTrend = Array.isArray(row.usage_trend)
    ? row.usage_trend.map(point => ({
        log_date: point.log_date,
        consumed_gb: point.consumed_gb == null ? null : Number(point.consumed_gb),
      })).filter(point => point.log_date)
    : [];
  return {
    service_line_id: row.service_line_id,
    site_id: row.site_id == null ? null : Number(row.site_id),
    site_name: row.site_name || null,
    nickname: row.nickname || null,
    account_id: row.account_id || null,
    current_status: row.current_status || 'Unknown',
    last_seen_utc: row.last_seen_utc || null,
    billing_cycle_start: row.billing_cycle_start || null,
    status_updated_at: row.status_updated_at || null,
    decommissioned_at: row.decommissioned_at || null,
    decommission_reason: row.decommission_reason || null,
    latest_usage: row.latest_log_date
      ? {
          log_date: row.latest_log_date,
          consumed_gb: consumedGb,
          collected_at: row.latest_collected_at || null,
        }
      : null,
    latest_ping: row.latest_ping_recorded_at
      ? {
          recorded_at: row.latest_ping_recorded_at,
          current_status: row.latest_ping_status || row.current_status || 'Unknown',
          is_offline: row.latest_ping_is_offline,
          ping_latency_ms: row.latest_ping_latency_ms == null ? null : Number(row.latest_ping_latency_ms),
          ping_drop_pct: row.latest_ping_drop_pct == null ? null : Number(row.latest_ping_drop_pct),
          last_seen_utc: row.latest_ping_last_seen_utc || null,
      }
      : null,
    usage_trend: usageTrend,
  };
}

function dailyUsageFromTerminal(terminal) {
  const latest = terminal?.latest_usage;
  if (!latest || latest.consumed_gb == null) return null;
  const bytes = Math.round(Number(latest.consumed_gb) * 1024 * 1024 * 1024);
  return {
    date: latest.log_date,
    bytes_total: bytes,
    gb_total: Math.round(Number(latest.consumed_gb) * 100) / 100,
    source: 'starlink_telemetryagg',
    confidence: 'portal_total',
    service_line_id: terminal.service_line_id,
    starlink_identifier: terminal.nickname || null,
    billing_period_start: terminal.billing_cycle_start || null,
    billing_period_end: null,
    scraped_at: latest.collected_at || null,
    uploaded_at: latest.collected_at || null,
  };
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

// Derive an outage-attribution verdict from the stored dish telemetry fields.
// Pure + cheap, so it runs on every read regardless of cache vs. DB source.
// Fields not yet persisted (outage, is_snr_persistently_low, software_update_state)
// degrade gracefully to null until the agent collects them.
function attachAttribution(signal) {
  if (!signal) return signal;
  const dish = {
    dish_grpc_reachable: signal.dish_grpc_reachable,
    outage: signal.outage || null,
    disablement_code: signal.disablement_code || null,
    ready_states: signal.ready_states || null,
    obstruction_pct: signal.obstruction_pct == null ? null : Number(signal.obstruction_pct),
    is_snr_above_noise_floor: signal.is_snr_above_noise_floor,
    is_snr_persistently_low: signal.is_snr_persistently_low ?? null,
    active_alerts: activeAlertNames(signal.starlink_alerts || {}),
    software_update_state: signal.software_update_state || null,
  };
  const { verdict, confidence, failed_ready_states } = classifyAttribution({ dish });
  signal.attribution = {
    verdict,
    confidence,
    ...(failed_ready_states ? { failed_ready_states } : {}),
  };
  return signal;
}

async function getSiteSignal(siteId) {
  const cached = currentSignal.get(String(siteId));
  if (cached) return attachAttribution({ ...cached });

  const { rows } = await pool.query(
    `SELECT pop_latency_ms, snr, obstruction_pct, ping_drop_pct,
            download_mbps, upload_mbps,
            boresight_azimuth_deg, boresight_elevation_deg,
            is_snr_above_noise_floor, starlink_alerts, disablement_code, ready_states,
            dl_bandwidth_restricted_reason, ul_bandwidth_restricted_reason,
            dish_uptime_s, dish_bootcount, dish_grpc_reachable, starlink_power_verdict,
            confidence, recorded_at
     FROM signal_readings
     WHERE site_id = $1
       AND recorded_at > NOW() - INTERVAL '12 hours'
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [siteId]
  );
  if (!rows.length) return null;

  const row = rows[0];
  return attachAttribution({
    snr: row.snr == null ? null : Number(row.snr),
    pop_latency_ms: row.pop_latency_ms == null ? null : Number(row.pop_latency_ms),
    obstruction_pct: row.obstruction_pct == null ? null : Number(row.obstruction_pct),
    ping_drop_pct: row.ping_drop_pct == null ? null : Number(row.ping_drop_pct),
    download_mbps: row.download_mbps == null ? null : Number(row.download_mbps),
    upload_mbps: row.upload_mbps == null ? null : Number(row.upload_mbps),
    boresight_azimuth_deg: row.boresight_azimuth_deg == null ? null : Number(row.boresight_azimuth_deg),
    boresight_elevation_deg: row.boresight_elevation_deg == null ? null : Number(row.boresight_elevation_deg),
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
  });
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

let lastAlertsSync = 0;
let syncPromise = null;

async function syncDerivedAlerts() {
  const now = Date.now();
  if (syncPromise) {
    return syncPromise;
  }
  if (now - lastAlertsSync < 15000) {
    return;
  }

  syncPromise = (async () => {
    try {
      await _syncDerivedAlerts();
      lastAlertsSync = Date.now();
    } finally {
      syncPromise = null;
    }
  })();

  return syncPromise;
}

async function _syncDerivedAlerts() {
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
          AND recorded_at > NOW() - INTERVAL '12 hours'
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
          message: `${siteLabel} has not reported signal in the last 12 hours.`,
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

    // Inventory mismatches: device is marked broken but heartbeating
    const inventoryMismatches = await client.query(`
      SELECT id, profile_number, windows_sn AS serial_number, hardware_status, last_seen AS last_seen_at
      FROM devices
      WHERE hardware_status IN ('intake_broken', 'in_repair', 'decommissioned')
        AND last_seen >= NOW() - INTERVAL '24 hours'
    `);
    for (const row of inventoryMismatches.rows) {
      const active_key = `inventory-mismatch:${row.id}`;
      activeKeys.push(active_key);
      await upsertAlert(client, {
        active_key,
        source_type: 'derived',
        source_id: String(row.id),
        site_id: null,
        device_id: row.id,
        severity: 'critical',
        category: 'inventory',
        title: 'Inventory Mismatch',
        message: `Device ${row.profile_number || row.serial_number} is marked as '${row.hardware_status}' but has recently connected.`,
        metadata: { profile_number: row.profile_number, hardware_status: row.hardware_status, last_seen_at: row.last_seen_at }
      });
    }

    const derivedKeys = activeKeys.filter(key => key.startsWith('site:') || key.startsWith('inventory-mismatch:'));
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
    const dailyUsageRes = await pool.query(
      `SELECT DISTINCT ON (site_id)
              site_id, date::text AS date, bytes_total, source, confidence,
              service_line_id, starlink_identifier,
              billing_period_start::text AS billing_period_start,
              billing_period_end::text AS billing_period_end,
              scraped_at, uploaded_at
       FROM site_usage_totals_daily
       WHERE date >= CURRENT_DATE - INTERVAL '45 days'
       ORDER BY site_id, date DESC`
    );
    const terminalRes = await pool.query(
      `SELECT DISTINCT ON (resolved.site_id)
              resolved.site_id,
              st.service_line_id,
              st.nickname,
              st.account_id,
              st.current_status,
              st.last_seen_utc,
              st.billing_cycle_start::text AS billing_cycle_start,
              st.status_updated_at,
              resolved.site_name,
              latest.log_date::text AS latest_log_date,
              latest.consumed_gb AS latest_consumed_gb,
              latest.collected_at AS latest_collected_at,
              latest_ping.recorded_at AS latest_ping_recorded_at,
              latest_ping.current_status AS latest_ping_status,
              latest_ping.is_offline AS latest_ping_is_offline,
              latest_ping.ping_latency_ms AS latest_ping_latency_ms,
              latest_ping.ping_drop_pct AS latest_ping_drop_pct,
              latest_ping.last_seen_utc AS latest_ping_last_seen_utc,
              usage_trend.usage_trend
       FROM starlink_terminals st
       LEFT JOIN LATERAL (
         SELECT s.id AS site_id, s.name AS site_name
         FROM sites s
         WHERE s.id = st.site_id
            OR ${sqlTerminalSiteMatch('s', 'st')}
         ORDER BY CASE WHEN s.id = st.site_id THEN 0 ELSE 1 END, s.id
         LIMIT 1
       ) resolved ON TRUE
       LEFT JOIN LATERAL (
         SELECT log_date, consumed_gb, collected_at
         FROM starlink_usage_history
         WHERE service_line_id = st.service_line_id
         ORDER BY log_date DESC
         LIMIT 1
       ) latest ON TRUE
       LEFT JOIN LATERAL (
         SELECT recorded_at, current_status, is_offline, ping_latency_ms, ping_drop_pct, last_seen_utc
         FROM starlink_ping_samples
         WHERE service_line_id = st.service_line_id
         ORDER BY recorded_at DESC
         LIMIT 1
       ) latest_ping ON TRUE
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('log_date', h.log_date::text, 'consumed_gb', h.consumed_gb) ORDER BY h.log_date ASC) AS usage_trend
         FROM (
           SELECT log_date, consumed_gb
           FROM starlink_usage_history
           WHERE service_line_id = st.service_line_id
             AND log_date >= CURRENT_DATE - INTERVAL '45 days'
             AND log_date <= CURRENT_DATE
           ORDER BY log_date ASC
         ) h
       ) usage_trend ON TRUE
       WHERE resolved.site_id IS NOT NULL
       -- One terminal per site: prefer ACTIVE over Inactive/decommissioned (so a
       -- decommissioned same-name terminal never hijacks a site's status), then
       -- Online, then most recently updated.
       ORDER BY resolved.site_id,
                (st.decommissioned_at IS NOT NULL) ASC,
                (st.current_status = 'Inactive') ASC,
                (st.current_status = 'Online') DESC,
                st.status_updated_at DESC NULLS LAST, st.updated_at DESC`
    );
    const uptimeBy  = Object.fromEntries(uptimeRes.rows.map(r => [r.site_id, Number(r.uptime_pct)]));
    const dataBy    = Object.fromEntries(dataRes.rows.map(r => [r.site_id, Number(r.data_mb_today)]));
    const weatherBy = Object.fromEntries(weatherRes.rows.map(r => [r.site_id, {
      date: r.date,
      rainfall_mm: r.rainfall_mm == null ? null : Number(r.rainfall_mm),
      cloud_cover_pct: r.cloud_cover_pct == null ? null : Number(r.cloud_cover_pct),
    }]));
    const dailyUsageBy = Object.fromEntries(dailyUsageRes.rows.map(r => [r.site_id, mapDailyUsageRow(r)]));
    const terminalBy = Object.fromEntries(terminalRes.rows.map(r => [r.site_id, mapStarlinkTerminalRow(r)]));

    const sites = await Promise.all(sitesRes.rows.map(async (site) => {
      const signal = await getSiteSignal(site.id);
      const starlinkTerminal = terminalBy[site.id] ?? null;

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
        starlink_terminal: starlinkTerminal,
        starlink_usage_daily: dailyUsageBy[site.id] ?? dailyUsageFromTerminal(starlinkTerminal),
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
    const dailyUsageRes = await pool.query(
      `SELECT date::text AS date, bytes_total, source, confidence,
              service_line_id, starlink_identifier,
              billing_period_start::text AS billing_period_start,
              billing_period_end::text AS billing_period_end,
              scraped_at, uploaded_at
       FROM site_usage_totals_daily
       WHERE site_id = $1
       ORDER BY date DESC
       LIMIT 1`,
      [id]
    );
    const terminalRes = await pool.query(
      `SELECT
              resolved.site_id,
              st.service_line_id,
              st.nickname,
              st.account_id,
              st.current_status,
              st.last_seen_utc,
              st.billing_cycle_start::text AS billing_cycle_start,
              st.status_updated_at,
              resolved.site_name,
              latest.log_date::text AS latest_log_date,
              latest.consumed_gb AS latest_consumed_gb,
              latest.collected_at AS latest_collected_at,
              latest_ping.recorded_at AS latest_ping_recorded_at,
              latest_ping.current_status AS latest_ping_status,
              latest_ping.is_offline AS latest_ping_is_offline,
              latest_ping.ping_latency_ms AS latest_ping_latency_ms,
              latest_ping.ping_drop_pct AS latest_ping_drop_pct,
              latest_ping.last_seen_utc AS latest_ping_last_seen_utc,
              usage_trend.usage_trend
       FROM starlink_terminals st
       LEFT JOIN LATERAL (
         SELECT s.id AS site_id, s.name AS site_name
         FROM sites s
         WHERE s.id = st.site_id
            OR ${sqlTerminalSiteMatch('s', 'st')}
         ORDER BY CASE WHEN s.id = st.site_id THEN 0 ELSE 1 END, s.id
         LIMIT 1
       ) resolved ON TRUE
       LEFT JOIN LATERAL (
         SELECT log_date, consumed_gb, collected_at
         FROM starlink_usage_history
         WHERE service_line_id = st.service_line_id
         ORDER BY log_date DESC
         LIMIT 1
       ) latest ON TRUE
       LEFT JOIN LATERAL (
         SELECT recorded_at, current_status, is_offline, ping_latency_ms, ping_drop_pct, last_seen_utc
         FROM starlink_ping_samples
         WHERE service_line_id = st.service_line_id
         ORDER BY recorded_at DESC
         LIMIT 1
       ) latest_ping ON TRUE
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('log_date', h.log_date::text, 'consumed_gb', h.consumed_gb) ORDER BY h.log_date ASC) AS usage_trend
         FROM (
           SELECT log_date, consumed_gb
           FROM starlink_usage_history
           WHERE service_line_id = st.service_line_id
             AND log_date >= CURRENT_DATE - INTERVAL '45 days'
             AND log_date <= CURRENT_DATE
           ORDER BY log_date ASC
         ) h
       ) usage_trend ON TRUE
       WHERE resolved.site_id = $1
       ORDER BY st.status_updated_at DESC NULLS LAST, st.updated_at DESC
       LIMIT 1`,
      [id]
    );
    const starlinkTerminal = mapStarlinkTerminalRow(terminalRes.rows[0]);
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
      starlink_terminal: starlinkTerminal,
      starlink_usage_daily: mapDailyUsageRow(dailyUsageRes.rows[0]) ?? dailyUsageFromTerminal(starlinkTerminal),
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

// ── GET /api/sites/:id/starlink-usage ────────────────────────────────────────
// Returns direct Starlink telemetryagg daily usage for the linked service line.
router.get('/sites/:id/starlink-usage', async (req, res, next) => {
  try {
    const siteId = Number(req.params.id);
    const days = Math.max(1, Math.min(Number(req.query.days || 62), 366));
    if (!Number.isInteger(siteId) || siteId <= 0) {
      return res.status(400).json({ error: 'Invalid site id' });
    }

    const terminalRes = await pool.query(
      `SELECT
              resolved.site_id,
              st.service_line_id,
              st.nickname,
              st.account_id,
              st.current_status,
              st.last_seen_utc,
              st.billing_cycle_start::text AS billing_cycle_start,
              st.status_updated_at,
              resolved.site_name,
              latest.log_date::text AS latest_log_date,
              latest.consumed_gb AS latest_consumed_gb,
              latest.collected_at AS latest_collected_at,
              latest_ping.recorded_at AS latest_ping_recorded_at,
              latest_ping.current_status AS latest_ping_status,
              latest_ping.is_offline AS latest_ping_is_offline,
              latest_ping.ping_latency_ms AS latest_ping_latency_ms,
              latest_ping.ping_drop_pct AS latest_ping_drop_pct,
              latest_ping.last_seen_utc AS latest_ping_last_seen_utc,
              usage_trend.usage_trend
       FROM starlink_terminals st
       LEFT JOIN LATERAL (
         SELECT s.id AS site_id, s.name AS site_name
         FROM sites s
         WHERE s.id = st.site_id
            OR ${sqlTerminalSiteMatch('s', 'st')}
         ORDER BY CASE WHEN s.id = st.site_id THEN 0 ELSE 1 END, s.id
         LIMIT 1
       ) resolved ON TRUE
       LEFT JOIN LATERAL (
         SELECT log_date, consumed_gb, collected_at
         FROM starlink_usage_history
         WHERE service_line_id = st.service_line_id
         ORDER BY log_date DESC
         LIMIT 1
       ) latest ON TRUE
       LEFT JOIN LATERAL (
         SELECT recorded_at, current_status, is_offline, ping_latency_ms, ping_drop_pct, last_seen_utc
         FROM starlink_ping_samples
         WHERE service_line_id = st.service_line_id
         ORDER BY recorded_at DESC
         LIMIT 1
       ) latest_ping ON TRUE
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('log_date', h.log_date::text, 'consumed_gb', h.consumed_gb) ORDER BY h.log_date ASC) AS usage_trend
         FROM (
           SELECT log_date, consumed_gb
           FROM starlink_usage_history
           WHERE service_line_id = st.service_line_id
             AND log_date >= CURRENT_DATE - INTERVAL '45 days'
             AND log_date <= CURRENT_DATE
           ORDER BY log_date ASC
         ) h
       ) usage_trend ON TRUE
       WHERE resolved.site_id = $1
       ORDER BY st.status_updated_at DESC NULLS LAST, st.updated_at DESC
       LIMIT 1`,
      [siteId]
    );
    const terminal = mapStarlinkTerminalRow(terminalRes.rows[0]);
    if (!terminal) {
      return res.json({ terminal: null, active_billing_cycle_start: null, history: [] });
    }

    const requestedStart = parseDateOnly(req.query.from);
    const activeStart = requestedStart || terminal.billing_cycle_start || null;
    const params = [terminal.service_line_id];
    const windowWhere = activeStart
      ? `AND log_date >= $2::date`
      : `AND log_date >= CURRENT_DATE - ($2::int * INTERVAL '1 day')`;
    params.push(activeStart || days);

    const { rows } = await pool.query(
      `SELECT log_date::text AS log_date,
              consumed_gb,
              account_id,
              billing_cycle_start::text AS billing_cycle_start,
              collected_at,
              metadata
       FROM starlink_usage_history
       WHERE service_line_id = $1
         ${windowWhere}
         AND log_date <= CURRENT_DATE
       ORDER BY log_date ASC`,
      params
    );

    res.json({
      terminal,
      active_billing_cycle_start: activeStart,
      history: rows.map(row => ({
        log_date: row.log_date,
        consumed_gb: row.consumed_gb == null ? null : Number(row.consumed_gb),
        account_id: row.account_id || null,
        billing_cycle_start: row.billing_cycle_start || null,
        collected_at: row.collected_at || null,
        metadata: row.metadata || {},
      })),
    });
  } catch (err) { next(err); }
});

// ── GET /api/starlink-usage?from=YYYY-MM-DD&to=YYYY-MM-DD[&service_line_id=X]
// Returns direct Starlink telemetryagg usage by date for one service line or all.
router.get('/starlink-usage', async (req, res, next) => {
  try {
    const from = parseDateOnly(req.query.from) || parseDateOnly(req.query.start);
    const to = parseDateOnly(req.query.to) || parseDateOnly(req.query.end);
    const serviceLineId = req.query.service_line_id || req.query.serviceLineId || null;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to are required as YYYY-MM-DD' });
    }

    const params = [from, to];
    let serviceFilter = '';
    if (serviceLineId) {
      params.push(String(serviceLineId));
      serviceFilter = `AND h.service_line_id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT h.log_date::text AS log_date,
              h.service_line_id,
              h.consumed_gb,
              h.account_id,
              h.billing_cycle_start::text AS billing_cycle_start,
              h.collected_at,
              st.nickname,
              resolved.site_id,
              resolved.site_name
       FROM starlink_usage_history h
       JOIN starlink_terminals st ON st.service_line_id = h.service_line_id
       LEFT JOIN LATERAL (
         SELECT s.id AS site_id, s.name AS site_name
         FROM sites s
         WHERE s.id = st.site_id
            OR ${sqlTerminalSiteMatch('s', 'st')}
         ORDER BY CASE WHEN s.id = st.site_id THEN 0 ELSE 1 END, s.id
         LIMIT 1
       ) resolved ON TRUE
       WHERE h.log_date >= $1::date
         AND h.log_date <= $2::date
         ${serviceFilter}
       ORDER BY h.log_date ASC, COALESCE(resolved.site_name, st.nickname, h.service_line_id) ASC`,
      params
    );

    res.json({
      from,
      to,
      service_line_id: serviceLineId,
      rows: rows.map(row => ({
        log_date: row.log_date,
        service_line_id: row.service_line_id,
        nickname: row.nickname || null,
        site_id: row.site_id == null ? null : Number(row.site_id),
        site_name: row.site_name || null,
        consumed_gb: row.consumed_gb == null ? null : Number(row.consumed_gb),
        account_id: row.account_id || null,
        billing_cycle_start: row.billing_cycle_start || null,
        collected_at: row.collected_at || null,
      })),
    });
  } catch (err) { next(err); }
});

// ── GET /api/starlink-terminals?days=45 ─────────────────────────────────────
// Returns direct Starlink cloud inventory/status plus a compact data-use trend.
router.get('/starlink-terminals', async (req, res, next) => {
  try {
    const days = Math.max(1, Math.min(Number(req.query.days || 45), 366));
    const { rows } = await pool.query(
      `SELECT
              resolved.site_id,
              resolved.site_name,
              st.service_line_id,
              st.nickname,
              st.account_id,
              st.current_status,
              st.last_seen_utc,
              st.billing_cycle_start::text AS billing_cycle_start,
              st.status_updated_at,
              st.decommissioned_at,
              st.decommission_reason,
              latest.log_date::text AS latest_log_date,
              latest.consumed_gb AS latest_consumed_gb,
              latest.collected_at AS latest_collected_at,
              latest_ping.recorded_at AS latest_ping_recorded_at,
              latest_ping.current_status AS latest_ping_status,
              latest_ping.is_offline AS latest_ping_is_offline,
              latest_ping.ping_latency_ms AS latest_ping_latency_ms,
              latest_ping.ping_drop_pct AS latest_ping_drop_pct,
              latest_ping.last_seen_utc AS latest_ping_last_seen_utc,
              usage_trend.usage_trend
       FROM starlink_terminals st
       LEFT JOIN LATERAL (
         SELECT s.id AS site_id, s.name AS site_name
         FROM sites s
         WHERE s.id = st.site_id
            OR ${sqlTerminalSiteMatch('s', 'st')}
         ORDER BY CASE WHEN s.id = st.site_id THEN 0 ELSE 1 END, s.id
         LIMIT 1
       ) resolved ON TRUE
       LEFT JOIN LATERAL (
         SELECT log_date, consumed_gb, collected_at
         FROM starlink_usage_history
         WHERE service_line_id = st.service_line_id
         ORDER BY log_date DESC
         LIMIT 1
       ) latest ON TRUE
       LEFT JOIN LATERAL (
         SELECT recorded_at, current_status, is_offline, ping_latency_ms, ping_drop_pct, last_seen_utc
         FROM starlink_ping_samples
         WHERE service_line_id = st.service_line_id
         ORDER BY recorded_at DESC
         LIMIT 1
       ) latest_ping ON TRUE
       LEFT JOIN LATERAL (
         SELECT json_agg(json_build_object('log_date', h.log_date::text, 'consumed_gb', h.consumed_gb) ORDER BY h.log_date ASC) AS usage_trend
         FROM (
           SELECT log_date, consumed_gb
           FROM starlink_usage_history
           WHERE service_line_id = st.service_line_id
             AND log_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
             AND log_date <= CURRENT_DATE
           ORDER BY log_date ASC
         ) h
       ) usage_trend ON TRUE
       ORDER BY COALESCE(resolved.site_name, st.nickname, st.service_line_id), st.service_line_id`,
      [days]
    );

    res.json({
      days,
      terminals: rows.map(mapStarlinkTerminalRow),
    });
  } catch (err) { next(err); }
});

// ── POST /api/starlink-terminals/:serviceLineId/decommission ──────────────────
// Mark a service line decommissioned (with reason + date) or clear it.
// Decommissioning also flips current_status to 'Inactive' so it leaves reports.
router.post('/starlink-terminals/:serviceLineId/decommission', requireAdmin, async (req, res, next) => {
  try {
    const { serviceLineId } = req.params;
    const { reason, decommissioned_at, clear } = req.body || {};

    if (clear === true) {
      const { rows } = await pool.query(
        `UPDATE starlink_terminals
            SET decommissioned_at = NULL, decommission_reason = NULL, updated_at = NOW()
          WHERE service_line_id = $1
          RETURNING service_line_id`,
        [serviceLineId]
      );
      if (!rows.length) return res.status(404).json({ error: 'Terminal not found' });
      return res.json({ ok: true, service_line_id: serviceLineId, decommissioned: false });
    }

    const when = decommissioned_at ? new Date(decommissioned_at) : new Date();
    if (isNaN(when.getTime())) {
      return res.status(400).json({ error: 'decommissioned_at must be a valid date' });
    }
    const { rows } = await pool.query(
      `UPDATE starlink_terminals
          SET decommissioned_at = $2,
              decommission_reason = $3,
              current_status = 'Inactive',
              updated_at = NOW()
        WHERE service_line_id = $1
        RETURNING service_line_id`,
      [serviceLineId, when.toISOString(), reason ? String(reason).trim() : null]
    );
    if (!rows.length) return res.status(404).json({ error: 'Terminal not found' });
    res.json({ ok: true, service_line_id: serviceLineId, decommissioned: true });
  } catch (err) { next(err); }
});

// ── POST /api/starlink-terminals/decommission-stale ──────────────────────────
// Bulk-decommission terminals with no telemetry for N weeks (default 3).
// Pass { dryRun: true } to preview the affected terminals without changing them.
router.post('/starlink-terminals/decommission-stale', requireAdmin, async (req, res, next) => {
  try {
    const weeks = Math.max(1, Math.min(Number(req.body?.weeks || 3), 52));
    const dryRun = req.body?.dryRun === true;
    const days = weeks * 7;

    // "Hasn't reported" = NO daily usage record in starlink_usage_history within
    // the cutoff. last_seen_utc is unreliable (stale even for active dishes), so
    // recent data consumption is the real activity signal. Already-Inactive
    // terminals are left alone.
    const staleFilter = `
      WHERE st.current_status != 'Inactive'
        AND NOT EXISTS (
          SELECT 1 FROM starlink_usage_history h
          WHERE h.service_line_id = st.service_line_id
            AND h.log_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
        )`;

    if (dryRun) {
      const { rows } = await pool.query(
        `SELECT st.service_line_id, st.nickname, st.current_status,
                (SELECT MAX(h.log_date) FROM starlink_usage_history h WHERE h.service_line_id = st.service_line_id) AS last_usage_date
         FROM starlink_terminals st ${staleFilter}
         ORDER BY last_usage_date ASC NULLS FIRST`,
        [days]
      );
      return res.json({ dryRun: true, weeks, count: rows.length, terminals: rows });
    }

    const reason = `No data usage for ${weeks}+ weeks (auto)`;
    const { rows } = await pool.query(
      `UPDATE starlink_terminals
          SET current_status = 'Inactive',
              decommissioned_at = COALESCE(decommissioned_at, NOW()),
              decommission_reason = COALESCE(decommission_reason, $2),
              updated_at = NOW()
        WHERE service_line_id IN (
          SELECT st.service_line_id FROM starlink_terminals st ${staleFilter}
        )
        RETURNING service_line_id`,
      [days, reason]
    );
    res.json({ dryRun: false, weeks, decommissioned: rows.length, service_line_ids: rows.map(r => r.service_line_id) });
  } catch (err) { next(err); }
});

// ── POST /api/starlink-terminals/restore-active ───────────────────────────────
// Recover terminals that were AUTO-decommissioned but actually have recent data
// usage (i.e. were wrongly flagged). Clears decommission + resets to 'Unknown'
// so the status sync re-evaluates them. Manual decommissions are left untouched.
router.post('/starlink-terminals/restore-active', requireAdmin, async (req, res, next) => {
  try {
    const weeks = Math.max(1, Math.min(Number(req.body?.weeks || 3), 52));
    const days = weeks * 7;
    const { rows } = await pool.query(
      `UPDATE starlink_terminals st
          SET current_status = 'Unknown',
              decommissioned_at = NULL,
              decommission_reason = NULL,
              updated_at = NOW()
        WHERE st.decommission_reason LIKE '%(auto)'
          AND EXISTS (
            SELECT 1 FROM starlink_usage_history h
            WHERE h.service_line_id = st.service_line_id
              AND h.log_date >= CURRENT_DATE - ($1::int * INTERVAL '1 day')
          )
        RETURNING service_line_id`,
      [days]
    );
    res.json({ restored: rows.length, service_line_ids: rows.map(r => r.service_line_id) });
  } catch (err) { next(err); }
});

function mapPingSampleRow(row) {
  return {
    recorded_at: row.recorded_at,
    service_line_id: row.service_line_id,
    site_id: row.site_id == null ? null : Number(row.site_id),
    current_status: row.current_status || 'Unknown',
    is_offline: row.is_offline,
    ping_latency_ms: row.ping_latency_ms == null ? null : Number(row.ping_latency_ms),
    ping_drop_pct: row.ping_drop_pct == null ? null : Number(row.ping_drop_pct),
    last_seen_utc: row.last_seen_utc || null,
  };
}

async function getPingSamples({ serviceLineId, siteId, hours }) {
  const params = [];
  let where = '';
  const join = `
      JOIN starlink_terminals st ON st.service_line_id = p.service_line_id
      LEFT JOIN LATERAL (
        SELECT s.id AS site_id
        FROM sites s
        WHERE s.id = st.site_id
           OR ${sqlTerminalSiteMatch('s', 'st')}
        ORDER BY CASE WHEN s.id = st.site_id THEN 0 ELSE 1 END, s.id
        LIMIT 1
      ) resolved ON TRUE`;
  if (serviceLineId) {
    params.push(String(serviceLineId));
    where = `p.service_line_id = $${params.length}`;
  } else {
    params.push(Number(siteId));
    where = `resolved.site_id = $${params.length}`;
  }
  params.push(hours);
  const { rows } = await pool.query(
    `SELECT p.recorded_at, p.service_line_id, COALESCE(p.site_id, resolved.site_id) AS site_id,
            p.current_status, p.is_offline, p.ping_latency_ms, p.ping_drop_pct, p.last_seen_utc
     FROM starlink_ping_samples p
     ${join}
     WHERE ${where}
       AND p.recorded_at >= NOW() - ($${params.length}::int * INTERVAL '1 hour')
     ORDER BY p.recorded_at ASC`,
    params
  );
  return rows.map(mapPingSampleRow);
}

// ── GET /api/sites/:id/starlink-ping?hours=24 ────────────────────────────────
router.get('/sites/:id/starlink-ping', async (req, res, next) => {
  try {
    const siteId = Number(req.params.id);
    const hours = Math.max(1, Math.min(Number(req.query.hours || 24), 168));
    if (!Number.isInteger(siteId) || siteId <= 0) {
      return res.status(400).json({ error: 'Invalid site id' });
    }
    const samples = await getPingSamples({ siteId, hours });
    res.json({ site_id: siteId, hours, samples });
  } catch (err) { next(err); }
});

// ── GET /api/starlink-terminals/:serviceLineId/ping?hours=24 ────────────────
router.get('/starlink-terminals/:serviceLineId/ping', async (req, res, next) => {
  try {
    const serviceLineId = String(req.params.serviceLineId || '').trim();
    const hours = Math.max(1, Math.min(Number(req.query.hours || 24), 168));
    if (!serviceLineId) {
      return res.status(400).json({ error: 'serviceLineId is required' });
    }
    const samples = await getPingSamples({ serviceLineId, hours });
    res.json({ service_line_id: serviceLineId, hours, samples });
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
              d.free_storage_bytes, d.total_storage_bytes, d.profile_number, d.hardware_status,
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

// ── POST /api/alerts/:id/reconcile (admin only) ──────────────────────────────
router.post('/alerts/:id/reconcile', requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const { action, comment, assignee_email, assignee_type, site_id } = req.body || {};

    if (!['reassign', 'comment'].includes(action)) {
      return res.status(400).json({ error: 'invalid action. Must be reassign or comment' });
    }

    await client.query('BEGIN');

    // Fetch the alert event
    const alertRes = await client.query('SELECT * FROM alert_events WHERE id = $1', [id]);
    if (alertRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Alert not found' });
    }
    const alertRow = alertRes.rows[0];
    if (alertRow.category !== 'inventory' || !alertRow.device_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Reconciliation is only supported for inventory mismatch alerts' });
    }

    const deviceId = alertRow.device_id;
    const operator = req.user?.email || 'unknown_operator';

    // Fetch current device state
    const devRes = await client.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (devRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Device not found' });
    }
    const prevDevice = devRes.rows[0];

    if (action === 'reassign') {
      if (!assignee_email || !assignee_type) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'assignee_email and assignee_type are required for reassign' });
      }

      // Unassign existing active assignments
      await client.query(
        `UPDATE device_assignments
         SET unassigned_at = NOW(), status = 'transferred', unassign_reason = 'role_change'
         WHERE device_id = $1 AND status = 'active'`,
        [deviceId]
      );

      // Create new assignment
      await client.query(
        `INSERT INTO device_assignments (device_id, assignee_email, assignee_type, site_id, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [deviceId, assignee_email, assignee_type, site_id || null]
      );

      // Update devices table (set status to working_in_use)
      const updateRes = await client.query(
        `UPDATE devices 
         SET site_id = $1, user_principal_name = $2, hardware_status = 'working_in_use'
         WHERE id = $3 
         RETURNING *`,
        [site_id || null, assignee_email, deviceId]
      );
      const updatedDevice = updateRes.rows[0];

      // Log lifecycle ASSIGN
      await client.query(
        `INSERT INTO device_lifecycle_logs 
         (device_id, operator_email, action_type, previous_state, new_state, repair_details)
         VALUES ($1, $2, 'ASSIGN', $3, $4, $5)`,
        [deviceId, operator, 'ASSIGN', JSON.stringify(prevDevice), JSON.stringify(updatedDevice), comment || 'Reassigned from alert console']
      );

      // Resolve the alert
      await client.query(
        `UPDATE alert_events
         SET status = 'resolved', resolved_at = NOW(), metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('resolved_action', 'reassign', 'resolved_by', $1::text)
         WHERE id = $2`,
        [operator, id]
      );

      await client.query('COMMIT');
      return res.json({ ok: true, resolved_action: 'reassign', device: updatedDevice });

    } else if (action === 'comment') {
      if (!comment || !comment.trim()) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'comment text is required' });
      }

      // Keep marked as broken but log validation comment
      await client.query(
        `INSERT INTO device_lifecycle_logs 
         (device_id, operator_email, action_type, previous_state, new_state, repair_details)
         VALUES ($1, $2, 'VERIFICATION_MISMATCH', $3, $4, $5)`,
        [deviceId, operator, 'VERIFICATION_MISMATCH', JSON.stringify(prevDevice), JSON.stringify(prevDevice), comment.trim()]
      );

      // Resolve/Acknowledge the alert with comment details
      await client.query(
        `UPDATE alert_events
         SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $1,
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('reconciliation_comment', $2::text, 'reconciled_by', $3::text)
         WHERE id = $4`,
        [req.user.id, comment.trim(), operator, id]
      );

      await client.query('COMMIT');
      return res.json({ ok: true, resolved_action: 'comment' });
    }

  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
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
         FROM generate_series($2::int - 1, 0, -1) AS g(n)
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
       monthly_totals AS (
         SELECT month,
                bytes_total / (1024.0 * 1024.0) AS total_mb
         FROM site_usage_totals_monthly
         WHERE site_id = $1
       ),
       daily_totals AS (
         SELECT date_trunc('month', date)::date AS month,
                SUM(bytes_total) / (1024.0 * 1024.0) AS total_mb
         FROM site_usage_totals_daily
         WHERE site_id = $1
         GROUP BY 1
       ),
       totals AS (
         SELECT COALESCE(m.month, d.month) AS month,
                COALESCE(m.total_mb, d.total_mb) AS total_mb
         FROM monthly_totals m
         FULL OUTER JOIN daily_totals d ON d.month = m.month
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

// ── GET /api/sites/:id/usage/daily ───────────────────────────────────────────
// Returns daily Starlink portal totals with managed-device usage and residual.
router.get('/sites/:id/usage/daily', async (req, res, next) => {
  try {
    const siteId = Number(req.params.id);
    const days = Math.max(1, Math.min(Number(req.query.days || 31), 366));
    if (!Number.isInteger(siteId) || siteId <= 0) {
      return res.status(400).json({ error: 'Invalid site id' });
    }

    const { rows } = await pool.query(
      `WITH day_grid AS (
         SELECT (CURRENT_DATE - (g.n || ' days')::interval)::date AS date
         FROM generate_series($2::int - 1, 0, -1) AS g(n)
       ),
       managed AS (
         SELECT date,
                SUM(bytes_down + bytes_up) / (1024.0 * 1024.0) AS managed_mb
         FROM (
           SELECT date, bytes_down, bytes_up FROM data_usage WHERE site_id = $1
           UNION ALL
           SELECT date, bytes_down, bytes_up FROM data_usage_archive WHERE site_id = $1
         ) u
         GROUP BY date
       ),
       totals AS (
         SELECT date, bytes_total, source, confidence,
                service_line_id, starlink_identifier,
                billing_period_start::text AS billing_period_start,
                billing_period_end::text AS billing_period_end,
                scraped_at, uploaded_at
         FROM site_usage_totals_daily
         WHERE site_id = $1
       )
       SELECT dg.date::text AS date,
              ROUND(COALESCE(m.managed_mb, 0)::numeric, 2) AS managed_mb,
              ROUND((t.bytes_total / (1024.0 * 1024.0))::numeric, 2) AS total_mb,
              CASE
                WHEN t.bytes_total IS NULL THEN NULL
                ELSE ROUND(GREATEST((t.bytes_total / (1024.0 * 1024.0)) - COALESCE(m.managed_mb, 0), 0)::numeric, 2)
              END AS unattributed_mb,
              t.bytes_total,
              t.source,
              t.confidence,
              t.service_line_id,
              t.starlink_identifier,
              t.billing_period_start,
              t.billing_period_end,
              t.scraped_at,
              t.uploaded_at
       FROM day_grid dg
       LEFT JOIN managed m ON m.date = dg.date
       LEFT JOIN totals t ON t.date = dg.date
       ORDER BY dg.date ASC`,
      [siteId, days]
    );

    res.json(rows.map(r => ({
      date: r.date,
      managed_mb: Number(r.managed_mb || 0),
      total_mb: r.total_mb == null ? null : Number(r.total_mb),
      unattributed_mb: r.unattributed_mb == null ? null : Number(r.unattributed_mb),
      bytes_total: r.bytes_total == null ? null : Number(r.bytes_total),
      source: r.source || null,
      confidence: r.confidence || (r.bytes_total == null ? 'missing' : 'portal_total'),
      service_line_id: r.service_line_id || null,
      starlink_identifier: r.starlink_identifier || null,
      billing_period_start: r.billing_period_start || null,
      billing_period_end: r.billing_period_end || null,
      scraped_at: r.scraped_at || null,
      uploaded_at: r.uploaded_at || null,
    })));
  } catch (err) { next(err); }
});

// ── POST /api/usage/daily-import (admin/collector) ───────────────────────────
// Body: { date: "YYYY-MM-DD", entries: [{ site_id, bytes_total|mb_total|gb_total }] }
router.post('/usage/daily-import', requireAdminOrStarlinkCollector, async (req, res, next) => {
  try {
    const { entries, source } = req.body || {};
    const defaultDate = parseDateOnly(req.body?.date);
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries[] is required' });
    }

    const client = await pool.connect();
    let imported = 0;
    try {
      await client.query('BEGIN');
      for (const entry of entries) {
        const siteId = Number(entry.site_id);
        const date = parseDateOnly(entry.date) || defaultDate;
        const bytes = bytesFromUsageEntry(entry);
        if (!Number.isInteger(siteId) || siteId <= 0 || !date || bytes == null) continue;

        await client.query(
          `INSERT INTO site_usage_totals_daily
             (site_id, date, bytes_total, source, confidence, service_line_id,
              starlink_identifier, billing_period_start, billing_period_end,
              scraped_at, uploaded_by, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, NOW()), $11, $12)
           ON CONFLICT (site_id, date)
           DO UPDATE SET
             bytes_total = EXCLUDED.bytes_total,
             source = EXCLUDED.source,
             confidence = EXCLUDED.confidence,
             service_line_id = COALESCE(EXCLUDED.service_line_id, site_usage_totals_daily.service_line_id),
             starlink_identifier = COALESCE(EXCLUDED.starlink_identifier, site_usage_totals_daily.starlink_identifier),
             billing_period_start = COALESCE(EXCLUDED.billing_period_start, site_usage_totals_daily.billing_period_start),
             billing_period_end = COALESCE(EXCLUDED.billing_period_end, site_usage_totals_daily.billing_period_end),
             scraped_at = COALESCE(EXCLUDED.scraped_at, site_usage_totals_daily.scraped_at),
             uploaded_by = EXCLUDED.uploaded_by,
             uploaded_at = NOW(),
             metadata = EXCLUDED.metadata`,
          [
            siteId,
            date,
            bytes,
            entry.source || source || 'starlink_portal_scraper',
            entry.confidence || 'portal_total',
            entry.service_line_id || null,
            entry.starlink_identifier || entry.starlink_sn || entry.kit_id || null,
            parseDateOnly(entry.billing_period_start),
            parseDateOnly(entry.billing_period_end),
            entry.scraped_at || null,
            req.user?.email || null,
            safeMetadata(entry.metadata),
          ]
        );
        imported += 1;
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({ ok: true, imported });
  } catch (err) { next(err); }
});

// ── POST /api/usage/portal-snapshots (admin/collector) ───────────────────────
// Accepts cumulative Starlink portal readings and derives daily totals once a
// prior snapshot exists for the same site.
router.post('/usage/portal-snapshots', requireAdminOrStarlinkCollector, async (req, res, next) => {
  try {
    const { entries, source } = req.body || {};
    const defaultDate = parseDateOnly(req.body?.snapshot_date || req.body?.date);
    const defaultDailyDate = parseDateOnly(req.body?.daily_date);
    if (!Array.isArray(entries) || entries.length === 0) {
      return res.status(400).json({ error: 'entries[] is required' });
    }

    const client = await pool.connect();
    const results = [];
    let importedSnapshots = 0;
    let importedDailyTotals = 0;
    try {
      await client.query('BEGIN');
      for (const entry of entries) {
        const siteId = Number(entry.site_id);
        const snapshotDate = parseDateOnly(entry.snapshot_date || entry.date) || defaultDate;
        const dailyDate = parseDateOnly(entry.daily_date) || defaultDailyDate || snapshotDate;
        const cumulativeBytes = bytesFromUsageEntry(entry, 'bytes_used_cumulative');
        const entrySource = entry.source || source || 'starlink_portal_scraper';
        if (!Number.isInteger(siteId) || siteId <= 0 || !snapshotDate || !dailyDate || cumulativeBytes == null) {
          results.push({ site_id: entry.site_id, imported: false, reason: 'invalid_entry' });
          continue;
        }

        const previousRes = await client.query(
          `SELECT snapshot_date::text AS snapshot_date, bytes_used_cumulative
           FROM starlink_portal_usage_snapshots
           WHERE site_id = $1
             AND source = $2
             AND snapshot_date < $3::date
           ORDER BY snapshot_date DESC
           LIMIT 1`,
          [siteId, entrySource, snapshotDate]
        );

        await client.query(
          `INSERT INTO starlink_portal_usage_snapshots
             (site_id, snapshot_date, bytes_used_cumulative, source, service_line_id,
              starlink_identifier, billing_period_start, billing_period_end,
              collected_at, uploaded_by, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9::timestamptz, NOW()), $10, $11)
           ON CONFLICT (site_id, snapshot_date, source)
           DO UPDATE SET
             bytes_used_cumulative = EXCLUDED.bytes_used_cumulative,
             service_line_id = COALESCE(EXCLUDED.service_line_id, starlink_portal_usage_snapshots.service_line_id),
             starlink_identifier = COALESCE(EXCLUDED.starlink_identifier, starlink_portal_usage_snapshots.starlink_identifier),
             billing_period_start = COALESCE(EXCLUDED.billing_period_start, starlink_portal_usage_snapshots.billing_period_start),
             billing_period_end = COALESCE(EXCLUDED.billing_period_end, starlink_portal_usage_snapshots.billing_period_end),
             collected_at = EXCLUDED.collected_at,
             uploaded_by = EXCLUDED.uploaded_by,
             metadata = EXCLUDED.metadata`,
          [
            siteId,
            snapshotDate,
            cumulativeBytes,
            entrySource,
            entry.service_line_id || null,
            entry.starlink_identifier || entry.starlink_sn || entry.kit_id || null,
            parseDateOnly(entry.billing_period_start),
            parseDateOnly(entry.billing_period_end),
            entry.collected_at || entry.scraped_at || null,
            req.user?.email || null,
            safeMetadata(entry.metadata),
          ]
        );
        importedSnapshots += 1;

        const previous = previousRes.rows[0];
        if (!previous) {
          results.push({ site_id: siteId, snapshot_date: snapshotDate, imported: true, daily_total: false, reason: 'needs_previous_snapshot' });
          continue;
        }

        const prevBytes = Number(previous.bytes_used_cumulative);
        const delta = computeSnapshotDailyTotal(cumulativeBytes, prevBytes);
        const dailyBytes = delta.bytes_total;
        const confidence = delta.confidence;

        await client.query(
          `INSERT INTO site_usage_totals_daily
             (site_id, date, bytes_total, source, confidence, service_line_id,
              starlink_identifier, billing_period_start, billing_period_end,
              scraped_at, uploaded_by, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10::timestamptz, NOW()), $11, $12)
           ON CONFLICT (site_id, date)
           DO UPDATE SET
             bytes_total = EXCLUDED.bytes_total,
             source = EXCLUDED.source,
             confidence = EXCLUDED.confidence,
             service_line_id = COALESCE(EXCLUDED.service_line_id, site_usage_totals_daily.service_line_id),
             starlink_identifier = COALESCE(EXCLUDED.starlink_identifier, site_usage_totals_daily.starlink_identifier),
             billing_period_start = COALESCE(EXCLUDED.billing_period_start, site_usage_totals_daily.billing_period_start),
             billing_period_end = COALESCE(EXCLUDED.billing_period_end, site_usage_totals_daily.billing_period_end),
             scraped_at = COALESCE(EXCLUDED.scraped_at, site_usage_totals_daily.scraped_at),
             uploaded_by = EXCLUDED.uploaded_by,
             uploaded_at = NOW(),
             metadata = EXCLUDED.metadata`,
          [
            siteId,
            dailyDate,
            dailyBytes,
            entrySource,
            confidence,
            entry.service_line_id || null,
            entry.starlink_identifier || entry.starlink_sn || entry.kit_id || null,
            parseDateOnly(entry.billing_period_start),
            parseDateOnly(entry.billing_period_end),
            entry.collected_at || entry.scraped_at || null,
            req.user?.email || null,
            {
              ...safeMetadata(entry.metadata),
              snapshot_date: snapshotDate,
              previous_snapshot_date: previous.snapshot_date,
              previous_bytes_used_cumulative: prevBytes,
              counter_reset_detected: delta.counter_reset_detected,
            },
          ]
        );
        importedDailyTotals += 1;
        results.push({
          site_id: siteId,
          snapshot_date: snapshotDate,
          daily_date: dailyDate,
          imported: true,
          daily_total: true,
          bytes_total: dailyBytes,
          confidence,
        });
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    res.json({
      ok: true,
      imported_snapshots: importedSnapshots,
      imported_daily_totals: importedDailyTotals,
      results,
    });
  } catch (err) { next(err); }
});

// ── POST /api/usage/portal-runs (admin/collector) ────────────────────────────
// Scraper heartbeat/audit upsert. The Playwright worker can call this at start
// and finish so Starfleet can report stale or failed portal collection.
router.post('/usage/portal-runs', requireAdminOrStarlinkCollector, async (req, res, next) => {
  try {
    const {
      run_id, status, started_at, finished_at, sites_seen, sites_imported,
      error, report_sent_at, metadata,
    } = req.body || {};
    if (!run_id || !['running', 'success', 'partial', 'failed'].includes(status)) {
      return res.status(400).json({ error: 'run_id and valid status are required' });
    }

    const { rows } = await pool.query(
      `INSERT INTO starlink_portal_scraper_runs
         (run_id, status, started_at, finished_at, sites_seen, sites_imported,
          error, report_sent_at, metadata)
       VALUES ($1, $2, COALESCE($3::timestamptz, NOW()), $4, $5, $6, $7, $8, $9)
       ON CONFLICT (run_id)
       DO UPDATE SET
         status = EXCLUDED.status,
         finished_at = COALESCE(EXCLUDED.finished_at, starlink_portal_scraper_runs.finished_at),
         sites_seen = EXCLUDED.sites_seen,
         sites_imported = EXCLUDED.sites_imported,
         error = EXCLUDED.error,
         report_sent_at = COALESCE(EXCLUDED.report_sent_at, starlink_portal_scraper_runs.report_sent_at),
         metadata = EXCLUDED.metadata
       RETURNING *`,
      [
        run_id,
        status,
        started_at || null,
        finished_at || null,
        Number.isInteger(Number(sites_seen)) ? Number(sites_seen) : 0,
        Number.isInteger(Number(sites_imported)) ? Number(sites_imported) : 0,
        error || null,
        report_sent_at || null,
        safeMetadata(metadata),
      ]
    );

    const run = rows[0];
    if (run.status === 'failed' && !run.report_sent_at) {
      try {
        await sendEmail({
          subject: '[Starfleet] Starlink portal collector failed',
          text: `Starlink portal collector run ${run.run_id} failed.\n\nError: ${run.error || 'unknown'}\nStarted: ${run.started_at}\nFinished: ${run.finished_at || 'unknown'}`,
          html: `
            <h3>Starlink portal collector failed</h3>
            <p><strong>Run:</strong> ${escapeHtml(run.run_id)}</p>
            <p><strong>Error:</strong> ${escapeHtml(run.error || 'unknown')}</p>
            <p><strong>Started:</strong> ${escapeHtml(run.started_at)}</p>
            <p><strong>Finished:</strong> ${escapeHtml(run.finished_at || 'unknown')}</p>
          `,
        });
        const marked = await pool.query(
          `UPDATE starlink_portal_scraper_runs
           SET report_sent_at = NOW()
           WHERE run_id = $1
           RETURNING *`,
          [run.run_id]
        );
        if (marked.rows[0]) Object.assign(run, marked.rows[0]);
      } catch (notifyErr) {
        console.error('[StarlinkPortal] Failed to send collector failure alert:', notifyErr.message);
      }
    }

    res.json({ ok: true, run });
  } catch (err) { next(err); }
});

router.get('/usage/portal-runs', requireAdmin, async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit || 30), 100));
    const { rows } = await pool.query(
      `SELECT *
       FROM starlink_portal_scraper_runs
       ORDER BY started_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(rows);
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
const DAILY_TOTAL_HEADERS = ['site_id','date','bytes_total','source','confidence','service_line_id','starlink_identifier','billing_period_start','billing_period_end','scraped_at','uploaded_by','uploaded_at'];
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

// GET /api/export/site-usage-daily?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/export/site-usage-daily', requireAdmin, async (req, res, next) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) {
      return res.status(400).json({ error: 'from and to are required' });
    }
    const { rows } = await pool.query(
      `SELECT site_id, date, bytes_total, source, confidence, service_line_id,
              starlink_identifier, billing_period_start, billing_period_end,
              scraped_at, uploaded_by, uploaded_at
       FROM site_usage_totals_daily
       WHERE date >= $1::date AND date <= $2::date
       ORDER BY date ASC, site_id ASC`,
      [from, to]
    );
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="site_usage_daily_${from}_${to}.csv"`);
    res.send(toCSV(rows, DAILY_TOTAL_HEADERS));
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

// ── INVENTORY ONBOARDING & LIFECYCLE LEDGER ──────────────────────────────────

// Helper to get next sequential LAP-XXX profile number
async function getNextProfileNumber(client) {
  const { rows } = await client.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(profile_number FROM '\\d+') AS INTEGER)), 0) AS max_num
     FROM devices
     WHERE profile_number LIKE 'LAP-%'`
  );
  const nextNum = rows[0].max_num + 1;
  return 'LAP-' + String(nextNum).padStart(3, '0');
}

// POST /api/inventory/onboard
router.post('/inventory/onboard', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { serial_number } = req.body || {};
    if (!serial_number) {
      return res.status(400).json({ error: 'serial_number is required' });
    }
    const normalized = serial_number.trim().toUpperCase().replace(/\s+/g, '');
    if (!normalized) {
      return res.status(400).json({ error: 'invalid serial_number' });
    }

    await client.query('BEGIN');

    // Check if device already exists
    const devRes = await client.query(
      'SELECT * FROM devices WHERE serial_normalized = $1 OR UPPER(windows_sn) = $2',
      [normalized, normalized]
    );

    let device;
    const operator = req.user?.email || 'unknown_operator';

    if (devRes.rows.length > 0) {
      device = devRes.rows[0];
      if (!device.profile_number) {
        // Assign a profile number
        const nextProfile = await getNextProfileNumber(client);
        const updateRes = await client.query(
          `UPDATE devices 
           SET profile_number = $1, hardware_status = 'intake_broken' 
           WHERE id = $2 
           RETURNING *`,
          [nextProfile, device.id]
        );
        device = updateRes.rows[0];

        // Log BIND_LABEL
        await client.query(
          `INSERT INTO device_lifecycle_logs (device_id, operator_email, action_type, previous_state, new_state)
           VALUES ($1, $2, 'BIND_LABEL', $3, $4)`,
          [device.id, operator, JSON.stringify(devRes.rows[0]), JSON.stringify(device)]
        );
      } else {
        // If it already has a profile_number, just ensure status is intake_broken
        if (device.hardware_status !== 'intake_broken') {
          const prev = { ...device };
          const updateRes = await client.query(
            `UPDATE devices SET hardware_status = 'intake_broken' WHERE id = $1 RETURNING *`,
            [device.id]
          );
          device = updateRes.rows[0];
          await client.query(
            `INSERT INTO device_lifecycle_logs (device_id, operator_email, action_type, previous_state, new_state)
             VALUES ($1, $2, 'INTAKE_BROKEN', $3, $4)`,
            [device.id, operator, JSON.stringify(prev), JSON.stringify(device)]
          );
        }
      }
    } else {
      // Create a brand new device
      const nextProfile = await getNextProfileNumber(client);
      const insertRes = await client.query(
        `INSERT INTO devices (hostname, windows_sn, serial_normalized, profile_number, hardware_status, role)
         VALUES ($1, $2, $3, $4, 'intake_broken', 'standard')
         RETURNING *`,
        [`LAP-ONBOARD-${nextProfile.replace('LAP-', '')}`, normalized, normalized, nextProfile]
      );
      device = insertRes.rows[0];

      // Log REGISTER
      await client.query(
        `INSERT INTO device_lifecycle_logs (device_id, operator_email, action_type, new_state)
         VALUES ($1, $2, 'REGISTER', $3)`,
        [device.id, operator, JSON.stringify(device)]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, device });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/inventory/mark-state
router.post('/inventory/mark-state', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { deviceId, hardware_status, symptom_tags, repair_details, client_transaction_uuid } = req.body || {};
    if (!deviceId || !hardware_status) {
      return res.status(400).json({ error: 'deviceId and hardware_status are required' });
    }

    const validStatuses = ['working_in_use', 'intake_broken', 'in_repair', 'ready_for_reissue', 'decommissioned'];
    if (!validStatuses.includes(hardware_status)) {
      return res.status(400).json({ error: 'invalid hardware_status value' });
    }

    await client.query('BEGIN');

    // Fetch current device state
    const devRes = await client.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (devRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Device not found' });
    }
    const prevDevice = devRes.rows[0];
    const operator = req.user?.email || 'unknown_operator';

    // If there's a client_transaction_uuid, check for duplicate processing
    if (client_transaction_uuid) {
      const dupRes = await client.query('SELECT id FROM device_lifecycle_logs WHERE client_transaction_uuid = $1', [client_transaction_uuid]);
      if (dupRes.rows.length > 0) {
        await client.query('COMMIT');
        return res.json({ ok: true, message: 'Transaction already processed (idempotent)', device: prevDevice });
      }
    }

    // Update hardware status
    const updateRes = await client.query(
      'UPDATE devices SET hardware_status = $1 WHERE id = $2 RETURNING *',
      [hardware_status, deviceId]
    );
    const updatedDevice = updateRes.rows[0];

    // Determine action_type
    let action_type = 'INTAKE_BROKEN';
    if (hardware_status === 'in_repair') action_type = 'REPAIR_START';
    if (hardware_status === 'ready_for_reissue') action_type = 'REPAIR_COMPLETE';
    if (hardware_status === 'decommissioned') action_type = 'DECOMMISSION';
    if (hardware_status === 'working_in_use') action_type = 'REPAIR_COMPLETE'; // Fallback

    // Log to lifecycle logs
    await client.query(
      `INSERT INTO device_lifecycle_logs 
       (device_id, operator_email, action_type, previous_state, new_state, symptom_tags, repair_details, client_transaction_uuid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        deviceId, 
        operator, 
        action_type, 
        JSON.stringify(prevDevice), 
        JSON.stringify(updatedDevice), 
        symptom_tags || null, 
        repair_details || null,
        client_transaction_uuid || null
      ]
    );

    // If marking as broken/decommissioned, automatically unassign active assignments
    if (hardware_status === 'intake_broken' || hardware_status === 'decommissioned') {
      await client.query(
        `UPDATE device_assignments 
         SET unassigned_at = NOW(), status = 'returned', unassign_reason = 'broken'
         WHERE device_id = $1 AND status = 'active'`,
        [deviceId]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, device: updatedDevice });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// POST /api/inventory/reassign
router.post('/inventory/reassign', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { deviceId, assignee_email, assignee_type, site_id, client_transaction_uuid } = req.body || {};
    if (!deviceId || !assignee_email || !assignee_type) {
      return res.status(400).json({ error: 'deviceId, assignee_email, and assignee_type are required' });
    }

    if (!['student', 'staff', 'pool'].includes(assignee_type)) {
      return res.status(400).json({ error: 'invalid assignee_type' });
    }

    await client.query('BEGIN');

    // Fetch device
    const devRes = await client.query('SELECT * FROM devices WHERE id = $1', [deviceId]);
    if (devRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Device not found' });
    }
    const prevDevice = devRes.rows[0];
    const operator = req.user?.email || 'unknown_operator';

    // Idempotency check
    if (client_transaction_uuid) {
      const dupRes = await client.query('SELECT id FROM device_lifecycle_logs WHERE client_transaction_uuid = $1', [client_transaction_uuid]);
      if (dupRes.rows.length > 0) {
        await client.query('COMMIT');
        return res.json({ ok: true, message: 'Transaction already processed (idempotent)', device: prevDevice });
      }
    }

    // Unassign existing active assignments
    await client.query(
      `UPDATE device_assignments
       SET unassigned_at = NOW(), status = 'transferred', unassign_reason = 'role_change'
       WHERE device_id = $1 AND status = 'active'`,
      [deviceId]
    );

    // Create new assignment
    await client.query(
      `INSERT INTO device_assignments (device_id, assignee_email, assignee_type, site_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [deviceId, assignee_email, assignee_type, site_id || null]
    );

    // Update devices table
    const updateRes = await client.query(
      `UPDATE devices 
       SET site_id = $1, user_principal_name = $2, hardware_status = 'working_in_use'
       WHERE id = $3 
       RETURNING *`,
      [site_id || null, assignee_email, deviceId]
    );
    const updatedDevice = updateRes.rows[0];

    // Log lifecycle ASSIGN
    await client.query(
      `INSERT INTO device_lifecycle_logs 
       (device_id, operator_email, action_type, previous_state, new_state, client_transaction_uuid)
       VALUES ($1, $2, 'ASSIGN', $3, $4, $5)`,
      [
        deviceId,
        operator,
        'ASSIGN',
        JSON.stringify(prevDevice),
        JSON.stringify(updatedDevice),
        client_transaction_uuid || null
      ]
    );

    await client.query('COMMIT');
    res.json({ ok: true, device: updatedDevice });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

// POST /inventory/sync (offline transaction log replay)
router.post('/inventory/sync', async (req, res, next) => {
  const { transactions } = req.body || {};
  if (!Array.isArray(transactions)) {
    return res.status(400).json({ error: 'transactions array is required' });
  }

  const results = [];
  const operator = req.user?.email || 'unknown_operator';

  // Process transactions in chronological order
  const sorted = [...transactions].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  for (const tx of sorted) {
    const { transaction_uuid, action_type, profile_number, payload, timestamp } = tx;
    if (!transaction_uuid || !action_type || !profile_number) {
      results.push({ transaction_uuid, status: 'failed', error: 'Missing core transaction fields' });
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Idempotency check: see if client_transaction_uuid already exists in logs
      const dupRes = await client.query('SELECT id FROM device_lifecycle_logs WHERE client_transaction_uuid = $1', [transaction_uuid]);
      if (dupRes.rows.length > 0) {
        await client.query('COMMIT');
        results.push({ transaction_uuid, status: 'success', note: 'already processed' });
        continue;
      }

      // Find device by profile_number
      const devRes = await client.query('SELECT * FROM devices WHERE profile_number = $1', [profile_number]);
      if (devRes.rows.length === 0) {
        throw new Error(`Device profile ${profile_number} not found`);
      }
      const device = devRes.rows[0];
      const deviceId = device.id;

      let prevDevice = { ...device };
      let updatedDevice = { ...device };

      if (action_type === 'INTAKE_BROKEN' || action_type === 'REPAIR_START' || action_type === 'REPAIR_COMPLETE') {
        let targetStatus = 'intake_broken';
        if (action_type === 'REPAIR_START') targetStatus = 'in_repair';
        if (action_type === 'REPAIR_COMPLETE') targetStatus = 'ready_for_reissue';

        const updateRes = await client.query(
          'UPDATE devices SET hardware_status = $1 WHERE id = $2 RETURNING *',
          [targetStatus, deviceId]
        );
        updatedDevice = updateRes.rows[0];

        // Log lifecycle event with transaction metadata and original timestamp
        await client.query(
          `INSERT INTO device_lifecycle_logs 
           (device_id, operator_email, action_type, previous_state, new_state, symptom_tags, repair_details, client_transaction_uuid, recorded_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            deviceId,
            operator,
            action_type,
            JSON.stringify(prevDevice),
            JSON.stringify(updatedDevice),
            payload?.symptom_tags || null,
            payload?.notes || null,
            transaction_uuid,
            new Date(timestamp)
          ]
        );

        if (targetStatus === 'intake_broken') {
          await client.query(
            `UPDATE device_assignments 
             SET unassigned_at = $2, status = 'returned', unassign_reason = 'broken'
             WHERE device_id = $1 AND status = 'active'`,
            [deviceId, new Date(timestamp)]
          );
        }
      } else if (action_type === 'ASSIGN') {
        const { assignee_email, assignee_type, site_id } = payload || {};
        if (!assignee_email || !assignee_type) {
          throw new Error('assignee_email and assignee_type required for ASSIGN');
        }

        // Unassign existing active assignments
        await client.query(
          `UPDATE device_assignments
           SET unassigned_at = $2, status = 'transferred', unassign_reason = 'role_change'
           WHERE device_id = $1 AND status = 'active'`,
          [deviceId, new Date(timestamp)]
        );

        // Create new assignment
        await client.query(
          `INSERT INTO device_assignments (device_id, assignee_email, assignee_type, site_id, status, assigned_at)
           VALUES ($1, $2, $3, $4, 'active', $5)`,
          [deviceId, assignee_email, assignee_type, site_id || null, new Date(timestamp)]
        );

        // Update devices table
        const updateRes = await client.query(
          `UPDATE devices 
           SET site_id = $1, user_principal_name = $2, hardware_status = 'working_in_use'
           WHERE id = $3 
           RETURNING *`,
          [site_id || null, assignee_email, deviceId]
        );
        updatedDevice = updateRes.rows[0];

        // Log lifecycle ASSIGN
        await client.query(
          `INSERT INTO device_lifecycle_logs 
           (device_id, operator_email, action_type, previous_state, new_state, client_transaction_uuid, recorded_at)
           VALUES ($1, $2, 'ASSIGN', $3, $4, $5, $6)`,
          [
            deviceId,
            operator,
            'ASSIGN',
            JSON.stringify(prevDevice),
            JSON.stringify(updatedDevice),
            transaction_uuid,
            new Date(timestamp)
          ]
        );
      } else if (action_type === 'UNASSIGN') {
        // Unassign active assignment
        await client.query(
          `UPDATE device_assignments 
           SET unassigned_at = $2, status = 'returned', unassign_reason = 'role_change'
           WHERE device_id = $1 AND status = 'active'`,
          [deviceId, new Date(timestamp)]
        );

        // Log lifecycle UNASSIGN
        await client.query(
          `INSERT INTO device_lifecycle_logs 
           (device_id, operator_email, action_type, previous_state, new_state, client_transaction_uuid, recorded_at)
           VALUES ($1, $2, 'UNASSIGN', $3, $4, $5, $6)`,
          [
            deviceId,
            operator,
            'UNASSIGN',
            JSON.stringify(prevDevice),
            JSON.stringify(updatedDevice),
            transaction_uuid,
            new Date(timestamp)
          ]
        );
      } else {
        throw new Error(`Unknown action_type: ${action_type}`);
      }

      await client.query('COMMIT');
      results.push({ transaction_uuid, status: 'success' });
    } catch (err) {
      await client.query('ROLLBACK');
      results.push({ transaction_uuid, status: 'failed', error: err.message });
    } finally {
      client.release();
    }
  }

  res.json({ ok: true, results });
});

// GET /api/inventory/devices/:deviceId/logs
router.get('/inventory/devices/:deviceId/logs', async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM device_lifecycle_logs
       WHERE device_id = $1
       ORDER BY recorded_at DESC`,
      [deviceId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// GET /api/inventory/devices/:deviceId/assignments
router.get('/inventory/devices/:deviceId/assignments', async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { rows } = await pool.query(
      `SELECT * FROM device_assignments
       WHERE device_id = $1
       ORDER BY assigned_at DESC`,
      [deviceId]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

module.exports = router;
