const express = require('express');
const settings = require('../db/repositories/settings');

const router = express.Router();

router.get('/settings', (req, res) => {
  const uid = req.session.userId;
  res.json({
    reminder_time: settings.getSetting(uid, 'reminder_time', '18:00'),
    timezone: settings.getSetting(uid, 'timezone', 'UTC'),
    nutrition_age: settings.getSetting(uid, 'nutrition_age', ''),
    nutrition_sex: settings.getSetting(uid, 'nutrition_sex', 'male'),
    nutrition_height_cm: settings.getSetting(uid, 'nutrition_height_cm', ''),
    nutrition_activity: settings.getSetting(uid, 'nutrition_activity', '1.55'),
    nutrition_goal: settings.getSetting(uid, 'nutrition_goal', 'maintain'),
    nutrition_calorie_adjustment: settings.getSetting(uid, 'nutrition_calorie_adjustment', ''),
    nutrition_body_fat_pct: settings.getSetting(uid, 'nutrition_body_fat_pct', ''),
  });
});

router.put('/settings', (req, res) => {
  const uid = req.session.userId;
  const {
    reminder_time, timezone,
    nutrition_age, nutrition_sex, nutrition_height_cm, nutrition_activity,
    nutrition_goal, nutrition_calorie_adjustment, nutrition_body_fat_pct,
  } = req.body;
  if (reminder_time) settings.setSetting(uid, 'reminder_time', reminder_time);
  if (timezone) settings.setSetting(uid, 'timezone', timezone);
  if (nutrition_age) settings.setSetting(uid, 'nutrition_age', nutrition_age);
  if (nutrition_sex) settings.setSetting(uid, 'nutrition_sex', nutrition_sex);
  if (nutrition_height_cm) settings.setSetting(uid, 'nutrition_height_cm', nutrition_height_cm);
  if (nutrition_activity) settings.setSetting(uid, 'nutrition_activity', nutrition_activity);
  if (nutrition_goal) settings.setSetting(uid, 'nutrition_goal', nutrition_goal);
  if (nutrition_calorie_adjustment) settings.setSetting(uid, 'nutrition_calorie_adjustment', nutrition_calorie_adjustment);
  if (nutrition_body_fat_pct) settings.setSetting(uid, 'nutrition_body_fat_pct', nutrition_body_fat_pct);
  res.json({ ok: true });
});

module.exports = router;
