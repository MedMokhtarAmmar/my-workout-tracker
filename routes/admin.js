const express = require('express');
const usersRepo = require('../db/repositories/users');
const exercisesRepo = require('../db/repositories/exercises');
const plansRepo = require('../db/repositories/plans');
const templatesRepo = require('../db/repositories/templates');
const adminStats = require('../db/repositories/adminStats');

const router = express.Router();

router.get('/admin/stats', (req, res) => {
  res.json(adminStats.summary());
});

router.get('/admin/users', (req, res) => {
  res.json(usersRepo.list());
});

// ---------- Exercises ----------

router.get('/admin/exercises', (req, res) => {
  res.json(exercisesRepo.listAll());
});

// image is an optional "data:image/...;base64,..." data URL from the admin
// client's file picker; when present it's saved to disk and takes priority
// over a hand-typed image_path.
router.post('/admin/exercises', (req, res) => {
  const { name, category, image, image_path, video_url } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const savedImagePath = image ? exercisesRepo.saveImageFromDataUrl(image) : (image_path || null);
  if (image && !savedImagePath) return res.status(400).json({ error: 'Unrecognized image type — use jpeg, png, webp, or gif.' });
  const id = exercisesRepo.create(name, category, savedImagePath, video_url);
  res.json({ id });
});

router.put('/admin/exercises/:id', (req, res) => {
  if (!exercisesRepo.findById(req.params.id)) return res.status(404).json({ error: 'Not found' });
  const { name, category, image, image_path, video_url } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required.' });
  const savedImagePath = image ? exercisesRepo.saveImageFromDataUrl(image) : (image_path || null);
  if (image && !savedImagePath) return res.status(400).json({ error: 'Unrecognized image type — use jpeg, png, webp, or gif.' });
  exercisesRepo.update(req.params.id, name, category, savedImagePath, video_url);
  res.json({ ok: true });
});

router.delete('/admin/exercises/:id', (req, res) => {
  if (!exercisesRepo.findById(req.params.id)) return res.status(404).json({ error: 'Not found' });
  if (exercisesRepo.isReferenced(req.params.id)) {
    return res.status(400).json({ error: "This exercise is used in a template or someone's logged session and can't be deleted." });
  }
  exercisesRepo.remove(req.params.id);
  res.json({ ok: true });
});

// ---------- Plans & templates ----------
// The shared program library every user picks from — not to be confused
// with a user's own active plan/schedule (routes/plans.js).

router.get('/admin/plans', (req, res) => {
  const plans = plansRepo.listPlans().map((p) => ({
    ...p,
    templates: templatesRepo.listForPlanKey(p.key).map((t) => ({
      ...t,
      exercises: templatesRepo.listExercisesWithDetail(t.id),
    })),
  }));
  res.json(plans);
});

router.post('/admin/plans', (req, res) => {
  const { key, name, description } = req.body;
  if (!key || !name) return res.status(400).json({ error: 'Key and name are required.' });
  if (plansRepo.findPlanByKey(key)) return res.status(400).json({ error: 'A plan with this key already exists.' });
  const id = plansRepo.createPlan(key, name, description);
  res.json({ id });
});

router.post('/admin/plans/:key/templates', (req, res) => {
  const plan = plansRepo.findPlanByKey(req.params.key);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  const { key, name, focus } = req.body;
  if (!key || !name) return res.status(400).json({ error: 'Key and name are required.' });
  if (templatesRepo.findByKey(key)) return res.status(400).json({ error: 'A template with this key already exists.' });

  const id = templatesRepo.create(plan.id, key, name, focus);
  res.json({ id });
});

router.post('/admin/templates/:key/exercises', (req, res) => {
  const template = templatesRepo.findByKey(req.params.key);
  if (!template) return res.status(404).json({ error: 'Template not found' });

  const { exercise_id, target_sets, target_reps_low, target_reps_high, rest_seconds, notes } = req.body;
  if (!exercise_id || !target_sets || !target_reps_low || !target_reps_high) {
    return res.status(400).json({ error: 'Exercise, sets, and rep range are required.' });
  }

  const orderIndex = templatesRepo.nextOrderIndex(template.id);
  const id = templatesRepo.addExercise(template.id, exercise_id, orderIndex, target_sets, target_reps_low, target_reps_high, rest_seconds, notes);
  res.json({ id });
});

router.delete('/admin/template-exercises/:id', (req, res) => {
  templatesRepo.removeExercise(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
