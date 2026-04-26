/**
 * Agent Watchdog (Stage 5)
 *
 * Runs every 10 minutes. Flags devices whose Intune sync/agent heartbeat is
 * older than the expected Intune maintenance window.
 *
 * Stale devices are exposed via GET /api/devices?filter=stale
 * (handled in routes/api.js — the query already selects last_seen).
 */
const cron      = require('node-cron');
const pool      = require('../db');
const { broadcast } = require('./websocket');

const STALE_THRESHOLD_HOURS = 9;
const OFFLINE_THRESHOLD_HOURS = 24;

/**
 * Check for stale devices and broadcast alerts.
 */
async function runWatchdog() {
  try {
    const { rows: stale } = await pool.query(
      `SELECT d.id, d.hostname, d.windows_sn, d.site_id, s.name AS site_name,
              COALESCE(d.intune_last_sync_at, d.last_seen) AS last_seen,
              EXTRACT(EPOCH FROM (NOW() - COALESCE(d.intune_last_sync_at, d.last_seen))) / 60 AS stale_min
       FROM devices d
       LEFT JOIN sites s ON s.id = d.site_id
       WHERE COALESCE(d.intune_last_sync_at, d.last_seen) < NOW() - INTERVAL '${STALE_THRESHOLD_HOURS} hours'
         AND COALESCE(d.intune_last_sync_at, d.last_seen) > NOW() - INTERVAL '${OFFLINE_THRESHOLD_HOURS} hours'
       ORDER BY COALESCE(d.intune_last_sync_at, d.last_seen) ASC`
    );

    if (stale.length > 0) {
      console.log(`[Watchdog] ${stale.length} stale device(s) detected.`);
      stale.forEach(d => {
        console.log(`  ↳ ${d.hostname} (site: ${d.site_name}) — last seen ${Math.round(d.stale_min)}m ago`);
      });

      // Broadcast a summary so the desktop / web dashboard can show a banner
      broadcast('stale_devices', {
        count:   stale.length,
        devices: stale.map(d => ({
          id:        d.id,
          device_id: d.id,
          hostname:  d.hostname,
          site_id:   d.site_id,
          site_name: d.site_name,
          last_seen: d.last_seen,
          stale_min: Math.round(d.stale_min),
        })),
      });
    }
  } catch (err) {
    console.error('[Watchdog] Error:', err.message);
  }
}

function scheduleWatchdog() {
  // Every 10 minutes
  cron.schedule('*/10 * * * *', runWatchdog);
  console.log('[Watchdog] Device stale-check scheduled (every 10 min, Intune-first).');
}

module.exports = { scheduleWatchdog, runWatchdog };
