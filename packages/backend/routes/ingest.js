/**
 * Stage 1B — Ingest API endpoints (v5.6 Final)
 * POST /ingest/heartbeat - Updates BIOS sn, Hostname, and OS/Model metadata
 * POST /ingest/signal    - Haversine-based Site Discovery
 * POST /ingest/health    - Battery, RAM, and Disk % metrics
 */
const express = require('express');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const { broadcast } = require('../services/websocket');
const { currentSignal } = require('../services/cache');
const { nearestSite, resolveAndMaybeNotify } = require('../services/siteResolver');
const { normalizeSerial } = require('../services/deviceIdentity');
const {
  heartbeatLimiter,
  signalLimiter,
  latencyLimiter,
  healthLimiter,
  usageLimiter,
  agentHealthLimiter,
} = require('../middleware/ingestRateLimit');

const router = express.Router();

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

function signAgentToken({ siteId, deviceSn, expiresIn }) {
  const { key, options } = getAgentTokenSignOptions();
  const subject = deviceSn ? `agent-site-${siteId}-${deviceSn}` : `agent-site-${siteId}`;
  return jwt.sign(
    {
      sub: subject,
      email: `${subject}@starfleet.local`,
      role: 'agent',
      site_id: siteId,
      device_sn: deviceSn || undefined,
    },
    key,
    { ...options, expiresIn: normalizeAgentTokenTtl(expiresIn) },
  );
}

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

function asJsonOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  return value;
}

function normalizeSiteIdForDb(siteId) {
  const n = Number(siteId);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function isRealSiteId(siteId) {
  return normalizeSiteIdForDb(siteId) !== null;
}

/**
 * Maps agent device_sn (BIOS) to database windows_sn.
 * Updates OS and Model metadata on every check-in.
 */
async function autoRegisterDevice(client, device_sn, site_id, hostname, metadata = {}) {
  const { os, model, manufacturer } = metadata;
  const serialNormalized = normalizeSerial(device_sn);
  const dbSiteId = normalizeSiteIdForDb(site_id);

  const existing = await client.query(
    `SELECT id
     FROM devices
     WHERE windows_sn = $1
        OR ($2::TEXT IS NOT NULL AND serial_normalized = $2)
     ORDER BY CASE
       WHEN $2::TEXT IS NOT NULL AND serial_normalized = $2 THEN 0
       ELSE 1
     END
     LIMIT 1`,
    [device_sn, serialNormalized]
  );

  if (existing.rows.length) {
    const result = await client.query(
      `UPDATE devices
       SET site_id = CASE
             WHEN devices.site_id IS NULL OR devices.site_id = 0 THEN $2
             ELSE devices.site_id
           END,
           windows_sn = CASE
             WHEN NOT EXISTS (SELECT 1 FROM devices WHERE windows_sn = $1 AND id <> $7) THEN $1
             ELSE windows_sn
           END,
           serial_normalized = COALESCE($6, serial_normalized),
           hostname = COALESCE($3, hostname),
           os = COALESCE($4, os),
           model = COALESCE($5, model),
           manufacturer = COALESCE($8, manufacturer)
       WHERE id = $7
       RETURNING id`,
      [device_sn, dbSiteId, hostname || null, os || null, model || null, serialNormalized, existing.rows[0].id, manufacturer || null]
    );
    return result.rows[0].id;
  }

  const result = await client.query(
    `INSERT INTO devices (windows_sn, site_id, hostname, os, model, manufacturer, serial_normalized)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (windows_sn)
     DO UPDATE SET 
       site_id = CASE
         WHEN devices.site_id IS NULL OR devices.site_id = 0 THEN EXCLUDED.site_id
         ELSE devices.site_id
       END,
       hostname = COALESCE(EXCLUDED.hostname, devices.hostname),
       os = COALESCE(EXCLUDED.os, devices.os),
       model = COALESCE(EXCLUDED.model, devices.model),
       manufacturer = COALESCE(EXCLUDED.manufacturer, devices.manufacturer),
       serial_normalized = COALESCE(EXCLUDED.serial_normalized, devices.serial_normalized)
     RETURNING id`,
    [device_sn, dbSiteId, hostname || null, os || null, model || null, manufacturer || null, serialNormalized]
  );
  return result.rows[0].id;
}

function enforceAgentSiteScope(req, res, postedSiteId) {
  if (req.user?.role !== 'agent') return true;
  const tokenSite = Number(req.user?.site_id ?? -1);
  const bodySite = Number(postedSiteId || 0);
  if (tokenSite === 0 && bodySite === 0) {
    return true;
  }
  if (!tokenSite || !bodySite || tokenSite !== bodySite) {
    res.status(403).json({ error: 'Forbidden — agent token site scope mismatch' });
    return false;
  }
  return true;
}

async function getCanonicalSiteId(client, device_id, fallbackSiteId) {
  const r = await client.query(`SELECT site_id FROM devices WHERE id = $1`, [device_id]);
  return normalizeSiteIdForDb(r.rows[0]?.site_id) ?? normalizeSiteIdForDb(fallbackSiteId);
}

async function markIngestSuccess(client, device_id, timestampIso) {
  await client.query(
    `UPDATE devices SET last_ingest_ok_at = $1 WHERE id = $2`,
    [timestampIso || new Date().toISOString(), device_id]
  );
}

async function isDuplicatePayload(client, endpoint, device_id, payload_id) {
  if (!payload_id) return false;
  const dedup = await client.query(
    `INSERT INTO ingest_payload_dedup (endpoint, device_id, payload_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (endpoint, device_id, payload_id) DO NOTHING
     RETURNING id`,
    [endpoint, device_id, payload_id]
  );
  return dedup.rows.length === 0;
}

function starlinkIdentityCandidates(...values) {
  const out = new Set();

  for (const raw of values) {
    const value = String(raw || '').trim().toLowerCase();
    if (!value) continue;

    out.add(value);
    if (value.startsWith('ut') && value.length > 2) out.add(value.slice(2));
    if (/^[0-9a-f-]{16,}$/.test(value) && !value.startsWith('ut')) out.add(`ut${value}`);
  }

  return [...out];
}

async function resolveSiteFromGpsOrIdentity(client, body = {}) {
  const identitySiteId = await resolveSiteFromStarlinkIdentity(client, body);
  if (identitySiteId) {
    return { site_id: identitySiteId, source: 'starlink_identity' };
  }

  const lat = body.lat == null ? null : Number(body.lat);
  const lon = body.lon == null ? null : Number(body.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const resolved = await nearestSite(lat, lon);
    if (resolved?.site_id) {
      return { site_id: resolved.site_id, source: 'gps', distance_km: resolved.distance_km };
    }
  }

  return null;
}

async function resolveSiteFromStarlinkIdentity(client, identities = {}) {
  const candidates = starlinkIdentityCandidates(
    identities.starlink_id,
    identities.starlink_uuid,
    identities.starlink_sn,
    identities.kit_id
  );
  if (!candidates.length) return null;

  const { rows } = await client.query(
    `SELECT id
     FROM sites
     WHERE LOWER(COALESCE(starlink_uuid, '')) = ANY($1)
        OR LOWER(COALESCE(starlink_sn, '')) = ANY($1)
        OR LOWER(COALESCE(kit_id, '')) = ANY($1)
     ORDER BY id
     LIMIT 1`,
    [candidates]
  );

  return rows[0]?.id ?? null;
}

// ── POST /ingest/bootstrap-token ─────────────────────────────────────────────
// Exchanges a shared discovery token (site_id 0) for a device/site-scoped agent token.
router.post('/bootstrap-token', agentHealthLimiter, async (req, res, next) => {
  try {
    if (req.user?.role !== 'agent' || Number(req.user?.site_id ?? -1) !== 0) {
      return res.status(403).json({ error: 'Forbidden — discovery agent token required' });
    }
    if (!require400(res, req.body, ['device_sn'])) return;

    const {
      device_sn, hostname, os, model, manufacturer,
      lat, lon, starlink_id, starlink_uuid, starlink_sn, kit_id,
    } = req.body;

    const client = await pool.connect();
    try {
      const resolved = await resolveSiteFromGpsOrIdentity(client, {
        lat, lon, starlink_id, starlink_uuid, starlink_sn, kit_id,
      });
      const discoveryDeviceId = await autoRegisterDevice(client, device_sn, 0, hostname, {
        os, model, manufacturer,
      });

      if (!resolved?.site_id) {
        await markIngestSuccess(client, discoveryDeviceId, new Date().toISOString());
        return res.status(409).json({
          error: 'Unable to resolve site from Starlink GPS or identity yet',
          site_id: 0,
        });
      }

      await client.query(
        `UPDATE devices SET site_id = $1, last_lat = COALESCE($2, last_lat),
             last_lon = COALESCE($3, last_lon), last_gps_at = CASE WHEN $2 IS NULL OR $3 IS NULL THEN last_gps_at ELSE NOW() END
         WHERE id = $4`,
        [resolved.site_id, lat ?? null, lon ?? null, discoveryDeviceId],
      );
      await markIngestSuccess(client, discoveryDeviceId, new Date().toISOString());

      const siteRes = await client.query(`SELECT name FROM sites WHERE id = $1`, [resolved.site_id]);
      const expiresIn = normalizeAgentTokenTtl(process.env.AGENT_TOKEN_TTL || '365d');
      const token = signAgentToken({ siteId: resolved.site_id, deviceSn: device_sn, expiresIn });
      return res.status(201).json({
        token,
        token_type: 'Bearer',
        role: 'agent',
        site_id: resolved.site_id,
        site_name: siteRes.rows[0]?.name || null,
        source: resolved.source,
        distance_km: resolved.distance_km ?? null,
        expires_in: expiresIn,
      });
    } finally {
      client.release();
    }
  } catch (err) { next(err); }
});

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
    const {
      device_sn, site_id, hostname, timestamp_utc,
      os, model, manufacturer, payload_id,
    } = req.body;

    if (!require400(res, req.body, ['device_sn', 'site_id'])) return;
    if (!enforceAgentSiteScope(req, res, site_id)) return;

    const client = await pool.connect();
    let mismatchInstruction = null;
    try {
      const device_id = await autoRegisterDevice(client, device_sn, site_id, hostname, {
        os, model, manufacturer
      });
      if (await isDuplicatePayload(client, 'heartbeat', device_id, payload_id)) {
        return res.status(200).json({ ok: true, duplicate: true });
      }

      const canonicalSiteId = await getCanonicalSiteId(client, device_id, site_id);
      const seenAt = timestamp_utc || new Date().toISOString();

      await client.query(
        `UPDATE devices SET last_seen = $1 WHERE id = $2`,
        [seenAt, device_id]
      );
      await markIngestSuccess(client, device_id, seenAt);
      broadcast('device_online', { device_id, site_id: canonicalSiteId });

      // Cross-verify manual inventory state
      mismatchInstruction = await checkDeviceStatusMismatch(client, device_id, canonicalSiteId);
    } finally {
      client.release();
    }

    res.status(201).json({ ok: true, instruction: mismatchInstruction });
  } catch (err) { next(err); }
});

// ── POST /ingest/signal ───────────────────────────────────────────────────────
router.post('/signal', signalLimiter, async (req, res, next) => {
  try {
    const {
      device_sn, site_id: hintedSiteId, timestamp_utc,
      pop_latency_ms, snr, obstruction_pct, ping_drop_pct,
      download_mbps, upload_mbps,
      lat, lon,
      azimuth_deg, elevation_deg,
      starlink_id, starlink_uuid, starlink_sn, kit_id,
      is_snr_above_noise_floor, starlink_alerts, disablement_code, ready_states,
      dl_bandwidth_restricted_reason, ul_bandwidth_restricted_reason,
      dish_uptime_s, dish_bootcount, dish_grpc_reachable, starlink_power_verdict,
      payload_id,
    } = req.body;
    if (!require400(res, req.body, ['device_sn', 'site_id'])) return;
    if (!enforceAgentSiteScope(req, res, hintedSiteId)) return;

    const client = await pool.connect();
    try {
      const device_id = await autoRegisterDevice(client, device_sn, hintedSiteId, null);
      const identitySiteId = await resolveSiteFromStarlinkIdentity(client, {
        starlink_id, starlink_uuid, starlink_sn, kit_id
      });
      if (identitySiteId) {
        await client.query(
          `UPDATE devices
           SET site_id = $1
           WHERE id = $2
             AND (site_id IS NULL OR site_id = 0)`,
          [identitySiteId, device_id]
        );
      }

      if (await isDuplicatePayload(client, 'signal', device_id, payload_id)) {
        return res.status(200).json({ ok: true, duplicate: true });
      }

      const fallbackSiteId = identitySiteId || hintedSiteId;

      // Site inference: Starlink inventory supplies the fallback hint when GPS is missing.
      const site_id = await resolveAndMaybeNotify(
        client, device_id, lat ?? null, lon ?? null, fallbackSiteId
      );
      if (!isRealSiteId(site_id)) {
        await markIngestSuccess(client, device_id, timestamp_utc || new Date().toISOString());
        return res.status(202).json({ ok: true, skipped: 'site_unresolved' });
      }

      const window = new Date(Date.now() - 10 * 60 * 1000).toISOString();
      const reportersRes = await client.query(
        `SELECT COUNT(DISTINCT device_id) AS cnt FROM signal_readings
         WHERE site_id = $1 AND recorded_at > $2`,
        [site_id, window]
      );
      const reporterCount = parseInt(reportersRes.rows[0].cnt) + 1;
      const confidence = reporterCount === 1 ? 'low' : 'high';

      await client.query(
        `INSERT INTO signal_readings
           (site_id, device_id, recorded_at,
            pop_latency_ms, snr, obstruction_pct, ping_drop_pct,
            download_mbps, upload_mbps,
            reporter_count, confidence,
            starlink_id, starlink_uuid, starlink_sn, kit_id,
            is_snr_above_noise_floor, starlink_alerts, disablement_code, ready_states,
            dl_bandwidth_restricted_reason, ul_bandwidth_restricted_reason,
            dish_uptime_s, dish_bootcount, dish_grpc_reachable, starlink_power_verdict,
            boresight_azimuth_deg, boresight_elevation_deg)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17::jsonb, $18, $19::jsonb, $20, $21, $22, $23, $24, $25, $26, $27)`,
        [site_id, device_id, timestamp_utc || new Date().toISOString(),
          pop_latency_ms, snr, obstruction_pct, ping_drop_pct,
          download_mbps ?? null, upload_mbps ?? null,
          reporterCount, confidence,
          starlink_id || null, starlink_uuid || null, starlink_sn || null, kit_id || null,
          is_snr_above_noise_floor ?? null,
          asJsonOrNull(starlink_alerts),
          disablement_code || null,
          asJsonOrNull(ready_states),
          dl_bandwidth_restricted_reason || null,
          ul_bandwidth_restricted_reason || null,
          dish_uptime_s ?? null,
          dish_bootcount ?? null,
          dish_grpc_reachable ?? null,
          starlink_power_verdict || null,
          azimuth_deg ?? null,
          elevation_deg ?? null]
      );

      const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const recentRes = await client.query(
        `SELECT pop_latency_ms, snr, obstruction_pct, ping_drop_pct,
                download_mbps, upload_mbps,
                is_snr_above_noise_floor, starlink_alerts, disablement_code, ready_states,
                dl_bandwidth_restricted_reason, ul_bandwidth_restricted_reason,
                dish_uptime_s, dish_bootcount, dish_grpc_reachable, starlink_power_verdict
         FROM signal_readings
         WHERE site_id = $1 AND recorded_at > $2
         ORDER BY recorded_at ASC`,
        [site_id, twoMinAgo]
      );
      const rows = recentRes.rows;
      const latest = rows[rows.length - 1] || {};
      const aggregated = {
        snr: median(rows.map(r => parseFloat(r.snr)).filter(v => !Number.isNaN(v))),
        pop_latency_ms: median(rows.map(r => parseFloat(r.pop_latency_ms)).filter(v => !Number.isNaN(v))),
        obstruction_pct: median(rows.map(r => parseFloat(r.obstruction_pct)).filter(v => !Number.isNaN(v))),
        ping_drop_pct: median(rows.map(r => parseFloat(r.ping_drop_pct)).filter(v => !Number.isNaN(v))),
        download_mbps: median(rows.map(r => parseFloat(r.download_mbps)).filter(v => !Number.isNaN(v))),
        upload_mbps: median(rows.map(r => parseFloat(r.upload_mbps)).filter(v => !Number.isNaN(v))),
        is_snr_above_noise_floor: latest.is_snr_above_noise_floor ?? null,
        starlink_alerts: latest.starlink_alerts ?? null,
        disablement_code: latest.disablement_code ?? null,
        ready_states: latest.ready_states ?? null,
        dl_bandwidth_restricted_reason: latest.dl_bandwidth_restricted_reason ?? null,
        ul_bandwidth_restricted_reason: latest.ul_bandwidth_restricted_reason ?? null,
        dish_uptime_s: latest.dish_uptime_s == null ? null : Number(latest.dish_uptime_s),
        dish_bootcount: latest.dish_bootcount == null ? null : Number(latest.dish_bootcount),
        dish_grpc_reachable: latest.dish_grpc_reachable ?? null,
        starlink_power_verdict: latest.starlink_power_verdict ?? null,
        confidence,
        updatedAt: new Date().toISOString(),
      };

      currentSignal.set(String(site_id), aggregated);
      broadcast('signal_update', { site_id, signal: aggregated });
      await markIngestSuccess(client, device_id, timestamp_utc || new Date().toISOString());
    } finally {
      client.release();
    }

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /ingest/latency ──────────────────────────────────────────────────────
router.post('/latency', latencyLimiter, async (req, res, next) => {
  try {
    const { device_sn, site_id, timestamp_utc, p50_ms, p95_ms, payload_id } = req.body;
    if (!require400(res, req.body, ['device_sn', 'site_id', 'p50_ms', 'p95_ms'])) return;
    if (!enforceAgentSiteScope(req, res, site_id)) return;

    const client = await pool.connect();
    try {
      const device_id = await autoRegisterDevice(client, device_sn, site_id, null);
      if (await isDuplicatePayload(client, 'latency', device_id, payload_id)) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      const canonicalSiteId = await getCanonicalSiteId(client, device_id, site_id);
      if (!isRealSiteId(canonicalSiteId)) {
        await markIngestSuccess(client, device_id, timestamp_utc || new Date().toISOString());
        return res.status(202).json({ ok: true, skipped: 'site_unresolved' });
      }

      const window15 = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const medRes = await client.query(
        `SELECT p50_ms FROM latency_readings
         WHERE site_id = $1 AND recorded_at > $2`,
        [canonicalSiteId, window15]
      );
      const siteMedian = median(medRes.rows.map(r => parseFloat(r.p50_ms)));
      const isOutlier = siteMedian !== null && parseFloat(p50_ms) > 2 * siteMedian;

      const spreadRes = await client.query(
        `SELECT MAX(p50_ms) - MIN(p50_ms) AS spread FROM latency_readings
         WHERE site_id = $1 AND recorded_at > $2`,
        [canonicalSiteId, window15]
      );
      const spread_ms = spreadRes.rows[0].spread ? parseFloat(spreadRes.rows[0].spread) : 0;

      await client.query(
        `INSERT INTO latency_readings (device_id, site_id, recorded_at, p50_ms, p95_ms, spread_ms, is_outlier)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [device_id, canonicalSiteId, timestamp_utc || new Date().toISOString(),
          p50_ms, p95_ms, spread_ms, isOutlier]
      );

      const cached = currentSignal.get(String(canonicalSiteId)) || {};
      currentSignal.set(String(canonicalSiteId), { ...cached, spread_ms });
      await markIngestSuccess(client, device_id, timestamp_utc || new Date().toISOString());

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
    if (!enforceAgentSiteScope(req, res, req.body.site_id)) return;

    const { device_sn, site_id, timestamp_utc,
      battery_pct, battery_health_pct, disk_free_gb,
      disk_total_gb, disk_usage_pct, disk_smart_status,
      disk_smart_predict_failure, disk_media_type,
      ram_used_mb, ram_total_mb, payload_id } = req.body;

    const client = await pool.connect();
    try {
      const device_id = await autoRegisterDevice(client, device_sn, site_id, null);
      if (await isDuplicatePayload(client, 'health', device_id, payload_id)) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      const canonicalSiteId = await getCanonicalSiteId(client, device_id, site_id);

      await client.query(
        `INSERT INTO device_health
           (device_id, recorded_at, battery_pct, battery_health_pct,
            disk_free_gb, disk_total_gb, disk_usage_pct,
            disk_smart_status, disk_smart_predict_failure, disk_media_type,
            ram_used_mb, ram_total_mb)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [device_id, timestamp_utc || new Date().toISOString(),
          battery_pct, battery_health_pct, disk_free_gb,
          disk_total_gb, disk_usage_pct || null,
          disk_smart_status || null,
          disk_smart_predict_failure == null ? null : Boolean(disk_smart_predict_failure),
          disk_media_type || null,
          ram_used_mb, ram_total_mb]
      );
      await markIngestSuccess(client, device_id, timestamp_utc || new Date().toISOString());

      // Keep device site canonical for downstream UI/status queries
      if (canonicalSiteId != null) {
        await client.query(`UPDATE devices SET site_id = $1 WHERE id = $2`, [canonicalSiteId, device_id]);
      }
    } finally {
      client.release();
    }

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /ingest/usage ────────────────────────────────────────────────────────
router.post('/usage', usageLimiter, async (req, res, next) => {
  try {
    const {
      device_sn, site_id, date, bytes_down_delta, bytes_up_delta,
      counter_reset_detected, payload_id,
    } = req.body;
    if (!require400(res, req.body, ['device_sn', 'site_id', 'date'])) return;
    if (!enforceAgentSiteScope(req, res, site_id)) return;

    const client = await pool.connect();
    try {
      const device_id = await autoRegisterDevice(client, device_sn, site_id, null);
      if (await isDuplicatePayload(client, 'usage', device_id, payload_id)) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      const canonicalSiteId = await getCanonicalSiteId(client, device_id, site_id);
      if (!isRealSiteId(canonicalSiteId)) {
        await markIngestSuccess(client, device_id, new Date().toISOString());
        return res.status(202).json({ ok: true, skipped: 'site_unresolved' });
      }

      if (counter_reset_detected === true) {
        await markIngestSuccess(client, device_id, new Date().toISOString());
        return res.status(202).json({ ok: true, skipped: 'counter_reset_detected' });
      }

      await client.query(
        `INSERT INTO data_usage (device_id, site_id, date, bytes_down, bytes_up)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (device_id, date)
         DO UPDATE SET
           bytes_down = data_usage.bytes_down + EXCLUDED.bytes_down,
           bytes_up   = data_usage.bytes_up   + EXCLUDED.bytes_up`,
        [device_id, canonicalSiteId, date,
          bytes_down_delta || 0, bytes_up_delta || 0]
      );
      await markIngestSuccess(client, device_id, new Date().toISOString());
    } finally {
      client.release();
    }

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /ingest/agent-health ────────────────────────────────────────────────
router.post('/agent-health', agentHealthLimiter, async (req, res, next) => {
  try {
    const required = ['device_sn', 'site_id'];
    if (!require400(res, req.body, required)) return;
    if (!enforceAgentSiteScope(req, res, req.body.site_id)) return;

    const {
      device_sn, site_id, timestamp_utc, queue_depth, oldest_queue_age_sec,
      wifi_adapter_count, agent_version, run_id, last_error, last_success_at, payload_id,
    } = req.body;

    const client = await pool.connect();
    try {
      const device_id = await autoRegisterDevice(client, device_sn, site_id, null);
      if (await isDuplicatePayload(client, 'agent-health', device_id, payload_id)) {
        return res.status(200).json({ ok: true, duplicate: true });
      }
      const canonicalSiteId = await getCanonicalSiteId(client, device_id, site_id);

      await client.query(
        `INSERT INTO agent_health_snapshots
          (device_id, site_id, recorded_at, queue_depth, oldest_queue_age_sec,
           wifi_adapter_count, agent_version, run_id, last_error, last_success_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          device_id,
          canonicalSiteId,
          timestamp_utc || new Date().toISOString(),
          queue_depth ?? null,
          oldest_queue_age_sec ?? null,
          wifi_adapter_count ?? null,
          agent_version || null,
          run_id || null,
          last_error || null,
          last_success_at || null,
        ]
      );
      await markIngestSuccess(client, device_id, new Date().toISOString());
    } finally {
      client.release();
    }

    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /ingest/refresh-token ────────────────────────────────────────────────
// Exchanges a valid site-scoped agent token for a fresh one with the same claims.
// The agent calls this periodically to rotate credentials before expiry.
router.post('/refresh-token', agentHealthLimiter, async (req, res, next) => {
  try {
    if (req.user?.role !== 'agent') {
      return res.status(403).json({ error: 'Forbidden — agent token required' });
    }
    const siteId = Number(req.user.site_id ?? 0);
    if (!siteId) {
      return res.status(403).json({ error: 'Forbidden — site-scoped token required (discovery tokens cannot be refreshed)' });
    }

    const deviceSn = req.user.device_sn || req.body.device_sn || null;
    const expiresIn = normalizeAgentTokenTtl(req.body.expires_in || process.env.AGENT_TOKEN_TTL || '365d');
    const token = signAgentToken({ siteId, deviceSn, expiresIn });

    const siteRes = await pool.query(`SELECT name FROM sites WHERE id = $1`, [siteId]);

    res.json({
      token,
      token_type: 'Bearer',
      role: 'agent',
      site_id: siteId,
      site_name: siteRes.rows[0]?.name || null,
      expires_in: expiresIn,
    });
  } catch (err) { next(err); }
});

// ── Telemetry Status Cross-Verification ─────────────────────────────────────
async function checkDeviceStatusMismatch(client, deviceId, currentSiteId) {
  try {
    const { rows } = await client.query(
      `SELECT d.id, d.profile_number, d.hardware_status, d.windows_sn 
       FROM devices d 
       WHERE d.id = $1`,
      [deviceId]
    );
    if (!rows.length) return null;
    const device = rows[0];

    const invalidState = 
      device.hardware_status === 'intake_broken' || 
      device.hardware_status === 'decommissioned' || 
      device.hardware_status === 'ready_for_reissue';

    if (invalidState) {
      const key = `mismatch_${device.id}_${device.hardware_status}`;
      const severity = device.hardware_status === 'decommissioned' ? 'critical' : 'warning';
      
      await client.query(
        `INSERT INTO alert_events (active_key, source_type, source_id, site_id, device_id, severity, category, title, message, metadata)
         VALUES ($1, 'device', $2, $3, $4, $5, 'inventory', $6, $7, $8)
         ON CONFLICT (active_key) DO UPDATE SET 
           last_seen_at = NOW(),
           message = EXCLUDED.message,
           metadata = alert_events.metadata || EXCLUDED.metadata`,
        [
          key,
          String(device.id),
          currentSiteId || null,
          device.id,
          severity,
          `Inventory Mismatch: ${device.profile_number || 'Device SN ' + device.windows_sn}`,
          `Device ${device.profile_number || device.windows_sn} heartbeated online, but is marked as '${device.hardware_status}' in inventory.`,
          JSON.stringify({
            hardware_status: device.hardware_status,
            current_site_id: currentSiteId,
            last_telemetry_timestamp: new Date().toISOString()
          })
        ]
      );

      // Lock retired/broken devices
      if (device.hardware_status === 'decommissioned' || device.hardware_status === 'intake_broken') {
        return 'LOCK_SCREEN';
      }
    } else {
      // Auto-resolve any open mismatch alerts for this device
      await client.query(
        `UPDATE alert_events 
         SET status = 'resolved', resolved_at = NOW() 
         WHERE device_id = $1 AND category = 'inventory' AND status != 'resolved'`,
        [deviceId]
      );
    }
  } catch (err) {
    console.error('Error in checkDeviceStatusMismatch:', err);
  }
  return null;
}

module.exports = router;
