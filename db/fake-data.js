// One-off script to populate demo history: past sessions with progressively
// heavier weights, plus weekly body-stat entries, so the UI (weekly progress
// bar, history list, progress charts) has something to show.
// Safe to re-run: skips any session/stat date that already exists.
//
// Run with: docker compose exec my-workout-tracker node --experimental-sqlite db/fake-data.js

const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_PATH = path.join(__dirname, '..', 'data', 'app.db');
const db = new DatabaseSync(DB_PATH);

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function roundToHalf(n) {
  return Math.round(n * 2) / 2;
}

const WEEKS_BACK = 4; // plus the current (partial) week = 5 weeks of data
const today = new Date();
const currentMonday = mondayOf(today);

// [startingWeight, weeklyIncrement] in kg. Bodyweight exercises are omitted
// and handled by reps progression instead.
const PROGRESSION = {
  'Chest Press Machine': [40, 2.5],
  'Lat Pulldown': [45, 2.5],
  'Seated Cable Row': [50, 2.5],
  'Seated Dumbbell Shoulder Press': [14, 1],
  'Dumbbell Lateral Raise': [8, 0.5],
  'Rope Triceps Pushdown': [20, 1.25],
  'Dumbbell Bicep Curl': [10, 0.5],
  'Leg Press': [80, 5],
  'Romanian Deadlift (Dumbbells)': [16, 1],
  'Leg Curl Machine': [30, 2],
  'Leg Extension': [35, 2],
  'Standing Calf Raise': [40, 2],
  'Incline Dumbbell Press': [16, 1],
  'Assisted Pull-Up Machine (or Lat Pulldown)': [40, 2],
  'Chest Supported Row Machine': [45, 2.5],
  'Machine Shoulder Press': [30, 2],
  'Face Pull': [15, 1],
  'Hammer Curl': [10, 0.5],
  'Overhead Rope Triceps Extension': [15, 1],
  'Cable Crunch': [25, 1.5],
  'Goblet Squat': [16, 1],
  'Walking Lunges': [12, 1],
  'Hip Thrust Machine (or Glute Bridge)': [40, 2.5],
  'Seated Leg Curl': [25, 2],
  'Cable Woodchoppers': [15, 1],
};

function weightFor(exerciseName, weekIndex) {
  const prog = PROGRESSION[exerciseName];
  if (!prog) return null; // bodyweight exercise
  const [base, inc] = prog;
  return roundToHalf(base + inc * weekIndex);
}

function repsFor(ex, weekIndex, setIndex) {
  const low = ex.target_reps_low;
  const high = ex.target_reps_high;
  if (ex.exercise_name === 'Plank') {
    return Math.min(high, low + 3 * weekIndex);
  }
  if (low === high) return low;
  // slight fatigue drop-off on the later sets
  const reps = high - Math.floor(setIndex / 2);
  return Math.max(low, Math.min(high, reps));
}

// Day offsets from Monday for a typical 4-day Upper/Lower split.
const SCHEDULE = [
  { offset: 0, key: 'upper_a' },
  { offset: 1, key: 'lower_a' },
  { offset: 3, key: 'upper_b' },
  { offset: 4, key: 'lower_b' },
];

// weekIndex 0 = oldest (4 weeks ago) .. WEEKS_BACK = current week.
// Current week only has Mon/Tue done so there's still progress to log live.
const WEEK_SESSIONS = {
  0: ['upper_a', 'lower_a', 'upper_b', 'lower_b'],
  1: ['upper_a', 'lower_a', 'upper_b'], // missed Friday that week
  2: ['upper_a', 'lower_a', 'upper_b', 'lower_b'],
  3: ['upper_a', 'lower_a', 'upper_b', 'lower_b'],
  4: ['upper_a', 'lower_a'],
};

const insertSession = db.prepare(`
  INSERT INTO sessions (date, template_id, cardio_minutes, notes)
  VALUES (?, ?, ?, ?)
`);
const insertSessionExercise = db.prepare(`
  INSERT INTO session_exercises
    (session_id, exercise_id, order_index, target_sets, target_reps_low, target_reps_high, rest_seconds, notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertSet = db.prepare(`
  INSERT INTO set_logs (session_id, session_exercise_id, set_number, reps, weight_kg)
  VALUES (?, ?, ?, ?, ?)
`);
const findSession = db.prepare('SELECT id FROM sessions WHERE date = ? AND template_id = ?');
const getTemplate = db.prepare('SELECT * FROM templates WHERE key = ?');
const getTemplateExercises = db.prepare(`
  SELECT te.*, e.name AS exercise_name
  FROM template_exercises te
  JOIN exercises e ON e.id = te.exercise_id
  WHERE te.template_id = ?
  ORDER BY te.order_index
`);

let sessionsCreated = 0;

for (let weekIndex = 0; weekIndex <= WEEKS_BACK; weekIndex++) {
  const weekMonday = new Date(currentMonday);
  weekMonday.setDate(currentMonday.getDate() - (WEEKS_BACK - weekIndex) * 7);

  for (const { offset, key } of SCHEDULE) {
    if (!WEEK_SESSIONS[weekIndex].includes(key)) continue;

    const sessionDate = new Date(weekMonday);
    sessionDate.setDate(weekMonday.getDate() + offset);
    if (sessionDate > today) continue;
    const dateStr = isoDate(sessionDate);

    const template = getTemplate.get(key);
    if (findSession.get(dateStr, template.id)) continue; // already logged

    const cardio = key.startsWith('lower') ? 15 : 0;
    const info = insertSession.run(dateStr, template.id, cardio, null);
    const sessionId = info.lastInsertRowid;

    for (const ex of getTemplateExercises.all(template.id)) {
      const seInfo = insertSessionExercise.run(
        sessionId, ex.exercise_id, ex.order_index, ex.target_sets,
        ex.target_reps_low, ex.target_reps_high, ex.rest_seconds, ex.notes
      );
      const sessionExerciseId = seInfo.lastInsertRowid;

      const weight = weightFor(ex.exercise_name, weekIndex);
      for (let s = 1; s <= ex.target_sets; s++) {
        const reps = repsFor(ex, weekIndex, s - 1);
        insertSet.run(sessionId, sessionExerciseId, s, reps, weight);
      }
    }
    sessionsCreated++;
  }
}

// ---------- Body stats: one weigh-in per week, gentle downward trend ----------

const insertStats = db.prepare(`
  INSERT INTO body_stats (date, weight_kg, waist_cm, notes)
  VALUES (?, ?, ?, ?)
`);
const findStats = db.prepare('SELECT id FROM body_stats WHERE date = ?');

let statsCreated = 0;
for (let weekIndex = 0; weekIndex <= WEEKS_BACK; weekIndex++) {
  const weekMonday = new Date(currentMonday);
  weekMonday.setDate(currentMonday.getDate() - (WEEKS_BACK - weekIndex) * 7);
  if (weekMonday > today) continue;
  const dateStr = isoDate(weekMonday);
  if (findStats.get(dateStr)) continue;

  const weight = roundToHalf(82 - 0.6 * weekIndex);
  const waist = roundToHalf(88 - 0.75 * weekIndex);
  insertStats.run(dateStr, weight, waist, null);
  statsCreated++;
}

console.log(`Fake data: ${sessionsCreated} sessions, ${statsCreated} body-stat entries created.`);
