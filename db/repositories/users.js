let db;
function init(database) { db = database; }

function findByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function findById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// Password-account creation only — callers must already have checked no
// account with this email exists (see routes/auth.js for why that check
// can't live here: it's a security decision, not a data one).
function createWithPassword(email, passwordHash) {
  return db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, passwordHash).lastInsertRowid;
}

function count() {
  return db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
}

function list() {
  return db.prepare('SELECT id, email, created_at FROM users ORDER BY created_at DESC').all();
}

module.exports = { init, findByEmail, findById, createWithPassword, count, list };
