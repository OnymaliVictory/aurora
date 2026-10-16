# Dark mode restored to the original Aurora design

- Light mode: untouched (verified with before/after screenshots of 12 pages — pixel-identical).
- Dark mode: the purple "app look" is now switched off in dark, so the original aurora design is back: moving aurora ribbons and stars, teal/purple glow, Cinzel + Orbitron fonts, neon gradient buttons.
- How: `css/aurora-app.css` (the light design) is now enabled only while the light theme is on (see `js/app.js` and the small script after the stylesheet link in each page). New `css/aurora-shared.css` holds layout fixes that apply to both themes (phone tab bar, spiral size).

Copy this `public/` folder over yours, then:
  git add . ; git commit -m "Restore original aurora dark theme; keep new light theme" ; git push
