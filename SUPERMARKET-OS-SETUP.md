# Aurora OS subscriptions — setup (do these once)

1. **Copy the files** in this zip into your `aurora` repo, keeping the same folders (replace when asked). Commit and push → Vercel redeploys.
2. **Database:** Supabase → SQL Editor → paste all of `migration-supermarket-os.sql` → Run.
3. **Make your licence keys** (on your computer, inside the repo folder): `node scripts/make-license-keys.js`
   - **PRIVATE key** → Vercel → Project → Settings → Environment Variables → name `OS_LICENSE_PRIVATE_KEY` → then **Redeploy** (env changes only apply to a new deployment).
   - **PUBLIC key** → the Aurora OS repo → `aurora/license_public.txt` (one line, nothing else) → push → GitHub Actions builds the new installer.
   - Keep a safe copy of the private key.
4. **Admin → Supermarket OS → Settings:** set the monthly and yearly price, Aurora's bank account, and the installer download link (e.g. a GitHub Release link to AuroraOS-Setup.exe). The page shows "Licence signing key: ready" when step 3 worked.
5. **Test:** Admin → Supermarket OS → Give a licence → your own email. Open Supermarket OS on the site → copy the key → paste in the app.

Check: `node scripts/test-os.js` should print "os subscription checks passed".
