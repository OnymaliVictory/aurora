// Shop templates: the look of a shop page (cover art, colours, fonts, falling effects).
// One file feeds both the shop page and the picker in Settings, so they always match.
// The server only stores the template NAME (see shopSettings.js); nothing here comes from the shop owner except
// that name and their own colour, and both are checked before use.
const ShopThemes = (() => {
  const svg = (w, h, body) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}'>${body}</svg>`)}")`;

  // ---------- reusable pieces of art ----------
  const bunting = colors => { // a string of little flags
    const flags = [4, 36, 68].map((x, i) => `<path d='M${x} 4 L${x + 24} 4 L${x + 12} 30 Z' fill='${colors[i % colors.length]}'/>`).join('');
    return svg(96, 34, `<path d='M0 4 H96' stroke='rgba(255,255,255,.75)' stroke-width='1.5'/>${flags}`);
  };
  const snow = svg(90, 22, `<path d='M0 22 V12 Q11 -2 22 10 Q34 0 45 10 Q56 -2 68 10 Q80 0 90 12 V22 Z' fill='#fff'/>`);
  const garland = svg(120, 46, `<path d='M0 6 Q30 40 60 6 Q90 40 120 6' fill='none' stroke='#1b5e20' stroke-width='5'/><path d='M0 6 Q30 40 60 6 Q90 40 120 6' fill='none' stroke='#43a047' stroke-width='2' stroke-dasharray='3 5'/>`
    + `<circle cx='15' cy='19' r='3' fill='#ffeb3b'/><circle cx='45' cy='19' r='3' fill='#ff7043'/><circle cx='75' cy='19' r='3' fill='#ffeb3b'/><circle cx='105' cy='19' r='3' fill='#ff7043'/>`
    + `<path d='M30 23 V30' stroke='#ddd'/><circle cx='30' cy='35' r='7' fill='#e53935'/><circle cx='28' cy='33' r='2' fill='#fff' opacity='.6'/>`
    + `<path d='M90 23 V30' stroke='#ddd'/><circle cx='90' cy='35' r='7' fill='#ffd54f'/><circle cx='88' cy='33' r='2' fill='#fff' opacity='.6'/>`);
  const bat = (x, y, k = 1) => `<g transform='translate(${x} ${y}) scale(${k})' fill='#12061f'><path d='M0 6 Q5 -4 11 4 Q14 0 17 4 Q23 -4 28 6 Q22 4 17 10 Q14 6 11 10 Q6 4 0 6Z'/></g>`;
  const spooky = svg(180, 46, `<path d='M0 46 V32 Q20 14 40 30 Q60 8 80 28 Q100 12 120 30 Q140 16 160 30 Q170 22 180 32 V46Z' fill='#12061f'/>`
    + `<circle cx='62' cy='33' r='8' fill='#f57c00'/><path d='M62 25 V21' stroke='#2e7d32' stroke-width='2.5'/><path d='M58 32 l3 -3 l3 3 M62 36 h0' stroke='#12061f' stroke-width='1.4' fill='none'/>`
    + `<circle cx='139' cy='33' r='7' fill='#f57c00'/><path d='M139 26 V22' stroke='#2e7d32' stroke-width='2.5'/>`
    + bat(24, 8) + bat(112, 4, .8));
  const scallop = svg(40, 16, `<path d='M0 16 V8 Q10 -2 20 8 Q30 -2 40 8 V16Z' fill='rgba(255,255,255,.92)'/>`);
  const hearts = svg(60, 40, `<path d='M0 5 H60' stroke='rgba(255,255,255,.75)' stroke-width='1.5'/>`
    + [14, 44].map(x => `<g transform='translate(${x} 12)'><path d='M0 0 C-9 -10 -15 4 0 15 C15 4 9 -10 0 0Z' fill='#ff80ab' stroke='#fff' stroke-width='1.2'/></g>`).join(''));
  const confetti = svg(120, 22, ['#ffd700,12,6,3', '#fff,40,14,2', '#ff80ab,64,5,3', '#ffd700,88,15,2.5', '#7cf,108,8,2'].map(c => { const [f, x, y, r] = c.split(','); return `<circle cx='${x}' cy='${y}' r='${r}' fill='${f}' opacity='.9'/>`; }).join('')
    + `<rect x='25' y='4' width='6' height='2' fill='#ffd700' transform='rotate(40 28 5)'/><rect x='76' y='10' width='6' height='2' fill='#fff' transform='rotate(-30 79 11)'/>`);
  const skyline = svg(200, 50, `<g fill='#04231a'><path d='M64 50 V32 Q64 12 90 12 Q116 12 116 32 V50Z'/><rect x='54' y='20' width='7' height='30'/><path d='M53 20 L57.5 8 L62 20Z'/><rect x='119' y='20' width='7' height='30'/><path d='M118 20 L122.5 8 L127 20Z'/>`
    + `<path d='M130 50 V38 Q130 28 146 28 Q162 28 162 38 V50Z'/><path d='M20 50 V40 Q20 31 33 31 Q46 31 46 40 V50Z'/><rect x='88' y='6' width='4' height='7'/><path d='M0 50 H200 V47 H0Z'/></g>`
    + `<path d='M90 4 a5 5 0 1 0 5 7 a4 4 0 1 1 -5 -7Z' fill='#ffd54f'/><circle cx='100' cy='6' r='1.2' fill='#ffd54f'/>`);
  const hazard = svg(28, 14, `<rect width='28' height='14' fill='#111'/><path d='M0 14 L14 0 H28 L14 14Z' fill='#facc15'/>`);
  const naijaBand = svg(90, 14, `<rect width='30' height='14' fill='#008751'/><rect x='30' width='30' height='14' fill='#fff'/><rect x='60' width='30' height='14' fill='#008751'/>`);
  const grass = svg(60, 24, `<g fill='#689f38'><path d='M0 24 L4 8 L8 24Z'/><path d='M9 24 L15 3 L21 24Z'/><path d='M22 24 L26 10 L31 24Z'/><path d='M32 24 L38 5 L44 24Z'/><path d='M45 24 L50 11 L55 24Z'/></g>`
    + `<circle cx='15' cy='5' r='3.5' fill='#f48fb1'/><circle cx='38' cy='7' r='3.5' fill='#fff176'/><circle cx='50' cy='13' r='3' fill='#ce93d8'/>`);
  const moon = svg(120, 120, `<circle cx='60' cy='60' r='34' fill='#ffe082'/><circle cx='48' cy='50' r='6' fill='#ffd54f'/><circle cx='70' cy='72' r='8' fill='#ffd54f'/><circle cx='72' cy='46' r='4' fill='#ffd54f'/>`);
  const crescent = svg(110, 110, `<path d='M62 14 a42 42 0 1 0 34 62 a34 34 0 1 1 -34 -62Z' fill='#ffd54f'/><path d='M86 22 l3 8 8 1 -6 5 2 8 -7 -4 -7 4 2 -8 -6 -5 8 -1Z' fill='#ffd54f'/>`);

  // ---------- the nine templates ----------
  // light / dark: accent colours for each mode (dark mode needs brighter ones).  cover: [from, to] gradient.
  const T = {
    classic:   { name: 'Classic', emoji: '✦', desc: 'Your own colour, clean and simple.' },
    christmas: { name: 'Christmas', emoji: '🎄', desc: 'Garlands, snow and festive red & green.',
      light: ['#C62828', '#2E7D32'], dark: ['#EF5350', '#66BB6A'], cover: ['#7f1010', '#14532d'], top: garland, bottom: snow, topH: 46, bottomH: 22,
      fx: { items: ['❄️', '❅', '❆', '🎄'], kind: 'fall' }, font: ['Mountains of Christmas', 'Mountains+of+Christmas:wght@700'] },
    halloween: { name: 'Halloween', emoji: '🎃', desc: 'Spooky hills, bats and pumpkins.',
      light: ['#E65100', '#6A1B9A'], dark: ['#FF9800', '#BA68C8'], cover: ['#14061f', '#4a148c'], top: bunting(['#f57c00', '#6a1b9a', '#212121']), bottom: spooky, topH: 34, bottomH: 46, extra: [{ img: moon, pos: '88% 30%', size: '64px 64px' }],
      fx: { items: ['🦇', '🎃', '👻', '🕸️'], kind: 'fall' }, font: ['Creepster', 'Creepster'] },
    valentine: { name: "Valentine's", emoji: '💝', desc: 'Hearts, lace and romantic pinks.',
      light: ['#D81B60', '#EC407A'], dark: ['#FF4081', '#F48FB1'], cover: ['#ad1457', '#ff6f91'], top: hearts, bottom: scallop, topH: 40, bottomH: 16,
      fx: { items: ['❤️', '💖', '💕', '💗'], kind: 'rise' }, font: ['Pacifico', 'Pacifico'] },
    newyear:   { name: 'New Year', emoji: '🎆', desc: 'Gold, black and party sparkle.',
      light: ['#B8860B', '#1F2937'], dark: ['#FFD54F', '#FFB300'], cover: ['#0d0b24', '#322a6b'], top: bunting(['#ffd700', '#111827', '#fff']), bottom: confetti, topH: 34, bottomH: 22,
      fx: { items: ['✨', '🎉', '🎊', '⭐'], kind: 'fall' }, font: ['Cinzel Decorative', 'Cinzel+Decorative:wght@700'] },
    eid:       { name: 'Eid / Sallah', emoji: '🌙', desc: 'Crescent, lanterns and green & gold.',
      light: ['#0F7B4A', '#B8860B'], dark: ['#34D399', '#FBBF24'], cover: ['#05442f', '#0f766e'], top: bunting(['#ffd54f', '#fff', '#1b5e20']), bottom: skyline, topH: 34, bottomH: 50, extra: [{ img: crescent, pos: '9% 36%', size: '70px 70px' }],
      fx: { items: ['⭐', '✨', '🌙'], kind: 'fall' }, font: ['Cormorant Garamond', 'Cormorant+Garamond:wght@700'] },
    blackfriday: { name: 'Black Friday', emoji: '🏷️', desc: 'Bold black and yellow for sale season.',
      light: ['#111827', '#B45309'], dark: ['#FACC15', '#F59E0B'], cover: ['#000000', '#2b2b30'], top: '', bottom: hazard, topH: 0, bottomH: 14,
      fx: { items: ['🏷️', '💥'], kind: 'fall', count: 8 }, font: ['Bebas Neue', 'Bebas+Neue'] },
    naija:     { name: 'Naija Pride', emoji: '🟢', desc: 'Green-white-green for Independence season.',
      light: ['#008751', '#00A86B'], dark: ['#2ECC71', '#58D68D'], cover: ['#006b40', '#00b36b'], top: bunting(['#008751', '#fff']), bottom: naijaBand, topH: 34, bottomH: 14,
      fx: { items: ['✨', '⭐'], kind: 'fall', count: 8 }, font: ['Poppins', 'Poppins:wght@700'] },
    spring:    { name: 'Easter / Spring', emoji: '🐣', desc: 'Pastel flowers, eggs and fresh greens.',
      light: ['#5B8E2B', '#D81B60'], dark: ['#9CCC65', '#F48FB1'], cover: ['#7cb342', '#f48fb1'], top: bunting(['#f8bbd0', '#fff59d', '#b3e5fc', '#c8e6c9']), bottom: grass, topH: 34, bottomH: 24,
      fx: { items: ['🌸', '🌼', '🐣', '🥚'], kind: 'fall' }, font: ['Fredoka', 'Fredoka:wght@600'] },
  };
  const KEYS = Object.keys(T);

  // ---------- colour helpers ----------
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const toHex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  const mix = (h, o, t) => { const a = hex(h), b = hex(o); return toHex(a.map((v, i) => v + (b[i] - v) * t)); };
  const lum = h => { const [r, g, b] = hex(h).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const onAccent = h => (contrast(h, '#ffffff') >= contrast(h, '#111111') ? '#ffffff' : '#111111');
  // An owner's colour can be very pale (neon mint on white is unreadable): darken it just enough that white text works.
  const readable = h => { let c = h, n = 0; while (contrast(c, '#ffffff') < 3.6 && n++ < 20) c = mix(c, '#000000', .08); return c; };
  const isHex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);

  const mode = () => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light');
  const keyOf = k => (T[k] ? k : 'classic');

  // Colours that should be used right now for a shop (template + mode + owner colour).
  function palette(shop) {
    const key = keyOf(shop && shop.theme), m = mode(), t = T[key];
    if (key === 'classic') {
      const base = isHex(shop && shop.color) ? shop.color.toLowerCase() : '#6D3EF2';
      const a = m === 'light' ? readable(base) : base;
      const a2 = m === 'light' ? mix(a, '#ffffff', .22) : mix(base, '#ffffff', .25);
      return { key, accent: a, accent2: a2, cover: [m === 'light' ? a : mix(base, '#000000', .35), mix(a, '#000000', .55)] };
    }
    const [a, a2] = t[m];
    return { key, accent: a, accent2: a2, cover: t.cover };
  }

  // ---------- painting a cover (used by the shop page AND the settings preview) ----------
  function coverLayers(shop, bannerUrl) {
    const key = keyOf(shop && shop.theme), t = T[key], p = palette(shop);
    const L = [];
    if (key !== 'classic') {
      if (t.top) L.push({ img: t.top, pos: 'left top', size: `auto ${t.topH}px`, rep: 'repeat-x' });
      if (t.bottom) L.push({ img: t.bottom, pos: 'left bottom', size: `auto ${t.bottomH}px`, rep: 'repeat-x' });
      (t.extra || []).forEach(e => L.push({ img: e.img, pos: e.pos, size: e.size, rep: 'no-repeat' }));
    }
    if (bannerUrl) L.push({ img: `url(${JSON.stringify(bannerUrl)})`, pos: 'center', size: 'cover', rep: 'no-repeat' });
    else L.push({ img: `linear-gradient(135deg, ${p.cover[0]}, ${p.cover[1]})`, pos: 'center', size: 'cover', rep: 'no-repeat' });
    return L;
  }
  // !important is deliberate: the light-mode stylesheet forces a purple cover and would otherwise hide the owner's choice.
  function paintCover(el, shop, bannerUrl, { always = false } = {}) {
    const key = keyOf(shop && shop.theme);
    const needs = always || bannerUrl || key !== 'classic' || mode() === 'light';
    if (!needs) { ['background-image', 'background-position', 'background-size', 'background-repeat'].forEach(p => el.style.removeProperty(p)); return; }
    const L = coverLayers(shop, bannerUrl);
    el.style.setProperty('background-image', L.map(l => l.img).join(','), 'important');
    el.style.setProperty('background-position', L.map(l => l.pos).join(','), 'important');
    el.style.setProperty('background-size', L.map(l => l.size).join(','), 'important');
    el.style.setProperty('background-repeat', L.map(l => l.rep).join(','), 'important');
  }

  // ---------- falling / rising emoji ----------
  let fxEl = null;
  function stopFx() { if (fxEl) { fxEl.remove(); fxEl = null; } }
  function startFx(key) {
    stopFx();
    const t = T[key]; if (!t || !t.fx) return;
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const small = window.innerWidth < 700;
    const n = Math.min(t.fx.count || 14, small ? 8 : 16);
    fxEl = document.createElement('div'); fxEl.className = 'shop-fx'; fxEl.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < n; i++) {
      const s = document.createElement('span'); s.textContent = t.fx.items[i % t.fx.items.length];
      s.style.cssText = `--x:${Math.round(Math.random() * 96)}%;--s:${14 + Math.round(Math.random() * 14)}px;--d:${9 + Math.round(Math.random() * 9)}s;--delay:${-Math.round(Math.random() * 14)}s;--drift:${Math.round(Math.random() * 90 - 45)}px;animation-name:${t.fx.kind === 'rise' ? 'shoprise' : 'shopfall'}`;
      fxEl.appendChild(s);
    }
    document.body.appendChild(fxEl);
  }

  function loadFont(key) {
    const t = T[key]; if (!t || !t.font) return;
    const id = 'shop-font-' + key; if (document.getElementById(id)) return;
    const l = document.createElement('link'); l.id = id; l.rel = 'stylesheet'; l.href = `https://fonts.googleapis.com/css2?family=${t.font[1]}&display=swap`; document.head.appendChild(l);
  }

  // ---------- apply to a shop page ----------
  let current = null;
  function apply(shop) {
    current = shop;
    const p = palette(shop), key = p.key, b = document.body, st = b.style;
    b.setAttribute('data-shop-theme', key);
    st.setProperty('--shop-accent', p.accent); st.setProperty('--shop-accent2', p.accent2); st.setProperty('--shop-on-accent', onAccent(p.accent));
    st.setProperty('--shop-font', T[key].font ? `'${T[key].font[0]}', 'Inter', sans-serif` : 'inherit');
    if (T[key].font) loadFont(key);
    const bannerUrl = shop && typeof shop.bannerUrl === 'string' && /^https:\/\//i.test(shop.bannerUrl) ? shop.bannerUrl : null;
    const cover = document.querySelector('.shop-cover');
    if (cover) {
      paintCover(cover, shop, bannerUrl);
      cover.toggleAttribute('data-banner', !!bannerUrl);
      const cv = document.getElementById('shop-cover-canvas');
      if (cv) { if (bannerUrl || key !== 'classic') cv.style.setProperty('display', 'none', 'important'); else cv.style.removeProperty('display'); }
    }
    // dark mode + Classic keeps the original Aurora look, tinted only by the owner's colour (as it always was)
    const sc = document.getElementById('shop-content');
    if (sc) { if (key === 'classic' && mode() === 'dark' && isHex(shop && shop.color)) sc.style.setProperty('--aurora-teal', shop.color); else sc.style.removeProperty('--aurora-teal'); }
    startFx(key);
  }
  // Light/dark switch: recolour without a reload.
  new MutationObserver(() => { if (current) apply(current); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  return { T, KEYS, apply, palette, coverLayers, paintCover, mode, readable, onAccent, contrast, startFx, stopFx, keyOf, loadFont };
})();
if (typeof module === 'object' && module.exports) module.exports = ShopThemes;
