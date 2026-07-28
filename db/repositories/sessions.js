let db;
function init(database) { db = database; }

// All-time best weight per exercise for this user, keyed by exercise_id —
// used to detect a new PR the moment a set is logged, without a query per set.
function prWeightsByExercise(userId) {
  const rows = db.prepare(`
    SELECT se.exercise_id, MAX(sl.weight_kg) AS max_weight
    FROM set_logs sl
    JOIN session_exercises se ON se.id = sl.session_exercise_id
    JOIN sessions s ON s.id = sl.session_id
    WHERE s.user_id = ? AND sl.weight_kg IS NOT NULL AND sl.reps IS NOT NULL
    GROUP BY se.exercise_id
  `).all(userId);
  const map = {};
  rows.forEach((r) => { map[r.exercise_id] = r.max_weight; });
  return map;
}

function findForDate(userId, date) {
  return db.prepare(`
    SELECT s.*, t.name AS template_name, t.key AS template_key, t.focus AS template_focus
    FROM sessions s
    LEFT JOIN templates t ON t.id = s.template_id
    WHERE s.user_id = ? AND s.date = ?
  `).get(userId, date);
}

function create(userId, date, templateId, cardioMinutes, notes) {
  return db.prepare(`
    INSERT INTO sessions (user_id, date, template_id, cardio_minutes, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, date, templateId, cardioMinutes || 0, notes || null).lastInsertRowid;
}

function cloneTemplateExercisesInto(sessionId, templateExercises) {
  const insert = db.prepare(`
    INSERT INTO session_exercises
      (session_id, exercise_id, order_index, target_sets, target_reps_low, target_reps_high, rest_seconds, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const te of templateExercises) {
    insert.run(
      sessionId, te.exercise_id, te.order_index, te.target_sets,
      te.target_reps_low, te.target_reps_high, te.rest_seconds, te.notes
    );
  }
}

function setCalendarEventId(sessionId, calendarEventId) {
  db.prepare('UPDATE sessions SET calendar_event_id = ? WHERE id = ?').run(calendarEventId, sessionId);
}

// Sets logged for this exercise in the most recent other session (this
// user's only) that included it, so the UI can show "last time" numbers.
function getPreviousSets(userId, exerciseId, excludeSessionId) {
  const lastSession = db.prepare(`
    SELECT sl.session_id, s.date
    FROM set_logs sl
    JOIN session_exercises se ON se.id = sl.session_exercise_id
    JOIN sessions s ON s.id = sl.session_id
    WHERE se.exercise_id = ? AND sl.session_id != ? AND s.user_id = ?
    ORDER BY s.date DESC, sl.session_id DESC, sl.id DESC
    LIMIT 1
  `).get(exerciseId, excludeSessionId, userId);
  if (!lastSession) return { date: null, sets: [] };

  const sets = db.prepare(`
    SELECT sl.set_number, sl.reps, sl.weight_kg
    FROM set_logs sl
    JOIN session_exercises se ON se.id = sl.session_exercise_id
    WHERE se.exercise_id = ? AND sl.session_id = ?
    ORDER BY sl.set_number ASC
  `).all(exerciseId, lastSession.session_id);

  return { date: lastSession.date, sets };
}

// Ownership-check helpers — every route touching a session (or anything
// under it) by id calls one of these first.
function findOwned(userId, sessionId) {
  return db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?').get(sessionId, userId);
}

function findOwnedSessionExercise(userId, sessionExerciseId) {
  return db.prepare(`
    SELECT se.* FROM session_exercises se
    JOIN sessions s ON s.id = se.session_id
    WHERE se.id = ? AND s.user_id = ?
  `).get(sessionExerciseId, userId);
}

function findOwnedSet(userId, setId) {
  return db.prepare(`
    SELECT sl.* FROM set_logs sl
    JOIN sessions s ON s.id = sl.session_id
    WHERE sl.id = ? AND s.user_id = ?
  `).get(setId, userId);
}

function listExercises(sessionId) {
  return db.prepare(`
    SELECT se.id AS session_exercise_id, se.order_index, se.target_sets,
           se.target_reps_low, se.target_reps_high, se.rest_seconds, se.notes,
           e.id AS exercise_id, e.name AS exercise_name, e.category AS exercise_category,
           e.image_path AS exercise_image, e.video_url AS exercise_video
    FROM session_exercises se
    JOIN exercises e ON e.id = se.exercise_id
    WHERE se.session_id = ?
    ORDER BY se.order_index
  `).all(sessionId);
}

function addExercise(sessionId, exerciseId, targetSets, targetRepsLow, targetRepsHigh, restSeconds, notes) {
  const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM session_exercises WHERE session_id = ?')
    .get(sessionId).m;
  return db.prepare(`
    INSERT INTO session_exercises
      (session_id, exercise_id, order_index, target_sets, target_reps_low, target_reps_high, rest_seconds, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, exerciseId, maxOrder + 1, targetSets || 3, targetRepsLow || 8, targetRepsHigh || 12, restSeconds || null, notes || null)
    .lastInsertRowid;
}

function replaceSessionExercise(sessionExerciseId, exerciseId) {
  db.prepare('DELETE FROM set_logs WHERE session_exercise_id = ?').run(sessionExerciseId);
  db.prepare('UPDATE session_exercises SET exercise_id = ? WHERE id = ?').run(exerciseId, sessionExerciseId);
}

function removeSessionExercise(sessionExerciseId) {
  db.prepare('DELETE FROM set_logs WHERE session_exercise_id = ?').run(sessionExerciseId);
  db.prepare('DELETE FROM session_exercises WHERE id = ?').run(sessionExerciseId);
}

function list(userId) {
  return db.prepare(`
    SELECT s.*, t.name AS template_name, t.key AS template_key
    FROM sessions s
    LEFT JOIN templates t ON t.id = s.template_id
    WHERE s.user_id = ?
    ORDER BY s.date DESC, s.id DESC
    LIMIT 100
  `).all(userId);
}

function listForDate(userId, date) {
  return db.prepare(`
    SELECT s.*, t.name AS template_name, t.key AS template_key, t.focus AS template_focus
    FROM sessions s
    LEFT JOIN templates t ON t.id = s.template_id
    WHERE s.user_id = ? AND s.date = ?
    ORDER BY s.id DESC
  `).all(userId, date);
}

function findByIdWithSets(sessionId, userId) {
  const session = db.prepare(`
    SELECT s.*, t.name AS template_name, t.key AS template_key
    FROM sessions s
    LEFT JOIN templates t ON t.id = s.template_id
    WHERE s.id = ? AND s.user_id = ?
  `).get(sessionId, userId);
  if (!session) return null;

  const sets = db.prepare(`
    SELECT sl.*, e.name AS exercise_name
    FROM set_logs sl
    JOIN session_exercises se ON se.id = sl.session_exercise_id
    JOIN exercises e ON e.id = se.exercise_id
    WHERE sl.session_id = ?
    ORDER BY sl.id
  `).all(session.id);

  return { ...session, sets };
}

function update(sessionId, cardioMinutes, notes) {
  db.prepare('UPDATE sessions SET cardio_minutes = ?, notes = ? WHERE id = ?')
    .run(cardioMinutes ?? 0, notes || null, sessionId);
}

function remove(sessionId) {
  db.prepare('DELETE FROM set_logs WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM session_exercises WHERE session_id = ?').run(sessionId);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

function addSet(sessionId, sessionExerciseId, setNumber, reps, weightKg) {
  return db.prepare(`
    INSERT INTO set_logs (session_id, session_exercise_id, set_number, reps, weight_kg)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, sessionExerciseId, setNumber, reps ?? null, weightKg ?? null).lastInsertRowid;
}

function updateSet(setId, reps, weightKg) {
  db.prepare('UPDATE set_logs SET reps = ?, weight_kg = ? WHERE id = ?').run(reps ?? null, weightKg ?? null, setId);
}

function removeSet(setId) {
  db.prepare('DELETE FROM set_logs WHERE id = ?').run(setId);
}

function progressForExercise(userId, exerciseId) {
  return db.prepare(`
    SELECT s.date, sl.set_number, sl.reps, sl.weight_kg
    FROM set_logs sl
    JOIN sessions s ON s.id = sl.session_id
    JOIN session_exercises se ON se.id = sl.session_exercise_id
    WHERE se.exercise_id = ? AND s.user_id = ?
    ORDER BY s.date ASC, sl.id ASC
  `).all(exerciseId, userId);
}

function inDateRange(userId, startDate, endDate) {
  return db.prepare(`
    SELECT s.id, s.date, t.key AS template_key, t.name AS template_name
    FROM sessions s
    LEFT JOIN templates t ON t.id = s.template_id
    WHERE s.user_id = ? AND s.date BETWEEN ? AND ?
    ORDER BY s.date ASC
  `).all(userId, startDate, endDate);
}

function volumeInDateRange(userId, startDate, endDate) {
  return db.prepare(`
    SELECT COALESCE(SUM(sl.reps * sl.weight_kg), 0) AS total
    FROM set_logs sl
    JOIN sessions s ON s.id = sl.session_id
    WHERE s.user_id = ? AND s.date BETWEEN ? AND ? AND sl.reps IS NOT NULL AND sl.weight_kg IS NOT NULL
  `).get(userId, startDate, endDate);
}

function cardioMinutesInDateRange(userId, startDate, endDate) {
  return db.prepare(`
    SELECT COALESCE(SUM(cardio_minutes), 0) AS total
    FROM sessions
    WHERE user_id = ? AND date BETWEEN ? AND ?
  `).get(userId, startDate, endDate);
}

function completedSetsCountInDateRange(userId, startDate, endDate) {
  return db.prepare(`
    SELECT COUNT(*) AS count
    FROM set_logs sl
    JOIN sessions s ON s.id = sl.session_id
    WHERE s.user_id = ? AND s.date BETWEEN ? AND ? AND sl.reps IS NOT NULL
  `).get(userId, startDate, endDate);
}

// Per-exercise rollup for a report: how much of each exercise was actually
// done (completed sets only) in the range, ranked by volume so the busiest
// lifts surface first.
function exerciseBreakdownInDateRange(userId, startDate, endDate) {
  return db.prepare(`
    SELECT e.name AS exercise_name,
           COUNT(*) AS sets,
           COALESCE(SUM(sl.reps * sl.weight_kg), 0) AS volume,
           MAX(sl.weight_kg) AS max_weight
    FROM set_logs sl
    JOIN session_exercises se ON se.id = sl.session_exercise_id
    JOIN sessions s ON s.id = sl.session_id
    JOIN exercises e ON e.id = se.exercise_id
    WHERE s.user_id = ? AND s.date BETWEEN ? AND ? AND sl.reps IS NOT NULL
    GROUP BY e.id
    ORDER BY volume DESC
  `).all(userId, startDate, endDate);
}

function inMonth(userId, monthPrefix) {
  return db.prepare(`
    SELECT s.id, s.date, t.name AS template_name
    FROM sessions s
    LEFT JOIN templates t ON t.id = s.template_id
    WHERE s.user_id = ? AND s.date LIKE ?
    ORDER BY s.date ASC, s.id ASC
  `).all(userId, `${monthPrefix}%`);
}

module.exports = {
  init,
  prWeightsByExercise,
  findForDate,
  create,
  cloneTemplateExercisesInto,
  setCalendarEventId,
  getPreviousSets,
  findOwned,
  findOwnedSessionExercise,
  findOwnedSet,
  listExercises,
  addExercise,
  replaceSessionExercise,
  removeSessionExercise,
  list,
  listForDate,
  findByIdWithSets,
  update,
  remove,
  addSet,
  updateSet,
  removeSet,
  progressForExercise,
  inDateRange,
  volumeInDateRange,
  cardioMinutesInDateRange,
  completedSetsCountInDateRange,
  exerciseBreakdownInDateRange,
  inMonth,
};
