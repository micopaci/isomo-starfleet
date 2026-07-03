/**
 * defenderTvm.js — Microsoft Defender for Endpoint TVM (Threat & Vulnerability
 * Management) sync.
 *
 * Pulls every CVE Defender reports for every product on every managed machine,
 * correlates Defender machines back to `devices`, upserts the vulnerability
 * catalog + per-device exposure, raises/resolves one fleet-wide `alert_events`
 * row per CVE (source_type='defender_tvm'), and fires a batched notification for
 * newly-discovered vulnerabilities.
 *
 * Auth reuses the same GRAPH_* app registration as services/graph.js, but the
 * token audience is the Defender for Endpoint API, not Microsoft Graph:
 *   scope = https://api.securitycenter.microsoft.com/.default
 * The app registration needs WindowsDefenderATP application permissions
 * Machine.Read.All + Vulnerability.Read.All with admin consent granted.
 *
 * Config (all optional; sync no-ops cleanly if creds/consent are missing):
 *   DEFENDER_TVM_SYNC_ENABLED       'false' to disable (default enabled)
 *   DEFENDER_TVM_SYNC_INTERVAL_MIN  minutes between syncs (default 360, min 30)
 *   DEFENDER_API_BASE_URL           geo override (api-eu/api-us) if global 403s
 *   SECURITY_NOTIFY_ENABLED         'false' to disable email/push (default on)
 *
 * Every external failure is logged (structured JSON) and swallowed — the sync
 * never crashes the process.
 */
const pool = require('../db');
const { fetchJson, requestWithRetry } = require('./graph');
const notifier = require('./notifier');
const aiMitigation = require('./aiMitigation');

const DEFENDER_BASE =
  (process.env.DEFENDER_API_BASE_URL || 'https://api.securitycenter.microsoft.com').replace(/\/+$/, '');

let defenderTokenCache = null; // { accessToken, expiresAt }

function logJson(level, event, payload = {}) {
  const line = { timestamp: new Date().toISOString(), level, agent: 'defender-tvm', event, payload };
  const write = level === 'ERROR' || level === 'FATAL' ? console.error : console.log;
  write(JSON.stringify(line));
}

// ── Auth ─────────────────────────────────────────────────────────────────────
async function getDefenderToken() {
  const now = Date.now();
  if (defenderTokenCache && defenderTokenCache.expiresAt > now + 5 * 60 * 1000) {
    return defenderTokenCache.accessToken;
  }

  const tenantId     = process.env.GRAPH_TENANT_ID;
  const clientId     = process.env.GRAPH_CLIENT_ID;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET must be set for Defender TVM sync');
  }

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
    scope:         `${DEFENDER_BASE}/.default`,
  }).toString();

  const result = await fetchJson(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    body
  );

  if (result.status !== 200) {
    throw new Error(`Defender auth failed (HTTP ${result.status}): ${JSON.stringify(result.body)}`);
  }

  defenderTokenCache = {
    accessToken: result.body.access_token,
    expiresAt:   now + result.body.expires_in * 1000,
  };
  return defenderTokenCache.accessToken;
}

async function defenderGet(path) {
  const token = await getDefenderToken();
  const rows = [];
  let url = path.startsWith('http') ? path : `${DEFENDER_BASE}${path}`;
  while (url) {
    const result = await requestWithRetry(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!result || result.status < 200 || result.status >= 300) {
      throw new Error(`Defender GET ${url} failed: HTTP ${result?.status || 'unknown'} ${JSON.stringify(result?.body || {})}`);
    }
    rows.push(...(result.body?.value || []));
    url = result.body?.['@odata.nextLink'] || null;
  }
  return rows;
}

// ── Fetch ────────────────────────────────────────────────────────────────────
async function listMachines() {
  return defenderGet('/api/machines');
}

async function listMachineVulnerabilities() {
  return defenderGet('/api/vulnerabilities/machinesVulnerabilities');
}

async function getVulnerabilityDetails(cveId) {
  const token = await getDefenderToken();
  const result = await requestWithRetry(
    `${DEFENDER_BASE}/api/vulnerabilities/${encodeURIComponent(cveId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!result || result.status < 200 || result.status >= 300) {
    throw new Error(`Defender vulnerability detail ${cveId} failed: HTTP ${result?.status || 'unknown'}`);
  }
  return result.body;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function isZeroDayId(id) {
  return !/^CVE-/i.test(id);
}

function severityRank(sev) {
  switch (String(sev || '').toLowerCase()) {
    case 'critical': return 4;
    case 'high':     return 3;
    case 'medium':   return 2;
    case 'low':      return 1;
    default:         return 0;
  }
}

// The full TVM feed is large (thousands of CVEs fleet-wide). Alert rows are
// created only at/above this severity so the Alerts page stays usable; the
// Security page still lists every vulnerability. Zero-days always alert.
// Values: critical | high | medium | low | all.
function alertMinRank() {
  const raw = String(process.env.SECURITY_ALERT_MIN_SEVERITY || 'high').toLowerCase();
  if (raw === 'all') return 0;
  const rank = severityRank(raw);
  return rank === 0 ? 3 : rank;
}

function shouldAlert(cat) {
  return isZeroDayId(cat.id) || severityRank(cat.severity) >= alertMinRank();
}

// Compare two dotted version strings ("120.0.6099.71"). Returns >0 if a>b.
function compareVersion(a, b) {
  if (!a) return b ? -1 : 0;
  if (!b) return 1;
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function alertSeverity(severity, isZeroDay) {
  if (isZeroDay || /critical/i.test(severity)) return 'critical';
  if (/high/i.test(severity)) return 'warning';
  return 'info';
}

function hasFixFor(cat) {
  // Third-party fixes (Chrome) carry a fixed product version rather than a KB;
  // a non-zero-day CVE reported by Defender is assumed to have an available fix.
  return Boolean(cat.fixing_kb_id) || !isZeroDayId(cat.id);
}

// Local copy of the alert_events upsert shape used by routes/api.js:upsertAlert.
// Kept here (rather than importing the route module) to avoid coupling the sync
// service to the HTTP layer.
async function upsertAlert(client, alert) {
  await client.query(
    `INSERT INTO alert_events
       (active_key, source_type, source_id, site_id, device_id, severity, category, title, message, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     ON CONFLICT (active_key) DO UPDATE SET
       source_type = EXCLUDED.source_type,
       source_id = EXCLUDED.source_id,
       site_id = EXCLUDED.site_id,
       device_id = EXCLUDED.device_id,
       severity = EXCLUDED.severity,
       category = EXCLUDED.category,
       title = EXCLUDED.title,
       message = EXCLUDED.message,
       last_seen_at = NOW(),
       status = CASE WHEN alert_events.status = 'resolved' THEN 'open' ELSE alert_events.status END,
       resolved_at = CASE WHEN alert_events.status = 'resolved' THEN NULL ELSE alert_events.resolved_at END,
       metadata = EXCLUDED.metadata`,
    [
      alert.active_key,
      alert.source_type,
      alert.source_id ?? null,
      alert.site_id ?? null,
      alert.device_id ?? null,
      alert.severity,
      alert.category,
      alert.title,
      alert.message,
      JSON.stringify(alert.metadata || {}),
    ]
  );
}

// ── Correlation ──────────────────────────────────────────────────────────────
// Map Defender machine id → devices.id. Match on azure_ad_device_id (Defender's
// aadDeviceId), falling back to hostname vs the leading label of computerDnsName.
// Read-only: returns the machine→device map plus a `persist` list the caller
// writes inside its transaction (devices.defender_machine_id).
async function correlateMachines(machines) {
  const { rows } = await pool.query(
    `SELECT id, LOWER(azure_ad_device_id) AS aad, LOWER(hostname) AS host FROM devices`
  );
  const byAad = new Map();
  const byHost = new Map();
  for (const r of rows) {
    if (r.aad) byAad.set(r.aad, r.id);
    if (r.host) byHost.set(r.host, r.id);
  }

  const machineToDevice = new Map();
  const persist = [];
  let unmatched = 0;
  for (const m of machines) {
    const aad = (m.aadDeviceId || '').toLowerCase();
    const host = String(m.computerDnsName || '').split('.')[0].toLowerCase();
    let deviceId = (aad && byAad.get(aad)) || (host && byHost.get(host)) || null;
    if (deviceId == null) { unmatched += 1; continue; }
    // Multiple Defender machine records can resolve to one device (offboarded
    // duplicates); the partial unique index on defender_machine_id is per
    // machine id, so persisting each mapping is safe — last write wins.
    machineToDevice.set(m.id, deviceId);
    persist.push([m.id, deviceId]);
  }

  if (unmatched) {
    logJson('WARN', 'machines_unmatched', { unmatched, total: machines.length });
  }
  return { machineToDevice, unmatched, persist };
}

// ── Alerts ───────────────────────────────────────────────────────────────────
async function syncSecurityAlerts(client, catalog) {
  const activeKeys = [];
  for (const cat of catalog.values()) {
    if (cat.exposed.size === 0) continue;
    if (!shouldAlert(cat)) continue; // below SECURITY_ALERT_MIN_SEVERITY — dashboard-only
    const zeroDay = isZeroDayId(cat.id);
    const hasFix = hasFixFor(cat);
    const active_key = `vuln:${cat.id}`;
    activeKeys.push(active_key);
    const label = zeroDay ? 'Zero-day' : `${cat.severity} severity`;
    await upsertAlert(client, {
      active_key,
      source_type: 'defender_tvm',
      source_id: cat.id,
      site_id: null,
      device_id: null,
      severity: alertSeverity(cat.severity, zeroDay),
      category: 'security',
      title: `${label}: ${cat.id}`,
      message: `${cat.name || cat.product_name || cat.id} — ${cat.exposed.size} exposed device(s)${hasFix ? '' : ' — no patch available'}`,
      metadata: {
        exposed_count: cat.exposed.size,
        cvss_v3: cat.cvss_v3 ?? null,
        product_name: cat.product_name ?? null,
        fixing_kb_id: cat.fixing_kb_id ?? null,
        is_zero_day: zeroDay,
        has_fix: hasFix,
      },
    });
  }

  // Resolve any open TVM alert whose CVE is no longer reported (or dropped
  // below the alert threshold). Passing an empty array resolves all open
  // defender_tvm alerts (x <> ALL('{}') is TRUE).
  await client.query(
    `UPDATE alert_events
     SET status = 'resolved', resolved_at = NOW()
     WHERE source_type = 'defender_tvm'
       AND status = 'open'
       AND active_key <> ALL($1::TEXT[])`,
    [activeKeys]
  );
  return activeKeys.length;
}

// ── Notifications ────────────────────────────────────────────────────────────
async function notifySecurityFindings(newVulns) {
  if (process.env.SECURITY_NOTIFY_ENABLED === 'false') return;
  if (!newVulns.length) return;

  const dashUrl = process.env.DASHBOARD_URL || 'https://starfleet.icircles.rw';
  const sorted = [...newVulns].sort((a, b) =>
    (Number(b.is_zero_day) - Number(a.is_zero_day)) ||
    (severityRank(b.severity) - severityRank(a.severity)) ||
    (b.exposed_count - a.exposed_count));
  const critical = sorted.filter(v => v.is_zero_day || /critical/i.test(v.severity));

  // The full feed can surface thousands of findings at once (especially the
  // first sync). Itemize the worst MAX_LISTED; summarize the rest by severity.
  const MAX_LISTED = 50;
  const listed = sorted.slice(0, MAX_LISTED);
  const rest = sorted.slice(MAX_LISTED);
  const restBySev = {};
  for (const v of rest) {
    const key = v.is_zero_day ? 'zero-day' : String(v.severity || 'unknown').toLowerCase();
    restBySev[key] = (restBySev[key] || 0) + 1;
  }
  const restSummary = rest.length
    ? `… and ${rest.length} more (${Object.entries(restBySev).map(([k, n]) => `${n} ${k}`).join(', ')}) — full list on the dashboard.`
    : '';

  const rowsText = listed.map(v =>
    `- [${v.is_zero_day ? 'ZERO-DAY' : v.severity}] ${v.id} — ${v.name || v.product_name || 'unknown product'}` +
    ` (CVSS ${v.cvss_v3 ?? '—'}, ${v.exposed_count} device(s)${v.has_fix ? '' : ', no patch'})`
  ).join('\n');

  const rowsHtml = listed.map(v => `
    <tr>
      <td style="padding:4px 10px 4px 0;"><strong>${v.is_zero_day ? 'ZERO-DAY' : v.severity}</strong></td>
      <td style="padding:4px 10px 4px 0;">${v.id}</td>
      <td style="padding:4px 10px 4px 0;">${v.name || v.product_name || '—'}</td>
      <td style="padding:4px 10px 4px 0;">CVSS ${v.cvss_v3 ?? '—'}</td>
      <td style="padding:4px 10px 4px 0;">${v.exposed_count} device(s)</td>
      <td style="padding:4px 10px 4px 0;">${v.has_fix ? 'fix available' : 'no patch'}</td>
    </tr>`).join('');

  const subject = `[Starfleet] ${sorted.length} new vulnerabilit${sorted.length === 1 ? 'y' : 'ies'} detected` +
    (critical.length ? ` (${critical.length} critical)` : '');
  const html = `
    <h3>New vulnerabilities from Defender for Endpoint</h3>
    <p>Starfleet's TVM sync discovered ${sorted.length} new vulnerabilit${sorted.length === 1 ? 'y' : 'ies'} across the managed fleet.</p>
    <table style="border-collapse:collapse;font-family:monospace;font-size:13px;">${rowsHtml}</table>
    ${rest.length ? `<p style="font-size:13px;">${restSummary}</p>` : ''}
    <p style="font-size:12px;color:#64748b;">Review and remediate in the <a href="${dashUrl}/security">Security dashboard</a>.</p>`;

  const results = await Promise.allSettled([
    notifier.sendEmail({ subject, text: `${sorted.length} new vulnerabilities detected:\n\n${rowsText}\n${restSummary}\n\n${dashUrl}/security`, html }),
    critical.length
      ? notifier.sendPush({
          title: `${critical.length} critical vulnerabilit${critical.length === 1 ? 'y' : 'ies'}`,
          body: critical.slice(0, 3).map(v => `${v.id} (${v.exposed_count} devices)`).join(', '),
          data: { type: 'security_vulnerability', count: String(critical.length) },
        })
      : Promise.resolve(),
  ]);
  for (const r of results) {
    if (r.status === 'rejected') logJson('WARN', 'notify_channel_failed', { error: r.reason?.message || String(r.reason) });
  }
  logJson('INFO', 'notified_new_vulnerabilities', { total: sorted.length, critical: critical.length });
}

// ── Enrichment ───────────────────────────────────────────────────────────────
// Fill name / description / cvss / published for CVEs that lack it. Sequential
// with a short delay + per-run cap to stay under the MDE ~30 calls/min limit.
async function enrichVulnerabilityDetails(cap = 25) {
  // Severity-first: with thousands of CVEs in the feed, the per-run budget must
  // go to zero-days and criticals before the long tail ever gets details.
  const { rows } = await pool.query(
    `SELECT id FROM vulnerabilities
     WHERE name IS NULL OR cvss_v3 IS NULL
     ORDER BY is_zero_day DESC,
              CASE lower(severity) WHEN 'critical' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC,
              last_synced_at DESC
     LIMIT $1`,
    [cap]
  );
  let enriched = 0;
  for (const { id } of rows) {
    try {
      const d = await getVulnerabilityDetails(id);
      await pool.query(
        `UPDATE vulnerabilities SET
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           cvss_v3 = COALESCE($4, cvss_v3),
           public_exploit = COALESCE($5, public_exploit),
           published_at = COALESCE($6, published_at),
           source_updated_at = COALESCE($7, source_updated_at)
         WHERE id = $1`,
        [
          id,
          d?.name ?? null,
          d?.description ?? null,
          d?.cvssV3 ?? null,
          typeof d?.publicExploit === 'boolean' ? d.publicExploit : null,
          d?.publishedOn ?? null,
          d?.updatedOn ?? null,
        ]
      );
      enriched += 1;
    } catch (err) {
      logJson('WARN', 'enrich_failed', { id, error: err.message });
    }
    await new Promise(r => setTimeout(r, 250));
  }
  if (enriched) logJson('INFO', 'enriched_vulnerabilities', { enriched });
  return enriched;
}

// ── Orchestrator ─────────────────────────────────────────────────────────────
async function syncVulnerabilities() {
  // Fetch outside the transaction (network-bound, potentially slow). The real
  // fleet feed is large: ~400 machines, ~230K machine-vulnerability pairs,
  // ~5-6K distinct CVEs.
  const machines = await listMachines();
  const vulnRows = await listMachineVulnerabilities();
  const syncStart = new Date(); // strictly before the txn's NOW(); drives the stale sweep

  // Correlate (read-only) and aggregate BEFORE the transaction so locks are
  // held only for the write phase, then release the raw row array.
  const { machineToDevice, unmatched, persist } = await correlateMachines(machines);

  const catalog = new Map();       // cveId -> { id, severity, name, cvss_v3, product_name, fixing_kb_id, exposed:Set }
  const deviceVulnMap = new Map(); // `${deviceId}::${cveId}` -> row (keep max product_version)
  let skippedRows = 0;

  for (const row of vulnRows) {
    const cveId = row.cveId || row.id;
    if (!cveId) continue;

    let cat = catalog.get(cveId);
    if (!cat) {
      cat = { id: cveId, severity: row.severity || 'Medium', name: row.name || null, cvss_v3: row.cvssV3 ?? null, product_name: row.productName || null, fixing_kb_id: row.fixingKbId || null, exposed: new Set() };
      catalog.set(cveId, cat);
    } else {
      if (severityRank(row.severity) > severityRank(cat.severity)) cat.severity = row.severity;
      if (cat.cvss_v3 == null && row.cvssV3 != null) cat.cvss_v3 = row.cvssV3;
      if (!cat.product_name && row.productName) cat.product_name = row.productName;
      if (!cat.fixing_kb_id && row.fixingKbId) cat.fixing_kb_id = row.fixingKbId;
    }

    const deviceId = machineToDevice.get(row.machineId);
    if (deviceId == null) { skippedRows += 1; continue; }
    cat.exposed.add(deviceId);

    const key = `${deviceId}::${cveId}`;
    const cand = {
      device_id: deviceId,
      vulnerability_id: cveId,
      product_name: row.productName || null,
      product_vendor: row.productVendor || null,
      product_version: row.productVersion || null,
      fixing_kb_id: row.fixingKbId || null,
    };
    const existing = deviceVulnMap.get(key);
    if (!existing || compareVersion(cand.product_version, existing.product_version) > 0) {
      deviceVulnMap.set(key, cand);
    }
  }
  vulnRows.length = 0; // free ~230K raw rows before the write phase

  const client = await pool.connect();
  let summary;
  let newVulns = [];
  try {
    await client.query('BEGIN');
    await client.query(`SET lock_timeout = '5s'`);

    // Persist machine↔device correlation. Clear a stale claim first so a
    // machine remapping to a different device can't trip the partial unique
    // index on devices.defender_machine_id.
    for (const [machineId, deviceId] of persist) {
      await client.query(
        `UPDATE devices SET defender_machine_id = NULL WHERE defender_machine_id = $1 AND id <> $2`,
        [machineId, deviceId]
      );
      await client.query(
        `UPDATE devices SET defender_machine_id = $1, defender_synced_at = NOW() WHERE id = $2`,
        [machineId, deviceId]
      );
    }

    // Which CVEs are brand-new this sync (for notification)?
    const existingIdsRes = await client.query(`SELECT id FROM vulnerabilities`);
    const existingIds = new Set(existingIdsRes.rows.map(r => r.id));

    // Batch-upsert the catalog (multi-row VALUES; both maps are keyed uniquely,
    // so no tuple appears twice within one statement — required by ON CONFLICT).
    const CHUNK = 500;
    const cats = [...catalog.values()];
    for (let i = 0; i < cats.length; i += CHUNK) {
      const chunk = cats.slice(i, i + CHUNK);
      const params = [];
      const tuples = chunk.map((cat, j) => {
        const b = j * 5;
        params.push(cat.id, cat.name, cat.severity, cat.cvss_v3, isZeroDayId(cat.id));
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, NOW())`;
      });
      await client.query(
        `INSERT INTO vulnerabilities (id, name, severity, cvss_v3, is_zero_day, last_synced_at)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (id) DO UPDATE SET
           severity = EXCLUDED.severity,
           is_zero_day = EXCLUDED.is_zero_day,
           name = COALESCE(vulnerabilities.name, EXCLUDED.name),
           cvss_v3 = COALESCE(vulnerabilities.cvss_v3, EXCLUDED.cvss_v3),
           last_synced_at = NOW()`,
        params
      );
    }

    // Batch-upsert per-device exposure (keep highest product_version's fields).
    const dvs = [...deviceVulnMap.values()];
    for (let i = 0; i < dvs.length; i += CHUNK) {
      const chunk = dvs.slice(i, i + CHUNK);
      const params = [];
      const tuples = chunk.map((dv, j) => {
        const b = j * 6;
        params.push(dv.device_id, dv.vulnerability_id, dv.product_name, dv.product_vendor, dv.product_version, dv.fixing_kb_id);
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, 'active', NOW(), NOW())`;
      });
      await client.query(
        `INSERT INTO device_vulnerabilities
           (device_id, vulnerability_id, product_name, product_vendor, product_version, fixing_kb_id, status, first_seen_at, last_seen_at)
         VALUES ${tuples.join(', ')}
         ON CONFLICT (device_id, vulnerability_id) DO UPDATE SET
           product_name = EXCLUDED.product_name,
           product_vendor = EXCLUDED.product_vendor,
           product_version = EXCLUDED.product_version,
           fixing_kb_id = EXCLUDED.fixing_kb_id,
           status = 'active',
           resolved_at = NULL,
           last_seen_at = NOW()`,
        params
      );
    }

    // Anything active but not re-seen this sync is resolved.
    const swept = await client.query(
      `UPDATE device_vulnerabilities SET status = 'resolved', resolved_at = NOW()
       WHERE status = 'active' AND last_seen_at < $1`,
      [syncStart]
    );

    const alerted = await syncSecurityAlerts(client, catalog);
    await client.query('COMMIT');

    // Build the "new vulnerabilities" payload (exposed CVEs unseen before).
    newVulns = [...catalog.values()]
      .filter(cat => cat.exposed.size > 0 && !existingIds.has(cat.id))
      .map(cat => ({
        id: cat.id,
        name: cat.name,
        severity: cat.severity,
        cvss_v3: cat.cvss_v3,
        product_name: cat.product_name,
        exposed_count: cat.exposed.size,
        is_zero_day: isZeroDayId(cat.id),
        has_fix: hasFixFor(cat),
      }));

    summary = {
      machines: machines.length,
      unmatched_machines: unmatched,
      vulnerabilities: catalog.size,
      device_rows: deviceVulnMap.size,
      skipped_rows: skippedRows,
      resolved: swept.rowCount,
      alerts_open: alerted,
      new_vulnerabilities: newVulns.length,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    try { await client.query('RESET lock_timeout'); } catch { /* ignore */ }
    client.release();
  }

  logJson('INFO', 'sync_complete', summary);

  // Best-effort post-commit work — failures never affect the sync result.
  await notifySecurityFindings(newVulns).catch(err => logJson('WARN', 'notify_failed', { error: err.message }));
  await enrichVulnerabilityDetails().catch(err => logJson('WARN', 'enrich_batch_failed', { error: err.message }));
  await aiMitigation.generateMissingGuidance().catch(err => logJson('WARN', 'ai_guidance_failed', { error: err.message }));

  return summary;
}

// ── Scheduler ────────────────────────────────────────────────────────────────
function scheduleDefenderTvmSync() {
  if (process.env.DEFENDER_TVM_SYNC_ENABLED === 'false') {
    logJson('INFO', 'sync_disabled', { reason: 'DEFENDER_TVM_SYNC_ENABLED=false' });
    return;
  }
  if (!process.env.GRAPH_TENANT_ID || !process.env.GRAPH_CLIENT_ID || !process.env.GRAPH_CLIENT_SECRET) {
    logJson('INFO', 'sync_not_scheduled', { reason: 'graph credentials not configured' });
    return;
  }

  const intervalMin = Math.max(30, Number(process.env.DEFENDER_TVM_SYNC_INTERVAL_MIN || 360));
  const run = () => syncVulnerabilities().catch(err => logJson('ERROR', 'sync_failed', { error: err.message }));

  // First run 45s after boot — staggered behind the Intune device sync (15s) so
  // devices rows exist to correlate against.
  setTimeout(run, 45 * 1000);
  setInterval(run, intervalMin * 60 * 1000);
  logJson('INFO', 'sync_scheduled', { interval_min: intervalMin });
}

module.exports = {
  getDefenderToken,
  listMachines,
  listMachineVulnerabilities,
  getVulnerabilityDetails,
  correlateMachines,
  syncVulnerabilities,
  syncSecurityAlerts,
  notifySecurityFindings,
  enrichVulnerabilityDetails,
  scheduleDefenderTvmSync,
};
