/**
 * Weather Correlation Service (Stage 5 — best-effort)
 *
 * Fetches daily rainfall and cloud cover from Open-Meteo (free, no API key)
 * for each Isomo site that has GPS coordinates. Data is stored in weather_log
 * and used by the diagnosis engine to annotate causes with rain likelihood.
 *
 * Runs daily at 01:00 UTC (after midnight, before score cron at 23:55).
 * Only fires if OPEN_METEO_ENABLED=true in .env.
 *
 * API: https://api.open-meteo.com/v1/forecast
 * Variables: precipitation_sum, cloudcover_mean (daily aggregates)
 */
const cron  = require('node-cron');
const axios = require('axios');
const pool  = require('../db');

const ENABLED = process.env.OPEN_METEO_ENABLED === 'true';
const BASE_URL = 'https://api.open-meteo.com/v1/forecast';

/**
 * Fetch yesterday's weather for a site and upsert into weather_log.
 * @param {{ id: number, name: string, lat: number, lng: number }} site
 */
async function fetchWeatherForSite(site) {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];

  try {
    const { data } = await axios.get(BASE_URL, {
      timeout: 10_000,
      params: {
        latitude:   site.lat,
        longitude:  site.lng,
        daily:      'precipitation_sum,cloud_cover_mean',
        timezone:   'Africa/Kigali',
        past_days:  1,
        forecast_days: 0,
      },
    });

    // Find the index matching yesterday's date in the returned time array
    const daily     = data.daily;
    const timeArr   = daily?.time ?? [];
    const idx       = timeArr.indexOf(dateStr);
    const i         = idx >= 0 ? idx : timeArr.length - 1;

    const rainfall_mm = daily?.precipitation_sum?.[i]  ?? null;
    const cloud_pct   = daily?.cloud_cover_mean?.[i]   ?? null;

    await pool.query(
      `INSERT INTO weather_log (site_id, date, rainfall_mm, cloud_cover_pct)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (site_id, date)
       DO UPDATE SET rainfall_mm = EXCLUDED.rainfall_mm, cloud_cover_pct = EXCLUDED.cloud_cover_pct`,
      [site.id, dateStr, rainfall_mm, cloud_pct]
    );

    console.log(
      `[Weather] ${site.name}: ${dateStr} rain=${rainfall_mm ?? '--'}mm cloud=${cloud_pct ?? '--'}%`
    );
  } catch (err) {
    console.warn(`[Weather] Failed for site ${site.id} (${site.name}): ${err.message}`);
  }
}

/**
 * Fetch yesterday's weather for all GPS-equipped sites.
 */
async function runWeatherSync() {
  if (!ENABLED) return;

  const { rows: sites } = await pool.query(
    'SELECT id, name, lat, lng FROM sites WHERE lat IS NOT NULL AND lng IS NOT NULL'
  );

  if (!sites.length) {
    console.log('[Weather] No sites with GPS coordinates — skipping sync.');
    return;
  }

  console.log(`[Weather] Syncing weather for ${sites.length} sites…`);

  // Stagger requests by 200ms to be polite to the free API
  for (const site of sites) {
    await fetchWeatherForSite(site);
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('[Weather] Sync complete.');
}

/**
 * Get the latest weather reading for a site.
 * Returns null if no data or OPEN_METEO_ENABLED is false.
 * @param {number} site_id
 * @returns {Promise<{ rainfall_mm: number|null, cloud_cover_pct: number|null }|null>}
 */
async function getLatestWeather(site_id) {
  if (!ENABLED) return null;
  try {
    const { rows } = await pool.query(
      `SELECT rainfall_mm, cloud_cover_pct
       FROM weather_log
       WHERE site_id = $1
       ORDER BY date DESC LIMIT 1`,
      [site_id]
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Annotate a cause string with rain likelihood if conditions match.
 * Called by the diagnosis engine after determining the base cause.
 * @param {string} cause
 * @param {number} site_id
 * @returns {Promise<string>}
 */
async function annotateCauseWithWeather(cause, site_id) {
  if (!cause || !ENABLED) return cause;

  // Only annotate geometry/backhaul causes — not storm/gap which have clear causes
  const isAnnotatable = /geometry|congestion|terrestrial|interference/i.test(cause);
  if (!isAnnotatable) return cause;

  const weather = await getLatestWeather(site_id);
  if (!weather) return cause;

  if (weather.rainfall_mm != null && weather.rainfall_mm > 5) {
    return `${cause} (Heavy rain: ${weather.rainfall_mm.toFixed(1)}mm yesterday)`;
  }
  if (weather.cloud_cover_pct != null && weather.cloud_cover_pct > 85) {
    return `${cause} (Dense cloud cover: ${Math.round(weather.cloud_cover_pct)}% yesterday)`;
  }

  return cause;
}

function scheduleWeatherCron() {
  if (!ENABLED) {
    console.log('[Weather] OPEN_METEO_ENABLED=false — weather correlation disabled.');
    return;
  }
  // 01:00 UTC daily
  cron.schedule('0 1 * * *', runWeatherSync);
  console.log('[Weather] Weather correlation cron scheduled (daily at 01:00 UTC).');
  // Eager first run
  runWeatherSync().catch(() => {});
}

module.exports = { scheduleWeatherCron, runWeatherSync, getLatestWeather, annotateCauseWithWeather };
