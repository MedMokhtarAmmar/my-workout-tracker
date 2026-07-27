const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const { DatabaseSync } = require('node:sqlite');
const { seed, categorizeExercises, attachExerciseMedia } = require('./db/seed');
const {
  ensureSessionExercisesMigration, ensureCalendarEventIdColumn, ensurePlansMigration,
  ensureExerciseMediaColumns, ensureMultiUserMigration, ensurePasswordColumn, ensureAdminColumn,
} = require('./db/migrate');
const googleAuth = require('./lib/google');
const SqliteSessionStore = require('./lib/sqlite-session-store');
const usersRepo = require('./db/repositories/users');

const DB_PATH = path.join(__dirname, 'data', 'app.db');
const PHOTOS_DIR = path.join(__dirname, 'data', 'progress-photos');
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const db = new DatabaseSync(DB_PATH);

const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
db.exec(schema);
ensureSessionExercisesMigration(db);
ensureCalendarEventIdColumn(db);
ensurePlansMigration(db);
ensureExerciseMediaColumns(db);
ensureMultiUserMigration(db);
ensurePasswordColumn(db);
ensureAdminColumn(db);
seed(db);
categorizeExercises(db);
attachExerciseMedia(db);

googleAuth.init(db);
usersRepo.init(db);
require('./db/repositories/settings').init(db);
require('./db/repositories/plans').init(db);
require('./db/repositories/templates').init(db);
require('./db/repositories/sessions').init(db);
require('./db/repositories/exercises').init(db);
require('./db/repositories/bodyStats').init(db);
require('./db/repositories/progressPhotos').init(db, PHOTOS_DIR);
require('./db/repositories/adminStats').init(db);

const app = express();
app.set('trust proxy', 1); // behind nginx in production; needed for secure cookies to work
// Progress photos arrive as base64 JSON (see routes/progressPhotos.js) —
// raised from the default 100kb so a resized photo fits comfortably.
app.use(express.json({ limit: '15mb' }));
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
function requireAdmin(req, res, next) {
  if (req.session.loggedIn && usersRepo.isAdmin(req.session.userId)) return next();
  res.status(403).json({ error: 'Admin access required' });
}
function requireAdminPage(req, res, next) {
  if (req.session.loggedIn && usersRepo.isAdmin(req.session.userId)) return next();
  res.redirect('/login.html');
}

// These three page routes must be registered — and gated — before
// express.static below. Static serving matches files by exact path
// (including index.html and admin.html, both real files in public/), so if
// it came first it would hand them out directly and these auth checks
// would never run. Everything else (login.html, style.css, app.js, images)
// has no such gated route competing for its path, so it's unaffected
// either way and just falls through to static serving as normal.
app.get('/', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/index.html', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin.html', requireAdminPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules', 'chart.js', 'dist')));

// Auth routes (and /api/auth/status specifically) must be registered
// before the /api requireAuth gate below — status is the one API route
// that works whether or not you're logged in.
const authRoutes = require('./routes/auth');
app.use('/auth', authRoutes.router);
app.get('/api/auth/status', authRoutes.status);

app.use('/api', requireAuth);

app.use('/api', require('./routes/settings'));
app.use('/api', require('./routes/plans'));
app.use('/api', require('./routes/sessions'));
app.use('/api', require('./routes/progress'));
app.use('/api', require('./routes/reports'));
app.use('/api', require('./routes/bodyStats'));
app.use('/api', require('./routes/progressPhotos'));
app.use('/api', requireAdmin, require('./routes/admin'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Workout tracker running at http://localhost:${PORT}`);
});
