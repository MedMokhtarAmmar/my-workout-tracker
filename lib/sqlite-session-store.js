const { Store } = require('express-session');

// Persists express-session data in the app's own SQLite db so logins
// survive server restarts (the default MemoryStore does not).
class SqliteSessionStore extends Store {
  constructor(db) {
    super();
    this.db = db;
  }

  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT data, expires FROM login_sessions WHERE id = ?').get(sid);
      if (!row || (row.expires && row.expires < Date.now())) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sessionData, cb) {
    try {
      const expires = sessionData.cookie?.expires
        ? new Date(sessionData.cookie.expires).getTime()
        : Date.now() + 30 * 24 * 60 * 60 * 1000;
      this.db.prepare(`
        INSERT INTO login_sessions (id, data, expires) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, expires = excluded.expires
      `).run(sid, JSON.stringify(sessionData), expires);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.db.prepare('DELETE FROM login_sessions WHERE id = ?').run(sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  touch(sid, sessionData, cb) {
    this.set(sid, sessionData, cb);
  }
}

module.exports = SqliteSessionStore;
