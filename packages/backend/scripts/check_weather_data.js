#!/usr/bin/env node
require('dotenv').config();

const pool = require('../db');
const { runWeatherSync } = require('../services/weatherCorrelation');

const args = new Set(process.argv.slice(2));

function formatDate(value) {
  if (!value) return '-';
  if (typeof value === 'string') return value.slice(0, 10);
  return new Date(value).toISOString().slice(0, 10);
}

async function main() {
  console.log('Checking Open-Meteo site weather data...');
  console.log(`OPEN_METEO_ENABLED=${process.env.OPEN_METEO_ENABLED || 'false'}`);

  if (args.has('--sync')) {
    console.log('\nRunning weather sync now...');
    const result = await runWeatherSync({ force: true });
    console.log(`Weather sync: ${result.synced} synced; ${result.failed} failed.`);
  }

  const summary = await pool.query(
    `SELECT
       COUNT(*) AS rows,
       COUNT(DISTINCT site_id) AS sites,
       MAX(date)::text AS latest_date
     FROM weather_log`
  );
  const latest = await pool.query(
    `SELECT DISTINCT ON (w.site_id)
            s.name, w.date::text AS date, w.rainfall_mm, w.cloud_cover_pct
     FROM weather_log w
     JOIN sites s ON s.id = w.site_id
     ORDER BY w.site_id, w.date DESC
     LIMIT 10`
  );

  const s = summary.rows[0];
  console.log('\nWeather DB');
  console.log(`  Rows:        ${s.rows}`);
  console.log(`  Sites:       ${s.sites}`);
  console.log(`  Latest date: ${formatDate(s.latest_date)}`);

  console.log('\nLatest sample (10):');
  for (const row of latest.rows) {
    const rain = row.rainfall_mm == null ? '-' : `${Number(row.rainfall_mm).toFixed(1)} mm`;
    const cloud = row.cloud_cover_pct == null ? '-' : `${Math.round(Number(row.cloud_cover_pct))}% cloud`;
    console.log(`  - ${row.name} | ${formatDate(row.date)} | ${rain} | ${cloud}`);
  }

  console.log('\nDone.');
}

main()
  .catch(err => {
    console.error('Weather check failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
