// Supabase dashboard → Project Settings → API Keys
//   Project URL          → SUPABASE_URL
//   "publishable" key    → SUPABASE_ANON_KEY  (safe to expose in frontend
//                           code — it's designed for browsers and is
//                           restricted by the Row Level Security policies
//                           in supabase-schema/schema.sql. Never put the
//                           "secret" key here — that one stays server-side
//                           only, in supabase-backend/.env)
const SUPABASE_URL = "https://wdiabltjkrjfjnwaunpo.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_h2xNrpUSW0kQ-IxbBd-Dfw_F5Zmmiwm";