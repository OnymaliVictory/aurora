const supabaseAdmin = require('./supabaseAdmin');

function tokenFromReq(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

async function getUserFromToken(token) {
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data || !data.user) return null;
  const authUser = data.user;

  let { data: profile } = await supabaseAdmin.from('profiles').select('*').eq('id', authUser.id).single();

  if (!profile) {
    // Rare race: the row-creation trigger hasn't run yet. Create it now so
    // the very first request right after signup doesn't fail.
    const meta = authUser.user_metadata || {};
    const { data: created } = await supabaseAdmin
      .from('profiles')
      .insert({
        id: authUser.id,
        first_name: meta.first_name || '',
        last_name: meta.last_name || '',
        phone: meta.phone || '',
        role: meta.role === 'seller' ? 'seller' : 'buyer',
      })
      .select()
      .single();
    profile = created;
  }

  return profile ? { ...profile, email: authUser.email } : null;
}

async function requireAuth(req, res, next) {
  const user = await getUserFromToken(tokenFromReq(req));
  if (!user) return res.status(401).json({ error: 'Please sign in to continue.' });
  req.user = user;
  next();
}

async function optionalAuth(req, res, next) {
  req.user = await getUserFromToken(tokenFromReq(req));
  next();
}

module.exports = { requireAuth, optionalAuth, getUserFromToken };
