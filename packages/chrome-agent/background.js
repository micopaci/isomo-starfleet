/**
 * Starfleet Chrome Agent — background service worker.
 *
 * Collects system telemetry from managed Chromebooks and reports to the
 * Starfleet ingest API using the same protocol as the Windows PowerShell agent.
 *
 * Deployed via Google Workspace admin → Chrome management → Apps & extensions.
 * Config is set via chrome.storage.managed (managed_schema.json) or
 * chrome.storage.local (options page).
 */

const ALARM_NAME = 'starfleet-heartbeat';
const HEARTBEAT_INTERVAL_MIN = 5;
const TOKEN_REFRESH_INTERVAL_H = 24;

// ── Config ──────────────────────────────────────────────────────────────────

async function getConfig() {
  const managed = await chrome.storage.managed.get(null).catch(() => ({}));
  const local = await chrome.storage.local.get([
    'apiBase', 'apiToken', 'siteId', 'deviceSn',
  ]);

  return {
    apiBase: managed.apiBase || local.apiBase || '',
    apiToken: managed.apiToken || local.apiToken || '',
    siteId: Number(managed.siteId || local.siteId || 0),
    deviceSn: local.deviceSn || '',
  };
}

async function saveLocal(updates) {
  await chrome.storage.local.set(updates);
}

// ── API helpers ─────────────────────────────────────────────────────────────

async function apiPost(config, endpoint, payload) {
  if (!config.apiBase || !config.apiToken) {
    throw new Error('Agent not configured — set apiBase and apiToken');
  }

  const url = `${config.apiBase.replace(/\/$/, '')}/ingest/${endpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ── Telemetry collectors ────────────────────────────────────────────────────

function getDeviceSerial() {
  return new Promise((resolve) => {
    if (chrome.enterprise?.deviceAttributes?.getDeviceSerialNumber) {
      chrome.enterprise.deviceAttributes.getDeviceSerialNumber(resolve);
    } else {
      resolve('');
    }
  });
}

async function getDeviceIdentity(config) {
  let deviceSn = config.deviceSn;

  if (!deviceSn) {
    deviceSn = await getDeviceSerial();
    if (!deviceSn) {
      deviceSn = `CHROME-${(await chrome.storage.local.get('instanceId')).instanceId || generateInstanceId()}`;
    }
    await saveLocal({ deviceSn });
  }

  return {
    device_sn: deviceSn,
    hostname: deviceSn,
    os: 'Chrome OS',
    model: navigator.userAgent.includes('CrOS') ? 'Chromebook' : 'Chrome Device',
    manufacturer: 'Google',
  };
}

function generateInstanceId() {
  const id = crypto.randomUUID().slice(0, 12);
  chrome.storage.local.set({ instanceId: id });
  return id;
}

async function getSystemHealth() {
  const [cpuInfo, memoryInfo, storageInfo] = await Promise.all([
    chrome.system.cpu.getInfo(),
    chrome.system.memory.getInfo(),
    new Promise((resolve) =>
      chrome.system.storage.getInfo((info) => resolve(info))
    ),
  ]);

  const totalRam = memoryInfo.capacity;
  const availableRam = memoryInfo.availableCapacity;
  const ramPct = totalRam > 0
    ? Math.round(((totalRam - availableRam) / totalRam) * 100)
    : null;

  let diskUsagePct = null;
  const mainDisk = storageInfo.find((s) => s.type === 'fixed');
  if (mainDisk && mainDisk.capacity > 0) {
    diskUsagePct = 0;
  }

  return {
    ram_pct: ramPct,
    disk_usage_pct: diskUsagePct,
    cpu_model: cpuInfo.modelName,
    cpu_cores: cpuInfo.numOfProcessors,
  };
}

// ── Main heartbeat loop ─────────────────────────────────────────────────────

async function runHeartbeat() {
  try {
    const config = await getConfig();
    if (!config.apiBase || !config.apiToken) {
      console.log('[Starfleet] Not configured yet — skipping heartbeat.');
      return;
    }

    const identity = await getDeviceIdentity(config);
    const health = await getSystemHealth();
    const timestamp = new Date().toISOString();
    const siteId = config.siteId;

    // Bootstrap if no site yet
    if (!siteId || siteId <= 0) {
      try {
        const bootstrap = await apiPost(config, 'bootstrap-token', {
          device_sn: identity.device_sn,
          hostname: identity.hostname,
          os: identity.os,
          model: identity.model,
          manufacturer: identity.manufacturer,
        });
        if (bootstrap.token && bootstrap.site_id > 0) {
          await saveLocal({
            apiToken: bootstrap.token,
            siteId: bootstrap.site_id,
          });
          config.apiToken = bootstrap.token;
          config.siteId = bootstrap.site_id;
          console.log(`[Starfleet] Bootstrapped to site ${bootstrap.site_id}.`);
        }
      } catch (err) {
        console.warn('[Starfleet] Bootstrap failed:', err.message);
      }
    }

    // Token rotation (once per day)
    if (config.siteId > 0) {
      const { lastTokenRefresh } = await chrome.storage.local.get('lastTokenRefresh');
      const hoursSince = lastTokenRefresh
        ? (Date.now() - lastTokenRefresh) / (1000 * 60 * 60)
        : Infinity;

      if (hoursSince >= TOKEN_REFRESH_INTERVAL_H) {
        try {
          const refreshed = await apiPost(config, 'refresh-token', {
            device_sn: identity.device_sn,
          });
          if (refreshed.token) {
            await saveLocal({
              apiToken: refreshed.token,
              lastTokenRefresh: Date.now(),
            });
            config.apiToken = refreshed.token;
            console.log('[Starfleet] Token refreshed.');
          }
        } catch (err) {
          console.warn('[Starfleet] Token refresh failed:', err.message);
        }
      }
    }

    const effectiveSiteId = config.siteId || 0;

    // Heartbeat
    await apiPost(config, 'heartbeat', {
      device_sn: identity.device_sn,
      site_id: effectiveSiteId,
      hostname: identity.hostname,
      timestamp_utc: timestamp,
      os: identity.os,
      model: identity.model,
      manufacturer: identity.manufacturer,
    });

    // Health
    await apiPost(config, 'health', {
      device_sn: identity.device_sn,
      site_id: effectiveSiteId,
      timestamp_utc: timestamp,
      ram_pct: health.ram_pct,
      disk_usage_pct: health.disk_usage_pct,
    });

    console.log(`[Starfleet] Heartbeat sent for site ${effectiveSiteId}.`);
  } catch (err) {
    console.error('[Starfleet] Heartbeat error:', err.message);
  }
}

// ── Alarm setup ─────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    runHeartbeat();
  }
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: 1,
    periodInMinutes: HEARTBEAT_INTERVAL_MIN,
  });
  console.log('[Starfleet] Agent installed. Heartbeat alarm set.');
});

chrome.runtime.onStartup.addListener(() => {
  runHeartbeat();
});
