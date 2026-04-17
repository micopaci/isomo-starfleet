/**
 * Microsoft Graph API client.
 * - Auth via client_credentials (tenant_id, client_id, client_secret from env)
 * - Token cache with 5-min expiry buffer
 * - Retry with exponential backoff on 429 and 503
 */
const https = require('https');
const pool  = require('../db');

let tokenCache = null; // { accessToken, expiresAt }

async function fetchJson(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const reqOptions = {
      hostname: parsed.hostname,
      path:     parsed.pathname + parsed.search,
      method:   options.method || 'GET',
      headers:  options.headers || {},
    };
    if (body) {
      const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
      reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
    }

    const req = https.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
      });
    });
    req.on('error', reject);
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 5 * 60 * 1000) {
    console.log('Using cached Graph token');
    return tokenCache.accessToken;
  }

  const tenantId     = process.env.GRAPH_TENANT_ID;
  const clientId     = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET must be set');
  }

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         'https://graph.microsoft.com/.default',
  }).toString();

  const result = await fetchJson(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    },
    body
  );

  if (result.status !== 200) {
    throw new Error(`Graph auth failed: ${JSON.stringify(result.body)}`);
  }

  tokenCache = {
    accessToken: result.body.access_token,
    expiresAt:   now + result.body.expires_in * 1000,
  };

  return tokenCache.accessToken;
}

async function requestWithRetry(url, options, body, maxRetries = 3) {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await fetchJson(url, options, body);
    if (result.status === 429 || result.status === 503) {
      if (attempt === maxRetries) throw new Error(`Graph request failed after ${maxRetries} retries`);
      await sleep(delay);
      delay *= 2;
      continue;
    }
    return result;
  }
}

async function triggerRemediationScript(device_id, type, trigger_id) {
  // Get Intune device ID from devices table (stored as windows_sn or a dedicated column)
  const devRes = await pool.query(`SELECT windows_sn FROM devices WHERE id = $1`, [device_id]);
  if (!devRes.rows.length) throw new Error(`Device ${device_id} not found`);
  const intuneDeviceId = devRes.rows[0].windows_sn;

  const token = await getAccessToken();
  const result = await requestWithRetry(
    `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${intuneDeviceId}/runRemediationScript`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
    { scriptType: type }
  );

  // Update trigger status
  const status = result.status < 300 ? 'running' : 'failed';
  await pool.query(
    `UPDATE script_triggers SET status = $1, result = $2 WHERE id = $3`,
    [status, JSON.stringify(result.body), trigger_id]
  );

  return result;
}

// Background poller: update trigger status every 60s
function startTriggerPoller() {
  setInterval(async () => {
    try {
      const pending = await pool.query(
        `SELECT id, device_id FROM script_triggers WHERE status IN ('pending', 'running')`
      );
      if (!pending.rows.length) return;

      const token = await getAccessToken().catch(() => null);
      if (!token) return;

      for (const row of pending.rows) {
        const devRes = await pool.query(`SELECT windows_sn FROM devices WHERE id = $1`, [row.device_id]);
        if (!devRes.rows.length) continue;

        const result = await requestWithRetry(
          `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${devRes.rows[0].windows_sn}`,
          { headers: { Authorization: `Bearer ${token}` } }
        ).catch(() => null);

        if (result && result.status === 200) {
          await pool.query(
            `UPDATE script_triggers SET status = 'done', result = $1 WHERE id = $2`,
            [JSON.stringify(result.body), row.id]
          );
        }
      }
    } catch (err) {
      console.error('Trigger poller error:', err.message);
    }
  }, 60 * 1000);
}

module.exports = { triggerRemediationScript, startTriggerPoller, getAccessToken };
