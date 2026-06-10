'use strict';

const cron = require('node-cron');
const nodemailer = require('nodemailer');
const pool = require('../db');

const ENABLED = process.env.STARLINK_USAGE_REPORT_ENABLED === 'true';

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function kigaliDateString(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kigali',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function previousKigaliWeek(now = new Date()) {
  const today = kigaliDateString(now);
  const date = new Date(`${today}T00:00:00.000Z`);
  const day = date.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday - 7);
  const start = date.toISOString().slice(0, 10);
  return { start, end: addDays(start, 7) };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatGb(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  return `${(Number(bytes) / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function enumerateDays(start, endExclusive) {
  const days = [];
  for (let day = start; day < endExclusive; day = addDays(day, 1)) days.push(day);
  return days;
}

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'localhost',
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  }
  return transporter;
}

async function collectWeeklyStarlinkUsageData(now = new Date()) {
  const { start, end } = previousKigaliWeek(now);
  const days = enumerateDays(start, end);

  const [sitesRes, dailyRes, runRes] = await Promise.all([
    pool.query(
      `SELECT id, name, starlink_sn, starlink_uuid, kit_id
       FROM sites
       WHERE starlink_sn IS NOT NULL OR starlink_uuid IS NOT NULL OR kit_id IS NOT NULL
       ORDER BY name`
    ),
    pool.query(
      `WITH managed AS (
         SELECT site_id, date, SUM(bytes_down + bytes_up) AS managed_bytes
         FROM (
           SELECT site_id, date, bytes_down, bytes_up FROM data_usage
           UNION ALL
           SELECT site_id, date, bytes_down, bytes_up FROM data_usage_archive
         ) usage_rows
         WHERE date >= $1::date AND date < $2::date
         GROUP BY site_id, date
       )
       SELECT d.site_id, s.name AS site_name, d.date::text AS date,
              d.bytes_total,
              d.confidence,
              d.service_line_id,
              d.starlink_identifier,
              COALESCE(m.managed_bytes, 0) AS managed_bytes
       FROM site_usage_totals_daily d
       JOIN sites s ON s.id = d.site_id
       LEFT JOIN managed m ON m.site_id = d.site_id AND m.date = d.date
       WHERE d.date >= $1::date AND d.date < $2::date
       ORDER BY s.name, d.date`,
      [start, end]
    ),
    pool.query(
      `SELECT run_id, status, started_at, finished_at, error, sites_seen, sites_imported
       FROM starlink_portal_scraper_runs
       WHERE started_at::date >= $1::date AND started_at::date < $2::date
       ORDER BY started_at`,
      [start, end]
    ),
  ]);

  const rowsBySite = new Map();
  for (const row of dailyRes.rows) {
    if (!rowsBySite.has(row.site_id)) rowsBySite.set(row.site_id, new Map());
    rowsBySite.get(row.site_id).set(row.date, row);
  }

  const siteSummaries = sitesRes.rows.map(site => {
    const byDay = rowsBySite.get(site.id) || new Map();
    const daily = days.map(date => {
      const row = byDay.get(date);
      const bytesTotal = row?.bytes_total == null ? null : Number(row.bytes_total);
      const managedBytes = row?.managed_bytes == null ? 0 : Number(row.managed_bytes);
      return {
        date,
        bytes_total: bytesTotal,
        managed_bytes: managedBytes,
        unattributed_residual_bytes: bytesTotal == null ? null : Math.max(bytesTotal - managedBytes, 0),
        confidence: row?.confidence || null,
      };
    });
    return {
      site_id: site.id,
      site_name: site.name,
      total_bytes: daily.reduce((sum, row) => sum + (row.bytes_total || 0), 0),
      unattributed_residual_bytes: daily.reduce((sum, row) => sum + (row.unattributed_residual_bytes || 0), 0),
      missing_days: daily.filter(row => row.bytes_total === null).map(row => row.date),
      review_days: daily.filter(row => row.confidence === 'cycle_reset_estimate'),
      daily,
    };
  });

  return {
    start,
    end,
    days,
    site_summaries: siteSummaries,
    top_sites: [...siteSummaries].sort((a, b) => b.total_bytes - a.total_bytes).slice(0, 10),
    failed_runs: runRes.rows.filter(row => ['failed', 'partial'].includes(row.status)),
    missing_site_days: siteSummaries.flatMap(site =>
      site.missing_days.map(date => ({ site_id: site.site_id, site_name: site.site_name, date }))
    ),
    review_site_days: siteSummaries.flatMap(site =>
      site.review_days.map(day => ({ site_id: site.site_id, site_name: site.site_name, ...day }))
    ),
  };
}

function renderWeeklyStarlinkUsageReport(data) {
  const dayHeaders = data.days.map(day => `<th>${escapeHtml(day.slice(5))}</th>`).join('');
  const topRows = data.top_sites.map(site => `
    <tr>
      <td>${escapeHtml(site.site_name)}</td>
      <td align="right">${formatGb(site.total_bytes)}</td>
      <td align="right">${formatGb(site.unattributed_residual_bytes)}</td>
      <td>${site.missing_days.length ? escapeHtml(site.missing_days.join(', ')) : '—'}</td>
    </tr>`).join('');
  const dailyRows = data.site_summaries.map(site => `
    <tr>
      <td>${escapeHtml(site.site_name)}</td>
      ${site.daily.map(day => `<td align="right">${formatGb(day.bytes_total)}</td>`).join('')}
    </tr>`).join('');
  const failedHtml = data.failed_runs.length
    ? data.failed_runs.map(run => `<li>${escapeHtml(run.status)} ${escapeHtml(run.run_id)}: ${escapeHtml(run.error || '')}</li>`).join('')
    : '<li>No failed or partial collector runs recorded.</li>';
  const reviewHtml = data.review_site_days.length
    ? data.review_site_days.map(row => `<li>${escapeHtml(row.date)} — ${escapeHtml(row.site_name)}: counter/payment-cycle reset estimate</li>`).join('')
    : '<li>No counter resets recorded.</li>';
  const missingHtml = data.missing_site_days.length
    ? data.missing_site_days.slice(0, 100).map(row => `<li>${escapeHtml(row.date)} — ${escapeHtml(row.site_name)}</li>`).join('')
    : '<li>No missing site-days recorded.</li>';

  const html = `
    <h2>Starlink Weekly Usage Report</h2>
    <p><strong>Window:</strong> ${escapeHtml(data.start)} through ${escapeHtml(addDays(data.end, -1))} (Africa/Kigali)</p>
    <h3>Top highest-usage sites</h3>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead><tr><th>Site</th><th>Total usage</th><th>Unattributed residual</th><th>Missing days</th></tr></thead>
      <tbody>${topRows || '<tr><td colspan="4">No usage rows available.</td></tr>'}</tbody>
    </table>
    <h3>Daily breakdown</h3>
    <table border="1" cellpadding="5" cellspacing="0">
      <thead><tr><th>Site</th>${dayHeaders}</tr></thead>
      <tbody>${dailyRows || '<tr><td>No mapped sites available.</td></tr>'}</tbody>
    </table>
    <h3>Missing / failed collection days</h3>
    <ul>${failedHtml}${missingHtml}</ul>
    <h3>Counter resets and unexplained deltas</h3>
    <ul>${reviewHtml}</ul>
    <p style="color:#64748b;font-size:12px;">Unattributed residual is portal daily usage minus Starfleet managed endpoint usage for the same site/day where available.</p>
  `;

  const text = [
    `Starlink Weekly Usage Report (${data.start} through ${addDays(data.end, -1)} Kigali)`,
    '',
    'Top sites:',
    ...data.top_sites.map(site => `- ${site.site_name}: ${formatGb(site.total_bytes)} (${formatGb(site.unattributed_residual_bytes)} residual)`),
    '',
    'Failed/partial runs:',
    ...(data.failed_runs.length ? data.failed_runs.map(run => `- ${run.status} ${run.run_id}: ${run.error || ''}`) : ['- none']),
    '',
    'Counter resets:',
    ...(data.review_site_days.length ? data.review_site_days.map(row => `- ${row.date} ${row.site_name}`) : ['- none']),
    '',
    'Missing site-days:',
    ...(data.missing_site_days.length ? data.missing_site_days.slice(0, 100).map(row => `- ${row.date} ${row.site_name}`) : ['- none']),
  ].join('\n');

  return { html, text };
}

async function runWeeklyStarlinkUsageReport() {
  if (!ENABLED) return;
  const recipients = (process.env.STARLINK_USAGE_REPORT_TO || process.env.DIGEST_TO || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (!recipients.length) {
    console.warn('[StarlinkUsageReport] STARLINK_USAGE_REPORT_TO/DIGEST_TO is not set — skipping.');
    return;
  }

  const data = await collectWeeklyStarlinkUsageData();
  const rendered = renderWeeklyStarlinkUsageReport(data);
  await getTransporter().sendMail({
    from: process.env.STARLINK_USAGE_REPORT_FROM || process.env.DIGEST_FROM || 'Starfleet <noreply@starfleet.icircles.rw>',
    to: recipients.join(', '),
    subject: `Isomo Starfleet — Starlink weekly usage (${data.start} to ${addDays(data.end, -1)})`,
    text: rendered.text,
    html: rendered.html,
  });
  console.log(`[StarlinkUsageReport] Sent to ${recipients.join(', ')}`);
}

function scheduleWeeklyStarlinkUsageReport() {
  if (!ENABLED) {
    console.log('[StarlinkUsageReport] STARLINK_USAGE_REPORT_ENABLED=false — weekly usage report disabled.');
    return;
  }
  cron.schedule('0 15 * * 1', runWeeklyStarlinkUsageReport, { timezone: 'UTC' });
  console.log('[StarlinkUsageReport] Scheduled for Mondays at 17:00 Kigali (15:00 UTC).');
}

module.exports = {
  addDays,
  collectWeeklyStarlinkUsageData,
  previousKigaliWeek,
  renderWeeklyStarlinkUsageReport,
  runWeeklyStarlinkUsageReport,
  scheduleWeeklyStarlinkUsageReport,
};
