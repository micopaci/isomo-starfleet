require('dotenv').config();
const pool = require('../db');

const APPLY = process.argv.includes('--apply');
const STALE_DAYS = 90;

const DEPENDENT_TABLES = [
  'signal_readings',
  'latency_readings',
  'device_health',
  'data_usage',
  'script_triggers',
  'agent_health_snapshots',
  'ingest_payload_dedup',
  'site_change_events',
  'site_move_candidates',
  'alert_events',
];

async function main() {
  const client = await pool.connect();
  try {
    const stale = await client.query(`
      SELECT id, hostname, windows_sn, os, model, site_id,
             last_seen, intune_last_sync_at
        FROM devices
       WHERE GREATEST(last_seen, intune_last_sync_at) < NOW() - INTERVAL '${STALE_DAYS} days'
          OR (last_seen IS NULL AND intune_last_sync_at IS NULL)
       ORDER BY GREATEST(last_seen, intune_last_sync_at) NULLS FIRST
    `);

    if (stale.rows.length === 0) {
      console.log(`No devices stale beyond ${STALE_DAYS} days.`);
      return;
    }

    console.log(`\nDevices stale beyond ${STALE_DAYS} days (${stale.rows.length} total):\n`);
    for (const r of stale.rows) {
      const seen = r.last_seen || r.intune_last_sync_at || 'never';
      console.log(`  [${r.id}] ${r.hostname || r.windows_sn} | site=${r.site_id} | last_seen=${seen}`);
    }

    if (!APPLY) {
      console.log(`\nDRY RUN — pass --apply to delete these ${stale.rows.length} device(s) and their dependent rows.`);
      return;
    }

    const ids = stale.rows.map(r => r.id);
    await client.query('BEGIN');

    for (const table of DEPENDENT_TABLES) {
      const res = await client.query(
        `DELETE FROM ${table} WHERE device_id = ANY($1::int[])`,
        [ids]
      );
      if (res.rowCount > 0) console.log(`  Deleted ${res.rowCount} rows from ${table}`);
    }

    const del = await client.query(
      'DELETE FROM devices WHERE id = ANY($1::int[])',
      [ids]
    );
    console.log(`\nDeleted ${del.rowCount} stale device(s).`);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
