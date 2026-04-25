/**
 * siteResolver.js — map a reported lat/lon to the nearest Starfleet site.
 *
 * Algorithm: haversine distance against every site's GPS (migration 012/013).
 * A device is assigned to the nearest site whose distance is within
 * MAX_SITE_RADIUS_KM. If no site is within range the resolver returns
 * `null` — the caller should keep the existing site_id and log a warning.
 *
 * When the resolved site differs from `devices.site_id` we stage a candidate.
 * Reassignment is confirmed only after GPS evidence appears on at least
 * REQUIRED_MOVE_DAYS distinct days (default: 2), then we:
 *   1. UPDATE devices.site_id
 *   2. INSERT into site_change_events (audit log)
 *   3. Enqueue an email + FCM notification (via services/notifier.js)
 *
 * Tuning:
 *   - MAX_SITE_RADIUS_KM  default 2.0  — Starlink GPS is ±10m; 2km covers
 *     the full Starlink cell a school might move within
 *   - MIN_MOVE_KM         default 0.3  — sub-300m jitter is ignored
 */
const pool       = require('../db');
const { notifySiteChange } = require('./notifier');
const { broadcast }        = require('./websocket');

const MAX_SITE_RADIUS_KM = Number(process.env.MAX_SITE_RADIUS_KM || 2.0);
const MIN_MOVE_KM        = Number(process.env.MIN_MOVE_KM        || 0.3);
const REQUIRED_MOVE_DAYS = Number(process.env.REQUIRED_SITE_MOVE_DAYS || 2);

// In-memory site list. Loaded on first call, refreshed every 5 minutes.
let siteCache     = null;
let siteCacheAt   = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function loadSites() {
  if (siteCache && Date.now() - siteCacheAt < CACHE_TTL_MS) return siteCache;
  const res = await pool.query(
    `SELECT id, name, lat, lng FROM sites WHERE lat IS NOT NULL AND lng IS NOT NULL`
  );
  siteCache   = res.rows.map(r => ({ ...r, lat: parseFloat(r.lat), lng: parseFloat(r.lng) }));
  siteCacheAt = Date.now();
  return siteCache;
}

// Haversine great-circle distance in kilometres.
function haversineKm(lat1, lon1, lat2, lon2) {
  const R    = 6371;
  const rad  = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
            Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Find the nearest site to (lat, lon). Returns null if none within
 * MAX_SITE_RADIUS_KM.
 */
async function nearestSite(lat, lon) {
  if (lat == null || lon == null) return null;
  const sites = await loadSites();
  let best = null;
  for (const s of sites) {
    const d = haversineKm(lat, lon, s.lat, s.lng);
    if (!best || d < best.distance_km) {
      best = { site_id: s.id, name: s.name, distance_km: d };
    }
  }
  if (!best || best.distance_km > MAX_SITE_RADIUS_KM) return null;
  return best;
}

/**
 * Main entry point. Called from /ingest/signal after it has an authoritative
 * device_id. `hintedSiteId` is what the agent sent (for backwards compat /
 * fallback when GPS is unavailable).
 *
 * Returns the resolved site_id (or hintedSiteId if GPS missing / out of range).
 */
async function resolveAndMaybeNotify(client, device_id, lat, lon, hintedSiteId) {
  // Always store last-known GPS, even if we don't reassign.
  if (lat != null && lon != null) {
    await client.query(
      `UPDATE devices SET last_lat = $1, last_lon = $2, last_gps_at = NOW() WHERE id = $3`,
      [lat, lon, device_id]
    );
  }

  const resolved = await nearestSite(lat, lon);
  if (!resolved) {
    // GPS missing or out of range — fall back to hint, don't change devices.site_id
    return hintedSiteId;
  }

  // Compare to current devices.site_id
  const devRes = await client.query(
    `SELECT site_id, last_lat, last_lon FROM devices WHERE id = $1`,
    [device_id]
  );
  const current = devRes.rows[0];
  if (!current) return resolved.site_id;

  // No change, or not enough movement to trigger a reassignment
  if (current.site_id === resolved.site_id) {
    await client.query(`DELETE FROM site_move_candidates WHERE device_id = $1`, [device_id]);
    return resolved.site_id;
  }

  // If we have a previous GPS fix, require at least MIN_MOVE_KM of movement
  if (current.last_lat != null && current.last_lon != null) {
    const moved = haversineKm(
      parseFloat(current.last_lat), parseFloat(current.last_lon),
      lat, lon
    );
    if (moved < MIN_MOVE_KM) return current.site_id;
  }

  // ── SITE CHANGE CANDIDATE (must be observed across distinct days) ──
  const today = new Date().toISOString().slice(0, 10);
  const candRes = await client.query(
    `INSERT INTO site_move_candidates
       (device_id, from_site_id, to_site_id, first_seen_date, last_seen_date, seen_days,
        last_reported_lat, last_reported_lon, last_distance_km, updated_at)
     VALUES ($1, $2, $3, $4, $4, 1, $5, $6, $7, NOW())
     ON CONFLICT (device_id, to_site_id)
     DO UPDATE SET
       from_site_id      = EXCLUDED.from_site_id,
       seen_days         = CASE
                            WHEN site_move_candidates.last_seen_date < EXCLUDED.last_seen_date
                            THEN site_move_candidates.seen_days + 1
                            ELSE site_move_candidates.seen_days
                          END,
       last_seen_date    = GREATEST(site_move_candidates.last_seen_date, EXCLUDED.last_seen_date),
       last_reported_lat = EXCLUDED.last_reported_lat,
       last_reported_lon = EXCLUDED.last_reported_lon,
       last_distance_km  = EXCLUDED.last_distance_km,
       updated_at        = NOW()
     RETURNING seen_days`,
    [device_id, current.site_id, resolved.site_id, today, lat, lon, resolved.distance_km]
  );

  const seenDays = Number(candRes.rows[0]?.seen_days || 1);
  if (seenDays < REQUIRED_MOVE_DAYS) {
    return current.site_id;
  }

  // ── SITE CHANGE CONFIRMED ──
  await client.query(
    `UPDATE devices SET site_id = $1 WHERE id = $2`,
    [resolved.site_id, device_id]
  );

  const evRes = await client.query(
    `INSERT INTO site_change_events
       (device_id, from_site_id, to_site_id, reported_lat, reported_lon, distance_km)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [device_id, current.site_id, resolved.site_id, lat, lon, resolved.distance_km]
  );

  // Fire notification (non-blocking — swallows errors so ingest stays fast)
  notifySiteChange({
    event_id:     evRes.rows[0].id,
    device_id,
    from_site_id: current.site_id,
    to_site_id:   resolved.site_id,
    to_site_name: resolved.name,
    distance_km:  resolved.distance_km,
    lat, lon,
  }).catch(err => console.error('notifySiteChange failed:', err.message));

  // Push the event over WS so open admin dashboards update in real time
  broadcast('site_change', {
    device_id,
    from_site_id: current.site_id,
    to_site_id:   resolved.site_id,
    to_site_name: resolved.name,
    distance_km:  resolved.distance_km,
  });

  // Clear any outstanding candidate rows now that reassignment is confirmed.
  await client.query(`DELETE FROM site_move_candidates WHERE device_id = $1`, [device_id]);

  return resolved.site_id;
}

module.exports = {
  nearestSite,
  resolveAndMaybeNotify,
  haversineKm,  // exported for tests
};
