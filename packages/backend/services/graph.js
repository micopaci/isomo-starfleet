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

function normalizeDate(raw) {
  if (!raw || raw === '0001-01-01T00:00:00Z') return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeText(raw) {
  if (raw == null) return null;
  const value = String(raw).trim();
  return value || null;
}

function normalizeBytes(raw) {
  if (raw == null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value);
}

function syntheticWindowsSerial(intuneId) {
  return `INTUNE-${String(intuneId).replace(/-/g, '').slice(0, 8)}`;
}

async function listManagedDevices() {
  const token = await getAccessToken();
  const select = [
    'id',
    'deviceName',
    'serialNumber',
    'manufacturer',
    'model',
    'operatingSystem',
    'osVersion',
    'lastSyncDateTime',
    'enrolledDateTime',
    'complianceState',
    'userPrincipalName',
    'azureADDeviceId',
    'deviceCategoryDisplayName',
    'freeStorageSpaceInBytes',
    'totalStorageSpaceInBytes',
  ].join(',');

  let url = `https://graph.microsoft.com/beta/deviceManagement/managedDevices?$select=${encodeURIComponent(select)}&$top=100`;
  const devices = [];

  while (url) {
    const result = await requestWithRetry(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!result || result.status < 200 || result.status >= 300) {
      throw new Error(`Graph managedDevices sync failed: HTTP ${result?.status || 'unknown'} ${JSON.stringify(result?.body || {})}`);
    }
    devices.push(...(result.body?.value || []));
    url = result.body?.['@odata.nextLink'] || null;
  }

  return devices;
}

async function upsertManagedDevice(client, device) {
  const intuneId = normalizeText(device.id);
  if (!intuneId) return false;

  const serial = normalizeText(device.serialNumber);
  const windowsSn = serial || syntheticWindowsSerial(intuneId);
  const existing = await client.query(
    `SELECT id
     FROM devices
     WHERE intune_device_id = $1 OR windows_sn = $2
     ORDER BY CASE WHEN intune_device_id = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [intuneId, windowsSn]
  );

  const values = [
    normalizeText(device.deviceName),
    windowsSn,
    normalizeText(device.manufacturer),
    intuneId,
    normalizeText(device.model),
    normalizeText(device.operatingSystem),
    normalizeText(device.osVersion),
    normalizeDate(device.lastSyncDateTime),
    normalizeDate(device.enrolledDateTime),
    normalizeText(device.complianceState),
    normalizeText(device.userPrincipalName),
    normalizeText(device.azureADDeviceId),
    normalizeText(device.deviceCategoryDisplayName),
    normalizeBytes(device.freeStorageSpaceInBytes),
    normalizeBytes(device.totalStorageSpaceInBytes),
  ];

  if (existing.rows.length) {
    await client.query(
      `UPDATE devices
       SET hostname = COALESCE($1, hostname),
           windows_sn = CASE
             WHEN NOT EXISTS (SELECT 1 FROM devices WHERE windows_sn = $2 AND id <> $16) THEN $2
             ELSE windows_sn
           END,
           manufacturer = COALESCE($3, manufacturer),
           intune_device_id = $4,
           model = COALESCE($5, model),
           os = COALESCE($6, os),
           os_version = COALESCE($7, os_version),
           intune_last_sync_at = COALESCE($8, intune_last_sync_at),
           intune_enrolled_at = COALESCE($9, intune_enrolled_at),
           compliance_state = COALESCE($10, compliance_state),
           user_principal_name = COALESCE($11, user_principal_name),
           azure_ad_device_id = COALESCE($12, azure_ad_device_id),
           device_category = COALESCE($13, device_category),
           free_storage_bytes = COALESCE($14, free_storage_bytes),
           total_storage_bytes = COALESCE($15, total_storage_bytes),
           intune_synced_at = NOW()
       WHERE id = $16`,
      [...values, existing.rows[0].id]
    );
  } else {
    await client.query(
      `INSERT INTO devices
         (hostname, windows_sn, manufacturer, intune_device_id, model, os,
          os_version, intune_last_sync_at, intune_enrolled_at, compliance_state,
          user_principal_name, azure_ad_device_id, device_category,
          free_storage_bytes, total_storage_bytes, intune_synced_at, role)
       VALUES
         ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), 'standard')`,
      values
    );
  }

  return true;
}

async function syncManagedDevices(managedDevices = null) {
  const devices = managedDevices || await listManagedDevices();
  const client = await pool.connect();
  let upserted = 0;
  let failed = 0;

  try {
    await client.query(`SET lock_timeout = '5s'`);
    for (const device of devices) {
      try {
        if (await upsertManagedDevice(client, device)) upserted += 1;
      } catch (err) {
        failed += 1;
        console.error(`[Graph] Failed to sync Intune device ${device.id || device.deviceName || 'unknown'}: ${err.message}`);
      }
      if ((upserted + failed) % 50 === 0) {
        console.log(`[Graph] Intune sync progress: ${upserted + failed}/${devices.length}`);
      }
    }
  } finally {
    client.release();
  }

  console.log(`[Graph] Synced ${upserted} Intune managed device(s); ${failed} failed.`);
  return { total: devices.length, upserted, failed };
}

function scheduleIntuneDeviceSync() {
  if (process.env.GRAPH_INTUNE_SYNC_ENABLED === 'false') {
    console.log('[Graph] Intune device sync disabled by GRAPH_INTUNE_SYNC_ENABLED=false.');
    return;
  }
  if (!process.env.GRAPH_TENANT_ID || !process.env.GRAPH_CLIENT_ID || !process.env.GRAPH_CLIENT_SECRET) {
    console.log('[Graph] Intune device sync not scheduled; Graph credentials are not configured.');
    return;
  }

  const intervalMin = Math.max(5, Number(process.env.GRAPH_INTUNE_SYNC_INTERVAL_MIN || 30));
  const run = () => syncManagedDevices().catch(err => {
    console.error('[Graph] Intune device sync failed:', err.message);
  });

  setTimeout(run, 15 * 1000);
  setInterval(run, intervalMin * 60 * 1000);
  console.log(`[Graph] Intune device sync scheduled every ${intervalMin} minute(s).`);
}

// Map internal remediation type → Intune Device Health Script policy GUID.
// These GUIDs are provisioned once in Intune Admin Center → Endpoint security
// → Device remediations → Scripts. Keep this map in sync with the portal.
// Override any entry via env (e.g. REMEDIATION_POLICY_RESTART_STARLINK) for
// tenants that recreate scripts and get new GUIDs.
const REMEDIATION_POLICY_IDS = {
  'restart-starlink': process.env.REMEDIATION_POLICY_RESTART_STARLINK || null,
  'reboot_starlink':  process.env.REMEDIATION_POLICY_REBOOT_STARLINK  || process.env.REMEDIATION_POLICY_RESTART_STARLINK || null,
  'clear-cache':      process.env.REMEDIATION_POLICY_CLEAR_CACHE      || null,
  'reinstall-agent':  process.env.REMEDIATION_POLICY_REINSTALL_AGENT  || null,
  'location_refresh': process.env.REMEDIATION_POLICY_LOCATION_REFRESH || null,
  'data_pull':        process.env.REMEDIATION_POLICY_DATA_PULL        || null,
  'diagnostics':      process.env.REMEDIATION_POLICY_DIAGNOSTICS      || null,
  'ping_dish':        process.env.REMEDIATION_POLICY_PING_DISH        || null,
};

async function triggerRemediationScript(device_id, type, trigger_id) {
  // Read the Azure-side UUID (intune_device_id), NOT the BIOS serial (windows_sn).
  // Graph's managedDevices/{id} path parameter is the Azure device GUID.
  const devRes = await pool.query(
    `SELECT intune_device_id FROM devices WHERE id = $1`,
    [device_id]
  );
  if (!devRes.rows.length) throw new Error(`Device ${device_id} not found`);
  const intuneDeviceId = devRes.rows[0].intune_device_id;
  if (!intuneDeviceId) {
    throw new Error(`Device ${device_id} has no intune_device_id — cannot trigger remediation`);
  }

  const scriptPolicyId = REMEDIATION_POLICY_IDS[type];
  if (!scriptPolicyId) {
    throw new Error(
      `Unknown remediation type "${type}". ` +
      `Set REMEDIATION_POLICY_${type.toUpperCase().replace(/-/g, '_')} env var to the policy GUID.`
    );
  }

  const token = await getAccessToken();
  // On-demand proactive remediation lives on the /beta endpoint and requires
  // the DeviceManagementManagedDevices.PrivilegedOperations.All app permission.
  const result = await requestWithRetry(
    `https://graph.microsoft.com/beta/deviceManagement/managedDevices/${intuneDeviceId}/initiateOnDemandProactiveRemediation`,
    {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
    { scriptPolicyId }
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
        const devRes = await pool.query(
          `SELECT intune_device_id FROM devices WHERE id = $1`,
          [row.device_id]
        );
        if (!devRes.rows.length || !devRes.rows[0].intune_device_id) continue;

        const result = await requestWithRetry(
          `https://graph.microsoft.com/v1.0/deviceManagement/managedDevices/${devRes.rows[0].intune_device_id}`,
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

module.exports = {
  triggerRemediationScript,
  startTriggerPoller,
  getAccessToken,
  listManagedDevices,
  syncManagedDevices,
  scheduleIntuneDeviceSync,
};
