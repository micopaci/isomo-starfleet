const pool = require('../db');
const { getPoolStats } = require('../db');
const { DEVICE_ONLINE_HOURS, deviceSeenExpr } = require('./deviceStatus');

let timer = null;

async function emitMetrics() {
  try {
    const [deviceCount, staleCount, ingestAge] = await Promise.all([
      pool.query('SELECT COUNT(*)::INT AS cnt FROM devices'),
      pool.query(`SELECT COUNT(*)::INT AS cnt FROM devices WHERE ${deviceSeenExpr('devices')} = 'stale'`),
      pool.query(`SELECT EXTRACT(EPOCH FROM NOW() - MAX(last_ingest_ok_at))::INT AS age_sec FROM devices WHERE last_ingest_ok_at IS NOT NULL`),
    ]);

    const total = deviceCount.rows[0].cnt || 1;
    const stale = staleCount.rows[0].cnt || 0;
    const staleRatio = stale / total;
    const ingestAgeSec = ingestAge.rows[0].age_sec ?? 0;
    const poolStats = getPoolStats();
    const poolUtil = poolStats.totalCount > 0
      ? Math.round(((poolStats.totalCount - poolStats.idleCount) / poolStats.maxConnections) * 100)
      : 0;

    const metrics = [
      { name: 'starfleet_stale_device_ratio', value: staleRatio, stale, total },
      { name: 'starfleet_newest_ingest_age_sec', value: ingestAgeSec },
      { name: 'starfleet_db_pool_utilization', value: poolUtil },
      { name: 'starfleet_memory_mb', value: Math.round(process.memoryUsage().rss / (1024 * 1024)) },
    ];

    for (const m of metrics) {
      process.stdout.write(JSON.stringify({
        severity: 'INFO',
        message: `metric ${m.name}=${m.value}`,
        'logging.googleapis.com/labels': {
          service: 'starfleet-backend',
          metric_name: m.name,
        },
        metric: m,
      }) + '\n');
    }
  } catch (err) {
    process.stdout.write(JSON.stringify({
      severity: 'WARNING',
      message: `metrics emitter error: ${err.message}`,
      'logging.googleapis.com/labels': { service: 'starfleet-backend' },
    }) + '\n');
  }
}

function scheduleMetricsEmitter() {
  emitMetrics();
  timer = setInterval(emitMetrics, 5 * 60 * 1000);
}

module.exports = { scheduleMetricsEmitter };
