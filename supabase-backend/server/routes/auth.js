const express = require('express');
const { requireAuth } = require('../auth');

const router = express.Router();

// Sign-up and sign-in happen directly in the browser via the Supabase JS
// client (see public/js/supabase-client.js) — Supabase Auth issues the
// session token itself. This endpoint just confirms who that token belongs
// to and returns their Aurora profile (name, role, etc).
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
