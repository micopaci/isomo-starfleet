#!/usr/bin/env node
/**
 * Check whether Microsoft Graph is returning Intune managed-device inventory,
 * and optionally compare it with what Starfleet has stored locally.
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const pool = require('../db');
const graph = require('../services/graph');

const args = new Set(process.argv.slice(2));
const shouldSync = args.has('--sync');
const skipDb = args.has('--no-db');
const showHelp = args.has('--help') || args.has('-h');
const limit = Number(process.env.INTUNE_CHECK_LIMIT || 10);

if (showHelp) {
  console.log(`
Usage:
  npm run intune:check --workspace=packages/backend
  npm run intune:check --workspace=packages/backend -- --sync
  npm run intune:check --workspace=packages/backend -- --no-db

Environment:
  GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET are required.
  DATABASE_URL is required unless --no-db is passed.
  INTUNE_CHECK_LIMIT controls printed sample size. Default: 10.

Flags:
  --sync   After reading Graph, upsert devices into Starfleet DB.
  --no-db  Only check Graph; skip Starfleet DB comparison.
`);
  process.exit(0);
}

function requiredEnv(name) {
  if (!process.env[name]) throw new Error(`${name} is not set`);
}

function validateClientSecretShape() {
  const secret = String(process.env.GRAPH_CLIENT_SECRET || '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(secret)) {
    throw new Error(
      'GRAPH_CLIENT_SECRET looks like an Azure client secret ID. Use the secret VALUE from App registrations > Certificates & secrets.'
    );
  }
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toISOString();
}

function formatBytes(value) {
  if (value == null || value === '') return '-';
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '-';
  const gb = bytes / 1024 / 1024 / 1024;
  return `${gb.toFixed(1)} GB`;
}

function compact(value) {
  return value == null || String(value).trim() === '' ? '-' : String(value).trim();
}

function printGraphSummary(devices) {
  const withSerial = devices.filter(d => compact(d.serialNumber) !== '-').length;
  const withStorage = devices.filter(d => d.freeStorageSpaceInBytes != null || d.totalStorageSpaceInBytes != null).length;
  const withLastSync = devices.filter(d => d.lastSyncDateTime).length;

  console.log('\nGraph managedDevices');
  console.log(`  Total returned:       ${devices.length}`);
  console.log(`  With serial number:   ${withSerial}`);
  console.log(`  With storage fields:  ${withStorage}`);
  console.log(`  With last sync time:  ${withLastSync}`);

  console.log(`\nGraph sample (${Math.min(limit, devices.length)}):`);
  for (const device of devices.slice(0, limit)) {
    console.log([
      `  - ${compact(device.deviceName)}`,
      `serial=${compact(device.serialNumber)}`,
      `manufacturer=${compact(device.manufacturer)}`,
      `model=${compact(device.model)}`,
      `compliance=${compact(device.complianceState)}`,
      `lastSync=${formatDate(device.lastSyncDateTime)}`,
      `enrolled=${formatDate(device.enrolledDateTime)}`,
      `storage=${formatBytes(device.freeStorageSpaceInBytes)} free / ${formatBytes(device.totalStorageSpaceInBytes)} total`,
    ].join(' | '));
  }
}

async function printDbSummary() {
  if (!process.env.DATABASE_URL) {
    console.log('\nStarfleet DB');
    console.log('  Skipped: DATABASE_URL is not set.');
    return;
  }

  const { rows: summaryRows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE intune_device_id IS NOT NULL) AS intune_devices,
      COUNT(*) FILTER (WHERE intune_last_sync_at IS NOT NULL) AS with_last_sync,
      COUNT(*) FILTER (WHERE manufacturer IS NOT NULL) AS with_manufacturer,
      COUNT(*) FILTER (WHERE free_storage_bytes IS NOT NULL OR total_storage_bytes IS NOT NULL) AS with_storage,
      MAX(intune_synced_at) AS last_sync_import
    FROM devices
  `);

  const summary = summaryRows[0];
  console.log('\nStarfleet DB');
  console.log(`  Intune devices:       ${summary.intune_devices}`);
  console.log(`  With last sync time:  ${summary.with_last_sync}`);
  console.log(`  With manufacturer:    ${summary.with_manufacturer}`);
  console.log(`  With storage fields:  ${summary.with_storage}`);
  console.log(`  Last sync import:     ${formatDate(summary.last_sync_import)}`);

  const { rows } = await pool.query(`
    SELECT hostname, windows_sn, manufacturer, model, compliance_state,
           intune_last_sync_at, intune_enrolled_at,
           free_storage_bytes, total_storage_bytes
    FROM devices
    WHERE intune_device_id IS NOT NULL
    ORDER BY intune_last_sync_at DESC NULLS LAST, hostname ASC
    LIMIT $1
  `, [limit]);

  console.log(`\nDB sample (${rows.length}):`);
  for (const row of rows) {
    console.log([
      `  - ${compact(row.hostname)}`,
      `serial=${compact(row.windows_sn)}`,
      `manufacturer=${compact(row.manufacturer)}`,
      `model=${compact(row.model)}`,
      `compliance=${compact(row.compliance_state)}`,
      `lastSync=${formatDate(row.intune_last_sync_at)}`,
      `enrolled=${formatDate(row.intune_enrolled_at)}`,
      `storage=${formatBytes(row.free_storage_bytes)} free / ${formatBytes(row.total_storage_bytes)} total`,
    ].join(' | '));
  }
}

async function main() {
  requiredEnv('GRAPH_TENANT_ID');
  requiredEnv('GRAPH_CLIENT_ID');
  requiredEnv('GRAPH_CLIENT_SECRET');
  validateClientSecretShape();

  console.log('Checking Intune managedDevices via Microsoft Graph...');
  const devices = await graph.listManagedDevices();
  printGraphSummary(devices);

  if (shouldSync) {
    console.log('\nSyncing Graph devices into Starfleet DB...');
    const result = await graph.syncManagedDevices(devices);
    console.log(`  Synced: ${result.upserted} of ${result.total}; failed: ${result.failed}`);
  }

  if (!skipDb) {
    await printDbSummary();
  }

  console.log('\nDone.');
}

main()
  .catch(err => {
    console.error(`\nIntune check failed: ${err.message}`);
    if (/AADSTS7000215|invalid_client|client secret ID/i.test(err.message)) {
      console.error('Hint: GRAPH_CLIENT_SECRET must be the client secret VALUE, not the Azure secret ID. Create a new secret if the value is no longer visible.');
    }
    if (/Authorization_RequestDenied|Forbidden|Insufficient privileges/i.test(err.message)) {
      console.error('Hint: grant/admin-consent DeviceManagementManagedDevices.Read.All application permission for the Graph app.');
    }
    process.exitCode = 1;
  })
  .finally(() => {
    pool.end().catch(() => {});
  });
