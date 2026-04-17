const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set. See .env.example.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // SSL is required by most managed Postgres providers (Render, Neon, Supabase).
  // Only skip SSL for local Postgres (docker compose / localhost).
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)
    ? false
    : { rejectUnauthorized: false },
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres error', err);
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS operators (
      id                        SERIAL PRIMARY KEY,
      username                  TEXT UNIQUE NOT NULL,
      password_hash             TEXT NOT NULL,
      business_name             TEXT,
      email                     TEXT,
      email_verified            BOOLEAN NOT NULL DEFAULT TRUE,
      verification_token        TEXT,
      verification_expires_at   TIMESTAMPTZ,
      created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    -- Idempotent upgrades for existing deploys.
    ALTER TABLE operators ADD COLUMN IF NOT EXISTS email_verified          BOOLEAN NOT NULL DEFAULT TRUE;
    ALTER TABLE operators ADD COLUMN IF NOT EXISTS verification_token      TEXT;
    ALTER TABLE operators ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_operators_email_ci
      ON operators (LOWER(email)) WHERE email IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_operators_verification_token
      ON operators (verification_token) WHERE verification_token IS NOT NULL;

    CREATE TABLE IF NOT EXISTS machines (
      id              SERIAL PRIMARY KEY,
      operator_id     INTEGER NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      location        TEXT,
      public_token    TEXT UNIQUE NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_machines_operator ON machines(operator_id);
    ALTER TABLE machines ADD COLUMN IF NOT EXISTS address TEXT;
    ALTER TABLE machines ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
    ALTER TABLE machines ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

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
  async insertOperator({
    username, password_hash, business_name, email,
    email_verified = true, verification_token = null, verification_expires_at = null,
  }) {
    const { rows } = await pool.query(
      `INSERT INTO operators
         (username, password_hash, business_name, email,
          email_verified, verification_token, verification_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, email`,
      [username, password_hash, business_name, email,
       email_verified, verification_token, verification_expires_at]
    );
    return rows[0];
  },
  async getOperatorById(id) {
    const { rows } = await pool.query(`SELECT * FROM operators WHERE id = $1`, [id]);
    return rows[0];
  },
  async getOperatorByUsername(username) {
    const { rows } = await pool.query(`SELECT * FROM operators WHERE username = $1`, [username]);
    return rows[0];
  },
  async getOperatorByEmail(email) {
    const { rows } = await pool.query(
      `SELECT * FROM operators WHERE LOWER(email) = LOWER($1)`, [email]
    );
    return rows[0];
  },
  async getOperatorByVerificationToken(token) {
    const { rows } = await pool.query(
      `SELECT * FROM operators WHERE verification_token = $1`, [token]
    );
    return rows[0];
  },
  async setVerificationToken(id, token, expiresAt) {
    await pool.query(
      `UPDATE operators
         SET verification_token = $1,
             verification_expires_at = $2
       WHERE id = $3`,
      [token, expiresAt, id]
    );
  },
  async markEmailVerified(id) {
    await pool.query(
      `UPDATE operators
         SET email_verified = TRUE,
             verification_token = NULL,
             verification_expires_at = NULL
       WHERE id = $1`,
      [id]
    );
  },

  // --- machines ---
  async insertMachine({ operator_id, name, location, public_token, address, lat, lng }) {
    const { rows } = await pool.query(
      `INSERT INTO machines (operator_id, name, location, public_token, address, lat, lng)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [operator_id, name, location, public_token, address || null, lat || null, lng || null]
    );
    return rows[0];
  },
  async updateMachineLocation(id, operator_id, { address, lat, lng }) {
    await pool.query(
      `UPDATE machines SET address = $1, lat = $2, lng = $3
       WHERE id = $4 AND operator_id = $5`,
      [address || null, lat || null, lng || null, id, operator_id]
    );
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
