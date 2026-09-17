const multer = require('multer');
const supabaseAdmin = require('./supabaseAdmin');

const BUCKET = 'product-images';
const ALLOWED = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

// Files are held in memory just long enough to stream them into Supabase
// Storage — nothing touches the server's local disk, which matters because
// most hosts (Render, Railway, etc.) wipe the filesystem on every deploy.
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    if (ALLOWED[file.mimetype]) return cb(null, true);
    cb(new Error('Only JPG, PNG, WEBP, or GIF images are allowed.'));
  },
  limits: { fileSize: 4 * 1024 * 1024 }, // 4MB — stays under Vercel's 4.5MB request body cap on the free tier
});

async function uploadToSupabase(file) {
  const ext = ALLOWED[file.mimetype] || 'jpg';
  const path = `${Date.now()}-${Math.round(Math.random() * 1e9)}.${ext}`;
  const { error } = await supabaseAdmin.storage.from(BUCKET).upload(path, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });
  if (error) throw new Error('Photo upload failed: ' + error.message);
  const { data } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

function deleteFromSupabase(publicUrl) {
  if (!publicUrl) return;
  const marker = `/object/public/${BUCKET}/`;
  const idx = publicUrl.indexOf(marker);
  if (idx === -1) return;
  const path = publicUrl.slice(idx + marker.length);
  supabaseAdmin.storage.from(BUCKET).remove([path]).catch(() => {}); // best-effort
}

module.exports = { upload, uploadToSupabase, deleteFromSupabase };