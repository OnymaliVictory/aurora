// Run this after filling in your .env, to confirm the database is
// actually reachable and set up correctly — before wiring the frontend
// to it.
//
//   cd supabase-backend
//   npm install
//   node test-connection.js
//
// It checks, in order: env vars present → Supabase reachable → every
// table from schema.sql exists → the product-images storage bucket
// exists. Each check prints ✓ or ✗ so you know exactly where to look
// if something's wrong.

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

let failed = false;
function pass(msg) { console.log('  \x1b[32m✓\x1b[0m ' + msg); }
function fail(msg) { console.log('  \x1b[31m✗\x1b[0m ' + msg); failed = true; }

async function main() {
  console.log('\n1. Checking .env credentials...');
  if (!url || !key) {
    fail('SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY are missing from .env.');
    console.log('\n  → Copy .env.example to .env and fill in both values from');
    console.log('    your Supabase project: Project Settings → API.\n');
    process.exit(1);
  }
  if (!url.startsWith('https://') || !url.includes('.supabase.co')) {
    fail(`SUPABASE_URL doesn't look right: "${url}" (expected something like https://xxxxx.supabase.co)`);
  } else {
    pass('SUPABASE_URL is set and looks valid.');
  }
  if (key.length < 40) {
    fail('SUPABASE_SERVICE_ROLE_KEY looks too short — make sure you copied the whole key.');
  } else {
    pass('SUPABASE_SERVICE_ROLE_KEY is set.');
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log('\n2. Checking the tables from schema.sql exist...');
  const tables = ['profiles', 'shops', 'products', 'orders', 'messages'];
  for (const table of tables) {
    const { error } = await supabase.from(table).select('*', { count: 'exact', head: true });
    if (error) {
      fail(`"${table}" — ${error.message}`);
    } else {
      pass(`"${table}" table exists and is queryable.`);
    }
  }

  console.log('\n3. Checking the product-images storage bucket...');
  const { data: buckets, error: bucketErr } = await supabase.storage.listBuckets();
  if (bucketErr) {
    fail(`Could not list storage buckets — ${bucketErr.message}`);
  } else if (!buckets.find(b => b.id === 'product-images')) {
    fail('"product-images" bucket not found.');
  } else {
    pass('"product-images" storage bucket exists.');
  }

  console.log('\n' + (failed ? '\x1b[31mSome checks failed — see ✗ lines above.\x1b[0m' : '\x1b[32mAll checks passed! Your database is connected and ready.\x1b[0m'));

  console.log('\n4. To confirm the auto-profile signup trigger works, try this once you have your anon key:');
  console.log('   curl -X POST https://YOUR-PROJECT-REF.supabase.co/auth/v1/signup \\');
  console.log('     -H "apikey: YOUR_ANON_KEY" -H "Content-Type: application/json" \\');
  console.log('     -d \'{"email":"test@example.com","password":"password123"}\'');
  console.log('   Then check Table Editor → profiles in the Supabase dashboard — a');
  console.log('   matching row should appear automatically.\n');

  process.exit(failed ? 1 : 0);
}

main().catch(err => {
  console.error('\nUnexpected error — this usually means the URL or key is wrong, or your network is blocking the request:');
  console.error(' ', err.message);
  process.exit(1);
});
