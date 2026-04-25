/**
 * Ingest Rate Limiter — Stage 5
 *
 * Limits each device (keyed by device_sn in the request body) to
 * 5 requests per minute per endpoint. Falls back to IP address when
 * device_sn is absent (e.g. malformed requests) so those are still
 * throttled.
 *
 * Uses express-rate-limit with a per-key sliding window.
 * Returns 429 with a Retry-After header on breach.
 */
const rateLimit = require('express-rate-limit');

/**
 * Build a limiter for a specific ingest endpoint label.
 * Each endpoint gets its own window so a device cannot be blocked
 * on /signal by hammering /heartbeat.
 *
 * @param {string} endpointLabel  — used as part of the store key namespace
 */
function makeIngestLimiter(endpointLabel) {
  return rateLimit({
    windowMs: 60 * 1000,  // 1-minute rolling window
    max: 5,               // max 5 requests per device per minute

    // Key = "<endpoint>:<device_sn>" so limits are isolated per endpoint
    keyGenerator: (req) => {
      const sn = req.body?.device_sn;
      const ip = req.ip || req.socket?.remoteAddress || 'unknown';
      return sn ? `${endpointLabel}:${sn}` : `${endpointLabel}:ip:${ip}`;
    },

    // Express-rate-limit v7 requires standardHeaders or legacyHeaders
    standardHeaders: 'draft-7',  // RateLimit-* headers (RFC draft-7)
    legacyHeaders: false,

    // Return 429 with Retry-After when limit is exceeded
    handler: (req, res) => {
      const retryAfter = Math.ceil(60); // seconds until window resets
      res.setHeader('Retry-After', retryAfter);
      res.status(429).json({
        error: 'Too Many Requests',
        message: `Rate limit exceeded for this device on ${endpointLabel}. Retry after ${retryAfter}s.`,
        retryAfter,
      });
    },

    // Skip rate-limiting for requests that already returned 400/401
    // (they never reach DB so there's no real abuse risk for auth errors)
    skip: (req) => false,
  });
}

module.exports = {
  heartbeatLimiter: makeIngestLimiter('heartbeat'),
  signalLimiter:    makeIngestLimiter('signal'),
  latencyLimiter:   makeIngestLimiter('latency'),
  healthLimiter:    makeIngestLimiter('health'),
  usageLimiter:     makeIngestLimiter('usage'),
  agentHealthLimiter: makeIngestLimiter('agent-health'),
};
