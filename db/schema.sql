-- Exercises library
CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  image_path TEXT,   -- e.g. /exercise-media/leg-press.webp
  video_url TEXT      -- YouTube "how to" tutorial
);

-- A followable program (e.g. "Upper/Lower 4-Day Split", "Push Pull Legs").
-- Only one plan is "active" at a time (see settings.active_plan_key) — the
-- Today tab only offers that plan's templates.
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,      -- 'upper_lower', 'ppl'
  name TEXT NOT NULL,
  description TEXT
);

-- Workout day templates (Upper A, Lower A, Push, Pull, Legs, etc.)
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER REFERENCES plans(id),
  key TEXT UNIQUE NOT NULL,      -- 'upper_a', 'lower_a', ...
  name TEXT NOT NULL,            -- 'Upper A (Strength Focus)'
  focus TEXT
);

-- Which weekday runs which template for a given plan. A weekday with no row
-- here is a rest day. Only the active plan's schedule drives the calendar.
CREATE TABLE IF NOT EXISTS plan_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  weekday INTEGER NOT NULL,      -- 0 = Sunday .. 6 = Saturday
  template_id INTEGER NOT NULL REFERENCES templates(id),
  UNIQUE(plan_id, weekday)
);

-- Which exercises belong to which template, in order, with target sets/reps
CREATE TABLE IF NOT EXISTS template_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id),
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  order_index INTEGER NOT NULL,
  target_sets INTEGER NOT NULL,
  target_reps_low INTEGER NOT NULL,
  target_reps_high INTEGER NOT NULL,
  rest_seconds INTEGER,
  notes TEXT
);

-- A logged workout session (one visit to the gym)
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,            -- ISO date
  template_id INTEGER REFERENCES templates(id),
  cardio_minutes INTEGER DEFAULT 0,
  notes TEXT,
  calendar_event_id TEXT,        -- Google Calendar event id, if a reminder was created
  created_at TEXT DEFAULT (datetime('now'))
);

-- Exercises actually done in a given session, cloned from the template when
-- the session starts. Editing this (add/remove/replace) only affects that
-- one day — the reusable template is never touched.
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
);

-- Individual logged sets within a session
CREATE TABLE IF NOT EXISTS set_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  session_exercise_id INTEGER NOT NULL REFERENCES session_exercises(id),
  set_number INTEGER NOT NULL,
  reps INTEGER,
  weight_kg REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Body stats tracking
CREATE TABLE IF NOT EXISTS body_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  weight_kg REAL,
  waist_cm REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- App-wide key/value preferences (e.g. reminder_time)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Google OAuth tokens for the single owner account. Only ever one row.
CREATE TABLE IF NOT EXISTS google_auth (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  email TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_token_expiry INTEGER
);

-- express-session storage, so logins survive server/container restarts.
CREATE TABLE IF NOT EXISTS login_sessions (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  expires INTEGER
);
