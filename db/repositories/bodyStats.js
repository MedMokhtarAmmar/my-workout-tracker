let db;
function init(database) { db = database; }

function list(userId) {
  return db.prepare('SELECT * FROM body_stats WHERE user_id = ? ORDER BY date ASC').all(userId);
}

function create(userId, date, weightKg, waistCm, notes) {
  return db.prepare(`
    INSERT INTO body_stats (user_id, date, weight_kg, waist_cm, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, date, weightKg ?? null, waistCm ?? null, notes || null).lastInsertRowid;
}

module.exports = { init, list, create };
