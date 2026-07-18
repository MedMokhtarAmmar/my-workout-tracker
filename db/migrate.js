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

module.exports = {
  ensureSessionExercisesMigration,
  ensureCalendarEventIdColumn,
  ensurePlansMigration,
  ensureExerciseMediaColumns,
};
