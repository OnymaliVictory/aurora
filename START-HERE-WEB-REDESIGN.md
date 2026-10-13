# Website redesign (matches the mobile app)

Copy the `public/` folder over your project's `public/` folder, push to GitHub, Vercel redeploys.

What changed
- New `public/css/aurora-app.css` (loaded after style.css on every page): Inter font, lavender background, white rounded cards, purple gradient pill buttons, rounded inputs, gradient active sidebar, app-style tab bar on phones (buyer page), purple chat button.
- Light mode is now the default for everyone (theme key renamed to `aurora_theme_v2` so old "dark" choices don't carry over). Dark mode still works with the moon/sun button.
- Buyer page: new bottom tab bar on phones (Home, Browse, Cart, Orders, Account); Settings link now opens settings.html instead of "coming soon".
- All pages include terms.html / privacy.html styling; includes the earlier reset-password, auth, admin, seller pages (they get the new colours automatically).

To undo: delete the `<link ... aurora-app.css>` line from the pages.
Not changed: how anything works, only how it looks. Admin and seller dashboards got the new colours/fonts through shared styles but I haven't screenshot-reviewed them with real data, so glance at them.
