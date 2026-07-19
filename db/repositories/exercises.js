let db;
function init(database) { db = database; }

function listAll() {
  return db.prepare('SELECT * FROM exercises ORDER BY name').all();
}

module.exports = { init, listAll };
