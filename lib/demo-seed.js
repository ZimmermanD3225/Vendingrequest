const crypto = require('crypto');
const { pool } = require('../db');

const DEMO_MACHINES = [
  {
    name: 'HyVee Break Room',
    location: 'Ames, Iowa',
    address: '801 S Duff Ave, Ames, IA 50010',
    lat: 42.0208,
    lng: -93.6158,
    requests: [
      { product_name: "Flamin' Hot Cheetos", phone: '515-555-0142' },
      { product_name: 'Mountain Dew Zero', phone: '515-555-0198' },
      { product_name: 'Kind Bars (Dark Chocolate)', phone: '515-555-0231' },
    ],
  },
  {
    name: 'Kinnick Stadium Concourse',
    location: 'Iowa City, Iowa',
    address: '825 Stadium Dr, Iowa City, IA 52242',
    lat: 41.6584,
    lng: -91.551,
    requests: [
      { product_name: 'Gatorade Frost', phone: '319-555-0177' },
      { product_name: 'Snickers', phone: '319-555-0254' },
      { product_name: 'Trail Mix', phone: '319-555-0103' },
    ],
  },
  {
    name: 'Jordan Creek Mall East',
    location: 'West Des Moines, Iowa',
    address: '101 Jordan Creek Pkwy, West Des Moines, IA 50266',
    lat: 41.5715,
    lng: -93.7985,
    requests: [
      { product_name: 'Red Bull Sugar Free', phone: '515-555-0319' },
      { product_name: 'Peanut M&Ms', phone: '515-555-0287' },
      { product_name: "Jack Link's Beef Jerky", phone: '515-555-0145' },
    ],
  },
];

async function seedDemoMachines(operatorId) {
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
