const express = require('express');
const googleAuth = require('../lib/google');
const { hashPassword, verifyPassword } = require('../lib/password');
const users = require('../db/repositories/users');

const router = express.Router();

// Two ways in: Google OAuth (sign in and sign up are the same flow — the
// callback creates a user row on first login), or a plain email/password
// account. If an email matches an existing account either way, that's the
// same account — a password can't be attached without already being signed
// in as that user (attaching one via the public signup endpoint would let
// anyone take over an existing Google-only account just by knowing its
// email).

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

router.post('/signup', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  if (!isValidEmail(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  if (users.findByEmail(email)) {
    return res.status(400).json({ error: 'An account with this email already exists. Try signing in instead.' });
  }

  const userId = users.createWithPassword(email, hashPassword(password));

  req.session.loggedIn = true;
  req.session.userId = userId;
  req.session.email = email;
  res.json({ ok: true });
});

router.post('/login', (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const password = req.body.password || '';

  const user = users.findByEmail(email);
  if (user && !user.password_hash) {
    return res.status(401).json({ error: 'This account uses Google sign-in — use "Continue with Google" instead.' });
  }
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  req.session.loggedIn = true;
  req.session.userId = user.id;
  req.session.email = email;
  res.json({ ok: true });
});

router.get('/google', (req, res) => {
  res.redirect(googleAuth.getAuthUrl());
});

router.get('/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/login.html?error=access_denied');
  try {
    const { userId, email } = await googleAuth.handleCallback(code);
    req.session.loggedIn = true;
    req.session.userId = userId;
    req.session.email = email;
    res.redirect('/');
  } catch (err) {
    console.error('Google auth failed:', err.message);
    res.redirect('/login.html?error=auth_failed');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Deliberately outside the router's own /auth prefix — mounted at
// /api/auth/status by server.js, and must stay registered before the
// `/api` requireAuth gate since it's the one API route that works whether
// or not you're logged in.
function status(req, res) {
  res.json({ loggedIn: !!req.session.loggedIn, email: req.session.email || null });
}

module.exports = { router, status };
