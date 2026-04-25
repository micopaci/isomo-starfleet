const cron = require('node-cron');
const pool = require('../db');

const RETENTION_DAYS = Number(process.env.DATA_USAGE_RETENTION_DAYS || 30);

async function runUsageArchive() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const moveRes = await client.query(
      `WITH moved AS (
         INSERT INTO data_usage_archive (device_id, site_id, date, bytes_down, bytes_up, archived_at)
         SELECT device_id, site_id, date, bytes_down, bytes_up, NOW()
         FROM data_usage
         WHERE date < CURRENT_DATE - ($1::text || ' days')::interval
         ON CONFLICT (device_id, date)
         DO UPDATE SET
           bytes_down = data_usage_archive.bytes_down + EXCLUDED.bytes_down,
           bytes_up   = data_usage_archive.bytes_up   + EXCLUDED.bytes_up,
           archived_at = NOW()
         RETURNING device_id, date
       )
       DELETE FROM data_usage d
       USING moved m
       WHERE d.device_id = m.device_id
         AND d.date = m.date`,
      [String(RETENTION_DAYS)]
    );

    await client.query('COMMIT');
    if (moveRes.rowCount > 0) {
      console.log(`[UsageArchive] Moved ${moveRes.rowCount} row(s) to archive (>${RETENTION_DAYS} days old).`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[UsageArchive] Archive run failed:', err.message);
  } finally {
    client.release();
  }
}

function scheduleUsageArchive() {
  cron.schedule('30 2 * * *', runUsageArchive); // daily @02:30
  console.log(`[UsageArchive] Archive job scheduled daily (retain ${RETENTION_DAYS} days in primary).`);
}

module.exports = { scheduleUsageArchive, runUsageArchive };
