const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. See .env.example.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === 'production' && !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
      ? { rejectUnauthorized: false }
      : false,
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres error', err);
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operators (
      id              SERIAL PRIMARY KEY,
      username        TEXT UNIQUE NOT NULL,
      password_hash   TEXT NOT NULL,
      business_name   TEXT,
      email           TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS machines (
      id              SERIAL PRIMARY KEY,
      operator_id     INTEGER NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      location        TEXT,
      public_token    TEXT UNIQUE NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_machines_operator ON machines(operator_id);

    CREATE TABLE IF NOT EXISTS requests (
      id              SERIAL PRIMARY KEY,
      machine_id      INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
      product_name    TEXT NOT NULL,
      phone           TEXT NOT NULL,
      notes           TEXT,
      status          TEXT NOT NULL DEFAULT 'new',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_requests_machine ON requests(machine_id, status, created_at DESC);
  `);
}

// Query helpers. All return the plain rows; callers handle missing rows themselves.
const q = {
  // --- operators ---
  async insertOperator({ username, password_hash, business_name, email }) {
    const { rows } = await pool.query(
      `INSERT INTO operators (username, password_hash, business_name, email)
       VALUES ($1, $2, $3, $4) RETURNING id, username`,
      [username, password_hash, business_name, email]
    );
    return rows[0];
  },
  async getOperatorByUsername(username) {
    const { rows } = await pool.query(`SELECT * FROM operators WHERE username = $1`, [username]);
    return rows[0];
  },

  // --- machines ---
  async insertMachine({ operator_id, name, location, public_token }) {
    const { rows } = await pool.query(
      `INSERT INTO machines (operator_id, name, location, public_token)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [operator_id, name, location, public_token]
    );
    return rows[0];
  },
  async listMachinesForOperator(operator_id) {
    const { rows } = await pool.query(
      `SELECT m.*,
              COALESCE((SELECT COUNT(*) FROM requests r
                        WHERE r.machine_id = m.id AND r.status = 'new'), 0)::int AS new_count,
              COALESCE((SELECT COUNT(*) FROM requests r
                        WHERE r.machine_id = m.id), 0)::int                        AS total_count
       FROM machines m
       WHERE m.operator_id = $1
       ORDER BY m.created_at DESC`,
      [operator_id]
    );
    return rows;
  },
  async getMachineForOperator(id, operator_id) {
    const { rows } = await pool.query(
      `SELECT * FROM machines WHERE id = $1 AND operator_id = $2`,
      [id, operator_id]
    );
    return rows[0];
  },
  async getMachineByToken(token) {
    const { rows } = await pool.query(`SELECT * FROM machines WHERE public_token = $1`, [token]);
    return rows[0];
  },
  async deleteMachineForOperator(id, operator_id) {
    await pool.query(`DELETE FROM machines WHERE id = $1 AND operator_id = $2`, [id, operator_id]);
  },

  // --- requests ---
  async insertRequest({ machine_id, product_name, phone, notes }) {
    await pool.query(
      `INSERT INTO requests (machine_id, product_name, phone, notes)
       VALUES ($1, $2, $3, $4)`,
      [machine_id, product_name, phone, notes]
    );
  },
  async listRequestsForMachine(machine_id, status) {
    const { rows } = await pool.query(
      `SELECT * FROM requests WHERE machine_id = $1 AND status = $2 ORDER BY created_at DESC`,
      [machine_id, status]
    );
    return rows;
  },
  async listRecentRequestsForMachines(machineIds, limit = 3) {
    if (machineIds.length === 0) return [];
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT r.*,
                ROW_NUMBER() OVER (PARTITION BY machine_id ORDER BY created_at DESC) AS rn
         FROM requests r
         WHERE r.machine_id = ANY($1::int[]) AND r.status = 'new'
       ) t
       WHERE rn <= $2`,
      [machineIds, limit]
    );
    return rows;
  },
  async getRequestForOperator(id, operator_id) {
    const { rows } = await pool.query(
      `SELECT r.* FROM requests r
       JOIN machines m ON m.id = r.machine_id
       WHERE r.id = $1 AND m.operator_id = $2`,
      [id, operator_id]
    );
    return rows[0];
  },
  async updateRequestStatus(status, id, operator_id) {
    await pool.query(
      `UPDATE requests SET status = $1
       WHERE id = $2
         AND machine_id IN (SELECT id FROM machines WHERE operator_id = $3)`,
      [status, id, operator_id]
    );
  },
};

module.exports = { pool, initSchema, q };
