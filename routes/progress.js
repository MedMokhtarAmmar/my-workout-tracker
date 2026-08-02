const express = require('express');
const sessionsRepo = require('../db/repositories/sessions');
const exercisesRepo = require('../db/repositories/exercises');
const plansRepo = require('../db/repositories/plans');
const settings = require('../db/repositories/settings');

const router = express.Router();

router.get('/progress/exercise/:exerciseId', (req, res) => {
  res.json(sessionsRepo.progressForExercise(req.session.userId, req.params.exerciseId));
});

// Backs the Progress tab's Records and Favorites subtabs — one row per
// exercise this user has ever logged a completed set for, with usage
// stats the client sorts/slices client-side (Records: all rows, sortable;
// Favorites: top 3 by times_logged).
router.get('/progress/records', (req, res) => {
  const rows = sessionsRepo.recordsByExercise(req.session.userId);
  res.json(rows.map((r) => ({
    exercise_id: r.exercise_id,
    exercise_name: r.exercise_name,
    exercise_category: r.exercise_category,
    exercise_image: r.exercise_image,
    times_logged: r.times_logged,
    avg_weight_kg: r.avg_weight_kg != null ? Math.round(r.avg_weight_kg * 10) / 10 : null,
    max_weight_kg: r.max_weight_kg,
  })));
});

router.get('/exercises', (req, res) => {
  res.json(exercisesRepo.listAll());
});

// Weekly summary: workouts completed vs. planned, and total weight lifted,
// for the Mon–Sun week containing ?date= (defaults to today).
router.get('/progress/week', (req, res) => {
  const uid = req.session.userId;
  const ref = req.query.date ? new Date(req.query.date) : new Date();
  const day = ref.getDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(ref);
  monday.setDate(ref.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const weekStart = monday.toISOString().slice(0, 10);
  const weekEnd = sunday.toISOString().slice(0, 10);

  const sessions = sessionsRepo.inDateRange(uid, weekStart, weekEnd);

  const activePlanKey = settings.getSetting(uid, 'active_plan_key', 'upper_lower');
  const activePlan = plansRepo.findPlanByKey(activePlanKey);
  const sessionsPlanned = activePlan ? plansRepo.listTemplateIds(activePlan.id).length : 0;

  const volumeRow = sessionsRepo.volumeInDateRange(uid, weekStart, weekEnd);

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
router.get('/calendar', (req, res) => {
  const uid = req.session.userId;
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const rows = sessionsRepo.inMonth(uid, month);

  const sessionsByDate = {};
  for (const row of rows) {
    (sessionsByDate[row.date] ||= []).push({ id: row.id, template_name: row.template_name });
  }

  const activePlanKey = settings.getSetting(uid, 'active_plan_key', 'upper_lower');
  const activePlan = plansRepo.findPlanByKey(activePlanKey);
  const schedule = {};
  if (activePlan) {
    for (const row of plansRepo.getPlanSchedule(uid, activePlan.id)) {
      schedule[row.weekday] = { template_key: row.template_key, template_name: row.template_name };
    }
  }

  res.json({ month, sessionsByDate, schedule });
});

module.exports = router;
