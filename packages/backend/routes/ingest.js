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

/**
 * Maps agent device_sn (BIOS) to database windows_sn.
 * Updates OS and Model metadata on every check-in.
 */
async function autoRegisterDevice(client, device_sn, site_id, hostname, metadata = {}) {
  const { os, model, manufacturer } = metadata;

  const result = await client.query(
    `INSERT INTO devices (windows_sn, site_id, hostname, os, model, manufacturer)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (windows_sn)
     DO UPDATE SET 
       site_id = CASE
         WHEN devices.site_id IS NULL OR devices.site_id = 0 THEN EXCLUDED.site_id
         ELSE devices.site_id
       END,
       hostname = COALESCE(EXCLUDED.hostname, devices.hostname),
       os = COALESCE(EXCLUDED.os, devices.os),
       model = COALESCE(EXCLUDED.model, devices.model),
       manufacturer = COALESCE(EXCLUDED.manufacturer, devices.manufacturer)
     RETURNING id`,
    [device_sn, site_id, hostname || null, os || null, model || null, manufacturer || null]
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
  return r.rows[0]?.site_id ?? fallbackSiteId;
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
    } finally {
      client.release();
    }

    res.status(201).json({ ok: true });
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
      starlink_id, starlink_uuid, starlink_sn, kit_id,
      payload_id,
    } = req.body;
    if (!require400(res, req.body, ['device_sn', 'site_id'])) return;
    if (!enforceAgentSiteScope(req, res, hintedSiteId)) return;

    const client = await pool.connect();
    try {
      const device_id = await autoRegisterDevice(client, device_sn, hintedSiteId, null);
      if (await isDuplicatePayload(client, 'signal', device_id, payload_id)) {
        return res.status(200).json({ ok: true, duplicate: true });
      }

      const identitySiteId = await resolveSiteFromStarlinkIdentity(client, {
        starlink_id, starlink_uuid, starlink_sn, kit_id
      });
      const fallbackSiteId = identitySiteId || hintedSiteId;

      // Site inference: Starlink inventory supplies the fallback hint when GPS is missing.
      const site_id = await resolveAndMaybeNotify(
        client, device_id, lat ?? null, lon ?? null, fallbackSiteId
      );

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
            reporter_count, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [site_id, device_id, timestamp_utc || new Date().toISOString(),
          pop_latency_ms, snr, obstruction_pct, ping_drop_pct,
          download_mbps ?? null, upload_mbps ?? null,
          reporterCount, confidence]
      );

      const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const recentRes = await client.query(
        `SELECT pop_latency_ms, snr, obstruction_pct, ping_drop_pct,
                download_mbps, upload_mbps
         FROM signal_readings
         WHERE site_id = $1 AND recorded_at > $2`,
        [site_id, twoMinAgo]
      );
      const rows = recentRes.rows;
      const aggregated = {
        snr: median(rows.map(r => parseFloat(r.snr)).filter(v => !Number.isNaN(v))),
        pop_latency_ms: median(rows.map(r => parseFloat(r.pop_latency_ms)).filter(v => !Number.isNaN(v))),
        obstruction_pct: median(rows.map(r => parseFloat(r.obstruction_pct)).filter(v => !Number.isNaN(v))),
        ping_drop_pct: median(rows.map(r => parseFloat(r.ping_drop_pct)).filter(v => !Number.isNaN(v))),
        download_mbps: median(rows.map(r => parseFloat(r.download_mbps)).filter(v => !Number.isNaN(v))),
        upload_mbps: median(rows.map(r => parseFloat(r.upload_mbps)).filter(v => !Number.isNaN(v))),
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

module.exports = router;
