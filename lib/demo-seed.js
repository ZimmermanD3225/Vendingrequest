const crypto = require('crypto');
const { pool } = require('../db');

// Real Iowa landmarks with verified coordinates.
const DEMO_MACHINES = [
  {
    name: 'Hy-Vee Lincoln Way',
    location: 'Ames — Lobby',
    address: '640 Lincoln Way, Ames, IA 50010',
    lat: 42.0227,
    lng: -93.6167,
    requests: [
      { product_name: "Flamin' Hot Cheetos", phone: '515-555-0142' },
      { product_name: 'Mountain Dew Zero', phone: '515-555-0198' },
      { product_name: 'Kind Bars (Dark Chocolate)', phone: '515-555-0231' },
    ],
  },
  {
    name: 'Kinnick Stadium Concourse',
    location: 'Iowa City — Section 122',
    address: '825 Stadium Dr, Iowa City, IA 52242',
    lat: 41.6584,
    lng: -91.5511,
    requests: [
      { product_name: 'Gatorade Frost', phone: '319-555-0177' },
      { product_name: 'Snickers', phone: '319-555-0254' },
      { product_name: 'Trail Mix', phone: '319-555-0103' },
    ],
  },
  {
    name: 'Jordan Creek Town Center',
    location: 'West Des Moines — East wing',
    address: '101 Jordan Creek Pkwy, West Des Moines, IA 50266',
    lat: 41.5664,
    lng: -93.7957,
    requests: [
      { product_name: 'Red Bull Sugar Free', phone: '515-555-0319' },
      { product_name: 'Peanut M&Ms', phone: '515-555-0287' },
      { product_name: "Jack Link's Beef Jerky", phone: '515-555-0145' },
    ],
  },
];

async function seedDemoMachines(operatorId, { replace = false } = {}) {
  if (replace) {
    // Remove any prior demo machines (match by name) before inserting, so the
    // seed is idempotent. Uses cascade delete to clean up requests too.
    const names = DEMO_MACHINES.map((m) => m.name);
    await pool.query(
      `DELETE FROM machines WHERE operator_id = $1 AND name = ANY($2::text[])`,
      [operatorId, names]
    );
  }
  for (const m of DEMO_MACHINES) {
    const token = crypto.randomBytes(16).toString('hex');
    const { rows } = await pool.query(
      `INSERT INTO machines (operator_id, name, location, address, lat, lng, public_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [operatorId, m.name, m.location, m.address, m.lat, m.lng, token]
    );
    const machineId = rows[0].id;
    for (const r of m.requests) {
      await pool.query(
        `INSERT INTO requests (machine_id, product_name, phone) VALUES ($1, $2, $3)`,
        [machineId, r.product_name, r.phone]
      );
    }
  }
}

module.exports = { seedDemoMachines };
