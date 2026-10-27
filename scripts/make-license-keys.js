// Run ONCE on your own computer:   node scripts/make-license-keys.js
// It makes the pair of keys that protect Aurora OS licences.
//   PRIVATE key -> goes into Vercel (Settings -> Environment Variables) as OS_LICENSE_PRIVATE_KEY. Tell nobody.
//   PUBLIC key  -> goes into the Aurora OS app (aurora/license_public.txt). It is safe to share.
const crypto = require('crypto');
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const pub = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
console.log('\n=== 1. PRIVATE KEY (secret!) — add to Vercel as OS_LICENSE_PRIVATE_KEY ===\n');
console.log(priv);
console.log('\n=== 2. PUBLIC KEY — paste as the only line in aurora/license_public.txt (Aurora OS repo) ===\n');
console.log(pub);
console.log('\nKeep a safe copy of the private key (password manager). If you lose it, old keys keep working but you cannot make new ones.\n');
