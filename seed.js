#!/usr/bin/env node
// Seed the database with demo machines for the first operator.
// Usage:  DATABASE_URL=<connection-string> node seed.js
require('dotenv').config();
const { pool } = require('./db');
const { seedDemoMachines } = require('./lib/demo-seed');

async function main() {
  const { rows } = await pool.query(
    'SELECT id, username FROM operators ORDER BY id LIMIT 1'
  );
  if (!rows.length) {
    console.error('No operator found. Sign up at the site first, then re-run.');
    process.exit(1);
  }
  const op = rows[0];
  console.log(`Seeding demo machines for "${op.username}" (id=${op.id})...`);
  await seedDemoMachines(op.id, { replace: true });
  console.log('Done! Refresh your dashboard.');
  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
