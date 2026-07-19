let db;
function init(database) { db = database; }

function getSetting(userId, key, fallback) {
  return db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?').get(userId, key)?.value ?? fallback;
}

function setSetting(userId, key, value) {
  db.prepare(`
    INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `).run(userId, key, value);
}

module.exports = { init, getSetting, setSetting };
