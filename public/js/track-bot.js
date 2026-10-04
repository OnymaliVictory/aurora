// track-bot.js — the floating tracking assistant (loaded on every page by app.js)
// and the shared lookup/render code that track.html reuses.
(function () {
  const LAST_KEY = 'aurora_last_tracking_id';

  // Escape anything that came from the server before putting it in HTML.
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // localStorage can throw (private mode etc.), so always wrap it.
  const remember = id => { try { localStorage.setItem(LAST_KEY, id); } catch {} };
  const recall = () => { try { return localStorage.getItem(LAST_KEY) || ''; } catch { return ''; } };

  const fmtNaira = n => '₦' + Math.round(n).toLocaleString();
  const fmtDate = iso => iso ? new Date(iso).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : '';

  async function lookup(rawId) {
    const res = await fetch('/api/track/' + encodeURIComponent(rawId.trim()));
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data.error || 'Could not look that up. Please try again.');
    return data.tracking;
  }

  function renderTracking(t) {
    const steps = t.steps.map(s => `
      <div class="atk-step${s.done ? ' done' : ''}${s.current ? ' current' : ''}${s.failed ? ' failed' : ''}">
        <span class="atk-dot"></span>
        <div>
          <div class="atk-step-label">${esc(s.label)}</div>
          ${s.at ? `<div class="atk-step-time">${esc(fmtDate(s.at))}</div>` : ''}
        </div>
      </div>`).join('');

    const items = t.items.map(i =>
      `<li>${esc(i.emoji || '📦')} ${esc(i.name)}${i.size ? ' (' + esc(i.size) + ')' : ''} × ${Number(i.qty) || 1}</li>`).join('');

    return `
      <div class="atk-card">
        <div class="atk-id">${esc(t.trackingId)}</div>
        <div class="atk-meta">Order #${esc(t.orderNumber)} · ${esc(t.shopName || 'Aurora seller')}</div>
        <div class="atk-steps">${steps}</div>
        <ul class="atk-items">${items}</ul>
        <div class="atk-meta">Placed ${esc(fmtDate(t.createdAt))} · Total ${esc(fmtNaira(t.total))}</div>
        <div id="atk-actions"></div>
      </div>`;
  }

  // Wires one form + one result box together. Used by the bot AND track.html.
  function bindLookup(form, input, resultBox) {
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const id = input.value.trim();
      if (!id) return;
      const btn = form.querySelector('button');
      btn.disabled = true;
      resultBox.innerHTML = '<div class="atk-note">Looking…</div>';
      try {
        const t = await lookup(id);
        remember(t.trackingId);
        input.value = t.trackingId;
        resultBox.innerHTML = renderTracking(t);
      } catch (err) {
        resultBox.innerHTML = `<div class="atk-note atk-error">${esc(err.message)}</div>`;
      } finally {
        btn.disabled = false;
      }
    });
  }

  function injectStyles() {
    if (document.getElementById('atk-style')) return;
    const css = `
      #atk-fab{position:fixed;right:24px;bottom:24px;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;z-index:900;font-size:26px;
        background:linear-gradient(135deg,var(--aurora-green),var(--aurora-teal));box-shadow:0 0 24px rgba(0,255,179,.3);transition:transform .25s}
      #atk-fab:hover{transform:scale(1.08)}
      #atk-panel{position:fixed;right:24px;bottom:92px;width:370px;max-width:calc(100vw - 32px);max-height:75vh;overflow-y:auto;z-index:900;display:none;padding:18px;
        background:var(--panel-solid);border:1px solid var(--glass-border);border-radius:var(--radius);backdrop-filter:blur(20px);color:var(--text-primary)}
      #atk-panel.open{display:block}
      .atk-head{font-family:'Orbitron',sans-serif;font-size:11px;letter-spacing:2px;color:var(--text-dim);margin-bottom:6px}
      .atk-hello{font-size:13.5px;color:var(--text-muted);margin-bottom:12px}
      .atk-form{display:flex;gap:8px}
      .atk-form input{flex:1;min-width:0;padding:10px 12px;border-radius:10px;border:1px solid var(--glass-border);background:var(--input-bg);color:var(--text-primary);font-size:14px;letter-spacing:1px;text-transform:uppercase}
      .atk-form button{padding:10px 16px;border-radius:10px;border:none;cursor:pointer;font-weight:700;background:linear-gradient(135deg,var(--aurora-green),var(--aurora-teal));color:var(--on-accent-text)}
      .atk-form button:disabled{opacity:.6;cursor:wait}
      .atk-card{margin-top:14px;padding:14px;border-radius:12px;border:1px solid var(--glass-border);background:var(--glass)}
      .atk-id{font-family:'Orbitron',sans-serif;font-size:16px;font-weight:700;letter-spacing:2px;color:var(--aurora-teal)}
      .atk-meta{font-size:12px;color:var(--text-muted);margin-top:4px}
      .atk-steps{margin:14px 0 10px}
      .atk-step{display:flex;gap:12px;position:relative;padding-bottom:14px;opacity:.45}
      .atk-step:last-child{padding-bottom:0}
      .atk-step:not(:last-child)::before{content:'';position:absolute;left:6px;top:14px;bottom:0;width:2px;background:var(--glass-border)}
      .atk-step.done,.atk-step.current{opacity:1}
      .atk-dot{width:14px;height:14px;border-radius:50%;flex-shrink:0;margin-top:2px;border:2px solid var(--glass-border);background:var(--void)}
      .atk-step.done .atk-dot{background:var(--aurora-green);border-color:var(--aurora-green)}
      .atk-step.current .atk-dot{border-color:var(--aurora-teal);box-shadow:0 0 10px var(--aurora-teal)}
      .atk-step.failed .atk-dot{background:var(--aurora-pink);border-color:var(--aurora-pink)}
      .atk-step-label{font-size:13.5px;font-weight:600}
      .atk-step-time{font-size:11.5px;color:var(--text-muted)}
      .atk-items{list-style:none;margin:0 0 10px;padding:10px 0 0;border-top:1px solid var(--glass-border);font-size:13px}
      .atk-items li{padding:2px 0}
      .atk-note{margin-top:12px;font-size:13px;color:var(--text-muted)}
      .atk-error{color:var(--aurora-pink)}
      .atk-link{display:block;margin-top:12px;font-size:12.5px;color:var(--aurora-teal)}
    `;
    const style = document.createElement('style');
    style.id = 'atk-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function mountBot() {
    if (document.getElementById('atk-fab')) return;
    // track.html already IS the tracker, so it doesn't need the floating one.
    if (document.body.hasAttribute('data-no-bot')) return;
    injectStyles();

    const fab = document.createElement('button');
    fab.id = 'atk-fab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Track an order');
    fab.textContent = '🤖';

    const panel = document.createElement('div');
    panel.id = 'atk-panel';
    panel.innerHTML = `
      <div class="atk-head">AURORA ASSISTANT</div>
      <div class="atk-hello">Hi! Paste your tracking ID to see where your order is.</div>
      <form class="atk-form" id="atk-form">
        <input id="atk-input" placeholder="AUR-XXXX-XXXX" autocomplete="off" spellcheck="false" maxlength="20" aria-label="Tracking ID">
        <button type="submit">Track</button>
      </form>
      <div id="atk-result"></div>
      <a class="atk-link" id="atk-full" href="track.html">Open full tracking page →</a>`;

    document.body.append(panel, fab);

    const input = panel.querySelector('#atk-input');
    input.value = recall();
    bindLookup(panel.querySelector('#atk-form'), input, panel.querySelector('#atk-result'));

    fab.addEventListener('click', () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) input.focus();
    });
  }

  // Share the pieces track.html needs.
  window.AuroraTrack = { lookup, renderTracking, bindLookup, injectStyles, recall };

  // app.js loads this file dynamically, so the page may already be ready.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBot);
  else mountBot();
})();