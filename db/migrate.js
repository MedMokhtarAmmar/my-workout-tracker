// One-time migration for databases created before session_exercises existed:
// clones each session's template exercises into its own session_exercises
// rows, then repoints set_logs at those instead of the shared template rows.
// Safe to run every startup — no-ops once set_logs.session_exercise_id exists.

function ensureSessionExercisesMigration(db) {
  const columns = db.prepare('PRAGMA table_info(set_logs)').all();
  const alreadyMigrated = columns.some((c) => c.name === 'session_exercise_id');
  if (alreadyMigrated) return;

  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS session_exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id),
        exercise_id INTEGER NOT NULL REFERENCES exercises(id),
        order_index INTEGER NOT NULL,
        target_sets INTEGER NOT NULL,
        target_reps_low INTEGER NOT NULL,
        target_reps_high INTEGER NOT NULL,
        rest_seconds INTEGER,
        notes TEXT
      )
    `);

    const sessions = db.prepare('SELECT id, template_id FROM sessions').all();
    const getTemplateExercises = db.prepare('SELECT * FROM template_exercises WHERE template_id = ? ORDER BY order_index');
    const insertSessionExercise = db.prepare(`
      INSERT INTO session_exercises
        (session_id, exercise_id, order_index, target_sets, target_reps_low, target_reps_high, rest_seconds, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // old template_exercise_id -> new session_exercise_id, scoped per session
    const idMap = new Map();
    for (const s of sessions) {
      if (!s.template_id) continue;
      for (const te of getTemplateExercises.all(s.template_id)) {
        const info = insertSessionExercise.run(
          s.id, te.exercise_id, te.order_index, te.target_sets,
          te.target_reps_low, te.target_reps_high, te.rest_seconds, te.notes
        );
        idMap.set(`${s.id}-${te.id}`, info.lastInsertRowid);
      }
    }

    db.exec(`
      CREATE TABLE set_logs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES sessions(id),
        session_exercise_id INTEGER NOT NULL REFERENCES session_exercises(id),
        set_number INTEGER NOT NULL,
        reps INTEGER,
        weight_kg REAL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    const insertNewSetLog = db.prepare(`
      INSERT INTO set_logs_new (id, session_id, session_exercise_id, set_number, reps, weight_kg, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const row of db.prepare('SELECT * FROM set_logs').all()) {
      const sessionExerciseId = idMap.get(`${row.session_id}-${row.template_exercise_id}`);
      insertNewSetLog.run(row.id, row.session_id, sessionExerciseId, row.set_number, row.reps, row.weight_kg, row.created_at);
    }

    db.exec('DROP TABLE set_logs');
    db.exec('ALTER TABLE set_logs_new RENAME TO set_logs');
    db.exec('COMMIT');
    console.log(`Migrated ${sessions.length} sessions to session_exercises.`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function ensureCalendarEventIdColumn(db) {
  const columns = db.prepare('PRAGMA table_info(sessions)').all();
  if (columns.some((c) => c.name === 'calendar_event_id')) return;
  db.exec('ALTER TABLE sessions ADD COLUMN calendar_event_id TEXT');
}

// Existing templates predate the plans table — group them all under a
// default "Upper/Lower 4-Day Split" plan so nothing in the Today tab breaks.
function ensurePlansMigration(db) {
  const columns = db.prepare('PRAGMA table_info(templates)').all();
  if (columns.some((c) => c.name === 'plan_id')) return;

  db.exec('ALTER TABLE templates ADD COLUMN plan_id INTEGER REFERENCES plans(id)');

  let defaultPlan = db.prepare('SELECT id FROM plans WHERE key = ?').get('upper_lower');
  if (!defaultPlan) {
    const info = db.prepare(`
      INSERT INTO plans (key, name, description) VALUES (?, ?, ?)
    `).run('upper_lower', 'Upper/Lower 4-Day Split', 'A classic 4-day split alternating upper and lower body days.');
    defaultPlan = { id: info.lastInsertRowid };
  }

  db.prepare('UPDATE templates SET plan_id = ? WHERE plan_id IS NULL').run(defaultPlan.id);
  console.log('Migrated templates to plans (default: Upper/Lower 4-Day Split).');
}

function ensureExerciseMediaColumns(db) {
  const columns = db.prepare('PRAGMA table_info(exercises)').all();
  if (!columns.some((c) => c.name === 'image_path')) {
    db.exec('ALTER TABLE exercises ADD COLUMN image_path TEXT');
  }
  if (!columns.some((c) => c.name === 'video_url')) {
    db.exec('ALTER TABLE exercises ADD COLUMN video_url TEXT');
  }
}

// Upgrades a pre-multi-user database (single implicit owner) to the
// multi-user schema: assigns all existing data to a user row derived from
// OWNER_EMAIL (or the existing google_auth row's email), and rebuilds
// settings/google_auth/plan_schedule with proper per-user keys.
//
// Gated on `sessions.user_id` (not on the `users` table existing) because
// schema.sql's `CREATE TABLE IF NOT EXISTS users` always creates that table
// on every startup, including against this old-shaped database — checking
// for the table would make this look "already migrated" immediately and
// skip the real work.  No-op on a genuinely fresh install, since a fresh
// `sessions` table (from schema.sql) already has `user_id` from the start.
function ensureMultiUserMigration(db) {
  const sessionsColumns = db.prepare('PRAGMA table_info(sessions)').all();
  if (sessionsColumns.some((c) => c.name === 'user_id')) return;

  db.exec('BEGIN');
  try {
    // schema.sql already created `users` (IF NOT EXISTS) — just look up or
    // create the owner row to assign existing data to.
    const hadGoogleAuth = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='google_auth'").get();
    const existingAuth = hadGoogleAuth ? db.prepare('SELECT * FROM google_auth WHERE id = 1').get() : null;
    const ownerEmail = (process.env.OWNER_EMAIL || existingAuth?.email || '').toLowerCase() || null;

    let ownerId = null;
    if (ownerEmail) {
      const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(ownerEmail);
      ownerId = existingUser
        ? existingUser.id
        : db.prepare('INSERT INTO users (email) VALUES (?)').run(ownerEmail).lastInsertRowid;
    }

    // sessions: add user_id, backfill
    db.exec('ALTER TABLE sessions ADD COLUMN user_id INTEGER REFERENCES users(id)');
    if (ownerId) db.prepare('UPDATE sessions SET user_id = ?').run(ownerId);

    // body_stats: add user_id, backfill
    db.exec('ALTER TABLE body_stats ADD COLUMN user_id INTEGER REFERENCES users(id)');
    if (ownerId) db.prepare('UPDATE body_stats SET user_id = ?').run(ownerId);

    // settings: rebuild with composite (user_id, key) primary key
    const oldSettings = db.prepare('SELECT key, value FROM settings').all();
    db.exec('DROP TABLE settings');
    db.exec(`
      CREATE TABLE settings (
        user_id INTEGER NOT NULL REFERENCES users(id),
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (user_id, key)
      )
    `);
    if (ownerId) {
      const insertSetting = db.prepare('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)');
      for (const row of oldSettings) insertSetting.run(ownerId, row.key, row.value);
    }

    // google_auth: rebuild keyed by user_id instead of a fixed id=1 row
    db.exec('DROP TABLE IF EXISTS google_auth');
    db.exec(`
      CREATE TABLE google_auth (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        email TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        access_token TEXT,
        access_token_expiry INTEGER
      )
    `);
    if (ownerId && existingAuth) {
      db.prepare(`
        INSERT INTO google_auth (user_id, email, refresh_token, access_token, access_token_expiry)
        VALUES (?, ?, ?, ?, ?)
      `).run(ownerId, existingAuth.email, existingAuth.refresh_token, existingAuth.access_token, existingAuth.access_token_expiry);
    }

    // plan_schedule: rebuild with user_id and a per-user unique constraint
    // (the old UNIQUE(plan_id, weekday) would otherwise block a second
    // user from having a schedule entry on the same plan/weekday).
    const oldSchedule = db.prepare('SELECT plan_id, weekday, template_id FROM plan_schedule').all();
    db.exec('DROP TABLE plan_schedule');
    db.exec(`
      CREATE TABLE plan_schedule (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        plan_id INTEGER NOT NULL REFERENCES plans(id),
        weekday INTEGER NOT NULL,
        template_id INTEGER NOT NULL REFERENCES templates(id),
        UNIQUE(user_id, plan_id, weekday)
      )
    `);
    if (ownerId) {
      const insertSched = db.prepare('INSERT INTO plan_schedule (user_id, plan_id, weekday, template_id) VALUES (?, ?, ?, ?)');
      for (const row of oldSchedule) insertSched.run(ownerId, row.plan_id, row.weekday, row.template_id);
    }

    db.exec('COMMIT');
    console.log(`Migrated to multi-user schema${ownerEmail ? ` (existing data assigned to ${ownerEmail})` : ' (no prior owner found)'}.`);
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function ensurePasswordColumn(db) {
  const columns = db.prepare('PRAGMA table_info(users)').all();
  if (columns.some((c) => c.name === 'password_hash')) return;
  db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
}

// Adds the admin flag and, on first run only, grants it to OWNER_EMAIL (the
// same account the earlier multi-user migration assigned existing data to)
// so the backoffice has at least one admin without manual DB surgery.
function ensureAdminColumn(db) {
  const columns = db.prepare('PRAGMA table_info(users)').all();
  if (columns.some((c) => c.name === 'is_admin')) return;

  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');

  const ownerEmail = (process.env.OWNER_EMAIL || '').toLowerCase();
  if (ownerEmail) {
    const info = db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run(ownerEmail);
    if (info.changes) console.log(`Granted admin to ${ownerEmail}.`);
  }
}

// Lets a template be a user's own private custom one instead of shared
// library content — see schema.sql for the plan_id/user_id split.
function ensureTemplateUserIdColumn(db) {
  const columns = db.prepare('PRAGMA table_info(templates)').all();
  if (columns.some((c) => c.name === 'user_id')) return;
  db.exec('ALTER TABLE templates ADD COLUMN user_id INTEGER REFERENCES users(id)');
}

function ensurePlanCoverImageColumn(db) {
  const columns = db.prepare('PRAGMA table_info(plans)').all();
  if (columns.some((c) => c.name === 'cover_image')) return;
  db.exec('ALTER TABLE plans ADD COLUMN cover_image TEXT');
}

module.exports = {
  ensureSessionExercisesMigration,
  ensureCalendarEventIdColumn,
  ensurePlansMigration,
  ensureExerciseMediaColumns,
  ensureMultiUserMigration,
  ensurePasswordColumn,
  ensureAdminColumn,
  ensureTemplateUserIdColumn,
  ensurePlanCoverImageColumn,
};
