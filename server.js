const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const { DatabaseSync } = require('node:sqlite');
const { seed, categorizeExercises, attachExerciseMedia } = require('./db/seed');
const {
  ensureSessionExercisesMigration, ensureCalendarEventIdColumn, ensurePlansMigration, ensureExerciseMediaColumns,
} = require('./db/migrate');
const googleAuth = require('./lib/google');
const SqliteSessionStore = require('./lib/sqlite-session-store');

const DB_PATH = path.join(__dirname, 'data', 'app.db');
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const db = new DatabaseSync(DB_PATH);

const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
db.exec(schema);
ensureSessionExercisesMigration(db);
ensureCalendarEventIdColumn(db);
ensurePlansMigration(db);
ensureExerciseMediaColumns(db);
seed(db);
categorizeExercises(db);
attachExerciseMedia(db);
googleAuth.init(db);

function getSetting(key, fallback) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
}
function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

const app = express();
app.set('trust proxy', 1); // behind Caddy in production; needed for secure cookies to work
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist')));
app.use(session({
  store: new SqliteSessionStore(db),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, secure: 'auto', maxAge: 30 * 24 * 60 * 60 * 1000 },
}));

function requireAuthPage(req, res, next) {
  if (req.session.loggedIn) return next();
  res.redirect('/login.html');
}
function requireAuth(req, res, next) {
  if (req.session.loggedIn) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

app.get('/', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/index.html', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------- Auth ----------

app.get('/auth/google', (req, res) => {
  res.redirect(googleAuth.getAuthUrl());
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/login.html?error=access_denied');
  try {
    const email = await googleAuth.handleCallback(code);
    req.session.loggedIn = true;
    req.session.email = email;
    res.redirect('/');
  } catch (err) {
    const reason = err.code === 'UNAUTHORIZED_ACCOUNT' ? 'not_authorized' : 'auth_failed';
    console.error('Google auth failed:', err.message);
    res.redirect(`/login.html?error=${reason}`);
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/status', (req, res) => {
  res.json({ loggedIn: !!req.session.loggedIn, email: req.session.email || null });
});

app.use('/api', requireAuth);

// ---------- Settings ----------

app.get('/api/settings', (req, res) => {
  res.json({
    reminder_time: getSetting('reminder_time', '18:00'),
    timezone: getSetting('timezone', 'UTC'),
    nutrition_age: getSetting('nutrition_age', ''),
    nutrition_sex: getSetting('nutrition_sex', 'male'),
    nutrition_height_cm: getSetting('nutrition_height_cm', ''),
    nutrition_activity: getSetting('nutrition_activity', '1.55'),
    nutrition_goal: getSetting('nutrition_goal', 'maintain'),
    nutrition_calorie_adjustment: getSetting('nutrition_calorie_adjustment', ''),
    nutrition_body_fat_pct: getSetting('nutrition_body_fat_pct', ''),
  });
});

app.put('/api/settings', (req, res) => {
  const {
    reminder_time, timezone,
    nutrition_age, nutrition_sex, nutrition_height_cm, nutrition_activity,
    nutrition_goal, nutrition_calorie_adjustment, nutrition_body_fat_pct,
  } = req.body;
  if (reminder_time) setSetting('reminder_time', reminder_time);
  if (timezone) setSetting('timezone', timezone);
  if (nutrition_age) setSetting('nutrition_age', nutrition_age);
  if (nutrition_sex) setSetting('nutrition_sex', nutrition_sex);
  if (nutrition_height_cm) setSetting('nutrition_height_cm', nutrition_height_cm);
  if (nutrition_activity) setSetting('nutrition_activity', nutrition_activity);
  if (nutrition_goal) setSetting('nutrition_goal', nutrition_goal);
  if (nutrition_calorie_adjustment) setSetting('nutrition_calorie_adjustment', nutrition_calorie_adjustment);
  if (nutrition_body_fat_pct) setSetting('nutrition_body_fat_pct', nutrition_body_fat_pct);
  res.json({ ok: true });
});

// ---------- Plans ----------

function getPlanSchedule(planId) {
  return db.prepare(`
    SELECT ps.weekday, t.key AS template_key, t.name AS template_name
    FROM plan_schedule ps
    JOIN templates t ON t.id = ps.template_id
    WHERE ps.plan_id = ?
    ORDER BY ps.weekday
  `).all(planId);
}

app.get('/api/plans', (req, res) => {
  const activeKey = getSetting('active_plan_key', 'upper_lower');
  const plans = db.prepare('SELECT * FROM plans ORDER BY id').all();
  const result = plans.map((p) => ({
    ...p,
    active: p.key === activeKey,
    templates: db.prepare('SELECT key, name, focus FROM templates WHERE plan_id = ? ORDER BY id').all(p.id),
    schedule: getPlanSchedule(p.id),
  }));
  res.json(result);
});

app.put('/api/plans/active', (req, res) => {
  const plan = db.prepare('SELECT id FROM plans WHERE key = ?').get(req.body.key);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  setSetting('active_plan_key', req.body.key);
  res.json({ ok: true });
});

// Assigns the chosen weekdays to this plan's templates in rotation (e.g.
// Sun/Mon/Wed/Fri -> Upper A/Lower A/Upper B/Lower B). Any weekday not
// included is a rest day. Replaces whatever schedule this plan had before.
app.put('/api/plans/:key/schedule', (req, res) => {
  const plan = db.prepare('SELECT id FROM plans WHERE key = ?').get(req.params.key);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  const weekdays = [...new Set(req.body.weekdays || [])]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b);
  const templates = db.prepare('SELECT id FROM templates WHERE plan_id = ? ORDER BY id').all(plan.id);
  if (templates.length === 0) return res.status(400).json({ error: 'Plan has no templates' });

  db.prepare('DELETE FROM plan_schedule WHERE plan_id = ?').run(plan.id);
  const insert = db.prepare('INSERT INTO plan_schedule (plan_id, weekday, template_id) VALUES (?, ?, ?)');
  weekdays.forEach((weekday, i) => {
    insert.run(plan.id, weekday, templates[i % templates.length].id);
  });

  res.json({ schedule: getPlanSchedule(plan.id) });
});

// ---------- Templates ----------

// Only the active plan's templates — this is what populates the Today tab.
app.get('/api/templates', (req, res) => {
  const planKey = req.query.plan_key || getSetting('active_plan_key', 'upper_lower');
  const templates = db.prepare(`
    SELECT t.* FROM templates t
    JOIN plans p ON p.id = t.plan_id
    WHERE p.key = ?
    ORDER BY t.id
  `).all(planKey);
  res.json(templates);
});

// Which template should be preselected for a new workout: whatever the
// active plan's calendar schedule has for this weekday. An empty key means
// a rest day — the Today tab offers "Cardio day" (no template) for those.
app.get('/api/templates/suggested', (req, res) => {
  const planKey = getSetting('active_plan_key', 'upper_lower');
  const plan = db.prepare('SELECT id FROM plans WHERE key = ?').get(planKey);
  if (!plan) return res.json({ key: '' });

  // Parsed as UTC and read back as UTC so the weekday matches the calendar
  // date the client sent, regardless of the server's own timezone.
  const dateStr = req.query.date;
  const weekday = new Date(`${dateStr}T00:00:00Z`).getUTCDay();

  const scheduled = db.prepare(`
    SELECT t.key
    FROM plan_schedule ps
    JOIN templates t ON t.id = ps.template_id
    WHERE ps.plan_id = ? AND ps.weekday = ?
  `).get(plan.id, weekday);

  res.json({ key: scheduled ? scheduled.key : '' });
});

app.get('/api/templates/:key', (req, res) => {
  const template = db.prepare('SELECT * FROM templates WHERE key = ?').get(req.params.key);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const exercises = db.prepare(`
    SELECT te.id AS template_exercise_id, te.order_index, te.target_sets,
           te.target_reps_low, te.target_reps_high, te.rest_seconds, te.notes,
           e.id AS exercise_id, e.name AS exercise_name, e.category AS exercise_category
    FROM template_exercises te
    JOIN exercises e ON e.id = te.exercise_id
    WHERE te.template_id = ?
    ORDER BY te.order_index
  `).all(template.id);

  res.json({ ...template, exercises });
});

// ---------- Sessions ----------

app.post('/api/sessions', async (req, res) => {
  const { date, template_key, cardio_minutes, notes } = req.body;

  // Only one workout per date — if one's already started, resume it
  // instead of creating a duplicate.
  const existing = db.prepare(`
    SELECT s.*, t.name AS template_name, t.key AS template_key, t.focus AS template_focus
    FROM sessions s
    LEFT JOIN templates t ON t.id = s.template_id
    WHERE s.date = ?
  `).get(date);
  if (existing) {
    return res.json({
      id: existing.id,
      template_name: existing.template_name,
      template_focus: existing.template_focus,
      calendar_event_id: existing.calendar_event_id,
    });
  }

  const template = template_key
    ? db.prepare('SELECT * FROM templates WHERE key = ?').get(template_key)
    : null;

  const info = db.prepare(`
    INSERT INTO sessions (date, template_id, cardio_minutes, notes)
    VALUES (?, ?, ?, ?)
  `).run(date, template ? template.id : null, cardio_minutes || 0, notes || null);
  const sessionId = info.lastInsertRowid;

  if (template) {
    const templateExercises = db.prepare(`
      SELECT * FROM template_exercises WHERE template_id = ? ORDER BY order_index
    `).all(template.id);
    const insertSessionExercise = db.prepare(`
      INSERT INTO session_exercises
        (session_id, exercise_id, order_index, target_sets, target_reps_low, target_reps_high, rest_seconds, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const te of templateExercises) {
      insertSessionExercise.run(
        sessionId, te.exercise_id, te.order_index, te.target_sets,
        te.target_reps_low, te.target_reps_high, te.rest_seconds, te.notes
      );
    }
  }

  let calendarEventId = null;
  if (googleAuth.isConnected()) {
    try {
      calendarEventId = await googleAuth.createWorkoutEvent({
        date,
        time: getSetting('reminder_time', '18:00'),
        timeZone: getSetting('timezone', 'UTC'),
        title: `Workout: ${template ? template.name : 'Workout'}`,
      });
      if (calendarEventId) {
        db.prepare('UPDATE sessions SET calendar_event_id = ? WHERE id = ?').run(calendarEventId, sessionId);
      }
    } catch (err) {
      console.error('Failed to create calendar reminder:', err.message);
    }
  }

  res.json({
    id: sessionId,
    template_name: template ? template.name : null,
    template_focus: template ? template.focus : null,
    calendar_event_id: calendarEventId,
  });
});

// Sets logged for this exercise in the most recent other session that
// included it, so the UI can show "last time" numbers alongside today's.
function getPreviousSets(exerciseId, excludeSessionId) {
  const lastSession = db.prepare(`
    SELECT sl.session_id, s.date
    FROM set_logs sl
    JOIN session_exercises se ON se.id = sl.session_exercise_id
    JOIN sessions s ON s.id = sl.session_id
    WHERE se.exercise_id = ? AND sl.session_id != ?
    ORDER BY s.date DESC, sl.session_id DESC, sl.id DESC
    LIMIT 1
  `).get(exerciseId, excludeSessionId);
  if (!lastSession) return { date: null, sets: [] };

  const sets = db.prepare(`
    SELECT sl.set_number, sl.reps, sl.weight_kg
    FROM set_logs sl
    JOIN session_exercises se ON se.id = sl.session_exercise_id
    WHERE se.exercise_id = ? AND sl.session_id = ?
    ORDER BY sl.set_number ASC
  `).all(exerciseId, lastSession.session_id);

  return { date: lastSession.date, sets };
}

// The exercises actually in a given session's plan (cloned from the
// template at session start, then freely editable per-session).
app.get('/api/sessions/:id/exercises', (req, res) => {
  const exercises = db.prepare(`
    SELECT se.id AS session_exercise_id, se.order_index, se.target_sets,
           se.target_reps_low, se.target_reps_high, se.rest_seconds, se.notes,
           e.id AS exercise_id, e.name AS exercise_name, e.category AS exercise_category,
           e.image_path AS exercise_image, e.video_url AS exercise_video
    FROM session_exercises se
    JOIN exercises e ON e.id = se.exercise_id
    WHERE se.session_id = ?
    ORDER BY se.order_index
  `).all(req.params.id);

  for (const ex of exercises) {
    ex.previous = getPreviousSets(ex.exercise_id, req.params.id);
  }

  res.json(exercises);
});

// Add an exercise to today's plan only.
app.post('/api/sessions/:id/exercises', (req, res) => {
  const { exercise_id, target_sets, target_reps_low, target_reps_high, rest_seconds, notes } = req.body;
  const maxOrder = db.prepare('SELECT COALESCE(MAX(order_index), -1) AS m FROM session_exercises WHERE session_id = ?')
    .get(req.params.id).m;

  const info = db.prepare(`
    INSERT INTO session_exercises
      (session_id, exercise_id, order_index, target_sets, target_reps_low, target_reps_high, rest_seconds, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.params.id, exercise_id, maxOrder + 1,
    target_sets || 3, target_reps_low || 8, target_reps_high || 12, rest_seconds || null, notes || null
  );
  res.json({ id: info.lastInsertRowid });
});

// Replace which exercise a slot in today's plan points to. Any sets already
// logged against the old exercise are cleared since they don't apply anymore.
app.put('/api/session-exercises/:id', (req, res) => {
  const { exercise_id } = req.body;
  db.prepare('DELETE FROM set_logs WHERE session_exercise_id = ?').run(req.params.id);
  db.prepare('UPDATE session_exercises SET exercise_id = ? WHERE id = ?').run(exercise_id, req.params.id);
  res.json({ ok: true });
});

// Remove an exercise from today's plan only.
app.delete('/api/session-exercises/:id', (req, res) => {
  db.prepare('DELETE FROM set_logs WHERE session_exercise_id = ?').run(req.params.id);
  db.prepare('DELETE FROM session_exercises WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/sessions', (req, res) => {
  const sessions = req.query.date
    ? db.prepare(`
        SELECT s.*, t.name AS template_name, t.key AS template_key, t.focus AS template_focus
        FROM sessions s
        LEFT JOIN templates t ON t.id = s.template_id
        WHERE s.date = ?
        ORDER BY s.id DESC
      `).all(req.query.date)
    : db.prepare(`
        SELECT s.*, t.name AS template_name, t.key AS template_key
        FROM sessions s
        LEFT JOIN templates t ON t.id = s.template_id
        ORDER BY s.date DESC, s.id DESC
        LIMIT 100
      `).all();
  res.json(sessions);
});

app.get('/api/sessions/:id', (req, res) => {
  const session = db.prepare(`
    SELECT s.*, t.name AS template_name, t.key AS template_key
    FROM sessions s
    LEFT JOIN templates t ON t.id = s.template_id
    WHERE s.id = ?
  `).get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const sets = db.prepare(`
    SELECT sl.*, e.name AS exercise_name
    FROM set_logs sl
    JOIN session_exercises se ON se.id = sl.session_exercise_id
    JOIN exercises e ON e.id = se.exercise_id
    WHERE sl.session_id = ?
    ORDER BY sl.id
  `).all(session.id);

  res.json({ ...session, sets });
});

app.put('/api/sessions/:id', (req, res) => {
  const { cardio_minutes, notes } = req.body;
  db.prepare('UPDATE sessions SET cardio_minutes = ?, notes = ? WHERE id = ?')
    .run(cardio_minutes ?? 0, notes || null, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/sessions/:id', async (req, res) => {
  const existing = db.prepare('SELECT calendar_event_id FROM sessions WHERE id = ?').get(req.params.id);

  db.prepare('DELETE FROM set_logs WHERE session_id = ?').run(req.params.id);
  db.prepare('DELETE FROM session_exercises WHERE session_id = ?').run(req.params.id);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(req.params.id);

  if (existing?.calendar_event_id) {
    await googleAuth.deleteWorkoutEvent(existing.calendar_event_id);
  }
  res.json({ ok: true });
});

// ---------- Set logs ----------

app.post('/api/sessions/:id/sets', (req, res) => {
  const { session_exercise_id, set_number, reps, weight_kg } = req.body;
  const info = db.prepare(`
    INSERT INTO set_logs (session_id, session_exercise_id, set_number, reps, weight_kg)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.params.id, session_exercise_id, set_number, reps ?? null, weight_kg ?? null);
  res.json({ id: info.lastInsertRowid });
});

app.put('/api/sets/:id', (req, res) => {
  const { reps, weight_kg } = req.body;
  db.prepare('UPDATE set_logs SET reps = ?, weight_kg = ? WHERE id = ?')
    .run(reps ?? null, weight_kg ?? null, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/sets/:id', (req, res) => {
  db.prepare('DELETE FROM set_logs WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Progress ----------

app.get('/api/progress/exercise/:exerciseId', (req, res) => {
  const rows = db.prepare(`
    SELECT s.date, sl.set_number, sl.reps, sl.weight_kg
    FROM set_logs sl
    JOIN sessions s ON s.id = sl.session_id
    JOIN session_exercises se ON se.id = sl.session_exercise_id
    WHERE se.exercise_id = ?
    ORDER BY s.date ASC, sl.id ASC
  `).all(req.params.exerciseId);
  res.json(rows);
});

app.get('/api/exercises', (req, res) => {
  res.json(db.prepare('SELECT * FROM exercises ORDER BY name').all());
});

// Weekly summary: workouts completed vs. planned, and total weight lifted,
// for the Mon–Sun week containing ?date= (defaults to today).
app.get('/api/progress/week', (req, res) => {
  const ref = req.query.date ? new Date(req.query.date) : new Date();
  const day = ref.getDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(ref);
  monday.setDate(ref.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const weekStart = monday.toISOString().slice(0, 10);
  const weekEnd = sunday.toISOString().slice(0, 10);

  const sessions = db.prepare(`
    SELECT s.id, s.date, t.key AS template_key, t.name AS template_name
    FROM sessions s
    LEFT JOIN templates t ON t.id = s.template_id
    WHERE s.date BETWEEN ? AND ?
    ORDER BY s.date ASC
  `).all(weekStart, weekEnd);

  const activePlanKey = getSetting('active_plan_key', 'upper_lower');
  const sessionsPlanned = db.prepare(`
    SELECT COUNT(*) AS c FROM templates t JOIN plans p ON p.id = t.plan_id WHERE p.key = ?
  `).get(activePlanKey).c;

  const volumeRow = db.prepare(`
    SELECT COALESCE(SUM(sl.reps * sl.weight_kg), 0) AS total
    FROM set_logs sl
    JOIN sessions s ON s.id = sl.session_id
    WHERE s.date BETWEEN ? AND ? AND sl.reps IS NOT NULL AND sl.weight_kg IS NOT NULL
  `).get(weekStart, weekEnd);

  res.json({
    weekStart,
    weekEnd,
    sessionsCompleted: sessions.length,
    sessionsPlanned,
    templatesDone: sessions.map((s) => ({ key: s.template_key, name: s.template_name, date: s.date })),
    totalVolumeKg: Math.round(volumeRow.total * 10) / 10,
  });
});

// Sessions within a given month (YYYY-MM), grouped by date, so the calendar
// can mark and open the specific session logged (or planned) on each day.
app.get('/api/calendar', (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const rows = db.prepare(`
    SELECT s.id, s.date, t.name AS template_name
    FROM sessions s
    LEFT JOIN templates t ON t.id = s.template_id
    WHERE s.date LIKE ?
    ORDER BY s.date ASC, s.id ASC
  `).all(`${month}%`);

  const sessionsByDate = {};
  for (const row of rows) {
    (sessionsByDate[row.date] ||= []).push({ id: row.id, template_name: row.template_name });
  }

  const activePlanKey = getSetting('active_plan_key', 'upper_lower');
  const activePlan = db.prepare('SELECT id FROM plans WHERE key = ?').get(activePlanKey);
  const schedule = {};
  if (activePlan) {
    for (const row of getPlanSchedule(activePlan.id)) {
      schedule[row.weekday] = { template_key: row.template_key, template_name: row.template_name };
    }
  }

  res.json({ month, sessionsByDate, schedule });
});

// ---------- Body stats ----------

app.get('/api/body-stats', (req, res) => {
  res.json(db.prepare('SELECT * FROM body_stats ORDER BY date ASC').all());
});

app.post('/api/body-stats', (req, res) => {
  const { date, weight_kg, waist_cm, notes } = req.body;
  const info = db.prepare(`
    INSERT INTO body_stats (date, weight_kg, waist_cm, notes)
    VALUES (?, ?, ?, ?)
  `).run(date, weight_kg ?? null, waist_cm ?? null, notes || null);
  res.json({ id: info.lastInsertRowid });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Workout tracker running at http://localhost:${PORT}`);
});
