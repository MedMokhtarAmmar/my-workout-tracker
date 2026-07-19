const express = require('express');
const photos = require('../db/repositories/progressPhotos');

const router = express.Router();

// Personal photos, so unlike exercise reference images these are never
// served from the public/ static folder — only through the authenticated
// image route below, with an ownership check like everything else here.

router.get('/progress-photos', (req, res) => {
  res.json(photos.list(req.session.userId));
});

// Body is { date, weight_kg, image: "data:image/jpeg;base64,..." } — the
// client resizes the photo onto a canvas before sending it.
router.post('/progress-photos', (req, res) => {
  const { date, weight_kg, image } = req.body;
  const id = photos.createFromDataUrl(req.session.userId, date, weight_kg, image);
  if (!id) return res.status(400).json({ error: 'A date and a valid image (jpeg/png/webp/gif) are required.' });
  res.json({ id });
});

router.get('/progress-photos/:id/image', (req, res) => {
  const photo = photos.findOwned(req.session.userId, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Not found' });

  res.set('Content-Type', photo.mime_type);
  res.set('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(photos.filePathFor(photo));
});

router.delete('/progress-photos/:id', (req, res) => {
  const photo = photos.findOwned(req.session.userId, req.params.id);
  if (!photo) return res.status(404).json({ error: 'Not found' });
  photos.remove(photo);
  res.json({ ok: true });
});

module.exports = router;
