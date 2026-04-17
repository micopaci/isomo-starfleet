/**
 * JWT authentication middleware (RS256).
 * Reads the public key from JWT_PUBLIC_KEY env var (PEM string).
 * Falls back to a symmetric HS256 secret (JWT_SECRET) for dev convenience
 * when no RSA keys are configured.
 */
const jwt = require('jsonwebtoken');

function getVerifyKey() {
  if (process.env.JWT_PUBLIC_KEY && process.env.JWT_PUBLIC_KEY.startsWith('-----BEGIN')) {
    return { key: process.env.JWT_PUBLIC_KEY, algorithms: ['RS256'] };
  }
  // Dev fallback: symmetric secret
  const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
  return { key: secret, algorithms: ['HS256'] };
}

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { key, algorithms } = getVerifyKey();
  try {
    req.user = jwt.verify(token, key, { algorithms });
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Unauthorized', detail: err.message });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden — admin role required' });
  }
  next();
}

module.exports = { authMiddleware, requireAdmin };
