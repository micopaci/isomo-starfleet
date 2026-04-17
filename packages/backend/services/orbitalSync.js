/**
 * Orbital Sync Service (v4.1 — OSINT Intelligence)
 *
 * Two functions:
 *
 *  1. updateStarlinkTLEs() — fetches the full Starlink constellation Two-Line
 *     Element sets from CelesTrak daily and upserts them into satellite_tles.
 *
 *  2. checkCoverageGap(lat, lng) — uses the satellite.js SGP4 propagator to
 *     count how many Starlink birds are above the 25° elevation mask at a given
 *     ground location RIGHT NOW. Returns 0 when a predictable gap is underway.
 *
 * This allows the diagnosis engine to tell apart:
 *   • "Hardware failure"        — dish offline, sats visible above horizon
 *   • "Constellation gap"       — no sats above 25° mask (SGP4-predicted)
 *   • "Geomagnetic degradation" — sats visible but K-index is high
 *
 * Source: CelesTrak GP (Starlink group)
 * URL:    https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle
 *
 * Dependency: satellite.js (npm install satellite.js)
 */
const cron      = require('node-cron');
const axios     = require('axios');
const satellite = require('satellite.js');
const pool      = require('../db');

const CELESTRAK_URL =
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle';

/** Minimum elevation (radians) for a reliable Starlink lock. */
const MIN_ELEVATION_RAD = satellite.degreesToRadians(25);

// ── TLE Sync ─────────────────────────────────────────────────────────────────

/**
 * Download the latest Starlink TLEs from CelesTrak and upsert into DB.
 * TLE format is three-line: NAME / LINE1 / LINE2 (CRLF separated).
 */
async function updateStarlinkTLEs() {
  try {
    const { data } = await axios.get(CELESTRAK_URL, { timeout: 30_000 });
    const lines = data.split(/\r?\n/);

    let updated = 0;
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const name = lines[i]?.trim();
      const l1   = lines[i + 1]?.trim();
      const l2   = lines[i + 2]?.trim();

      // Skip malformed triplets
      if (!name || !l1?.startsWith('1 ') || !l2?.startsWith('2 ')) continue;

      await pool.query(
        `INSERT INTO satellite_tles (satellite_name, line1, line2, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (satellite_name) DO UPDATE
           SET line1 = EXCLUDED.line1,
               line2 = EXCLUDED.line2,
               updated_at = NOW()`,
        [name, l1, l2]
      );
      updated++;
    }

    console.log(`[OrbitalSync] TLE sync complete — ${updated} Starlink birds updated.`);
  } catch (err) {
    console.error('[OrbitalSync] TLE sync failed:', err.message);
  }
}

// ── Coverage Gap Check ───────────────────────────────────────────────────────

/**
 * Count the number of Starlink satellites currently visible above the 25°
 * elevation mask at (lat, lng) using the SGP4 propagator.
 *
 * @param {number} lat  Geodetic latitude  in decimal degrees
 * @param {number} lng  Geodetic longitude in decimal degrees
 * @returns {Promise<number>} Number of visible satellites (0 = coverage gap)
 */
async function checkCoverageGap(lat, lng) {
  const { rows: tles } = await pool.query(
    'SELECT line1, line2 FROM satellite_tles'
  );

  if (!tles.length) {
    // No TLEs loaded yet — assume coverage is fine to avoid false positives
    console.warn('[OrbitalSync] No TLEs in DB; skipping coverage check.');
    return 1;
  }

  const observerGd = {
    latitude:  satellite.degreesToRadians(lat),
    longitude: satellite.degreesToRadians(lng),
    height:    1.5, // km above sea level (ground station)
  };

  const now  = new Date();
  const gmst = satellite.gstime(now);

  let visibleSats = 0;

  for (const tle of tles) {
    try {
      const satrec = satellite.twoline2satrec(tle.line1, tle.line2);
      const pv     = satellite.propagate(satrec, now);

      // propagate() returns false for decayed sats — skip them
      if (!pv.position || pv.position === false) continue;

      const posEcf     = satellite.eciToEcf(pv.position, gmst);
      const lookAngles = satellite.ecfToLookAngles(observerGd, posEcf);

      if (lookAngles.elevation > MIN_ELEVATION_RAD) {
        visibleSats++;
      }
    } catch {
      // Bad TLE entry — skip silently
    }
  }

  return visibleSats;
}

// ── Scheduler ────────────────────────────────────────────────────────────────

/**
 * Schedule daily TLE refresh at 02:00 UTC.
 * Also runs immediately on startup if the TLE table is empty.
 */
async function scheduleOrbitalCron() {
  cron.schedule('0 2 * * *', updateStarlinkTLEs);
  console.log('[OrbitalSync] TLE cron scheduled (daily at 02:00 UTC).');

  // Seed on first start if table is empty
  const { rows } = await pool.query('SELECT COUNT(*) AS cnt FROM satellite_tles');
  if (parseInt(rows[0].cnt, 10) === 0) {
    console.log('[OrbitalSync] TLE table is empty — running initial sync…');
    updateStarlinkTLEs().catch(() => {});
  }
}

module.exports = { scheduleOrbitalCron, updateStarlinkTLEs, checkCoverageGap };
