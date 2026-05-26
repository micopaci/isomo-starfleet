/**
 * Structured request logging middleware.
 * Outputs JSON lines compatible with GCP Cloud Logging severity levels.
 * Cloud Run captures stdout and parses JSON with a `severity` field automatically.
 */

function requestLog(req, res, next) {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const status = res.statusCode;

    const severity =
      status >= 500 ? 'ERROR' :
      status >= 400 ? 'WARNING' :
      'INFO';

    const entry = {
      severity,
      message: `${req.method} ${req.originalUrl} ${status} ${durationMs.toFixed(1)}ms`,
      httpRequest: {
        requestMethod: req.method,
        requestUrl: req.originalUrl,
        status,
        latency: `${(durationMs / 1000).toFixed(4)}s`,
        userAgent: req.get('user-agent') || '',
        remoteIp: req.ip,
      },
      'logging.googleapis.com/labels': {
        service: 'starfleet-backend',
        route: routeLabel(req),
      },
    };

    if (req.user) {
      entry['logging.googleapis.com/labels'].role = req.user.role || 'unknown';
    }

    process.stdout.write(JSON.stringify(entry) + '\n');
  });

  next();
}

function routeLabel(req) {
  const p = req.route?.path || req.originalUrl;
  if (p.startsWith('/ingest/')) return '/ingest/*';
  if (p.startsWith('/api/')) return '/api/*';
  if (p.startsWith('/auth/')) return '/auth/*';
  if (p.startsWith('/health')) return '/health';
  return p;
}

module.exports = { requestLog };
