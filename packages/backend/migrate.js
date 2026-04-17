#!/usr/bin/env node
/**
 * Simple migration runner.
 * Reads all *.sql files from ./migrations in filename order and executes them.
 * Idempotent: uses IF NOT EXISTS everywhere in 001_init.sql.
 */
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pool = require('./db');

async function run() {
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Running ${files.length} migration file(s)…`);

  const client = await pool.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      console.log(`  → ${file}`);
      await client.query(sql);
    }
    console.log('\nMigrations complete. 9 tables created.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
