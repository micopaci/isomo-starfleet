/**
 * In-memory cache for current site signal state.
 * Structure: Map<siteId, { snr, pop_latency_ms, obstruction_pct, ping_drop_pct,
 *                           confidence, spread_ms, updatedAt }>
 */
const currentSignal = new Map();

module.exports = { currentSignal };
