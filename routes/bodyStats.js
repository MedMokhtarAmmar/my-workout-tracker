const express = require('express');
const bodyStats = require('../db/repositories/bodyStats');

const router = express.Router();

router.get('/body-stats', (req, res) => {
  res.json(bodyStats.list(req.session.userId));
});

router.post('/body-stats', (req, res) => {
  const { date, weight_kg, waist_cm, notes } = req.body;
  const id = bodyStats.create(req.session.userId, date, weight_kg, waist_cm, notes);
  res.json({ id });
});

module.exports = router;
