let db;
function init(database) { db = database; }

function getPlanSchedule(userId, planId) {
  return db.prepare(`
    SELECT ps.weekday, t.key AS template_key, t.name AS template_name
    FROM plan_schedule ps
    JOIN templates t ON t.id = ps.template_id
    WHERE ps.user_id = ? AND ps.plan_id = ?
    ORDER BY ps.weekday
  `).all(userId, planId);
}

function listPlans() {
  return db.prepare('SELECT * FROM plans ORDER BY id').all();
}

function findPlanByKey(key) {
  return db.prepare('SELECT id FROM plans WHERE key = ?').get(key);
}

function listTemplateSummaries(planId) {
  return db.prepare('SELECT key, name, focus FROM templates WHERE plan_id = ? ORDER BY id').all(planId);
}

function listTemplateIds(planId) {
  return db.prepare('SELECT id FROM templates WHERE plan_id = ? ORDER BY id').all(planId);
}

// Replaces this user's schedule for this plan with one entry per given
// weekday, assigning templates in rotation.
function replaceSchedule(userId, planId, weekdays, templateIds) {
  db.prepare('DELETE FROM plan_schedule WHERE user_id = ? AND plan_id = ?').run(userId, planId);
  const insert = db.prepare('INSERT INTO plan_schedule (user_id, plan_id, weekday, template_id) VALUES (?, ?, ?, ?)');
  weekdays.forEach((weekday, i) => {
    insert.run(userId, planId, weekday, templateIds[i % templateIds.length]);
  });
}

function scheduledTemplateKeyForWeekday(userId, planId, weekday) {
  return db.prepare(`
    SELECT t.key
    FROM plan_schedule ps
    JOIN templates t ON t.id = ps.template_id
    WHERE ps.user_id = ? AND ps.plan_id = ? AND ps.weekday = ?
  `).get(userId, planId, weekday);
}

module.exports = {
  init,
  getPlanSchedule,
  listPlans,
  findPlanByKey,
  listTemplateSummaries,
  listTemplateIds,
  replaceSchedule,
  scheduledTemplateKeyForWeekday,
};
