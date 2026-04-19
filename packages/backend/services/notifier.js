/**
 * notifier.js — fan out site-change notifications via email + FCM.
 *
 * Configuration:
 *   - SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS  (email, optional)
 *   - FCM_SERVER_KEY                                 (push,  optional)
 *   - NOTIFY_EMAIL_TO  (comma-separated fallback if no per-user opt-in rows)
 *
 * If neither channel is configured we log a warning and return — ingest never
 * fails on notification errors.
 */
const https = require('https');
const pool  = require('../db');

// Lazy-loaded nodemailer (optional dependency; only imported when SMTP_HOST set)
let mailer = null;
function getMailer() {
  if (mailer) return mailer;
  if (!process.env.SMTP_HOST) return null;
  try {
    const nodemailer = require('nodemailer');
    mailer = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
    return mailer;
  } catch (err) {
    console.warn('nodemailer not installed — email notifications disabled');
    return null;
  }
}

// ── Build recipient list ────────────────────────────────────────────────────
async function getEmailRecipients() {
  // Prefer per-user opt-in table
  const res = await pool.query(
    `SELECT u.email
     FROM users u
     LEFT JOIN notification_prefs p ON p.user_id = u.id
     WHERE u.role IN ('admin', 'ops')
       AND COALESCE(p.site_change_email, TRUE) = TRUE
       AND u.email IS NOT NULL`
  );
  if (res.rows.length) return res.rows.map(r => r.email);

  // Fallback to env list
  const fallback = process.env.NOTIFY_EMAIL_TO;
  return fallback ? fallback.split(',').map(s => s.trim()).filter(Boolean) : [];
}

async function getFcmTokens() {
  const res = await pool.query(
    `SELECT ft.token
     FROM fcm_tokens ft
     JOIN users u ON u.id = ft.user_id
     LEFT JOIN notification_prefs p ON p.user_id = u.id
     WHERE u.role IN ('admin', 'ops')
       AND COALESCE(p.site_change_push, TRUE) = TRUE
       AND ft.token IS NOT NULL`
  );
  return res.rows.map(r => r.token);
}

// ── Email ───────────────────────────────────────────────────────────────────
async function sendEmail({ subject, text, html }) {
  const transport = getMailer();
  if (!transport) return;

  const to = await getEmailRecipients();
  if (!to.length) return;

  await transport.sendMail({
    from:    process.env.SMTP_FROM || 'Starfleet <noreply@starfleet.icircles.rw>',
    to:      to.join(', '),
    subject, text, html,
  });
}

// ── FCM (v1 legacy API, works with the FCM_SERVER_KEY from Firebase console) ─
function fcmPost(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req  = https.request({
      hostname: 'fcm.googleapis.com',
      path:     '/fcm/send',
      method:   'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        Authorization: `key=${process.env.FCM_SERVER_KEY}`,
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end',  () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendPush({ title, body, data }) {
  if (!process.env.FCM_SERVER_KEY) return;
  const tokens = await getFcmTokens();
  if (!tokens.length) return;

  // FCM supports up to 1000 tokens per call via `registration_ids`
  const chunks = [];
  for (let i = 0; i < tokens.length; i += 1000) chunks.push(tokens.slice(i, i + 1000));

  await Promise.all(chunks.map(chunk => fcmPost({
    registration_ids: chunk,
    notification: { title, body, sound: 'default' },
    data: { ...data, click_action: 'OPEN_SITE_CHANGES' },
    priority: 'high',
  })));
}

// ── Public: notify on site change ───────────────────────────────────────────
async function notifySiteChange(ev) {
  const { event_id, device_id, from_site_id, to_site_id, to_site_name, distance_km } = ev;

  // Get from-site name + device hostname for readable messaging
  const q = await pool.query(
    `SELECT d.hostname,
            f.name AS from_name
     FROM devices d
     LEFT JOIN sites f ON f.id = $1
     WHERE d.id = $2`,
    [from_site_id, device_id]
  );
  const row      = q.rows[0] || {};
  const hostname = row.hostname || `device-${device_id}`;
  const fromName = row.from_name || 'unassigned';

  const title = `Site change: ${hostname}`;
  const body  = `${hostname} moved from ${fromName} → ${to_site_name} (${distance_km.toFixed(2)} km match)`;

  const html = `
    <h3>Site reassignment detected</h3>
    <p><strong>${hostname}</strong> has been automatically reassigned based on its Starlink GPS fix.</p>
    <table style="border-collapse: collapse; font-family: monospace; font-size: 13px;">
      <tr><td style="padding: 4px 10px 4px 0;">From:</td>       <td><strong>${fromName}</strong></td></tr>
      <tr><td style="padding: 4px 10px 4px 0;">To:</td>         <td><strong>${to_site_name}</strong></td></tr>
      <tr><td style="padding: 4px 10px 4px 0;">Distance:</td>   <td>${distance_km.toFixed(2)} km from new site</td></tr>
      <tr><td style="padding: 4px 10px 4px 0;">GPS fix:</td>    <td>${ev.lat.toFixed(5)}, ${ev.lon.toFixed(5)}</td></tr>
      <tr><td style="padding: 4px 10px 4px 0;">Event ID:</td>   <td>#${event_id}</td></tr>
    </table>
    <p style="font-size: 12px; color: #64748b;">
      Acknowledge in the dashboard to dismiss this alert.
    </p>
  `;

  // Run both channels in parallel, log errors, never throw
  const results = await Promise.allSettled([
    sendEmail({ subject: `[Starfleet] ${title}`, text: body, html }),
    sendPush ({ title, body, data: {
      type:         'site_change',
      event_id:     String(event_id),
      device_id:    String(device_id),
      from_site_id: String(from_site_id ?? ''),
      to_site_id:   String(to_site_id),
    }}),
  ]);
  for (const r of results) {
    if (r.status === 'rejected') console.error('notify channel failed:', r.reason?.message || r.reason);
  }

  // Mark event as notified
  await pool.query(
    `UPDATE site_change_events SET notified_at = NOW() WHERE id = $1`,
    [event_id]
  );
}

module.exports = { notifySiteChange, sendEmail, sendPush };
