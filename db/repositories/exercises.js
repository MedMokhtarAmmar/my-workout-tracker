let db;
function init(database) { db = database; }

function listAll() {
  return db.prepare('SELECT * FROM exercises ORDER BY name').all();
}

function findById(id) {
  return db.prepare('SELECT * FROM exercises WHERE id = ?').get(id);
}

function create(name, category, imagePath, videoUrl) {
  return db.prepare('INSERT INTO exercises (name, category, image_path, video_url) VALUES (?, ?, ?, ?)')
    .run(name, category || null, imagePath || null, videoUrl || null).lastInsertRowid;
}

function update(id, name, category, imagePath, videoUrl) {
  db.prepare('UPDATE exercises SET name = ?, category = ?, image_path = ?, video_url = ? WHERE id = ?')
    .run(name, category || null, imagePath || null, videoUrl || null, id);
}

// An exercise used in a template (shared library) or a session (someone's
// logged history) can't be deleted without leaving orphaned references.
function isReferenced(id) {
  const inTemplates = db.prepare('SELECT 1 FROM template_exercises WHERE exercise_id = ? LIMIT 1').get(id);
  const inSessions = db.prepare('SELECT 1 FROM session_exercises WHERE exercise_id = ? LIMIT 1').get(id);
  return !!(inTemplates || inSessions);
}

function remove(id) {
  db.prepare('DELETE FROM exercises WHERE id = ?').run(id);
}

module.exports = { init, listAll, findById, create, update, isReferenced, remove };
