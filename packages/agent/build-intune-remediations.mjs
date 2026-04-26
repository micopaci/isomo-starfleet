#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const flagArgs = new Set(['dry-run']);
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key.startsWith('--')) continue;

  const name = key.slice(2);
  if (flagArgs.has(name) || !value || value.startsWith('--')) {
    args.set(name, true);
    continue;
  }

  args.set(name, value);
  i += 1;
}

const apiBase = String(args.get('api-base') || 'https://api.starfleet.icircles.rw').replace(/\/+$/, '');
const adminToken = args.get('admin-token') || process.env.STARFLEET_ADMIN_TOKEN;
const ttl = args.get('expires-in') || process.env.AGENT_TOKEN_TTL || '365d';
const siteFilter = String(args.get('site-ids') || '')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isInteger(value) && value > 0);
const outputDir = path.resolve(repoRoot, args.get('out-dir') || 'dist/intune/sites');
const intervalMinutes = args.get('interval-minutes') || '5';
const pingHost = args.get('ping-host') || '1.1.1.1';
const dryRun = args.has('dry-run');

if (!adminToken) {
  throw new Error(
    '--admin-token or STARFLEET_ADMIN_TOKEN is required. Use a dashboard admin JWT to mint site-scoped agent tokens.',
  );
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Admin token must be a JWT with three dot-separated parts.');
  }

  const payload = parts[1].replaceAll('-', '+').replaceAll('_', '/');
  const padded = payload.padEnd(Math.ceil(payload.length / 4) * 4, '=');
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

function assertAdminToken(token) {
  const payload = decodeJwtPayload(token);
  if (payload.role !== 'admin') {
    throw new Error(`Refusing to mint agent tokens with role "${payload.role || 'missing'}"; expected "admin".`);
  }
  if (payload.exp && Number(payload.exp) * 1000 <= Date.now()) {
    throw new Error('Admin token is expired. Log in again and export a fresh STARFLEET_ADMIN_TOKEN.');
  }
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  });
  const text = await response.text();
  let body = text;
  try {
    body = JSON.parse(text);
  } catch {}

  if (!response.ok) {
    const detail = typeof body === 'object' && body ? body.detail || body.error : body;
    throw new Error(`${url} returned HTTP ${response.status}: ${String(detail || response.statusText).slice(0, 300)}`);
  }

  return body;
}

function filenameForSite(site) {
  const name = String(site.name || `site-${site.id}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `site-${site.id}-${name || 'unnamed'}-remediation.ps1`;
}

assertAdminToken(adminToken);

const sites = await fetchJson(`${apiBase}/api/sites`);
if (!Array.isArray(sites)) {
  throw new Error('/api/sites did not return an array.');
}

const selectedSites = sites
  .filter((site) => Number.isInteger(Number(site.id)) && (!siteFilter.length || siteFilter.includes(Number(site.id))))
  .map((site) => ({ ...site, id: Number(site.id) }))
  .sort((a, b) => a.id - b.id);

if (!selectedSites.length) {
  throw new Error(siteFilter.length ? `No matching sites found for --site-ids ${siteFilter.join(',')}.` : 'No sites found.');
}

console.log(`Preparing ${selectedSites.length} site remediation script(s) from ${apiBase}.`);
if (dryRun) {
  for (const site of selectedSites) {
    console.log(`Would build site ${site.id}: ${site.name || '(unnamed)'}`);
  }
  process.exit(0);
}

fs.mkdirSync(outputDir, { recursive: true });

const manifest = [];
for (const site of selectedSites) {
  const tokenResponse = await fetchJson(`${apiBase}/api/agent-tokens`, {
    method: 'POST',
    body: JSON.stringify({ site_id: site.id, expires_in: ttl }),
  });
  if (!tokenResponse?.token) {
    throw new Error(`/api/agent-tokens did not return a token for site ${site.id}.`);
  }

  const outPath = path.join(outputDir, filenameForSite(site));
  const result = spawnSync(
    process.execPath,
    [
      path.join(__dirname, 'build-intune-remediation.mjs'),
      '--site-id',
      String(site.id),
      '--api-base',
      apiBase,
      '--interval-minutes',
      String(intervalMinutes),
      '--ping-host',
      String(pingHost),
      '--out',
      outPath,
    ],
    {
      cwd: repoRoot,
      env: { ...process.env, STARFLEET_AGENT_TOKEN: tokenResponse.token },
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    throw new Error(`Failed to build site ${site.id}: ${result.stderr || result.stdout}`);
  }

  manifest.push({
    site_id: site.id,
    site_name: site.name || null,
    remediation_file: path.relative(repoRoot, outPath),
    expires_in: tokenResponse.expires_in || ttl,
  });
  console.log(`Built site ${site.id}: ${site.name || '(unnamed)'} -> ${path.relative(repoRoot, outPath)}`);
}

const manifestPath = path.join(outputDir, 'manifest.json');
fs.writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      generated_at_utc: new Date().toISOString(),
      api_base: apiBase,
      token_ttl: ttl,
      count: manifest.length,
      sites: manifest,
    },
    null,
    2,
  ),
  'utf8',
);

console.log(`Wrote ${path.relative(repoRoot, manifestPath)}`);
console.log('Do not commit generated remediation scripts or the manifest; they describe secret-bearing artifacts.');
