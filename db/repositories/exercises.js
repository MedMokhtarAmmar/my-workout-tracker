const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Exercise photos are shared reference media (not user-owned like progress
// photos), so they live directly in public/ and are just served statically.
const MEDIA_DIR = path.join(__dirname, '..', '..', 'public', 'exercise-media');
const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

let db;
function init(database) { db = database; }

// dataUrl is "data:image/jpeg;base64,..." as produced by the admin client's
// canvas resize step. Returns the public path to store as image_path, or
// null if it isn't a recognized image type.
function saveImageFromDataUrl(dataUrl) {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl || '');
  const ext = match && MIME_EXT[match[1]];
  if (!ext) return null;

  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, fileName), Buffer.from(match[2], 'base64'));
  return `/exercise-media/${fileName}`;
}

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

module.exports = { init, saveImageFromDataUrl, listAll, findById, create, update, isReferenced, remove };
