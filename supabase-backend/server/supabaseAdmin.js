require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.warn(
    '⚠️  SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are missing.\n' +
    '   Copy .env.example to .env and fill in your Supabase project credentials\n' +
    '   (Project Settings → API in the Supabase dashboard). The API will return\n' +
    '   errors on every request until this is set.'
  );
}

// Server-side client — uses the SERVICE ROLE key, which bypasses Row Level
// Security. That's intentional: this file only runs on the server, never
// reaches the browser, and every route below does its own ownership checks
// before touching data (same as RLS would, just enforced in Express).
const supabaseAdmin = createClient(url || 'https://placeholder.supabase.co', serviceKey || 'placeholder', {
  auth: { autoRefreshToken: false, persistSession: false },
});

module.exports = supabaseAdmin;
