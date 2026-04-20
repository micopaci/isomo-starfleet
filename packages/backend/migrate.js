#!/usr/bin/env node
/**
 * Migration runner — tracks applied migrations in schema_migrations table.
 * Safe to re-run: skips files that have already been applied.
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pool = require('./db');

async function run() {
  const client = await pool.connect();
  try {
    // Ensure tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const dir   = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

    const applied = await client.query('SELECT filename FROM schema_migrations');
    const appliedSet = new Set(applied.rows.map(r => r.filename));

    const pending = files.filter(f => !appliedSet.has(f));
    if (pending.length === 0) {
      console.log('All migrations already applied — nothing to do.');
      return;
    }

    console.log(`Applying ${pending.length} pending migration(s)…`);
    for (const file of pending) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      console.log(`  → ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`${file}: ${err.message}`);
      }
    }
    console.log('\nMigrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
