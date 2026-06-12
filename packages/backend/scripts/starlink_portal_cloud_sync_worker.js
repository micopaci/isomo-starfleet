#!/usr/bin/env node
/**
 * Direct Starlink portal cloud sync worker.
 *
 * This worker is intentionally stateless with respect to login. It reads an
 * externally refreshed auth_state.json or header payload, then polls Starlink's
 * cloud APIs and writes authoritative terminal status + daily usage history.
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env.portal') });

const cron = require('node-cron');
const pool = require('../db');
const {
  StarlinkPortalAuthExpiredError,
  loadPortalAuthHeaders,
} = require('../services/starlinkPortalAuth');
const {
  StarlinkPortalClient,
  parseTerminalStatus,
  parseUsageHistory,
} = require('../services/starlinkPortalCloudSync');

const args = new Set(process.argv.slice(2));

function showHelp() {
  console.log(`
Usage:
  npm run starlink:portal:cloud-sync --workspace=packages/backend -- --daemon
  npm run starlink:portal:cloud-sync --workspace=packages/backend -- --status-once
  npm run starlink:portal:cloud-sync --workspace=packages/backend -- --usage-once
  npm run starlink:portal:cloud-sync --workspace=packages/backend -- --seed-only

Required auth input, choose one:
  STARLINK_PORTAL_AUTH_STATE_FILE=/srv/starfleet/starlink-auth-state.json
  STARLINK_PORTAL_AUTH_HEADERS_FILE=/srv/starfleet/starlink-auth-headers.json
  STARLINK_PORTAL_AUTH_HEADERS_JSON='{"Cookie":"..."}'
  STARLINK_PORTAL_COOKIE='...'
  STARLINK_PORTAL_AUTHORIZATION='Bearer ...'

Required terminal inventory, choose one for first seed:
  STARLINK_TERMINALS_FILE=/srv/starfleet/starlink-terminals.json
  STARLINK_TERMINALS_JSON='[{"service_line_id":"AST-...","account_id":"ACC-...","nickname":"GS Example","site_id":41}]'
  Existing data_usage/auth/fleet_map.json is accepted directly.

Daemon schedule:
  STARLINK_STATUS_INTERVAL_MINUTES=5
  STARLINK_USAGE_CRON=0 0 * * *        (daily usage sync, default midnight)
  STARLINK_USAGE_TZ=Africa/Kigali

Optional:
  STARLINK_WEBAGG_BASE_URL=https://starlink.com/api/webagg/v2
  STARLINK_TELEMETRYAGG_BASE_URL=https://starlink.com/api/telemetryagg/v1
  STARLINK_CLOUD_SYNC_DRY_RUN=true
`);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), 'utf8'));
}

function argValue(name) {
  const prefix = `${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

function asPositiveInteger(value, fallback) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function loadTerminalInventoryFromEnv() {
  const raw = process.env.STARLINK_TERMINALS_JSON
    ? JSON.parse(process.env.STARLINK_TERMINALS_JSON)
    : process.env.STARLINK_TERMINALS_FILE
      ? readJsonFile(process.env.STARLINK_TERMINALS_FILE)
      : null;
  if (!raw) return [];
  const entries = normalizeTerminalInventory(raw);
  if (!Array.isArray(entries)) {
    throw new Error('Starlink terminal inventory must be an array or { terminals: [...] }');
  }
  return entries.map(entry => ({
    service_line_id: String(entry.service_line_id || entry.serviceLineId || entry.service_line || '').trim(),
    account_id: String(entry.account_id || entry.accountId || '').trim(),
    nickname: entry.nickname || entry.name || null,
    site_id: entry.site_id == null || entry.site_id === ''
      ? null
      : Number(entry.site_id),
    billing_cycle_start: entry.billing_cycle_start || entry.billingCycleStart || null,
  })).filter(entry => entry.service_line_id && entry.account_id);
}

function normalizeTerminalInventory(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.terminals)) return raw.terminals;

  // data_usage/auth/fleet_map.json shape:
  // { "Account name": { account_id: "ACC-...", terminals: [{ service_line, nickname }] } }
  if (raw && typeof raw === 'object') {
    const terminals = [];
    for (const [account_name, account] of Object.entries(raw)) {
      if (!account || typeof account !== 'object' || !Array.isArray(account.terminals)) continue;
      for (const terminal of account.terminals) {
        terminals.push({
          ...terminal,
          account_name,
          account_id: account.account_id || account.accountId,
        });
      }
    }
    return terminals;
  }
  return null;
}

function normalizeNameForMatch(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function nameAliasesForMatch(value) {
  const raw = String(value || '').trim().toLowerCase();
  const aliases = new Set([normalizeNameForMatch(raw)]);
  if (raw.startsWith('es ')) aliases.add(normalizeNameForMatch(raw.replace(/^es\s+/, 'ecole des sciences ')));
  if (raw.startsWith('gs ')) aliases.add(normalizeNameForMatch(raw.replace(/^gs\s+/, 'groupe scolaire ')));
  return [...aliases].filter(Boolean);
}

function namesLikelyMatch(left, right) {
  const leftAliases = nameAliasesForMatch(left);
  const rightAliases = nameAliasesForMatch(right);
  for (const l of leftAliases) {
    for (const r of rightAliases) {
      if (l === r) return true;
      if (l.length > 5 && r.includes(l)) return true;
      if (r.length > 5 && l.includes(r)) return true;
    }
  }
  return false;
}

async function resolveSiteId(client, terminal) {
  if (terminal.site_id != null) return terminal.site_id;
  if (!terminal.nickname) return null;
  const { rows } = await client.query(
    `SELECT id, name
     FROM sites
     ORDER BY id`,
  );
  const match = rows.find(site => namesLikelyMatch(terminal.nickname, site.name));
  return match?.id || null;
}

async function seedConfiguredTerminals(client, inventory) {
  let seeded = 0;
  for (const terminal of inventory) {
    if (terminal.site_id != null && !Number.isInteger(terminal.site_id)) {
      console.warn(`[StarlinkCloudSync] Skipping ${terminal.service_line_id}: invalid site_id`);
      continue;
    }
    const siteId = await resolveSiteId(client, terminal);
    await client.query(
      `INSERT INTO starlink_terminals
         (service_line_id, account_id, nickname, site_id, billing_cycle_start)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (service_line_id)
       DO UPDATE SET
         account_id = EXCLUDED.account_id,
         nickname = COALESCE(EXCLUDED.nickname, starlink_terminals.nickname),
         site_id = COALESCE(EXCLUDED.site_id, starlink_terminals.site_id),
         billing_cycle_start = COALESCE(EXCLUDED.billing_cycle_start, starlink_terminals.billing_cycle_start),
         updated_at = NOW()`,
      [
        terminal.service_line_id,
        terminal.account_id,
        terminal.nickname,
        siteId,
        terminal.billing_cycle_start,
      ],
    );
    seeded += 1;
  }
  return seeded;
}

async function loadTerminals(client) {
  const { rows } = await client.query(
    `SELECT service_line_id, account_id, nickname, site_id, billing_cycle_start::text AS billing_cycle_start
     FROM starlink_terminals
     ORDER BY COALESCE(site_id, 999999), nickname NULLS LAST, service_line_id`,
  );
  return rows;
}

async function ensureTerminalInventory(client) {
  const inventory = loadTerminalInventoryFromEnv();
  const seeded = inventory.length ? await seedConfiguredTerminals(client, inventory) : 0;
  const terminals = await loadTerminals(client);
  if (!terminals.length) {
    throw new Error('No Starlink terminals configured. Seed starlink_terminals with STARLINK_TERMINALS_FILE or STARLINK_TERMINALS_JSON.');
  }
  return { seeded, terminals };
}

async function recordAuthExpiredAlert(client, err, context = {}) {
  const status = err.status || null;
  const metadata = {
    ...context,
    ...(err.context || {}),
    status,
    recorded_at: new Date().toISOString(),
  };
  await client.query(
    `INSERT INTO alert_events
       (active_key, source_type, source_id, severity, category, title, message, metadata)
     VALUES ($1, 'starlink_portal', 'auth', 'critical', 'auth', $2, $3, $4::jsonb)
     ON CONFLICT (active_key)
     DO UPDATE SET
       severity = EXCLUDED.severity,
       category = EXCLUDED.category,
       title = EXCLUDED.title,
       message = EXCLUDED.message,
       last_seen_at = NOW(),
       status = 'open',
       acknowledged_at = NULL,
       acknowledged_by = NULL,
       resolved_at = NULL,
       metadata = EXCLUDED.metadata`,
    [
      'starlink-portal-auth:expired',
      'Starlink portal session expired',
      `Starlink cloud sync received HTTP ${status || 'auth'} from the portal API. Refresh the external auth_state.json or header payload before the next polling run.`,
      JSON.stringify(metadata),
    ],
  );
}

async function upsertTerminalStatus(client, terminal, status) {
  await client.query(
    `UPDATE starlink_terminals
     SET current_status = $2,
         last_seen_utc = COALESCE($3::timestamptz, last_seen_utc),
         nickname = COALESCE($4, nickname),
         raw_terminal = $5::jsonb,
         status_updated_at = NOW(),
         updated_at = NOW()
     WHERE service_line_id = $1`,
    [
      terminal.service_line_id,
      status.current_status,
      status.last_seen_utc,
      status.nickname,
      JSON.stringify(status.raw_terminal || {}),
    ],
  );
}

async function insertPingSample(client, terminal, status) {
  await client.query(
    `INSERT INTO starlink_ping_samples
       (recorded_at, service_line_id, site_id, current_status, is_offline,
        ping_latency_ms, ping_drop_pct, last_seen_utc, raw_terminal)
     VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7::timestamptz, $8::jsonb)`,
    [
      terminal.service_line_id,
      terminal.site_id || null,
      status.current_status,
      status.is_offline,
      status.ping_latency_ms,
      status.ping_drop_pct,
      status.last_seen_utc,
      JSON.stringify(status.raw_terminal || {}),
    ],
  );
}

async function syncOfflineAlerts(client) {
  const { rows } = await client.query(
    `SELECT service_line_id, site_id, nickname, current_status, last_seen_utc, status_updated_at,
            EXTRACT(EPOCH FROM (NOW() - COALESCE(last_seen_utc, status_updated_at))) / 3600.0 AS offline_hours
     FROM starlink_terminals
     WHERE current_status = 'Offline'
       AND COALESCE(last_seen_utc, status_updated_at) <= NOW() - INTERVAL '16 hours'`
  );
  const activeKeys = [];
  for (const row of rows) {
    const activeKey = `starlink:${row.service_line_id}:offline-16h`;
    activeKeys.push(activeKey);
    const label = row.nickname || row.service_line_id;
    const offlineHours = row.offline_hours == null ? null : Math.round(Number(row.offline_hours) * 10) / 10;
    await client.query(
      `INSERT INTO alert_events
         (active_key, source_type, source_id, site_id, severity, category, title, message, metadata)
       VALUES ($1, 'starlink_portal', $2, $3, 'critical', 'connectivity', $4, $5, $6::jsonb)
       ON CONFLICT (active_key)
       DO UPDATE SET
         source_type = EXCLUDED.source_type,
         source_id = EXCLUDED.source_id,
         site_id = EXCLUDED.site_id,
         severity = EXCLUDED.severity,
         category = EXCLUDED.category,
         title = EXCLUDED.title,
         message = EXCLUDED.message,
         last_seen_at = NOW(),
         status = CASE WHEN alert_events.status = 'resolved' THEN 'open' ELSE alert_events.status END,
         resolved_at = CASE WHEN alert_events.status = 'resolved' THEN NULL ELSE alert_events.resolved_at END,
         metadata = EXCLUDED.metadata`,
      [
        activeKey,
        row.service_line_id,
        row.site_id || null,
        'Starlink offline for 16+ hours',
        `${label} has been offline in Starlink cloud telemetry for ${offlineHours ?? 'more than 16'} hours.`,
        JSON.stringify({
          service_line_id: row.service_line_id,
          nickname: row.nickname,
          current_status: row.current_status,
          last_seen_utc: row.last_seen_utc,
          status_updated_at: row.status_updated_at,
          offline_hours: offlineHours,
          threshold_hours: 16,
        }),
      ],
    );
  }

  if (activeKeys.length) {
    await client.query(
      `UPDATE alert_events
       SET status = 'resolved', resolved_at = NOW()
       WHERE source_type = 'starlink_portal'
         AND category = 'connectivity'
         AND active_key LIKE 'starlink:%:offline-16h'
         AND status = 'open'
         AND active_key <> ALL($1::text[])`,
      [activeKeys],
    );
  } else {
    await client.query(
      `UPDATE alert_events
       SET status = 'resolved', resolved_at = NOW()
       WHERE source_type = 'starlink_portal'
         AND category = 'connectivity'
         AND active_key LIKE 'starlink:%:offline-16h'
         AND status = 'open'`
    );
  }

  return { active_offline_alerts: activeKeys.length };
}

async function upsertUsageHistory(client, terminal, parsed) {
  for (const row of parsed.history) {
    await client.query(
      `INSERT INTO starlink_usage_history
         (log_date, service_line_id, consumed_gb, account_id, billing_cycle_start, collected_at, metadata)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6::jsonb)
       ON CONFLICT (log_date, service_line_id)
       DO UPDATE SET
         consumed_gb = EXCLUDED.consumed_gb,
         account_id = EXCLUDED.account_id,
         billing_cycle_start = EXCLUDED.billing_cycle_start,
         collected_at = NOW(),
         metadata = EXCLUDED.metadata`,
      [
        row.log_date,
        terminal.service_line_id,
        row.consumed_gb,
        terminal.account_id,
        row.billing_cycle_start,
        JSON.stringify(row.metadata || {}),
      ],
    );
  }

  if (parsed.active_billing_cycle_start) {
    await client.query(
      `UPDATE starlink_terminals
       SET billing_cycle_start = $2,
           updated_at = NOW()
       WHERE service_line_id = $1`,
      [terminal.service_line_id, parsed.active_billing_cycle_start],
    );
  }
}

function createPortalClient() {
  const headers = loadPortalAuthHeaders();
  return new StarlinkPortalClient({
    headers,
    webaggBaseUrl: process.env.STARLINK_WEBAGG_BASE_URL,
    telemetryaggBaseUrl: process.env.STARLINK_TELEMETRYAGG_BASE_URL,
  });
}

async function runStatusCycle({ dryRun = false } = {}) {
  const client = await pool.connect();
  const portal = createPortalClient();
  let updated = 0;
  try {
    const { seeded, terminals } = await ensureTerminalInventory(client);
    for (const terminal of terminals) {
      const payload = await portal.getTerminalStatus(terminal.service_line_id);
      const status = parseTerminalStatus(payload);
      if (!dryRun) {
        await upsertTerminalStatus(client, terminal, status);
        await insertPingSample(client, terminal, status);
      }
      updated += 1;
      console.log(`[StarlinkCloudSync] ${terminal.service_line_id} status=${status.current_status} ping=${status.ping_latency_ms ?? 'unknown'}ms last_seen=${status.last_seen_utc || 'unknown'}`);
    }
    const alerts = dryRun ? { active_offline_alerts: 0 } : await syncOfflineAlerts(client);
    return { ok: true, seeded, terminals: terminals.length, updated, ...alerts };
  } catch (err) {
    if (err instanceof StarlinkPortalAuthExpiredError) {
      await recordAuthExpiredAlert(client, err, { loop: 'status' }).catch(alertErr => {
        console.error(`[StarlinkCloudSync] Failed to record auth alert: ${alertErr.message}`);
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

async function runUsageCycle({ dryRun = false } = {}) {
  const client = await pool.connect();
  const portal = createPortalClient();
  let records = 0;
  let terminalsSeen = 0;
  try {
    const { seeded, terminals } = await ensureTerminalInventory(client);
    for (const terminal of terminals) {
      const payload = await portal.getDataUsage(terminal.account_id, terminal.service_line_id);
      const parsed = parseUsageHistory(payload);
      if (!dryRun) await upsertUsageHistory(client, terminal, parsed);
      records += parsed.history.length;
      terminalsSeen += 1;
      console.log(`[StarlinkCloudSync] ${terminal.service_line_id} usage_records=${parsed.history.length} billing_cycle_start=${parsed.active_billing_cycle_start || 'unknown'}`);
    }
    return { ok: true, seeded, terminals: terminalsSeen, records };
  } catch (err) {
    if (err instanceof StarlinkPortalAuthExpiredError) {
      await recordAuthExpiredAlert(client, err, { loop: 'usage' }).catch(alertErr => {
        console.error(`[StarlinkCloudSync] Failed to record auth alert: ${alertErr.message}`);
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

async function runSeedOnly() {
  const client = await pool.connect();
  try {
    const inventory = loadTerminalInventoryFromEnv();
    if (!inventory.length) throw new Error('No terminal inventory provided.');
    const seeded = await seedConfiguredTerminals(client, inventory);
    return { ok: true, seeded };
  } finally {
    client.release();
  }
}

async function runDaemon() {
  const dryRun = process.env.STARLINK_CLOUD_SYNC_DRY_RUN === 'true';
  const intervalMinutes = asPositiveInteger(
    argValue('--status-interval-minutes') || process.env.STARLINK_STATUS_INTERVAL_MINUTES,
    5,
  );
  const usageCron = argValue('--usage-cron') || process.env.STARLINK_USAGE_CRON || '0 0 * * *';
  const usageTz = process.env.STARLINK_USAGE_TZ || 'Africa/Kigali';
  if (!cron.validate(usageCron)) {
    throw new Error(`Invalid STARLINK_USAGE_CRON expression: ${usageCron}`);
  }
  let statusRunning = false;
  let usageRunning = false;

  async function guardedStatus() {
    if (statusRunning) return;
    statusRunning = true;
    try {
      const result = await runStatusCycle({ dryRun });
      console.log(`[StarlinkCloudSync] status cycle complete: ${JSON.stringify(result)}`);
    } catch (err) {
      console.error(`[StarlinkCloudSync] status cycle failed: ${err.message}`);
    } finally {
      statusRunning = false;
    }
  }

  async function guardedUsage() {
    if (usageRunning) return;
    usageRunning = true;
    try {
      const result = await runUsageCycle({ dryRun });
      console.log(`[StarlinkCloudSync] usage cycle complete: ${JSON.stringify(result)}`);
    } catch (err) {
      console.error(`[StarlinkCloudSync] usage cycle failed: ${err.message}`);
    } finally {
      usageRunning = false;
    }
  }

  console.log(`[StarlinkCloudSync] daemon started. status_interval=${intervalMinutes}m usage_cron="${usageCron}" usage_tz=${usageTz} dry_run=${dryRun}`);
  await guardedStatus();
  setInterval(guardedStatus, intervalMinutes * 60 * 1000);
  cron.schedule(usageCron, guardedUsage, { timezone: usageTz });

  process.on('SIGINT', async () => {
    console.log('[StarlinkCloudSync] SIGINT received, shutting down.');
    await pool.end();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    console.log('[StarlinkCloudSync] SIGTERM received, shutting down.');
    await pool.end();
    process.exit(0);
  });
}

async function main() {
  if (args.has('--help') || args.has('-h')) {
    showHelp();
    return;
  }

  const dryRun = args.has('--dry-run') || process.env.STARLINK_CLOUD_SYNC_DRY_RUN === 'true';
  let result = null;

  if (args.has('--daemon')) {
    await runDaemon();
    return;
  }
  if (args.has('--seed-only')) {
    result = await runSeedOnly();
  } else if (args.has('--status-once')) {
    result = await runStatusCycle({ dryRun });
  } else if (args.has('--usage-once')) {
    result = await runUsageCycle({ dryRun });
  } else if (args.has('--once')) {
    const status = await runStatusCycle({ dryRun });
    const usage = await runUsageCycle({ dryRun });
    result = { ok: true, status, usage };
  } else {
    showHelp();
    return;
  }

  console.log(JSON.stringify(result, null, 2));
  await pool.end();
}

main().catch(async err => {
  console.error(`Starlink cloud sync worker failed: ${err.message}`);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
