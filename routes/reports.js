const express = require('express');
const sessionsRepo = require('../db/repositories/sessions');
const bodyStatsRepo = require('../db/repositories/bodyStats');
const plansRepo = require('../db/repositories/plans');
const settings = require('../db/repositories/settings');

const router = express.Router();

// Mon-Sun week containing dateStr (same definition used by /progress/week).
function weekRangeFor(dateStr) {
  const ref = dateStr ? new Date(dateStr) : new Date();
  const day = ref.getDay(); // 0 = Sunday .. 6 = Saturday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(ref);
  monday.setDate(ref.getDate() + diffToMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

// Calendar month containing dateStr.
function monthRangeFor(dateStr) {
  const ref = dateStr ? new Date(dateStr) : new Date();
  const monthPrefix = ref.toISOString().slice(0, 7);
  const [y, m] = monthPrefix.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${monthPrefix}-01`, end: `${monthPrefix}-${String(lastDay).padStart(2, '0')}` };
}

// A rollup of a week or month's training: workouts done, volume, sets,
// cardio, weight change, and a per-exercise breakdown — everything the
// Report subtab needs in one call. ?period=week|month, ?date=any day in
// the desired range (defaults to today).
router.get('/reports', (req, res) => {
  const uid = req.session.userId;
  const period = req.query.period === 'month' ? 'month' : 'week';
  const { start, end } = period === 'month' ? monthRangeFor(req.query.date) : weekRangeFor(req.query.date);

  const sessions = sessionsRepo.inDateRange(uid, start, end);

  // "Planned" workouts only makes sense against the weekly cadence of the
  // active plan — a month doesn't have a single well-defined target count.
  let sessionsPlanned = null;
  if (period === 'week') {
    const activePlanKey = settings.getSetting(uid, 'active_plan_key', 'upper_lower');
    const activePlan = plansRepo.findPlanByKey(activePlanKey);
    sessionsPlanned = activePlan ? plansRepo.listTemplateIds(activePlan.id).length : 0;
  }

  const volume = sessionsRepo.volumeInDateRange(uid, start, end).total;
  const cardioMinutes = sessionsRepo.cardioMinutesInDateRange(uid, start, end).total;
  const totalSets = sessionsRepo.completedSetsCountInDateRange(uid, start, end).count;
  const exercises = sessionsRepo.exerciseBreakdownInDateRange(uid, start, end);
  const weights = bodyStatsRepo.inDateRange(uid, start, end);
  const weightStart = weights.length ? weights[0].weight_kg : null;
  const weightEnd = weights.length ? weights[weights.length - 1].weight_kg : null;

  res.json({
    period,
    start,
    end,
    sessionsCompleted: sessions.length,
    sessionsPlanned,
    sessions: sessions.map((s) => ({ date: s.date, template_name: s.template_name })),
    totalVolumeKg: Math.round(volume * 10) / 10,
    totalSets,
    cardioMinutes,
    weightStart,
    weightEnd,
    weightChangeKg: weightStart != null && weightEnd != null ? Math.round((weightEnd - weightStart) * 10) / 10 : null,
    exercises: exercises.map((e) => ({
      name: e.exercise_name,
      sets: e.sets,
      volumeKg: Math.round(e.volume * 10) / 10,
      maxWeightKg: e.max_weight,
    })),
  });
});

module.exports = router;
