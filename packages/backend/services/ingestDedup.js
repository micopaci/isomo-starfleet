const cron = require('node-cron');
const pool = require('../db');

const RETENTION_DAYS = Number(process.env.INGEST_DEDUP_RETENTION_DAYS || 7);

async function pruneIngestDedup() {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ingest_payload_dedup
       WHERE received_at < NOW() - ($1::text || ' days')::interval`,
      [String(RETENTION_DAYS)]
    );
    if (rowCount > 0) {
      console.log(`[IngestDedup] Pruned ${rowCount} dedup row(s) older than ${RETENTION_DAYS} day(s).`);
    }
  } catch (err) {
    console.error('[IngestDedup] Prune failed:', err.message);
  }
}

function scheduleIngestDedupPrune() {
  cron.schedule('15 0 * * *', pruneIngestDedup); // daily @00:15
  console.log(`[IngestDedup] Dedup prune scheduled daily (retention ${RETENTION_DAYS}d).`);
}

module.exports = { scheduleIngestDedupPrune, pruneIngestDedup };
