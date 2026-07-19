// Deliberately its own file, not tacked onto sessions.js/bodyStats.js/etc.
// Those repositories are used by regular per-user routes and every query
// in them is scoped by user_id on purpose — an "everyone" count doesn't
// belong next to functions a per-user route could accidentally call.

let db;
function init(database) { db = database; }

function summary() {
  return {
    totalUsers: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    totalSessions: db.prepare('SELECT COUNT(*) AS c FROM sessions').get().c,
    totalExercises: db.prepare('SELECT COUNT(*) AS c FROM exercises').get().c,
    totalPlans: db.prepare('SELECT COUNT(*) AS c FROM plans').get().c,
    totalProgressPhotos: db.prepare('SELECT COUNT(*) AS c FROM progress_photos').get().c,
  };
}

module.exports = { init, summary };
