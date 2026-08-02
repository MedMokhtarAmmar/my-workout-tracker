const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Shared reference media, like exercise photos — lives directly in public/
// and is just served statically.
const MEDIA_DIR = path.join(__dirname, '..', '..', 'public', 'plan-covers');
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

let db;
function init(database) { db = database; }

// dataUrl is "data:image/jpeg;base64,..." as produced by the admin client's
// canvas resize step. Returns the public path to store as cover_image, or
// null if it isn't a recognized image type.
function saveCoverImageFromDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl || '');
  const ext = match && MIME_EXT[match[1]];
  if (!ext) return null;

  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, fileName), Buffer.from(match[2], 'base64'));
  return `/plan-covers/${fileName}`;
}

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

function createPlan(key, name, description, coverImage) {
  return db.prepare('INSERT INTO plans (key, name, description, cover_image) VALUES (?, ?, ?, ?)')
    .run(key, name, description || null, coverImage || null).lastInsertRowid;
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
  saveCoverImageFromDataUrl,
  getPlanSchedule,
  listPlans,
  findPlanByKey,
  createPlan,
  listTemplateSummaries,
  listTemplateIds,
  replaceSchedule,
  scheduledTemplateKeyForWeekday,
};
