const crypto = require('crypto');

let db;
function init(database) { db = database; }

function create(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO api_tokens (token, user_id) VALUES (?, ?)').run(token, userId);
  return token;
}

function findUser(token) {
  return db.prepare(`
    SELECT users.id, users.email FROM api_tokens
    JOIN users ON users.id = api_tokens.user_id
    WHERE api_tokens.token = ?
  `).get(token);
}

function revoke(token) {
  db.prepare('DELETE FROM api_tokens WHERE token = ?').run(token);
}

module.exports = { init, create, findUser, revoke };
