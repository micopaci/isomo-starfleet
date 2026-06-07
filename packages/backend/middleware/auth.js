/**
 * JWT authentication middleware.
 *
 * Verification supports key rotation: a token is accepted if it validates
 * against ANY configured key. This lets us rotate the signing secret without
 * stranding long-lived tokens (e.g. site-scoped agent tokens) that were signed
 * with a previous secret.
 *
 * Candidate verify keys, in order:
 *   1. RS256 public key      — JWT_PUBLIC_KEY          (PEM, if present)
 *   2. RS256 previous public — JWT_PUBLIC_KEY_PREVIOUS (PEM, if present)
 *   3. HS256 current secret  — JWT_SECRET              (or dev fallback)
 *   4. HS256 previous secret — JWT_SECRET_PREVIOUS     (if present)
 *
 * New tokens are always SIGNED with the current key only (see auth.js /
 * api.js). The previous key is verify-only and should be removed once the
 * whole fleet has been re-issued onto the current secret.
 */
const jwt = require('jsonwebtoken');

function getVerifyCandidates() {
  const candidates = [];

  if (process.env.JWT_PUBLIC_KEY && process.env.JWT_PUBLIC_KEY.startsWith('-----BEGIN')) {
    candidates.push({ key: process.env.JWT_PUBLIC_KEY, algorithms: ['RS256'] });
  }
  if (process.env.JWT_PUBLIC_KEY_PREVIOUS && process.env.JWT_PUBLIC_KEY_PREVIOUS.startsWith('-----BEGIN')) {
    candidates.push({ key: process.env.JWT_PUBLIC_KEY_PREVIOUS, algorithms: ['RS256'] });
  }

  // HS256 current secret (dev fallback keeps local dev working)
  candidates.push({ key: process.env.JWT_SECRET || 'dev-secret-change-me', algorithms: ['HS256'] });

  // HS256 previous secret — verify-only, for rotation without re-issuing tokens
  if (process.env.JWT_SECRET_PREVIOUS) {
    candidates.push({ key: process.env.JWT_SECRET_PREVIOUS, algorithms: ['HS256'] });
  }

  return candidates;
}

function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const candidates = getVerifyCandidates();
  let lastErr = null;
  for (const { key, algorithms } of candidates) {
    try {
      req.user = jwt.verify(token, key, { algorithms });
      return next();
    } catch (err) {
      lastErr = err;
    }
  }
  return res.status(401).json({ error: 'Unauthorized', detail: lastErr ? lastErr.message : 'no verify key configured' });
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden — admin role required' });
  }
  next();
}

module.exports = { authMiddleware, requireAdmin };
