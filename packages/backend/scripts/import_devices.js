#!/usr/bin/env node
/**
 * One-time import: loads all devices from Intune CSV export into the devices table.
 * Upserts on windows_sn — safe to run multiple times.
 *
 * CSV columns: Device ID, Device name, Manufacturer, Serial number
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs   = require('fs');
const path = require('path');
const pool = require('../db');

const CSV_PATH = process.argv[2];
if (!CSV_PATH) {
  console.error('Usage: node scripts/import_devices.js <path-to-csv>');
  process.exit(1);
}

function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  // Parse header
  const header = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim());
  return lines.slice(1).map(line => {
    // Handle quoted fields
    const fields = [];
    let current = '';
    let inQuote = false;
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote; }
      else if (ch === ',' && !inQuote) { fields.push(current); current = ''; }
      else { current += ch; }
    }
    fields.push(current);
    const obj = {};
    header.forEach((h, i) => { obj[h] = (fields[i] || '').trim(); });
    return obj;
  }).filter(row => row['Serial number'] && row['Serial number'].length > 0);
}

async function run() {
  const raw     = fs.readFileSync(CSV_PATH, 'utf8');
  const devices = parseCSV(raw);
  console.log(`Parsed ${devices.length} devices from CSV…`);

  const client = await pool.connect();
  let inserted = 0, updated = 0;

  try {
    await client.query('BEGIN');

    for (const dev of devices) {
      const intuneId   = dev['Device ID'];
      const hostname   = dev['Device name'];
      const serialNum  = dev['Serial number'];
      const mfr        = dev['Manufacturer'];

      const result = await client.query(
        `INSERT INTO devices (windows_sn, hostname, manufacturer, intune_device_id, role)
         VALUES ($1, $2, $3, $4, 'standard')
         ON CONFLICT (windows_sn)
         DO UPDATE SET
           hostname         = EXCLUDED.hostname,
           manufacturer     = EXCLUDED.manufacturer,
           intune_device_id = EXCLUDED.intune_device_id
         RETURNING (xmax = 0) AS is_insert`,
        [serialNum, hostname, mfr, intuneId]
      );

      if (result.rows[0].is_insert) inserted++;
      else updated++;
    }

    await client.query('COMMIT');
    console.log(`Done. ${inserted} inserted, ${updated} updated.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Import failed:', err.message);
  process.exit(1);
});
