#!/usr/bin/env node
/**
 * Starlink portal usage worker.
 *
 * This is meant to run on the always-on Windows/WSL server, not inside the
 * web backend process. It owns the browser session, posts scraper-run audit
 * rows, and imports either cumulative billing-cycle snapshots or direct daily
 * portal totals into Starfleet.
 */
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env.portal') });

const args = new Set(process.argv.slice(2));

const DEFAULT_PORTAL_URL = 'https://www.starlink.com/account/home';
const DEFAULT_API_URL = 'https://api.starfleet.icircles.rw';

function showHelp() {
  console.log(`
Usage:
  npm run starlink:portal:usage --workspace=packages/backend -- --run
  npm run starlink:portal:usage --workspace=packages/backend -- --check-auth
  npm run starlink:portal:usage --workspace=packages/backend -- --fixture ./usage.json --dry-run

Modes:
  --run         Open Starlink portal with Playwright, extract usage, and import it.
  --check-auth  Open the portal and save/refresh the persistent browser session.
  --fixture X   Read extracted entries from a JSON file instead of opening the portal.
  --dry-run     Print extracted entries without importing them.

Required for imports:
  STARFLEET_API_URL=https://api.starfleet.icircles.rw
  STARFLEET_ADMIN_TOKEN=<dashboard admin JWT>
    or STARFLEET_ADMIN_EMAIL + STARFLEET_ADMIN_PASSWORD

Required for portal scraping:
  STARLINK_PORTAL_ADAPTER=/absolute/path/to/adapter.js
  STARLINK_PORTAL_PROFILE_DIR=/srv/starfleet/starlink-browser-profile

Optional:
  STARLINK_PORTAL_EMAIL=support@icircles.rw
  STARLINK_PORTAL_URL=https://www.starlink.com/account/home
  STARLINK_PORTAL_HEADLESS=true|false
  STARLINK_PORTAL_USAGE_MODE=snapshot|daily
  STARLINK_PORTAL_DAILY_DATE_BACKDAYS=1
  STARLINK_SITE_MAP_FILE=/srv/starfleet/starlink-site-map.json
`);
}

function argValue(name) {
  const prefix = `${name}=`;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

function todayKigali() {
  return dateKigali();
}

function dateKigali(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Kigali',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function readJsonFile(filePath) {
  const resolved = path.resolve(filePath);
  return JSON.parse(fs.readFileSync(resolved, 'utf8'));
}

function loadSiteMap() {
  if (process.env.STARLINK_SITE_MAP_JSON) {
    return JSON.parse(process.env.STARLINK_SITE_MAP_JSON);
  }
  if (process.env.STARLINK_SITE_MAP_FILE) {
    return readJsonFile(process.env.STARLINK_SITE_MAP_FILE);
  }
  return {};
}

function normalizeEntries(raw) {
  const entries = Array.isArray(raw) ? raw : raw.entries;
  if (!Array.isArray(entries)) {
    throw new Error('Usage extraction must return an array or { entries: [...] }');
  }
  return entries.map(entry => ({
    ...entry,
    site_id: Number(entry.site_id),
  })).filter(entry => Number.isInteger(entry.site_id) && entry.site_id > 0);
}

async function requestJson(apiUrl, pathName, options = {}) {
  const res = await fetch(`${apiUrl}${pathName}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${pathName} failed with HTTP ${res.status}: ${body.error || body.raw || text}`);
  }
  return body;
}

async function getAdminToken(apiUrl) {
  if (process.env.STARFLEET_ADMIN_TOKEN) return process.env.STARFLEET_ADMIN_TOKEN;

  const email = requireEnv('STARFLEET_ADMIN_EMAIL');
  const password = requireEnv('STARFLEET_ADMIN_PASSWORD');
  const login = await requestJson(apiUrl, '/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!login.token) throw new Error('/auth/login did not return a token');
  return login.token;
}

async function postAuthed(apiUrl, token, pathName, body) {
  return requestJson(apiUrl, pathName, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    throw new Error(
      'Playwright is not installed. On the always-on server run: npm install --workspace=packages/backend playwright && npx playwright install chromium'
    );
  }
}

async function collectFromPortal() {
  const adapterPath = process.env.STARLINK_PORTAL_ADAPTER;
  if (!adapterPath) {
    throw new Error('STARLINK_PORTAL_ADAPTER is required for --run. Use --check-auth first, then add a calibrated adapter.');
  }

  const resolvedAdapter = path.resolve(adapterPath);
  const adapter = require(resolvedAdapter);
  if (typeof adapter.extractStarlinkUsage !== 'function') {
    throw new Error('STARLINK_PORTAL_ADAPTER must export extractStarlinkUsage({ page, context, env, siteMap, today })');
  }

  const { chromium } = loadPlaywright();
  const profileDir = process.env.STARLINK_PORTAL_PROFILE_DIR
    || path.resolve(__dirname, '../.starlink-browser-profile');
  const headless = process.env.STARLINK_PORTAL_HEADLESS !== 'false';
  const context = await chromium.launchPersistentContext(profileDir, {
    headless,
    viewport: { width: 1440, height: 1000 },
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(process.env.STARLINK_PORTAL_URL || DEFAULT_PORTAL_URL, { waitUntil: 'domcontentloaded' });
    const rawEntries = await adapter.extractStarlinkUsage({
      page,
      context,
      env: process.env,
      siteMap: loadSiteMap(),
      today: todayKigali(),
    });
    return normalizeEntries(rawEntries);
  } finally {
    await context.close();
  }
}

async function checkAuth() {
  const { chromium } = loadPlaywright();
  const profileDir = process.env.STARLINK_PORTAL_PROFILE_DIR
    || path.resolve(__dirname, '../.starlink-browser-profile');
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    viewport: { width: 1440, height: 1000 },
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(process.env.STARLINK_PORTAL_URL || DEFAULT_PORTAL_URL, { waitUntil: 'domcontentloaded' });
  console.log('Portal browser opened.');
  console.log('Sign in as support@icircles.rw, complete OTP/MFA, then press Enter here to save the browser profile.');
  await new Promise(resolve => process.stdin.once('data', resolve));
  await context.close();
}

function fixturePath() {
  const direct = argValue('--fixture');
  if (direct) return direct;
  const argv = process.argv.slice(2);
  const idx = argv.indexOf('--fixture');
  return idx >= 0 ? argv[idx + 1] : null;
}

async function main() {
  if (args.has('--help') || args.has('-h')) {
    showHelp();
    return;
  }

  if (args.has('--check-auth')) {
    await checkAuth();
    return;
  }

  const runId = `starlink-portal-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const apiUrl = (process.env.STARFLEET_API_URL || DEFAULT_API_URL).replace(/\/$/, '');
  const mode = process.env.STARLINK_PORTAL_USAGE_MODE || 'snapshot';
  const defaultBackdays = mode === 'snapshot' ? 1 : 0;
  const dailyDateBackdays = Number.isFinite(Number(process.env.STARLINK_PORTAL_DAILY_DATE_BACKDAYS))
    ? Number(process.env.STARLINK_PORTAL_DAILY_DATE_BACKDAYS)
    : defaultBackdays;
  const dryRun = args.has('--dry-run');
  const source = process.env.STARLINK_PORTAL_USAGE_SOURCE || 'starlink_portal_scraper';

  let token = null;
  if (!dryRun) token = await getAdminToken(apiUrl);

  if (!dryRun) {
    await postAuthed(apiUrl, token, '/api/usage/portal-runs', {
      run_id: runId,
      status: 'running',
      started_at: new Date().toISOString(),
      metadata: { mode },
    });
  }

  try {
    const file = fixturePath();
    const entries = file ? normalizeEntries(readJsonFile(file)) : await collectFromPortal();
    const snapshotDate = todayKigali();
    const dailyDate = dateKigali(dailyDateBackdays * -1);

    if (dryRun) {
      console.log(JSON.stringify({ ok: true, dry_run: true, mode, snapshot_date: snapshotDate, daily_date: dailyDate, entries }, null, 2));
      return;
    }

    const importPath = mode === 'daily' ? '/api/usage/daily-import' : '/api/usage/portal-snapshots';
    const payload = mode === 'daily'
      ? { date: dailyDate, source, entries }
      : { snapshot_date: snapshotDate, daily_date: dailyDate, source, entries };
    const imported = await postAuthed(apiUrl, token, importPath, payload);

    await postAuthed(apiUrl, token, '/api/usage/portal-runs', {
      run_id: runId,
      status: 'success',
      finished_at: new Date().toISOString(),
      sites_seen: entries.length,
      sites_imported: imported.imported || imported.imported_daily_totals || 0,
      metadata: { mode, import_result: imported },
    });

    console.log(JSON.stringify({ ok: true, run_id: runId, mode, entries: entries.length, imported }, null, 2));
  } catch (err) {
    if (!dryRun && token) {
      await postAuthed(apiUrl, token, '/api/usage/portal-runs', {
        run_id: runId,
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: err.message,
        metadata: { mode },
      }).catch(reportErr => {
        console.error(`Failed to report scraper failure: ${reportErr.message}`);
      });
    }
    throw err;
  }
}

main().catch(err => {
  console.error(`Starlink portal usage worker failed: ${err.message}`);
  process.exitCode = 1;
});
