const crypto = require('crypto');

let db;
function init(database) { db = database; }

function listForPlanKey(planKey) {
  return db.prepare(`
    SELECT t.* FROM templates t
    JOIN plans p ON p.id = t.plan_id
    WHERE p.key = ?
    ORDER BY t.id
  `).all(planKey);
}

function findByKey(key) {
  return db.prepare('SELECT * FROM templates WHERE key = ?').get(key);
}

function listExercisesWithDetail(templateId) {
  return db.prepare(`
    SELECT te.id AS template_exercise_id, te.order_index, te.target_sets,
           te.target_reps_low, te.target_reps_high, te.rest_seconds, te.notes,
           e.id AS exercise_id, e.name AS exercise_name, e.category AS exercise_category
    FROM template_exercises te
    JOIN exercises e ON e.id = te.exercise_id
    WHERE te.template_id = ?
    ORDER BY te.order_index
  `).all(templateId);
}

// Raw template_exercises rows (used to clone a template into a new session).
function listRawExercises(templateId) {
  return db.prepare('SELECT * FROM template_exercises WHERE template_id = ? ORDER BY order_index').all(templateId);
}

function create(planId, key, name, focus) {
  return db.prepare('INSERT INTO templates (plan_id, key, name, focus) VALUES (?, ?, ?, ?)')
    .run(planId, key, name, focus || null).lastInsertRowid;
}

// ---------- User-owned custom templates ----------
// Same tables as the shared library (plan_id NULL, user_id set instead), so
// starting a session from one works for free — POST /sessions already just
// looks a template up by key regardless of who owns it.

function listForUser(userId) {
  return db.prepare('SELECT * FROM templates WHERE user_id = ? ORDER BY id DESC').all(userId);
}

function findOwnedById(userId, templateId) {
  return db.prepare('SELECT * FROM templates WHERE id = ? AND user_id = ?').get(templateId, userId);
}

function findOwnedTemplateExercise(userId, templateExerciseId) {
  return db.prepare(`
    SELECT te.* FROM template_exercises te
    JOIN templates t ON t.id = te.template_id
    WHERE te.id = ? AND t.user_id = ?
  `).get(templateExerciseId, userId);
}

// Key is random rather than derived from the name so two users (or two of
// this user's own templates) can never collide on the table's UNIQUE key.
function createCustom(userId, name, focus) {
  const key = `custom_${crypto.randomUUID()}`;
  return db.prepare('INSERT INTO templates (plan_id, user_id, key, name, focus) VALUES (NULL, ?, ?, ?, ?)')
    .run(userId, key, name, focus || null).lastInsertRowid;
}

function removeCustom(templateId) {
  db.prepare('DELETE FROM template_exercises WHERE template_id = ?').run(templateId);
  db.prepare('DELETE FROM templates WHERE id = ?').run(templateId);
}

function nextOrderIndex(templateId) {
  return db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM template_exercises WHERE template_id = ?').get(templateId).m + 1;
}

function addExercise(templateId, exerciseId, orderIndex, targetSets, targetRepsLow, targetRepsHigh, restSeconds, notes) {
  return db.prepare(`
    INSERT INTO template_exercises
      (template_id, exercise_id, order_index, target_sets, target_reps_low, target_reps_high, rest_seconds, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(templateId, exerciseId, orderIndex, targetSets, targetRepsLow, targetRepsHigh, restSeconds || null, notes || null).lastInsertRowid;
}

function removeExercise(templateExerciseId) {
  db.prepare('DELETE FROM template_exercises WHERE id = ?').run(templateExerciseId);
}

module.exports = {
  init,
  listForPlanKey,
  findByKey,
  listExercisesWithDetail,
  listRawExercises,
  create,
  nextOrderIndex,
  addExercise,
  removeExercise,
  listForUser,
  findOwnedById,
  findOwnedTemplateExercise,
  createCustom,
  removeCustom,
};
