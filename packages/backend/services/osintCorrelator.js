/**
 * OSINT Correlation Engine — 15-minute cycle
 *
 * Fuses Starlink TLE epoch age with NOAA Kp index and per-site signal
 * degradation readings to produce structured osint_anomaly_events records.
 *
 * Event types:
 *   KP_THRESHOLD  — Kp >= 5, no site-level degradation confirmed
 *   CORRELATION   — Kp >= 5 AND site shows recent connectivity degradation
 *   TLE_DEVIATION — TLE epoch data is > 48h stale across the fleet
 *
 * Dedup: an event is skipped if an unresolved event of the same type
 * already exists for the same site within the dedup window.
 *
 * Graceful degradation:
 *   - NOAA unreachable → skip Kp checks, continue TLE check
 *   - Signal readings missing → skip CORRELATION check for that site
 *   - DB unreachable → log FATAL and abort the cycle iteration
 */

const cron = require('node-cron');
const pool = require('../db');
const { getLatestKIndex } = require('./spaceWeather');

// ── Kp severity mapping ───────────────────────────────────────────────────────

const KP_SEVERITY_TIERS = [
  { min: 7, severity: 5 },
  { min: 6, severity: 4 },
  { min: 5, severity: 3 },
  { min: 3, severity: 2 },
  { min: 0, severity: 1 },
];

function kpToSeverity(kp) {
  for (const { min, severity } of KP_SEVERITY_TIERS) {
    if (kp >= min) return severity;
  }
  return 1;
}

// ── TLE epoch parsing ─────────────────────────────────────────────────────────

/**
 * Parse TLE epoch age in hours from TLE line 1.
 * Epoch field is at chars 18–31 (0-indexed): YYDDD.DDDDDDDD
 * YY < 57 → 20xx, else → 19xx (per TLE specification).
 * Returns null if parsing fails.
 */
function tleEpochAgeHours(line1) {
  try {
    const raw = line1.substring(18, 32).trim();
    const yy = parseInt(raw.substring(0, 2), 10);
    const dayFrac = parseFloat(raw.substring(2));
    if (!Number.isFinite(dayFrac) || !Number.isFinite(yy)) return null;
    const year = yy < 57 ? 2000 + yy : 1900 + yy;
    const epochMs = Date.UTC(year, 0, 1) + (dayFrac - 1) * 86_400_000;
    return (Date.now() - epochMs) / 3_600_000;
  } catch {
    return null;
  }
}

/**
 * Sample up to 20 TLEs from the DB and return the worst (max) epoch age.
 * Stale TLE data is fleet-wide, so a sample is representative.
 */
async function getFleetTleEpochAge() {
  const { rows } = await pool.query(
    'SELECT satellite_name, line1 FROM satellite_tles ORDER BY RANDOM() LIMIT 20'
  );
  if (!rows.length) return { maxAgeH: null, satName: null };

  let maxAgeH = 0;
  let satName = null;
  for (const row of rows) {
    const age = tleEpochAgeHours(row.line1);
    if (age !== null && age > maxAgeH) {
      maxAgeH = age;
      satName = row.satellite_name;
    }
  }
  return { maxAgeH, satName };
}

// ── Deduplication ─────────────────────────────────────────────────────────────

const DEDUP_WINDOW_MS = {
  TLE_DEVIATION: 24 * 3_600_000,
  KP_THRESHOLD:   3 * 3_600_000,
  CORRELATION:    1 * 3_600_000,
};

async function hasRecentUnresolved(siteId, anomalyType) {
  const cutoff = new Date(Date.now() - (DEDUP_WINDOW_MS[anomalyType] ?? 3_600_000));
  const { rows } = await pool.query(
    `SELECT 1 FROM osint_anomaly_events
     WHERE site_id    = $1
       AND anomaly_type = $2
       AND resolved   = FALSE
       AND recorded_at >= $3
     LIMIT 1`,
    [siteId, anomalyType, cutoff]
  );
  return rows.length > 0;
}

// ── Event insertion ───────────────────────────────────────────────────────────

async function insertEvent(siteId, anomalyType, severity, kpIndex, tleEpochAgeH, satelliteId, rawPayload) {
  if (await hasRecentUnresolved(siteId, anomalyType)) return false;

  await pool.query(
    `INSERT INTO osint_anomaly_events
       (site_id, anomaly_type, severity, kp_index, tle_epoch_age_h, satellite_id, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [siteId, anomalyType, severity, kpIndex ?? null, tleEpochAgeH ?? null, satelliteId ?? null, rawPayload]
  );
  return true;
}

// ── Main correlation cycle ────────────────────────────────────────────────────

async function runCorrelationCycle() {
  // 1. Fetch current Kp from local DB cache (populated by spaceWeather.js)
  let kp = 0;
  let kpAvailable = true;
  try {
    kp = await getLatestKIndex();
  } catch (err) {
    console.warn('[OsintCorrelator] WARN Kp lookup failed — skipping Kp checks:', err.message);
    kpAvailable = false;
  }

  // 2. Compute fleet-wide TLE epoch age
  let tleMaxAgeH = null;
  let staleSatName = null;
  try {
    const { maxAgeH, satName } = await getFleetTleEpochAge();
    tleMaxAgeH = maxAgeH;
    staleSatName = satName;
  } catch (err) {
    console.warn('[OsintCorrelator] WARN TLE epoch check failed:', err.message);
  }

  // 3. Load all sites — DB failure is fatal for this cycle
  let sites;
  try {
    const { rows } = await pool.query('SELECT id, name, lat, lng FROM sites');
    sites = rows;
  } catch (err) {
    console.error('[OsintCorrelator] FATAL DB unreachable — aborting cycle:', err.message);
    return [];
  }

  const written = [];

  for (const site of sites) {
    const siteId = String(site.id);

    // ── TLE_DEVIATION ─────────────────────────────────────────────────────────
    // Flag per-site when fleet TLE data is > 48h stale. Per-site because
    // satellite visibility (and hence degradation risk) varies by location.
    if (tleMaxAgeH !== null && tleMaxAgeH > 48) {
      const payload = { reason: 'TLE epoch >48h stale', tle_max_age_h: tleMaxAgeH };
      const ok = await insertEvent(siteId, 'TLE_DEVIATION', 4, kpAvailable ? kp : null, tleMaxAgeH, staleSatName, payload);
      if (ok) written.push({ siteId, type: 'TLE_DEVIATION' });
    }

    if (!kpAvailable || kp < 5) continue;

    // ── Check recent connectivity degradation (last 30 min) ──────────────────
    let hasDegradation = false;
    let degradStats = {};
    try {
      const { rows: sr } = await pool.query(
        `SELECT
           ROUND(AVG(ping_drop_pct)::numeric, 2) AS avg_drop,
           ROUND(AVG(snr)::numeric, 2)            AS avg_snr,
           COUNT(*)::int                          AS cnt
         FROM signal_readings
         WHERE site_id = $1 AND recorded_at >= NOW() - INTERVAL '30 minutes'`,
        [site.id]
      );
      const r = sr[0];
      if (r && r.cnt > 0) {
        const avgDrop = parseFloat(r.avg_drop);
        const avgSnr  = parseFloat(r.avg_snr);
        degradStats = { avg_drop_pct: avgDrop, avg_snr: avgSnr, reading_count: r.cnt };
        hasDegradation = avgDrop > 10 || avgSnr < 4;
      }
    } catch (err) {
      // gRPC/dish unreachable — per TASK.md, do not treat as anomaly
      console.info(`[OsintCorrelator] INFO signal lookup skipped for site ${siteId}: ${err.message}`);
    }

    const basePayload = { kp, tle_max_age_h: tleMaxAgeH, ...degradStats };

    if (hasDegradation) {
      // CORRELATION — Kp elevated AND site is actively degraded
      const severity = Math.max(kpToSeverity(kp), 3);
      const ok = await insertEvent(siteId, 'CORRELATION', severity, kp, tleMaxAgeH, null, basePayload);
      if (ok) written.push({ siteId, type: 'CORRELATION' });
    } else {
      // KP_THRESHOLD — Kp elevated, no confirmed site degradation
      const ok = await insertEvent(siteId, 'KP_THRESHOLD', kpToSeverity(kp), kp, tleMaxAgeH, null, basePayload);
      if (ok) written.push({ siteId, type: 'KP_THRESHOLD' });
    }
  }

  console.log(
    `[OsintCorrelator] Cycle complete — ${written.length} event(s) written.` +
    ` Kp=${kpAvailable ? kp : 'N/A'}, TLE age=${tleMaxAgeH != null ? tleMaxAgeH.toFixed(1) + 'h' : 'N/A'}`
  );
  return written;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function scheduleOsintCorrelator() {
  cron.schedule('*/15 * * * *', () =>
    runCorrelationCycle().catch(err =>
      console.error('[OsintCorrelator] Cycle error:', err.message)
    )
  );
  console.log('[OsintCorrelator] Correlation cycle scheduled (every 15 minutes).');
  runCorrelationCycle().catch(err =>
    console.error('[OsintCorrelator] Initial run failed:', err.message)
  );
}

module.exports = { scheduleOsintCorrelator, runCorrelationCycle };
