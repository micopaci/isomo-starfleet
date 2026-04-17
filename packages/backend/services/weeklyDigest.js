/**
 * Weekly Email Digest — Stage 5
 *
 * Sends a per-site signal summary every Monday at 08:00 (Africa/Kigali, UTC+2).
 * Cron fires at 06:00 UTC = 08:00 Kigali time.
 *
 * Content per email:
 *   - Fleet-wide: avg score, anomaly count, stale devices, low-data days
 *   - Top 3 worst sites (lowest avg score this week)
 *   - Top 3 most-improved sites (largest positive delta vs prior week)
 *   - All sites: 7-day avg, best day, worst day, top cause
 *
 * Configuration (.env):
 *   DIGEST_ENABLED=true
 *   DIGEST_TO=ops@isomo.org,cto@isomo.org        (comma-separated recipients)
 *   DIGEST_FROM=starfleet@isomo.org
 *   SMTP_HOST=smtp.example.com
 *   SMTP_PORT=587
 *   SMTP_USER=starfleet@isomo.org
 *   SMTP_PASS=secret
 *   DASHBOARD_URL=https://ops.isomo.org
 */
const cron       = require('node-cron');
const nodemailer = require('nodemailer');
const fs         = require('fs');
const path       = require('path');
const pool       = require('../db');

const ENABLED      = process.env.DIGEST_ENABLED === 'true';
const TEMPLATE_PATH = path.join(__dirname, '../templates/weekly-digest.html');

// ── Mailer transport (lazy-initialised) ──────────────────────────────────────

let _transporter = null;
function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST   || 'localhost',
      port:   parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }
  return _transporter;
}

// ── Score color helper ───────────────────────────────────────────────────────

function scoreClass(score) {
  if (score === null || score === undefined) return 'score-warn';
  if (score >= 75) return 'score-good';
  if (score >= 50) return 'score-warn';
  return 'score-bad';
}

function scoreBadge(score) {
  const val = score !== null && score !== undefined ? score : '—';
  return `<span class="score-badge ${scoreClass(score)}">${val}</span>`;
}

function deltaBadge(delta) {
  if (delta === null || delta === undefined) return '<span style="color:#94a3b8">—</span>';
  const sign = delta > 0 ? '+' : '';
  const cls  = delta >= 0 ? 'delta-up' : 'delta-down';
  return `<span class="site-delta ${cls}">${sign}${delta}</span>`;
}

function truncate(str, n) {
  if (!str) return '—';
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}

// ── Data collection ──────────────────────────────────────────────────────────

async function collectDigestData() {
  const today = new Date().toISOString().split('T')[0];

  // 7-day window (Mon–Sun of the past week)
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);
  const weekStartStr = weekStart.toISOString().split('T')[0];

  // Previous 7-day window (for improvement delta)
  const prevStart = new Date();
  prevStart.setDate(prevStart.getDate() - 14);
  const prevStartStr = prevStart.toISOString().split('T')[0];

  // All sites
  const sitesRes = await pool.query('SELECT id, name FROM sites ORDER BY name');
  const sites = sitesRes.rows;

  const siteStats = await Promise.all(sites.map(async (site) => {
    // Current week avg/best/worst/anomaly/low_data
    const weekRes = await pool.query(
      `SELECT
         ROUND(AVG(score))::INT                          AS avg_score,
         MAX(score)                                      AS best_score,
         MIN(score)                                      AS worst_score,
         COUNT(*) FILTER (WHERE anomaly = TRUE)         AS anomaly_count,
         COUNT(*) FILTER (WHERE data_quality = 'low_data') AS low_data_count,
         MODE() WITHIN GROUP (ORDER BY cause)           AS top_cause
       FROM daily_scores
       WHERE site_id = $1
         AND date >= $2 AND date < $3`,
      [site.id, weekStartStr, today]
    );

    // Prior week avg (for improvement delta)
    const prevRes = await pool.query(
      `SELECT ROUND(AVG(score))::INT AS avg_score
       FROM daily_scores
       WHERE site_id = $1
         AND date >= $2 AND date < $3`,
      [site.id, prevStartStr, weekStartStr]
    );

    const w    = weekRes.rows[0];
    const prev = prevRes.rows[0];
    const delta = (w.avg_score !== null && prev.avg_score !== null)
      ? w.avg_score - prev.avg_score
      : null;

    return {
      id:            site.id,
      name:          site.name,
      avg_score:     w.avg_score,
      best_score:    w.best_score  !== null ? parseInt(w.best_score)  : null,
      worst_score:   w.worst_score !== null ? parseInt(w.worst_score) : null,
      anomaly_count: parseInt(w.anomaly_count  || 0),
      low_data_count:parseInt(w.low_data_count || 0),
      top_cause:     w.top_cause || 'Optimal Operation',
      prev_avg:      prev.avg_score,
      delta,
    };
  }));

  // Stale devices (last_seen > 15 min — snapshot at send time)
  const staleRes = await pool.query(
    `SELECT COUNT(*) AS cnt FROM devices
     WHERE last_seen < NOW() - INTERVAL '15 minutes' AND last_seen IS NOT NULL`
  );
  const staleDeviceCount = parseInt(staleRes.rows[0].cnt || 0);

  return { siteStats, staleDeviceCount };
}

// ── HTML rendering ───────────────────────────────────────────────────────────

function renderDigest(siteStats, staleDeviceCount) {
  const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');

  const fleetAvg = siteStats.length
    ? Math.round(siteStats.reduce((s, x) => s + (x.avg_score || 0), 0) / siteStats.length)
    : 0;
  const anomalyCount   = siteStats.reduce((s, x) => s + x.anomaly_count,   0);
  const lowDataCount   = siteStats.reduce((s, x) => s + x.low_data_count,  0);

  // Date label
  const now = new Date();
  const weekLabel = now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  // ── Worst 3 sites ──
  const worst3 = [...siteStats]
    .filter(s => s.avg_score !== null)
    .sort((a, b) => a.avg_score - b.avg_score)
    .slice(0, 3);

  const worstSitesHtml = worst3.map(s => `
    <div class="site-row">
      <div style="flex:1">
        <div class="site-name">${s.name}</div>
        <div class="site-meta"><span class="cause-pill">${truncate(s.top_cause, 50)}</span></div>
      </div>
      ${scoreBadge(s.avg_score)}
    </div>`
  ).join('') || '<p style="color:#94a3b8;font-size:13px;">No data available for this week.</p>';

  // ── Most improved 3 sites ──
  const improved3 = [...siteStats]
    .filter(s => s.delta !== null && s.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);

  const improvedSitesHtml = improved3.map(s => `
    <div class="site-row">
      <div style="flex:1">
        <div class="site-name">${s.name}</div>
        <div class="site-meta">Previous week: ${s.prev_avg ?? '—'}</div>
      </div>
      ${scoreBadge(s.avg_score)}
      ${deltaBadge(s.delta)}
    </div>`
  ).join('') || '<p style="color:#94a3b8;font-size:13px;">Insufficient data to compute improvement delta.</p>';

  // ── Anomaly alerts ──
  const anomalySites = siteStats.filter(s => s.anomaly_count > 0);
  const hasAlerts    = anomalySites.length > 0;
  const alertItemsHtml = anomalySites.map(s => `
    <div class="alert-banner">
      <div class="alert-banner-title">${s.name} — ${s.anomaly_count} anomaly day${s.anomaly_count > 1 ? 's' : ''}</div>
      <div class="alert-banner-body">Avg score this week: ${s.avg_score ?? '—'} · Cause: ${truncate(s.top_cause, 60)}</div>
    </div>`
  ).join('');

  // ── All sites table rows ──
  const allSiteRowsHtml = [...siteStats]
    .sort((a, b) => (a.avg_score ?? 0) - (b.avg_score ?? 0))
    .map(s => `
    <tr style="border-bottom:1px solid #f1f5f9;">
      <td style="padding:7px 4px;font-size:13px;font-weight:500;color:#1e293b;">${s.name}</td>
      <td align="center" style="padding:7px 4px;">${scoreBadge(s.avg_score)}</td>
      <td align="center" style="padding:7px 4px;color:#16a34a;font-weight:600;">${s.best_score ?? '—'}</td>
      <td align="center" style="padding:7px 4px;color:#dc2626;font-weight:600;">${s.worst_score ?? '—'}</td>
      <td style="padding:7px 4px;font-size:11px;color:#475569;">${truncate(s.top_cause, 40)}</td>
    </tr>`
  ).join('');

  const dashboardUrl    = process.env.DASHBOARD_URL    || 'http://localhost:8080';
  const unsubscribeUrl  = process.env.UNSUBSCRIBE_URL  || `${dashboardUrl}/settings`;

  let html = template
    .replace('{{WEEK_LABEL}}',        weekLabel)
    .replace('{{SITE_COUNT}}',        String(siteStats.length))
    .replace('{{FLEET_AVG}}',         String(fleetAvg))
    .replace('{{ANOMALY_COUNT}}',     String(anomalyCount))
    .replace('{{STALE_DEVICE_COUNT}}',String(staleDeviceCount))
    .replace('{{LOW_DATA_COUNT}}',    String(lowDataCount))
    .replace('{{WORST_SITES}}',       worstSitesHtml)
    .replace('{{IMPROVED_SITES}}',    improvedSitesHtml)
    .replace('{{ALL_SITE_ROWS}}',     allSiteRowsHtml)
    .replace('{{DASHBOARD_URL}}',     dashboardUrl)
    .replace('{{UNSUBSCRIBE_URL}}',   unsubscribeUrl);

  // Conditional alerts block
  if (hasAlerts) {
    html = html
      .replace('{{#if HAS_ALERTS}}', '')
      .replace('{{/if}}', '')
      .replace('{{ALERT_ITEMS}}', alertItemsHtml);
  } else {
    // Remove entire conditional block
    html = html.replace(/\{\{#if HAS_ALERTS\}\}[\s\S]*?\{\{\/if\}\}/m, '');
  }

  return html;
}

// ── Send ─────────────────────────────────────────────────────────────────────

async function runWeeklyDigest() {
  if (!ENABLED) return;

  const recipients = (process.env.DIGEST_TO || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!recipients.length) {
    console.warn('[WeeklyDigest] DIGEST_TO is not set — skipping send.');
    return;
  }

  console.log('[WeeklyDigest] Collecting data…');
  try {
    const { siteStats, staleDeviceCount } = await collectDigestData();
    const html = renderDigest(siteStats, staleDeviceCount);

    const now      = new Date();
    const subject  = `Isomo Starfleet — Weekly Signal Digest (${now.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })})`;
    const from     = process.env.DIGEST_FROM || 'starfleet@isomo.org';

    await getTransporter().sendMail({
      from,
      to:      recipients.join(', '),
      subject,
      html,
    });

    console.log(`[WeeklyDigest] Sent to ${recipients.join(', ')}`);
  } catch (err) {
    console.error('[WeeklyDigest] Failed to send digest:', err.message);
  }
}

function scheduleWeeklyDigest() {
  if (!ENABLED) {
    console.log('[WeeklyDigest] DIGEST_ENABLED=false — weekly digest disabled.');
    return;
  }
  // Monday 06:00 UTC = 08:00 Kigali (UTC+2)
  cron.schedule('0 6 * * 1', runWeeklyDigest, { timezone: 'UTC' });
  console.log('[WeeklyDigest] Weekly digest scheduled for Mondays at 08:00 Kigali (06:00 UTC).');
}

module.exports = { scheduleWeeklyDigest, runWeeklyDigest };
