const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'app.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS operators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    business_name TEXT,
    email TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS machines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operator_id INTEGER NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    location TEXT,
    public_token TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_machines_operator ON machines(operator_id);

  CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    machine_id INTEGER NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
    product_name TEXT NOT NULL,
    category TEXT,
    notes TEXT,
    contact TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_requests_machine ON requests(machine_id, status);
`);

const stmts = {
  // operators
  insertOperator: db.prepare(
    `INSERT INTO operators (username, password_hash, business_name, email)
     VALUES (@username, @password_hash, @business_name, @email)`
  ),
  getOperatorByUsername: db.prepare(
    `SELECT * FROM operators WHERE username = ?`
  ),
  getOperatorById: db.prepare(`SELECT * FROM operators WHERE id = ?`),

  // machines
  insertMachine: db.prepare(
    `INSERT INTO machines (operator_id, name, location, public_token)
     VALUES (@operator_id, @name, @location, @public_token)`
  ),
  listMachinesForOperator: db.prepare(
    `SELECT m.*,
            (SELECT COUNT(*) FROM requests r WHERE r.machine_id = m.id AND r.status = 'new') AS new_count,
            (SELECT COUNT(*) FROM requests r WHERE r.machine_id = m.id) AS total_count
     FROM machines m
     WHERE m.operator_id = ?
     ORDER BY m.created_at DESC`
  ),
  getMachineForOperator: db.prepare(
    `SELECT * FROM machines WHERE id = ? AND operator_id = ?`
  ),
  getMachineByToken: db.prepare(
    `SELECT * FROM machines WHERE public_token = ?`
  ),
  deleteMachineForOperator: db.prepare(
    `DELETE FROM machines WHERE id = ? AND operator_id = ?`
  ),

  // requests
  insertRequest: db.prepare(
    `INSERT INTO requests (machine_id, product_name, category, notes, contact)
     VALUES (@machine_id, @product_name, @category, @notes, @contact)`
  ),
  listRequestsForMachine: db.prepare(
    `SELECT * FROM requests
     WHERE machine_id = ? AND status = ?
     ORDER BY created_at DESC`
  ),
  getRequestForOperator: db.prepare(
    `SELECT r.* FROM requests r
     JOIN machines m ON m.id = r.machine_id
     WHERE r.id = ? AND m.operator_id = ?`
  ),
  updateRequestStatus: db.prepare(
    `UPDATE requests SET status = ?
     WHERE id = ? AND machine_id IN (SELECT id FROM machines WHERE operator_id = ?)`
  ),
};

module.exports = { db, stmts };
