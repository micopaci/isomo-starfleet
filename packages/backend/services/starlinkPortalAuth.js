const fs = require('fs');
const path = require('path');

class StarlinkPortalAuthExpiredError extends Error {
  constructor(message, status, context = {}) {
    super(message);
    this.name = 'StarlinkPortalAuthExpiredError';
    this.status = status;
    this.context = context;
  }
}

function resolveConfigFile(filePath) {
  if (path.isAbsolute(filePath)) return filePath;
  const candidates = [
    path.resolve(process.cwd(), filePath),
    path.resolve(__dirname, '../../..', filePath),
    path.resolve(__dirname, '..', filePath),
  ];
  return candidates.find(candidate => fs.existsSync(candidate)) || candidates[0];
}

function readJson(filePath) {
  const resolved = resolveConfigFile(filePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function parseJsonPayload(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} must be valid JSON: ${err.message}`);
  }
}

function normalizeHeaderPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  const source = payload.headers && typeof payload.headers === 'object'
    ? payload.headers
    : payload;
  const headers = {};
  for (const [key, value] of Object.entries(source)) {
    if (value == null) continue;
    headers[key] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return headers;
}

function cookieHeaderFromAuthState(state, nowSeconds = Math.floor(Date.now() / 1000)) {
  const cookies = Array.isArray(state?.cookies) ? state.cookies : [];
  const pairs = cookies
    .filter(cookie => {
      const domain = String(cookie.domain || '').toLowerCase();
      const name = String(cookie.name || '');
      if (!name || cookie.value == null) return false;
      if (!domain.includes('starlink.com')) return false;
      if (cookie.expires && cookie.expires > 0 && cookie.expires < nowSeconds) return false;
      return true;
    })
    .map(cookie => `${cookie.name}=${cookie.value}`);
  return pairs.length ? pairs.join('; ') : null;
}

function loadPortalAuthHeaders(env = process.env) {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'User-Agent': env.STARLINK_PORTAL_USER_AGENT
      || 'Mozilla/5.0 StarfleetCloudSync/1.0 (+https://starfleet.icircles.rw)',
  };

  if (env.STARLINK_PORTAL_AUTH_HEADERS_JSON) {
    Object.assign(
      headers,
      normalizeHeaderPayload(parseJsonPayload(env.STARLINK_PORTAL_AUTH_HEADERS_JSON, 'STARLINK_PORTAL_AUTH_HEADERS_JSON')),
    );
  }

  if (env.STARLINK_PORTAL_AUTH_HEADERS_FILE) {
    Object.assign(headers, normalizeHeaderPayload(readJson(env.STARLINK_PORTAL_AUTH_HEADERS_FILE)));
  }

  if (env.STARLINK_PORTAL_AUTH_STATE_FILE) {
    const cookie = cookieHeaderFromAuthState(readJson(env.STARLINK_PORTAL_AUTH_STATE_FILE));
    if (cookie) headers.Cookie = cookie;
  }

  if (env.STARLINK_PORTAL_COOKIE) headers.Cookie = env.STARLINK_PORTAL_COOKIE;
  if (env.STARLINK_PORTAL_AUTHORIZATION) headers.Authorization = env.STARLINK_PORTAL_AUTHORIZATION;

  if (!headers.Cookie && !headers.Authorization) {
    throw new Error(
      'Starlink portal auth is missing. Set STARLINK_PORTAL_AUTH_STATE_FILE, STARLINK_PORTAL_AUTH_HEADERS_FILE, STARLINK_PORTAL_AUTH_HEADERS_JSON, STARLINK_PORTAL_COOKIE, or STARLINK_PORTAL_AUTHORIZATION.'
    );
  }

  return headers;
}

function isAuthExpiredStatus(status) {
  return status === 401 || status === 403;
}

module.exports = {
  StarlinkPortalAuthExpiredError,
  cookieHeaderFromAuthState,
  isAuthExpiredStatus,
  loadPortalAuthHeaders,
  normalizeHeaderPayload,
};
