-- One row per account. Created on first sign-in via Google, or on sign-up
-- with an email/password. password_hash is NULL for Google-only accounts.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Exercises library (shared across all users)
CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  image_path TEXT,   -- e.g. /exercise-media/leg-press.webp
  video_url TEXT      -- YouTube "how to" tutorial
);

-- A followable program (e.g. "Upper/Lower 4-Day Split", "Push Pull Legs").
-- Shared across all users. Only one plan is "active" per user at a time
-- (see settings.active_plan_key) — the Today tab only offers that plan's
-- templates.
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,      -- 'upper_lower', 'ppl'
  name TEXT NOT NULL,
  description TEXT,
  cover_image TEXT               -- e.g. /plan-covers/upper-lower.webp
);

-- Workout day templates (Upper A, Lower A, Push, Pull, Legs, etc.). Shared
-- library by default (plan_id set, user_id NULL); a template with user_id
-- set instead is a user's own private custom template (plan_id NULL).
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id INTEGER REFERENCES plans(id),
  user_id INTEGER REFERENCES users(id),
  key TEXT UNIQUE NOT NULL,      -- 'upper_a', 'lower_a', ... (custom: 'custom_<uuid>')
  name TEXT NOT NULL,            -- 'Upper A (Strength Focus)'
  focus TEXT
);

-- Which weekday runs which template for a given plan, per user (each user
-- picks their own workout days for a shared plan). A weekday with no row
-- here is a rest day for that user.
CREATE TABLE IF NOT EXISTS plan_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  plan_id INTEGER NOT NULL REFERENCES plans(id),
  weekday INTEGER NOT NULL,      -- 0 = Sunday .. 6 = Saturday
  template_id INTEGER NOT NULL REFERENCES templates(id),
  UNIQUE(user_id, plan_id, weekday)
);

-- Which exercises belong to which template, in order, with target sets/reps.
-- Shared reference data.
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

-- A logged workout session (one visit to the gym), owned by one user.
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,            -- ISO date
  template_id INTEGER REFERENCES templates(id),
  cardio_minutes INTEGER DEFAULT 0,
  notes TEXT,
  calendar_event_id TEXT,        -- Google Calendar event id, if a reminder was created
  created_at TEXT DEFAULT (datetime('now'))
);

-- Exercises actually done in a given session, cloned from the template when
-- the session starts. Editing this (add/remove/replace) only affects that
-- one day — the reusable template is never touched. Ownership follows the
-- parent session, so no user_id column here.
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

-- Individual logged sets within a session. Ownership follows the parent
-- session, so no user_id column here.
CREATE TABLE IF NOT EXISTS set_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  session_exercise_id INTEGER NOT NULL REFERENCES session_exercises(id),
  set_number INTEGER NOT NULL,
  reps INTEGER,
  weight_kg REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Body stats tracking, owned by one user.
CREATE TABLE IF NOT EXISTS body_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  weight_kg REAL,
  waist_cm REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Progress photos, owned by one user. The actual image bytes live on disk
-- under data/progress-photos/<user_id>/ (outside public/, since these are
-- personal photos) — file_name here is just that file's name, served only
-- through the authenticated /api/progress-photos/:id/image route.
CREATE TABLE IF NOT EXISTS progress_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  date TEXT NOT NULL,
  weight_kg REAL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Per-user key/value preferences (e.g. reminder_time, nutrition profile).
CREATE TABLE IF NOT EXISTS settings (
  user_id INTEGER NOT NULL REFERENCES users(id),
  key TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (user_id, key)
);

-- Google OAuth tokens, one row per user.
CREATE TABLE IF NOT EXISTS google_auth (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
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

-- Bearer tokens for non-browser clients (the mobile app) that can't rely on
-- same-origin session cookies. Issued at login/signup, checked as a fallback
-- in requireAuth/requireAdmin when there's no session, revoked on logout.
CREATE TABLE IF NOT EXISTS api_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
