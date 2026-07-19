const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIME_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

let db;
let photosDir;

function init(database, dir) {
  db = database;
  photosDir = dir;
  fs.mkdirSync(photosDir, { recursive: true });
}

function list(userId) {
  return db.prepare('SELECT id, date, weight_kg FROM progress_photos WHERE user_id = ? ORDER BY date ASC, id ASC').all(userId);
}

function findOwned(userId, photoId) {
  return db.prepare('SELECT * FROM progress_photos WHERE id = ? AND user_id = ?').get(photoId, userId);
}

function filePathFor(photo) {
  return path.join(photosDir, String(photo.user_id), photo.file_name);
}

// dataUrl is "data:image/jpeg;base64,..." as produced by the client's
// canvas resize step. Returns null if it isn't a recognized image type.
function createFromDataUrl(userId, date, weightKg, dataUrl) {
  const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/.exec(dataUrl || '');
  const ext = match && MIME_EXT[match[1]];
  if (!date || !ext) return null;

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], 'base64');

  const userDir = path.join(photosDir, String(userId));
  fs.mkdirSync(userDir, { recursive: true });
  const fileName = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(userDir, fileName), buffer);

  const id = db.prepare(`
    INSERT INTO progress_photos (user_id, date, weight_kg, file_name, mime_type)
    VALUES (?, ?, ?, ?, ?)
  `).run(userId, date, weightKg ?? null, fileName, mimeType).lastInsertRowid;

  return id;
}

function remove(photo) {
  fs.rm(filePathFor(photo), () => {});
  db.prepare('DELETE FROM progress_photos WHERE id = ?').run(photo.id);
}

module.exports = { init, list, findOwned, filePathFor, createFromDataUrl, remove };
