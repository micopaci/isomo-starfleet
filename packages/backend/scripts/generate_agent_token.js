#!/usr/bin/env node
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const jwt = require('jsonwebtoken');

const rawSiteId = process.argv[2] || process.env.SITE_ID;
const siteId = Number(rawSiteId);
const expiresIn = process.argv[3] || process.env.AGENT_TOKEN_TTL || '365d';

if (!Number.isInteger(siteId) || siteId <= 0) {
  console.error('Usage: node scripts/generate_agent_token.js <site_id> [expiresIn]');
  process.exit(1);
}

const privateKey = process.env.JWT_PRIVATE_KEY;
const secret = process.env.JWT_SECRET;
const algorithm = privateKey && privateKey.startsWith('-----BEGIN') ? 'RS256' : 'HS256';
const key = algorithm === 'RS256' ? privateKey : secret;

if (!key) {
  console.error('JWT_PRIVATE_KEY or JWT_SECRET is required to generate an agent token.');
  process.exit(1);
}

const token = jwt.sign(
  {
    sub: `agent-site-${siteId}`,
    email: `agent-site-${siteId}@starfleet.local`,
    role: 'agent',
    site_id: siteId,
  },
  key,
  { algorithm, expiresIn },
);

console.log(token);
