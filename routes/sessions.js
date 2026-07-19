const express = require('express');
const sessionsRepo = require('../db/repositories/sessions');
const templatesRepo = require('../db/repositories/templates');
const settings = require('../db/repositories/settings');
const googleAuth = require('../lib/google');

const router = express.Router();

router.post('/sessions', async (req, res) => {
  const uid = req.session.userId;
  const { date, template_key, cardio_minutes, notes } = req.body;

  // Only one workout per date per user — if one's already started, resume
  // it instead of creating a duplicate.
  const existing = sessionsRepo.findForDate(uid, date);
  if (existing) {
    return res.json({
      id: existing.id,
      template_name: existing.template_name,
      template_focus: existing.template_focus,
      calendar_event_id: existing.calendar_event_id,
    });
  }

  const template = template_key ? templatesRepo.findByKey(template_key) : null;
  const sessionId = sessionsRepo.create(uid, date, template ? template.id : null, cardio_minutes, notes);

  if (template) {
    sessionsRepo.cloneTemplateExercisesInto(sessionId, templatesRepo.listRawExercises(template.id));
  }

  let calendarEventId = null;
  if (googleAuth.isConnected(uid)) {
    try {
      calendarEventId = await googleAuth.createWorkoutEvent(uid, {
        date,
        time: settings.getSetting(uid, 'reminder_time', '18:00'),
        timeZone: settings.getSetting(uid, 'timezone', 'UTC'),
        title: `Workout: ${template ? template.name : 'Workout'}`,
      });
      if (calendarEventId) sessionsRepo.setCalendarEventId(sessionId, calendarEventId);
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

// The exercises actually in a given session's plan (cloned from the
// template at session start, then freely editable per-session).
router.get('/sessions/:id/exercises', (req, res) => {
  const uid = req.session.userId;
  if (!sessionsRepo.findOwned(uid, req.params.id)) return res.status(404).json({ error: 'Session not found' });

  const exercises = sessionsRepo.listExercises(req.params.id);
  for (const ex of exercises) {
    ex.previous = sessionsRepo.getPreviousSets(uid, ex.exercise_id, req.params.id);
  }
  res.json(exercises);
});

// Add an exercise to today's plan only.
router.post('/sessions/:id/exercises', (req, res) => {
  if (!sessionsRepo.findOwned(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Session not found' });

  const { exercise_id, target_sets, target_reps_low, target_reps_high, rest_seconds, notes } = req.body;
  const id = sessionsRepo.addExercise(req.params.id, exercise_id, target_sets, target_reps_low, target_reps_high, rest_seconds, notes);
  res.json({ id });
});

// Replace which exercise a slot in today's plan points to. Any sets already
// logged against the old exercise are cleared since they don't apply anymore.
router.put('/session-exercises/:id', (req, res) => {
  if (!sessionsRepo.findOwnedSessionExercise(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Not found' });
  sessionsRepo.replaceSessionExercise(req.params.id, req.body.exercise_id);
  res.json({ ok: true });
});

// Remove an exercise from today's plan only.
router.delete('/session-exercises/:id', (req, res) => {
  if (!sessionsRepo.findOwnedSessionExercise(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Not found' });
  sessionsRepo.removeSessionExercise(req.params.id);
  res.json({ ok: true });
});

router.get('/sessions', (req, res) => {
  const uid = req.session.userId;
  const list = req.query.date ? sessionsRepo.listForDate(uid, req.query.date) : sessionsRepo.list(uid);
  res.json(list);
});

router.get('/sessions/:id', (req, res) => {
  const session = sessionsRepo.findByIdWithSets(req.params.id, req.session.userId);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json(session);
});

router.put('/sessions/:id', (req, res) => {
  if (!sessionsRepo.findOwned(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Session not found' });
  sessionsRepo.update(req.params.id, req.body.cardio_minutes, req.body.notes);
  res.json({ ok: true });
});

router.delete('/sessions/:id', async (req, res) => {
  const uid = req.session.userId;
  const existing = sessionsRepo.findOwned(uid, req.params.id);
  if (!existing) return res.status(404).json({ error: 'Session not found' });

  sessionsRepo.remove(req.params.id);

  if (existing.calendar_event_id) {
    await googleAuth.deleteWorkoutEvent(uid, existing.calendar_event_id);
  }
  res.json({ ok: true });
});

// ---------- Set logs ----------

router.post('/sessions/:id/sets', (req, res) => {
  if (!sessionsRepo.findOwned(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Session not found' });

  const { session_exercise_id, set_number, reps, weight_kg } = req.body;
  const id = sessionsRepo.addSet(req.params.id, session_exercise_id, set_number, reps, weight_kg);
  res.json({ id });
});

router.put('/sets/:id', (req, res) => {
  if (!sessionsRepo.findOwnedSet(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Not found' });
  sessionsRepo.updateSet(req.params.id, req.body.reps, req.body.weight_kg);
  res.json({ ok: true });
});

router.delete('/sets/:id', (req, res) => {
  if (!sessionsRepo.findOwnedSet(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Not found' });
  sessionsRepo.removeSet(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
