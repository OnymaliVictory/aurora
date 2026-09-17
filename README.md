# Aurora — the luminous marketplace

This is set up in two stages, on purpose:

1. **`public/`** — a complete, working app in plain HTML, CSS, and
   JavaScript. No install, no build step, no server. Open it and it works.
2. **`supabase-backend/`** — sitting on the side, ready for when you want
   real accounts/data in Supabase instead of the browser's local storage.
   Nothing in `public/` depends on it yet.

## Stage 1 — run it right now

Just open `public/index.html` in a browser, or serve the folder with any
static file server, e.g.:

```bash
cd public
python3 -m http.server 8080
```

Then visit **http://localhost:8080**. That's it — no dependencies to
install.

### How it works without a server

Everything — accounts, shops, products, orders, messages — is stored in
the browser's `localStorage`, through `public/js/local-db.js`. Passwords
are hashed (not plain text) before storing, but this is **not** real
security or real persistence: it only lives in one browser, on one device,
and anyone using that browser can inspect it via dev tools. That's fine for
this stage — it's meant for you to click through the whole app (sign up,
open a shop, list a product with a real photo, browse as a buyer, add to
cart, check out, message the shop) and see it actually work end to end.

Every page talks to a single object, `AuroraAPI`, in `public/js/app.js` —
never to `local-db.js` directly. That matters for stage 2: swapping in real
network calls only means changing `AuroraAPI`, not every page.

### Dark mode fix

The dark background wasn't reliably dark before — a CSS rule that set the
page background got dropped by accident during an earlier edit, so the
browser was falling back to its own default (white) in some cases. Fixed:
`body`/`html` now explicitly set the dark background color again, and I
also added a small inline script that paints the correct background
*before* the stylesheet even finishes loading, so there's no flash of the
wrong color on first load either.

## Stage 2 — connect Supabase (whenever you're ready)

Everything for this is already written in `supabase-backend/`:

- `supabase-backend/supabase-schema/schema.sql` — the full Postgres schema
  (tables, security policies, a trigger that creates a profile on signup,
  and a storage bucket for product photos). Run it once in your Supabase
  project's SQL Editor.
- `supabase-backend/server/` — an Express API that talks to Supabase.
- `supabase-backend/.env.example` — copy to `.env` and fill in your
  Supabase project URL + service-role key.
- `supabase-backend/test-connection.js` — run this after filling in `.env`
  to confirm the database is actually reachable before doing anything else:
  ```bash
  cd supabase-backend
  npm install
  npm run check-db
  ```
  It checks your credentials are present and valid-looking, that every
  table from `schema.sql` exists and is queryable, and that the
  `product-images` storage bucket exists — printing a clear ✓ or ✗ for
  each so you know exactly what to fix if something's off.

When you want to move to this stage, the plan is:
1. Run the SQL schema in Supabase.
2. Fill in `supabase-backend/.env`.
3. Run `npm run check-db` to confirm the connection before going further.
4. Swap `public/js/app.js`'s `AuroraAPI` to make real `fetch()` calls to
   the Express API instead of calling `LocalDB` — the request/response
   shapes it already returns match what the backend sends, so this is a
   contained change, not a rewrite of every page.
5. `npm start`.

I can walk through that swap with you whenever you're ready — no rush.

## What's intentionally still a placeholder (either stage)

Reviews, shop analytics (visit counts, conversion rate), and payment
processing aren't wired up to real data — the UI says so rather than
showing invented numbers.
