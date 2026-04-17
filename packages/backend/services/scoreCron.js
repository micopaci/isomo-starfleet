/**
 * Daily signal score cron — runs at 23:55 local time.
 *
 * For each site, fetches today's signal_readings and computes a 0-100 score.
 *
 * Score formula:
 *   base = 100
 *   - ping_drop_pct    × 6    (max -30)
 *   - obstruction_pct  × 2    (max -30)
 *   - max(0, (9.5 - snr) × 8)
 *   - max(0, (pop_latency_ms - 35) × 0.3)
 *
 * v4.1 — OSINT-Enriched Cause Diagnosis (Decision Tree):
 *
 *   Rule A: Geomagnetic Storm
 *     SNR < 4 AND K-index >= 5 → "Geomagnetic Storm (K-index N) — SNR Degradation Expected"
 *
 *   Rule B: Orbital Coverage Gap (SGP4 propagated)
 *     0 Starlink birds above 25° elevation mask → "Temporary Constellation Coverage Gap (SGP4 Predicted)"
 *
 *   Rule C: Terrestrial Backhaul / PoP Congestion
 *     High packet drop AND satellites visible AND obstruction low
 *     → "Starlink PoP/Gateway Congestion suspected (Non-local)"
 *
 *   Rule D: Physical Obstruction
 *     obstruction_pct > 5 → "Physical Obstruction Detected (Trees/Buildings)"
 *
 *   Rule E: RF Interference
 *     SNR < 7 (no other cause found) → "Local RF Interference"
 *
 *   Default: "Good signal" / "Optimal Operation"
 */
const cron = require('node-cron');
const pool = require('../db');
const { getLatestKIndex }  = require('./spaceWeather');
const { checkCoverageGap } = require('./orbitalSync');

// ── Score Computation ─────────────────────────────────────────────────────────

/**
 * Compute a 0-100 signal quality score from averaged daily readings.
 * @param {{ ping_drop_pct, obstruction_pct, snr, pop_latency_ms }|null} avg
 * @returns {{ score: number, rawCause: string }}
 */
function computeScore(avg) {
  if (!avg) return { score: 0, rawCause: 'No data' };

  const {
    ping_drop_pct  = 0,
    obstruction_pct = 0,
    snr            = 9.5,
    pop_latency_ms = 35,
  } = avg;

  let score = 100;
  score -= Math.min(30, ping_drop_pct * 6);
  score -= Math.min(30, obstruction_pct * 2);
  score -= Math.max(0, (9.5 - snr) * 8);
  score -= Math.max(0, (pop_latency_ms - 35) * 0.3);
  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, rawCause: null }; // cause resolved asynchronously
}

// ── OSINT-Enriched Diagnosis ──────────────────────────────────────────────────

/**
 * Determine the root cause of signal degradation using:
 *   1. Real-time space weather (NOAA K-index from local DB cache)
 *   2. SGP4 orbital propagation (visible Starlink count at site GPS)
 *   3. Telemetry averages (drop %, SNR, obstruction)
 *
 * Falls back to purely terrestrial rules when GPS is absent or the
 * orbital/weather tables are still empty.
 *
 * @param {number} site_id
 * @param {{ ping_drop_pct, obstruction_pct, snr, pop_latency_ms }|null} avg
 * @returns {Promise<string>} Human-readable cause label
 */
async function getEnhancedDiagnosis(site_id, avg) {
  if (!avg) return 'No data';

  const {
    ping_drop_pct  = 0,
    obstruction_pct = 0,
    snr            = 9.5,
  } = avg;

  // ── 1. Space Weather ────────────────────────────────────────────────────────
  let kIndex = 0;
  try {
    kIndex = await getLatestKIndex();
  } catch (err) {
    console.warn('[Diagnosis] Space weather lookup failed:', err.message);
  }

  // ── 2. Orbital Coverage ─────────────────────────────────────────────────────
  let visibleSats = 1; // safe default: assume coverage present
  try {
    const { rows: siteRows } = await pool.query(
      'SELECT lat, lng FROM sites WHERE id = $1',
      [site_id]
    );
    const { lat, lng } = siteRows[0] || {};
    if (lat != null && lng != null) {
      visibleSats = await checkCoverageGap(lat, lng);
    }
  } catch (err) {
    console.warn('[Diagnosis] Orbital coverage check failed:', err.message);
  }

  // ── 3. Decision Tree ────────────────────────────────────────────────────────

  // Rule A — Geomagnetic Storm: space weather is the most likely cause when
  //   K-index is elevated AND SNR is severely suppressed.
  if (snr < 4 && kIndex >= 5) {
    return `Geomagnetic Storm (K-index ${kIndex}) — SNR Degradation Expected`;
  }

  // Rule B — Orbital Gap: no birds above the 25° elevation mask; this is a
  //   predictable gap, not a hardware failure.
  if (visibleSats === 0) {
    return 'Temporary Constellation Coverage Gap (SGP4 Predicted)';
  }

  // Rule C — Backhaul / PoP Congestion: healthy dish view of sky, high packet
  //   loss is occurring upstream (gateway or PoP-level).
  if (ping_drop_pct > 10 && visibleSats > 0 && obstruction_pct < 2) {
    return 'Starlink PoP/Gateway Congestion suspected (Non-local)';
  }

  // Rule D — Physical Obstruction: dish field of view is blocked.
  if (obstruction_pct > 5) {
    return 'Physical Obstruction Detected (Trees/Buildings)';
  }

  // Rule E — RF Interference: low SNR with no other explanation.
  if (snr < 7) {
    return 'Local RF Interference';
  }

  return 'Optimal Operation';
}

// ── Cron Runner (v5.0 — Stage 5 Hardening) ───────────────────────────────────

const MIN_READINGS_FOR_QUALITY = 12; // fewer → flag as 'low_data'
const ANOMALY_DROP_THRESHOLD   = 20; // points below 7-day avg → flag anomaly

async function runScoreCron() {
  console.log('[ScoreCron] Running daily v5.0 score computation…');
  const today = new Date().toISOString().split('T')[0];

  const sitesRes = await pool.query('SELECT id FROM sites');
  for (const { id: site_id } of sitesRes.rows) {

    // ── 1. Aggregate today's signal readings ──────────────────────────────────
    const readingsRes = await pool.query(
      `SELECT AVG(ping_drop_pct)   AS ping_drop_pct,
              AVG(obstruction_pct) AS obstruction_pct,
              AVG(snr)             AS snr,
              AVG(pop_latency_ms)  AS pop_latency_ms,
              COUNT(*)             AS reading_count
       FROM signal_readings
       WHERE site_id = $1 AND DATE(recorded_at) = $2`,
      [site_id, today]
    );

    const row = readingsRes.rows[0];
    const readingCount = parseInt(row?.reading_count ?? 0, 10);
    const avg = row?.ping_drop_pct !== null
      ? {
          ping_drop_pct:   parseFloat(row.ping_drop_pct),
          obstruction_pct: parseFloat(row.obstruction_pct),
          snr:             parseFloat(row.snr),
          pop_latency_ms:  parseFloat(row.pop_latency_ms),
        }
      : null;

    // ── 2. Data quality flag ──────────────────────────────────────────────────
    const dataQuality = (readingCount > 0 && readingCount < MIN_READINGS_FOR_QUALITY)
      ? 'low_data'
      : 'ok';

    // ── 3. Score + cause ──────────────────────────────────────────────────────
    const { score } = computeScore(avg);
    const cause     = await getEnhancedDiagnosis(site_id, avg);

    // ── 4. 7-day rolling average ──────────────────────────────────────────────
    const avgRes = await pool.query(
      `SELECT ROUND(AVG(score))::INT AS avg7
       FROM daily_scores
       WHERE site_id = $1
         AND date >= CURRENT_DATE - INTERVAL '7 days'
         AND date < CURRENT_DATE
         AND data_quality = 'ok'`,
      [site_id]
    );
    const avg7 = avgRes.rows[0]?.avg7 ?? null;

    // ── 5. Anomaly detection ──────────────────────────────────────────────────
    const anomaly      = avg7 !== null && (avg7 - score) > ANOMALY_DROP_THRESHOLD;
    const anomalyDelta = avg7 !== null ? (avg7 - score) : null;

    if (anomaly) {
      console.warn(`  [Anomaly] Site ${site_id}: score=${score} vs 7d-avg=${avg7} (Δ-${anomalyDelta})`);
    }

    // ── 6. Update 7-day rolling avg on sites row ──────────────────────────────
    const newAvg7 = avg7 !== null
      ? Math.round((avg7 * 6 + score) / 7)  // rolling update including today
      : score;

    await pool.query(
      `UPDATE sites SET score_7day_avg = $1 WHERE id = $2`,
      [newAvg7, site_id]
    );

    // ── 7. Upsert daily_scores ────────────────────────────────────────────────
    await pool.query(
      `INSERT INTO daily_scores (site_id, date, score, cause, data_quality, anomaly, anomaly_delta)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (site_id, date)
       DO UPDATE SET
         score         = EXCLUDED.score,
         cause         = EXCLUDED.cause,
         data_quality  = EXCLUDED.data_quality,
         anomaly       = EXCLUDED.anomaly,
         anomaly_delta = EXCLUDED.anomaly_delta`,
      [site_id, today, score, cause, dataQuality, anomaly, anomalyDelta]
    );

    console.log(
      `  Site ${site_id}: score=${score}, quality=${dataQuality}` +
      (anomaly ? `, ANOMALY Δ-${anomalyDelta}` : '') +
      `, cause="${cause}"`
    );
  }

  // ── 8. Purge scores older than 90 days ───────────────────────────────────
  await pool.query(
    `DELETE FROM daily_scores WHERE date < CURRENT_DATE - INTERVAL '90 days'`
  );
  console.log('[ScoreCron] Done.');
}

function scheduleCron() {
  // 23:55 every day
  cron.schedule('55 23 * * *', runScoreCron);
  console.log('[ScoreCron] Daily score cron scheduled for 23:55.');
}

module.exports = { scheduleCron, runScoreCron, computeScore, getEnhancedDiagnosis };
