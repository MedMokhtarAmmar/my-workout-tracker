const express = require('express');
const plansRepo = require('../db/repositories/plans');
const templatesRepo = require('../db/repositories/templates');
const settings = require('../db/repositories/settings');

const router = express.Router();

// ---------- Plans ----------
// Plans/templates/exercises are a shared library; each user has their own
// active plan + weekday schedule on top of that shared library.

router.get('/plans', (req, res) => {
  const uid = req.session.userId;
  const activeKey = settings.getSetting(uid, 'active_plan_key', 'upper_lower');
  const result = plansRepo.listPlans().map((p) => ({
    ...p,
    active: p.key === activeKey,
    templates: plansRepo.listTemplateSummaries(p.id),
    schedule: plansRepo.getPlanSchedule(uid, p.id),
  }));
  res.json(result);
});

router.put('/plans/active', (req, res) => {
  const plan = plansRepo.findPlanByKey(req.body.key);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });
  settings.setSetting(req.session.userId, 'active_plan_key', req.body.key);
  res.json({ ok: true });
});

// Assigns the chosen weekdays to this plan's templates in rotation (e.g.
// Sun/Mon/Wed/Fri -> Upper A/Lower A/Upper B/Lower B). Any weekday not
// included is a rest day. Replaces whatever schedule this user had for
// this plan before.
router.put('/plans/:key/schedule', (req, res) => {
  const uid = req.session.userId;
  const plan = plansRepo.findPlanByKey(req.params.key);
  if (!plan) return res.status(404).json({ error: 'Plan not found' });

  const weekdays = [...new Set(req.body.weekdays || [])]
    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    .sort((a, b) => a - b);
  const templateIds = plansRepo.listTemplateIds(plan.id).map((t) => t.id);
  if (templateIds.length === 0) return res.status(400).json({ error: 'Plan has no templates' });

  plansRepo.replaceSchedule(uid, plan.id, weekdays, templateIds);
  res.json({ schedule: plansRepo.getPlanSchedule(uid, plan.id) });
});

// ---------- Templates ----------

// Only the active plan's templates — this is what populates the Today tab.
router.get('/templates', (req, res) => {
  const planKey = req.query.plan_key || settings.getSetting(req.session.userId, 'active_plan_key', 'upper_lower');
  res.json(templatesRepo.listForPlanKey(planKey));
});

// Which template should be preselected for a new workout: whatever this
// user's active plan schedule has for this weekday. An empty key means a
// rest day — the Today tab offers "Cardio day" (no template) for those.
// Registered before /templates/:key on purpose — Express matches routes in
// registration order, and :key would otherwise swallow "suggested".
router.get('/templates/suggested', (req, res) => {
  const uid = req.session.userId;
  const planKey = settings.getSetting(uid, 'active_plan_key', 'upper_lower');
  const plan = plansRepo.findPlanByKey(planKey);
  if (!plan) return res.json({ key: '' });

  // Parsed as UTC and read back as UTC so the weekday matches the calendar
  // date the client sent, regardless of the server's own timezone.
  const dateStr = req.query.date;
  const weekday = new Date(`${dateStr}T00:00:00Z`).getUTCDay();

  const scheduled = plansRepo.scheduledTemplateKeyForWeekday(uid, plan.id, weekday);
  res.json({ key: scheduled ? scheduled.key : '' });
});

router.get('/templates/:key', (req, res) => {
  const template = templatesRepo.findByKey(req.params.key);
  if (!template) return res.status(404).json({ error: 'Template not found' });
  res.json({ ...template, exercises: templatesRepo.listExercisesWithDetail(template.id) });
});

module.exports = router;
