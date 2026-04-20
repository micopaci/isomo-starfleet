/**
 * Space Weather Cron (v4.2 — OSINT Intelligence)
 *
 * Syncs NOAA planetary K-index readings every 3 hours.
 * The K-index is used by the diagnosis engine to distinguish genuine
 * hardware/alignment faults from geomagnetic storm-induced SNR drops.
 *
 * Source:  NOAA Space Weather Prediction Center
 * K-index: https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json
 *          Current shape (2026+): JSON array of objects —
 *            { time_tag, Kp (float), a_running, station_count }
 *          Legacy shape: array of arrays, row 0 = header, later rows = data —
 *            [ "time_tag", "Kp", "a_running", "station_count" ]
 *          We support both defensively because NOAA has changed formats before.
 *
 * 10cm radio flux (F10.7) lives on a separate endpoint and is fetched
 * opportunistically to populate the solar_flux_10cm column. It is not fatal
 * if that endpoint fails — the row still gets inserted with a null flux.
 * Flux source: https://services.swpc.noaa.gov/json/f107_cm_flux.json
 */
const cron  = require('node-cron');
const axios = require('axios');
const pool  = require('../db');

const NOAA_K_INDEX_URL =
  'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
const NOAA_F107_URL =
  'https://services.swpc.noaa.gov/json/f107_cm_flux.json';

/**
 * Map a K-index integer to a NOAA geomagnetic storm label.
 * @param {number} k
 * @returns {string}
 */
function kIndexToLabel(k) {
  if (k >= 9) return 'G5 (Extreme)';
  if (k >= 8) return 'G4 (Severe)';
  if (k >= 7) return 'G3 (Strong)';
  if (k >= 6) return 'G2 (Moderate)';
  if (k >= 5) return 'G1 (Minor)';
  return 'Quiet';
}

/**
 * Pull the time_tag + Kp out of a single NOAA row, handling both the current
 * object shape and the legacy array-with-header shape. Returns null for
 * non-data rows (e.g. the legacy header row).
 *
 * @param {Object|Array<any>} row
 * @returns {{ time_tag: string, kp: number } | null}
 */
function parseNoaaRow(row) {
  // Current shape: { time_tag, Kp, a_running, station_count }
  if (row && typeof row === 'object' && !Array.isArray(row)) {
    const kp = Number.parseFloat(row.Kp);
    if (!row.time_tag || !Number.isFinite(kp)) return null;
    return { time_tag: row.time_tag, kp };
  }

  // Legacy shape: array of [time_tag, Kp, ...]. Header row's Kp is the
  // literal string "Kp", which parseFloat can't coerce — skip via isFinite.
  if (Array.isArray(row) && row.length >= 2) {
    const kp = Number.parseFloat(row[1]);
    if (!row[0] || !Number.isFinite(kp)) return null;
    return { time_tag: row[0], kp };
  }

  return null;
}

/**
 * Try to fetch NOAA's F10.7cm solar flux history (~42 days, 3 readings/day).
 * Returns a { fluxByDate, latest } pair so each historical K-index row can be
 * matched to its own day's flux value instead of stamping them all with the
 * current value. Always returns an object — this is an opportunistic
 * enrichment and should never block the K-index sync.
 *
 * NOAA returns this endpoint in **descending** order by time_tag (newest at
 * index 0), which is the opposite of the K-index endpoint. Don't rely on
 * position — always compare time_tag strings (ISO-8601 sorts lexicographically).
 *
 * @returns {Promise<{ fluxByDate: Record<string, number>, latest: number | null }>}
 */
async function fetchF107Flux() {
  try {
    const { data } = await axios.get(NOAA_F107_URL, { timeout: 10_000 });
    if (!Array.isArray(data) || !data.length) return { fluxByDate: {}, latest: null };

    // For each calendar date (YYYY-MM-DD), keep the latest reading of the day.
    // Also track the single most-recent reading overall for the "current" label.
    const byDate = {}; // { 'YYYY-MM-DD': { time_tag, flux } }
    let latestReading = null;

    for (const row of data) {
      if (!row || typeof row !== 'object' || !row.time_tag) continue;
      const flux = Number.parseFloat(row.flux);
      if (!Number.isFinite(flux)) continue;

      const date = row.time_tag.slice(0, 10); // ISO prefix → YYYY-MM-DD
      if (!byDate[date] || row.time_tag > byDate[date].time_tag) {
        byDate[date] = { time_tag: row.time_tag, flux };
      }
      if (!latestReading || row.time_tag > latestReading.time_tag) {
        latestReading = { time_tag: row.time_tag, flux };
      }
    }

    const fluxByDate = {};
    for (const [date, { flux }] of Object.entries(byDate)) fluxByDate[date] = flux;

    return { fluxByDate, latest: latestReading?.flux ?? null };
  } catch (err) {
    console.warn('[SpaceWeather] F10.7 flux fetch failed:', err.message);
    return { fluxByDate: {}, latest: null };
  }
}

/**
 * Fetch the latest NOAA planetary K-index reading and persist it.
 */
async function fetchSpaceWeather() {
  try {
    const { data } = await axios.get(NOAA_K_INDEX_URL, { timeout: 15_000 });

    if (!Array.isArray(data) || !data.length) {
      console.warn('[SpaceWeather] Unexpected response shape — skipping sync.');
      return;
    }

    // Parse every row NOAA returned (typically ~56 rows covering ~7 days at
    // 3-hour cadence). Dropping the legacy header row is handled by
    // parseNoaaRow returning null. Back-filling the full response means the
    // 72-hour grid populates on first deploy instead of gradually over days.
    const parsedRows = data
      .map(parseNoaaRow)
      .filter(Boolean);

    if (!parsedRows.length) {
      console.warn('[SpaceWeather] No parseable rows in NOAA response — skipping sync.');
      return;
    }

    // F10.7 history is daily, K-index cadence is 3-hourly. We pair each
    // K-index row to its own calendar date's flux so the UI shows the real
    // historical value rather than the current value stamped across every row.
    const { fluxByDate, latest: latestFlux } = await fetchF107Flux();

    // ON CONFLICT DO UPDATE lets us self-heal rows written by older versions of
    // this sync (e.g. when solar_flux_10cm was miscomputed). K-index and
    // condition_label are likewise refreshed in case NOAA revises a reading.
    let touched = 0;
    for (const { time_tag, kp } of parsedRows) {
      const k_index = Math.round(kp);
      const condition_label = kIndexToLabel(k_index);
      const date = time_tag.slice(0, 10);
      const flux = fluxByDate[date] ?? null;

      const result = await pool.query(
        `INSERT INTO space_weather (recorded_at, k_index, solar_flux_10cm, condition_label)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (recorded_at) DO UPDATE SET
           k_index         = EXCLUDED.k_index,
           solar_flux_10cm = EXCLUDED.solar_flux_10cm,
           condition_label = EXCLUDED.condition_label`,
        [time_tag, k_index, flux, condition_label]
      );
      touched += result.rowCount || 0;
    }

    const newest = parsedRows[parsedRows.length - 1];
    const newestKp = Math.round(newest.kp);
    console.log(
      `[SpaceWeather] Synced ${parsedRows.length} rows (${touched} upserted). ` +
      `Latest: ${newest.time_tag} | K-index=${newestKp} (${kIndexToLabel(newestKp)})` +
      (latestFlux !== null ? ` | F10.7 current=${latestFlux} sfu` : '')
    );
  } catch (err) {
    console.error('[SpaceWeather] Sync failed:', err.message);
  }
}

/**
 * Schedule the space weather sync — every 3 hours, on the hour.
 * Also runs once immediately on startup so the DB is populated right away.
 */
function scheduleSpaceWeatherCron() {
  // Every 3 hours at minute 0: 00:00, 03:00, 06:00, 09:00, 12:00, 15:00, 18:00, 21:00
  cron.schedule('0 */3 * * *', fetchSpaceWeather);
  console.log('[SpaceWeather] Cron scheduled (every 3 hours).');

  // Eager first-run so the table is populated before the first diagnosis cycle
  fetchSpaceWeather().catch(() => {});
}

/**
 * Retrieve the most recent K-index from the local DB cache.
 * Returns 0 if the table is empty (safe default — no storm assumed).
 * @returns {Promise<number>}
 */
async function getLatestKIndex() {
  const { rows } = await pool.query(
    'SELECT k_index FROM space_weather ORDER BY recorded_at DESC LIMIT 1'
  );
  return rows[0]?.k_index ?? 0;
}

module.exports = {
  scheduleSpaceWeatherCron,
  fetchSpaceWeather,
  getLatestKIndex,
  // Exported for unit testing / dry-runs without a live DB:
  parseNoaaRow,
  kIndexToLabel,
};
