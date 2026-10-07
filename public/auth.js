const express = require('express');
const supabaseAdmin = require('../supabaseAdmin');
const { requireAuth } = require('../auth');
const { cleanProfilePatch } = require('../shopSettings');

const router = express.Router();

// Sign-up and sign-in happen directly in the browser via the Supabase JS
// client (see public/js/supabase-client.js) — Supabase Auth issues the
// session token itself. This endpoint just confirms who that token belongs
// to and returns their Aurora profile (name, role, etc).
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// Edit your own name, phone and location. The role can never be changed here
// (cleanProfilePatch only lets these five fields through).
router.patch('/me', requireAuth, async (req, res) => {
  const { patch, error: bad } = cleanProfilePatch(req.body);
  if (bad) return res.status(400).json({ error: bad });
  if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nothing to change.' });
  const { data, error } = await supabaseAdmin.from('profiles').update(patch).eq('id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ user: { ...data, email: req.user.email } });
});

module.exports = router;
