#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  const value = process.argv[i + 1];
  if (!key.startsWith('--')) continue;
  args.set(key.slice(2), value && !value.startsWith('--') ? value : true);
  if (value && !value.startsWith('--')) i += 1;
}

const apiBase = String(args.get('api-base') || 'https://api.starfleet.icircles.rw').replace(/\/+$/, '');
const adminToken = args.get('admin-token') || process.env.STARFLEET_ADMIN_TOKEN;
const ttl = args.get('expires-in') || process.env.DISCOVERY_TOKEN_TTL || '30d';
const out = args.get('out') || 'dist/intune/discovery-remediation.ps1';

if (!adminToken) {
  throw new Error('--admin-token or STARFLEET_ADMIN_TOKEN is required to mint the discovery token.');
}

const response = await fetch(`${apiBase}/api/agent-tokens`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${adminToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ site_id: 0, scope: 'discovery', expires_in: ttl }),
});
const text = await response.text();
let body = text;
try {
  body = JSON.parse(text);
} catch {}

if (!response.ok) {
  const detail = typeof body === 'object' && body ? body.detail || body.error : body;
  throw new Error(`/api/agent-tokens returned HTTP ${response.status}: ${detail || response.statusText}`);
}
if (!body?.token) {
  throw new Error('/api/agent-tokens did not return a discovery token.');
}

const result = spawnSync(
  process.execPath,
  [
    path.join(__dirname, 'build-intune-remediation.mjs'),
    '--site-id',
    '0',
    '--api-base',
    apiBase,
    '--out',
    path.resolve(repoRoot, out),
  ],
  {
    cwd: repoRoot,
    env: { ...process.env, STARFLEET_AGENT_TOKEN: body.token },
    stdio: 'inherit',
  },
);

process.exit(result.status ?? 1);
