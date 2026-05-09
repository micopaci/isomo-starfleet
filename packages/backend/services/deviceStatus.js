function normalizeHours(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

const DEVICE_ONLINE_HOURS = normalizeHours(process.env.DEVICE_ONLINE_HOURS, 72);
const DEVICE_STALE_HOURS = Math.max(
  DEVICE_ONLINE_HOURS + 1,
  normalizeHours(process.env.DEVICE_STALE_HOURS, 336),
);

function deviceSeenExpr(alias = 'd') {
  const prefix = alias ? `${alias}.` : '';
  return `GREATEST(${prefix}intune_last_sync_at, ${prefix}last_seen)`;
}

function deviceStatusCase(alias = 'd') {
  const seen = deviceSeenExpr(alias);
  return `
  CASE
    WHEN ${seen} IS NULL THEN 'unknown'
    WHEN ${seen} > NOW() - INTERVAL '${DEVICE_ONLINE_HOURS} hours' THEN 'online'
    WHEN ${seen} > NOW() - INTERVAL '${DEVICE_STALE_HOURS} hours' THEN 'stale'
    ELSE 'offline'
  END`;
}

function deviceOnlineWhere(alias = 'd') {
  return `${deviceSeenExpr(alias)} > NOW() - INTERVAL '${DEVICE_ONLINE_HOURS} hours'`;
}

function deviceStaleWhere(alias = 'd') {
  const seen = deviceSeenExpr(alias);
  return `${seen} < NOW() - INTERVAL '${DEVICE_ONLINE_HOURS} hours' AND ${seen} > NOW() - INTERVAL '${DEVICE_STALE_HOURS} hours'`;
}

module.exports = {
  DEVICE_ONLINE_HOURS,
  DEVICE_STALE_HOURS,
  deviceSeenExpr,
  deviceStatusCase,
  deviceOnlineWhere,
  deviceStaleWhere,
};
