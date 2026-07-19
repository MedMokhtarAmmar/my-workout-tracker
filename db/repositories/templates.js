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

module.exports = { init, listForPlanKey, findByKey, listExercisesWithDetail, listRawExercises };
