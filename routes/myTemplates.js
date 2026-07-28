const express = require('express');
const templatesRepo = require('../db/repositories/templates');

const router = express.Router();

// A regular user's own private workout templates — same shape as the
// shared admin library (see routes/admin.js), just scoped to one user
// instead of everyone. Starting a session from one works automatically:
// POST /sessions looks a template up by key with no ownership check,
// since cloning its exercise list into your own session can't affect
// anyone else's data either way.

router.get('/my-templates', (req, res) => {
  const templates = templatesRepo.listForUser(req.session.userId);
  res.json(templates.map((t) => ({
    ...t,
    exercises: templatesRepo.listExercisesWithDetail(t.id),
  })));
});

router.post('/my-templates', (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const id = templatesRepo.createCustom(req.session.userId, name, req.body.focus);
  res.json({ id });
});

router.delete('/my-templates/:id', (req, res) => {
  if (!templatesRepo.findOwnedById(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Not found' });
  templatesRepo.removeCustom(req.params.id);
  res.json({ ok: true });
});

router.post('/my-templates/:id/exercises', (req, res) => {
  const template = templatesRepo.findOwnedById(req.session.userId, req.params.id);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const { exercise_id, target_sets, target_reps_low, target_reps_high } = req.body;
  if (!exercise_id || !target_sets || !target_reps_low || !target_reps_high) {
    return res.status(400).json({ error: 'Exercise, sets, and rep range are required.' });
  }

  const orderIndex = templatesRepo.nextOrderIndex(template.id);
  const id = templatesRepo.addExercise(template.id, exercise_id, orderIndex, target_sets, target_reps_low, target_reps_high, null, null);
  res.json({ id });
});

router.delete('/my-template-exercises/:id', (req, res) => {
  if (!templatesRepo.findOwnedTemplateExercise(req.session.userId, req.params.id)) return res.status(404).json({ error: 'Not found' });
  templatesRepo.removeExercise(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
