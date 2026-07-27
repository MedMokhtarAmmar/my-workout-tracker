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

// Weigh-ins within a range, oldest first, so a report can diff the first
// against the last to get a change over the period.
function inDateRange(userId, startDate, endDate) {
  return db.prepare(`
    SELECT date, weight_kg
    FROM body_stats
    WHERE user_id = ? AND date BETWEEN ? AND ? AND weight_kg IS NOT NULL
    ORDER BY date ASC
  `).all(userId, startDate, endDate);
}

module.exports = { init, list, create, inDateRange };
