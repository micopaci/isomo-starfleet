const {
  StarlinkPortalAuthExpiredError,
  isAuthExpiredStatus,
} = require('./starlinkPortalAuth');

const WEBAGG_BASE_URL = 'https://starlink.com/api/webagg/v2';
const TELEMETRYAGG_BASE_URL = 'https://starlink.com/api/telemetryagg/v1';
const AUTH_BASE_URL = 'https://starlink.com/api/auth';
const PORTAL_ORIGIN = 'https://starlink.com';
const PORTAL_REFERER = 'https://starlink.com/account/home';

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null);
}

function parseDateOnly(raw) {
  if (!raw) return null;
  const value = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const dt = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(dt.getTime())) return null;
  const normalized = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  return normalized === value ? value : null;
}

function addUtcDays(dateOnly, days) {
  const dt = new Date(`${dateOnly}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function todayUtcDate(now = new Date()) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function parseTimestamp(raw) {
  if (!raw) return null;
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function getContent(payload) {
  return payload?.content && typeof payload.content === 'object'
    ? payload.content
    : payload || {};
}

function firstNumberFromObjects(objects, fields) {
  for (const obj of objects) {
    if (!obj || typeof obj !== 'object') continue;
    for (const field of fields) {
      const value = numberFromValue(obj[field]);
      if (value != null) return value;
    }
  }
  return null;
}

function firstRatePctFromObjects(objects, pctFields, rateFields) {
  const pct = firstNumberFromObjects(objects, pctFields);
  if (pct != null) return pct;
  const rate = firstNumberFromObjects(objects, rateFields);
  if (rate == null) return null;
  return rate > 0 && rate <= 1 ? rate * 100 : rate;
}

function parseTerminalStatus(payload) {
  const content = getContent(payload);
  const terminal = Array.isArray(content.userTerminals)
    ? (content.userTerminals[0] || {})
    : (content.userTerminal || content.terminal || {});
  const isOffline = firstDefined(
    terminal.isOffline,
    terminal.is_offline,
    content.isOffline,
    content.is_offline,
  );
  const status = isOffline === true
    ? 'Offline'
    : isOffline === false
      ? 'Online'
      : 'Unknown';
  const lastConnected = firstDefined(
    terminal.lastConnected,
    terminal.last_connected,
    terminal.lastConnectedAt,
    terminal.last_connected_at,
    content.lastConnected,
    content.last_connected,
  );
  const nickname = firstDefined(
    terminal.nickname,
    terminal.nickName,
    terminal.name,
    content.nickname,
    content.nickName,
    content.serviceLine?.nickname,
  );
  const pingLatencyMs = firstNumberFromObjects(
    [terminal, content],
    [
      'popPingLatencyMs',
      'pop_ping_latency_ms',
      'pingLatencyMs',
      'ping_latency_ms',
      'avgPingLatencyMs',
      'meanPingLatencyMs',
      'popLatencyMs',
      'pop_latency_ms',
    ],
  );
  const pingDropPct = firstRatePctFromObjects(
    [terminal, content],
    [
      'pingDropPct',
      'ping_drop_pct',
      'packetLossPct',
      'packet_loss_pct',
      'dropPct',
      'drop_pct',
    ],
    [
      'pingDropRate',
      'ping_drop_rate',
      'packetLossRate',
      'packet_loss_rate',
      'dropRate',
      'drop_rate',
    ],
  );

  return {
    current_status: status,
    is_offline: isOffline == null ? null : isOffline === true,
    last_seen_utc: parseTimestamp(lastConnected),
    ping_latency_ms: pingLatencyMs,
    ping_drop_pct: pingDropPct,
    nickname: nickname == null ? null : String(nickname),
    raw_terminal: terminal && typeof terminal === 'object' ? terminal : {},
  };
}

function numberFromValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    if (!cleaned) return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function coerceDailyGigabytes(point) {
  const direct = numberFromValue(point);
  if (direct != null) return direct;
  // Annotated feed returns each day as a positional array of GB buckets,
  // e.g. [20.6] (total) or [priorityGb, standardGb]. Sum the numeric members.
  if (Array.isArray(point)) {
    const nums = point.map(numberFromValue).filter(n => n != null);
    return nums.length ? nums.reduce((sum, n) => sum + n, 0) : null;
  }
  if (!point || typeof point !== 'object') return null;

  const gb = numberFromValue(firstDefined(
    point.consumedGb,
    point.consumedGB,
    point.consumed_gb,
    point.usageGb,
    point.usageGB,
    point.totalGb,
    point.totalGB,
    point.gb,
    point.gigabytes,
    point.dataUsageGb,
    point.data_usage_gb,
  ));
  if (gb != null) return gb;

  const mb = numberFromValue(firstDefined(point.consumedMb, point.consumedMB, point.mb, point.megabytes));
  if (mb != null) return mb / 1024;

  const bytes = numberFromValue(firstDefined(point.consumedBytes, point.bytes, point.totalBytes));
  if (bytes != null) return bytes / (1024 * 1024 * 1024);

  return null;
}

function getBillingCycles(payload) {
  const content = getContent(payload);
  const cycles = firstDefined(
    content.billingCyclesAnnotated,
    content.billing_cycles_annotated,
    content.billingCycles,
    payload?.billingCyclesAnnotated,
    payload?.billing_cycles_annotated,
    payload?.billingCycles,
  );
  return Array.isArray(cycles) ? cycles : [];
}

function cycleStartDate(cycle) {
  return parseDateOnly(firstDefined(
    cycle.startDate,
    cycle.start_date,
    cycle.billingCycleStart,
    cycle.billing_cycle_start,
    cycle.billingCycleStartDate,
  ));
}

function cycleEndDate(cycle) {
  return parseDateOnly(firstDefined(
    cycle.endDate,
    cycle.end_date,
    cycle.billingCycleEnd,
    cycle.billing_cycle_end,
    cycle.billingCycleEndDate,
  ));
}

function getDailyData(cycle) {
  const dailyData = firstDefined(
    cycle.dailyData,
    cycle.daily_data,
    cycle.dailyUsage,
    cycle.daily_usage,
    cycle.days,
  );
  return Array.isArray(dailyData) ? dailyData : [];
}

function parseUsageHistory(payload, options = {}) {
  const now = options.now || new Date();
  const today = todayUtcDate(now);
  const cycles = getBillingCycles(payload);
  const history = [];
  let activeBillingCycleStart = null;

  cycles.forEach((cycle, cycleIndex) => {
    const startDate = cycleStartDate(cycle);
    if (!startDate) return;
    const endDate = cycleEndDate(cycle);
    const dailyData = getDailyData(cycle);

    if (startDate <= today && (!activeBillingCycleStart || startDate > activeBillingCycleStart)) {
      activeBillingCycleStart = startDate;
    }

    dailyData.forEach((point, dayIndex) => {
      const logDate = addUtcDays(startDate, dayIndex);
      if (logDate > today) return;
      const consumedGb = coerceDailyGigabytes(point);
      if (consumedGb == null || !Number.isFinite(consumedGb) || consumedGb < 0) return;

      history.push({
        log_date: logDate,
        consumed_gb: Math.round(consumedGb * 1000) / 1000,
        billing_cycle_start: startDate,
        metadata: {
          billing_cycle_index: cycleIndex,
          daily_data_index: dayIndex,
          billing_cycle_end: endDate,
          raw_daily_data: point && typeof point === 'object' ? point : null,
        },
      });
    });
  });

  return { history, active_billing_cycle_start: activeBillingCycleStart };
}

class StarlinkPortalClient {
  constructor({
    headers,
    webaggBaseUrl = WEBAGG_BASE_URL,
    telemetryaggBaseUrl = TELEMETRYAGG_BASE_URL,
    authBaseUrl = AUTH_BASE_URL,
  } = {}) {
    // Starlink rejects API calls without a same-origin Referer/Origin.
    this.baseHeaders = { Referer: PORTAL_REFERER, Origin: PORTAL_ORIGIN, ...(headers || {}) };
    this.webaggBaseUrl = webaggBaseUrl.replace(/\/$/, '');
    this.telemetryaggBaseUrl = telemetryaggBaseUrl.replace(/\/$/, '');
    this.authBaseUrl = authBaseUrl.replace(/\/$/, '');

    // Maintain a live cookie jar so per-account auth refreshes (which rotate
    // Starlink.Com.Access.V1 via Set-Cookie) carry into subsequent requests.
    this.jar = new Map();
    if (this.baseHeaders.Cookie) {
      for (const part of String(this.baseHeaders.Cookie).split(/;\s*/)) {
        const name = part.split('=')[0];
        if (name) this.jar.set(name, part);
      }
    }
    this.activeAccountId = null;
  }

  headers() {
    return { ...this.baseHeaders, Cookie: [...this.jar.values()].join('; ') };
  }

  captureCookies(res) {
    const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const cookie of setCookies) {
      const pair = cookie.split(';')[0];
      const name = pair.split('=')[0];
      if (name) this.jar.set(name, pair);
    }
  }

  // Starlink ignores ?accountNumber on data endpoints; account context is set by
  // the starlink.com.account_number cookie plus an auth refresh that rotates the
  // access token for that account. Call before fetching a different account's lines.
  async switchAccount(accountId) {
    if (!accountId || accountId === this.activeAccountId) return;
    this.jar.set('starlink.com.account_number', `starlink.com.account_number=${encodeURIComponent(accountId)}`);
    const res = await fetch(`${this.authBaseUrl}/auth/user?accountNumber=${encodeURIComponent(accountId)}`, {
      headers: this.headers(),
      redirect: 'manual',
    });
    this.captureCookies(res);
    if (isAuthExpiredStatus(res.status)) {
      throw new StarlinkPortalAuthExpiredError(
        `Starlink portal auth expired with HTTP ${res.status}`,
        res.status,
        { operation: 'switch_account', account_id: accountId },
      );
    }
    this.activeAccountId = accountId;
  }

  async requestJson(url, context = {}) {
    const res = await fetch(url, { headers: this.headers(), redirect: 'manual' });
    this.captureCookies(res);
    const text = await res.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }

    if (isAuthExpiredStatus(res.status)) {
      throw new StarlinkPortalAuthExpiredError(
        `Starlink portal auth expired with HTTP ${res.status}`,
        res.status,
        { ...context, url },
      );
    }
    if (!res.ok) {
      throw new Error(`${context.operation || 'Starlink portal request'} failed with HTTP ${res.status}: ${body.error || body.message || body.raw || text}`);
    }
    return body;
  }

  getTerminalStatus(serviceLineId) {
    const encodedServiceLine = encodeURIComponent(serviceLineId);
    return this.requestJson(
      `${this.webaggBaseUrl}/accounts/service-line/${encodedServiceLine}`,
      { operation: 'terminal_status', service_line_id: serviceLineId },
    );
  }

  getDataUsage(accountId, serviceLineId) {
    const encodedAccount = encodeURIComponent(accountId);
    const encodedServiceLine = encodeURIComponent(serviceLineId);
    return this.requestJson(
      `${this.telemetryaggBaseUrl}/data-usage/account/${encodedAccount}/service-line/${encodedServiceLine}/annotated`,
      { operation: 'daily_usage', account_id: accountId, service_line_id: serviceLineId },
    );
  }
}

module.exports = {
  StarlinkPortalClient,
  WEBAGG_BASE_URL,
  TELEMETRYAGG_BASE_URL,
  addUtcDays,
  coerceDailyGigabytes,
  parseDateOnly,
  parseTerminalStatus,
  parseUsageHistory,
  todayUtcDate,
};
