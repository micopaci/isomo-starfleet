/**
 * Space Weather Cron (v4.1 — OSINT Intelligence)
 *
 * Syncs NOAA planetary K-index readings every 3 hours.
 * The K-index is used by the diagnosis engine to distinguish genuine
 * hardware/alignment faults from geomagnetic storm-induced SNR drops.
 *
 * Source: NOAA Space Weather Prediction Center
 * API:    https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json
 * Format: JSON array — first row is header, subsequent rows are:
 *         [ "time_tag", "Kp", "observed", "noaa_scale" ]
 */
const cron = require('node-cron');
const axios = require('axios');
const pool  = require('../db');

const NOAA_K_INDEX_URL =
  'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';

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
 * Fetch the latest NOAA planetary K-index reading and persist it.
 */
async function fetchSpaceWeather() {
  try {
    const { data } = await axios.get(NOAA_K_INDEX_URL, { timeout: 15_000 });

    if (!Array.isArray(data) || data.length < 2) {
      console.warn('[SpaceWeather] Unexpected response shape — skipping sync.');
      return;
    }

    // First row is the header; take the most recent data row
    const latest = data[data.length - 1];
    const recorded_at = latest[0];

    // NOAA now returns Kp as a float (e.g. "3.33") — round to nearest int.
    // Guard against empty-string or non-numeric values.
    const kRaw    = parseFloat(latest[1]);
    const k_index = Number.isFinite(kRaw) ? Math.round(kRaw) : null;

    if (k_index === null) {
      console.warn('[SpaceWeather] K-index value is not numeric — skipping row.');
      return;
    }

    const solar_flux_10cm = (latest[2] !== '' && latest[2] != null)
      ? parseFloat(latest[2])
      : null;
    const condition_label = kIndexToLabel(k_index);

    await pool.query(
      `INSERT INTO space_weather (recorded_at, k_index, solar_flux_10cm, condition_label)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (recorded_at) DO NOTHING`,
      [recorded_at, k_index, solar_flux_10cm, condition_label]
    );

    console.log(
      `[SpaceWeather] Synced: K-index=${k_index} (${condition_label})` +
      (solar_flux_10cm !== null ? ` | Solar Flux=${solar_flux_10cm} sfu` : '')
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

module.exports = { scheduleSpaceWeatherCron, fetchSpaceWeather, getLatestKIndex };
