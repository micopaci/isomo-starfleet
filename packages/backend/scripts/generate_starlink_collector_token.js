#!/usr/bin/env node
'use strict';

const path = require('node:path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();

const jwt = require('jsonwebtoken');

const expiresIn = process.argv[2] || process.env.STARLINK_COLLECTOR_TOKEN_TTL || '180d';
const privateKey = process.env.JWT_PRIVATE_KEY;
const secret = process.env.JWT_SECRET;
const algorithm = privateKey && privateKey.startsWith('-----BEGIN') ? 'RS256' : 'HS256';
const key = algorithm === 'RS256' ? privateKey : secret;

if (!key) {
  console.error('JWT_PRIVATE_KEY or JWT_SECRET is required to generate a Starlink collector token.');
  process.exit(1);
}

const token = jwt.sign(
  {
    sub: 'starlink-portal-collector',
    email: 'starlink-portal-collector@starfleet.local',
    role: 'starlink_collector',
    scope: ['starlink:usage:import', 'starlink:portal-runs:write'],
  },
  key,
  { algorithm, expiresIn },
);

console.log(token);
