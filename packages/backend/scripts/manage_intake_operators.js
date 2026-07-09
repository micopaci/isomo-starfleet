#!/usr/bin/env node
/**
 * Manage intake kiosk operators (per-intern PIN) for the QR scan-to-register flow.
 *
 * PINs are stored as bcrypt hashes in intake_operators (migration 044); the plain
 * PIN is never persisted. Keep PINs unique across operators — a scan authenticates
 * by PIN alone, so a duplicate would be ambiguous.
 *
 * Usage (run from packages/backend with the same env as the server, e.g. DATABASE_URL):
 *   node scripts/manage_intake_operators.js add "Eric" --pin 4821 --email eric@isomo.tech
 *   node scripts/manage_intake_operators.js list
 *   node scripts/manage_intake_operators.js set-pin "Eric" --pin 5590
 *   node scripts/manage_intake_operators.js deactivate "Eric"
 *   node scripts/manage_intake_operators.js activate "Eric"
 */
const bcrypt = require('bcryptjs');
const pool = require('../db');

function flag(args, name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

async function pinInUse(pin, exceptId = null) {
  const { rows } = await pool.query('SELECT id, name, pin_hash FROM intake_operators WHERE active = TRUE');
  for (const r of rows) {
    if (exceptId && r.id === exceptId) continue;
    // eslint-disable-next-line no-await-in-loop
    if (await bcrypt.compare(String(pin), r.pin_hash)) return r;
  }
  return null;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === 'list') {
    const { rows } = await pool.query(
      'SELECT id, name, email, active, created_at, last_used_at FROM intake_operators ORDER BY id'
    );
    if (rows.length === 0) { console.log('No intake operators yet.'); return; }
    for (const r of rows) {
      console.log(
        `#${r.id}  ${r.name.padEnd(20)} ${r.email || '(no email)'}`.padEnd(60) +
        `${r.active ? 'ACTIVE' : 'disabled'}  last_used=${r.last_used_at ? r.last_used_at.toISOString() : 'never'}`
      );
    }
    return;
  }

  const name = rest[0];
  if (['add', 'set-pin', 'deactivate', 'activate'].includes(cmd) && !name) {
    throw new Error(`"${cmd}" requires an operator name`);
  }

  if (cmd === 'add') {
    const pin = flag(rest, 'pin');
    const email = flag(rest, 'email');
    if (!pin || !/^\d{4,8}$/.test(pin)) throw new Error('--pin must be 4–8 digits');
    const clash = await pinInUse(pin);
    if (clash) throw new Error(`PIN already in use by "${clash.name}" — choose a different PIN`);
    const hash = await bcrypt.hash(pin, 10);
    await pool.query(
      'INSERT INTO intake_operators (name, email, pin_hash) VALUES ($1, $2, $3)',
      [name, email || null, hash]
    );
    console.log(`Added operator "${name}"${email ? ` <${email}>` : ''}.`);
    return;
  }

  if (cmd === 'set-pin') {
    const pin = flag(rest, 'pin');
    if (!pin || !/^\d{4,8}$/.test(pin)) throw new Error('--pin must be 4–8 digits');
    const { rows } = await pool.query('SELECT id FROM intake_operators WHERE name = $1', [name]);
    if (rows.length === 0) throw new Error(`No operator named "${name}"`);
    const clash = await pinInUse(pin, rows[0].id);
    if (clash) throw new Error(`PIN already in use by "${clash.name}" — choose a different PIN`);
    const hash = await bcrypt.hash(pin, 10);
    await pool.query('UPDATE intake_operators SET pin_hash = $1 WHERE id = $2', [hash, rows[0].id]);
    console.log(`Updated PIN for "${name}".`);
    return;
  }

  if (cmd === 'deactivate' || cmd === 'activate') {
    const res = await pool.query(
      'UPDATE intake_operators SET active = $1 WHERE name = $2',
      [cmd === 'activate', name]
    );
    if (res.rowCount === 0) throw new Error(`No operator named "${name}"`);
    console.log(`${cmd === 'activate' ? 'Activated' : 'Deactivated'} "${name}".`);
    return;
  }

  console.log('Usage: manage_intake_operators.js <add|list|set-pin|deactivate|activate> [name] [--pin NNNN] [--email x]');
  process.exitCode = 2;
}

main()
  .catch(err => { console.error('Error:', err.message); process.exitCode = 1; })
  .finally(() => pool.end && pool.end());
