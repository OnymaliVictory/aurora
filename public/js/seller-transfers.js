// Seller side of bank-transfer payments: set the receiving account, check a buyer's receipt, confirm or reject.
// Needs app.js (AuroraAPI, showToast, escapeHtml) and receipt-scan.js. Loaded by seller.html.
const SellerTransfers = (() => {
  const naira = n => '₦' + Math.round(Number(n) || 0).toLocaleString('en-NG');
  const esc = s => (typeof escapeHtml === 'function' ? escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const BANKS = ['Access Bank', 'Citibank', 'Ecobank', 'Fidelity Bank', 'First Bank', 'FCMB', 'GTBank', 'Heritage Bank', 'Keystone Bank', 'Kuda', 'Moniepoint', 'Opay', 'PalmPay', 'Polaris Bank', 'Providus Bank', 'Stanbic IBTC', 'Sterling Bank', 'Union Bank', 'UBA', 'Unity Bank', 'Wema Bank', 'Zenith Bank'];

  // ---- order rows ----
  const isManual = o => o && o.paymentMethod === 'manual';
  const waitingForPay = o => isManual(o) && o.paymentStatus !== 'paid' && o.status !== 'cancelled';
  function badge(o) {
    const m = { awaiting_proof: ['status-pending', 'Waiting for transfer'], proof_submitted: ['status-processing', 'Receipt sent · verify'], rejected: ['status-pending', 'Not confirmed'], confirmed: ['status-delivered', 'Paid to you ✓'] };
    const s = m[o.transferStatus] || (o.paymentStatus === 'paid' ? m.confirmed : m.awaiting_proof);
    return `<span class="order-status ${s[0]}">${s[1]}</span><span class="order-status" style="background:rgba(128,128,128,.12);color:var(--text-dim)">Bank transfer</span>`;
  }
  function actions(o) {
    if (!waitingForPay(o)) return '';
    const hot = o.transferStatus === 'proof_submitted';
    return `<button class="${hot ? 'btn-primary' : 'btn-secondary'}" style="margin-top:7px;font-size:12px;padding:6px 14px;display:block;margin-left:auto" onclick="SellerTransfers.verify(${o.id})">${hot ? '🔎 Check receipt' : 'Confirm payment'}</button>`;
  }
  // Do not let a seller start preparing an order nobody has paid for yet.
  const blocked = o => waitingForPay(o);

  async function refresh() {
    try {
      const { orders } = await AuroraAPI.get('/orders/shop');
      myOrders = orders;
      if (typeof renderAllOrders === 'function') { renderAllOrders(); renderRecentOrders(); renderKpis(); }
    } catch (e) { showToast(e.message, 'error'); }
  }

  // ---- verify modal ----
  function ensureModal() {
    let m = document.getElementById('modal-verify-pay');
    if (m) return m;
    m = document.createElement('div'); m.className = 'modal-overlay'; m.id = 'modal-verify-pay';
    m.innerHTML = `<div class="modal" style="max-width:520px"><div class="modal-header"><span class="modal-title" id="vp-title">Check payment</span><button class="modal-close" onclick="SellerTransfers.close()">✕</button></div><div id="vp-body" style="padding:6px 20px 20px"></div></div>`;
    document.body.appendChild(m); return m;
  }
  const chip = c => { const col = { ok: '#16a34a', bad: '#dc2626', unknown: '#a16207' }[c.state]; const sym = { ok: '✓', bad: '✗', unknown: '?' }[c.state];
    return `<span style="display:inline-flex;gap:5px;align-items:center;padding:4px 10px;border-radius:999px;font-size:12px;border:1px solid ${col};color:${col};margin:0 6px 6px 0"><b>${sym}</b> ${esc(c.label)}</span>`; };
  const verdictStyle = { green: ['#16a34a', 'Looks right'], yellow: ['#a16207', 'Check this one yourself'], red: ['#dc2626', 'Does not match'], unreadable: ['#a16207', 'Could not read this image'] };

  let current = null;
  async function verify(id) {
    const m = ensureModal(); const body = m.querySelector('#vp-body');
    body.innerHTML = '<div style="padding:24px;color:var(--text-dim)">Loading…</div>'; m.classList.add('open');
    try {
      const { order } = await AuroraAPI.get('/transfers/order/' + id); current = order;
      m.querySelector('#vp-title').textContent = `Order #AUR-${order.id} · ${naira(order.total)}`;
      const hasProof = !!order.proofUrl;
      body.innerHTML = `
        <div style="font-size:13px;line-height:1.6;color:var(--text-muted);margin-bottom:10px">
          Open your <b>bank app</b> and look for <b>${naira(order.total)}</b>${order.reference ? ` with remark <b style="letter-spacing:1px">${esc(order.reference)}</b>` : ''}.
          The scan below only helps you — your bank app is the real proof.</div>
        ${hasProof ? `<a href="${esc(order.proofUrl)}" target="_blank" rel="noopener"><img src="${esc(order.proofUrl)}" alt="Buyer's receipt" style="width:100%;max-height:340px;object-fit:contain;border-radius:10px;border:1px solid rgba(128,128,128,.3);background:rgba(128,128,128,.08)"></a>
          <div id="vp-scan" style="margin-top:12px;font-size:13px;color:var(--text-dim)">Scanning receipt… <span id="vp-pct">0</span>%</div>`
          : `<div style="padding:14px;border-radius:10px;background:rgba(161,98,7,.1);color:#a16207;font-size:13px">The buyer has not uploaded a receipt yet. If you already see the money in your bank app you can still confirm.</div>`}
        ${order.rejectReason ? `<div style="margin-top:10px;font-size:12.5px;color:var(--text-dim)">Last note to buyer: “${esc(order.rejectReason)}”</div>` : ''}
        <label style="display:flex;gap:9px;align-items:flex-start;margin:16px 0 6px;font-size:13px;cursor:pointer"><input type="checkbox" id="vp-seen" style="margin-top:3px"> <span>I can see <b>${naira(order.total)}</b> in my account for this order.</span></label>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
          <button class="btn-primary" id="vp-confirm" disabled style="opacity:.5" onclick="SellerTransfers.confirm()">✓ I received it — confirm</button>
          <button class="btn-secondary" onclick="SellerTransfers.askReject()">Not received</button>
        </div>
        <div id="vp-reject" style="display:none;margin-top:12px"><input class="form-input" id="vp-reason" maxlength="200" placeholder="Tell the buyer what's wrong (e.g. amount is short)"><button class="btn-secondary" style="margin-top:8px" onclick="SellerTransfers.reject()">Send to buyer</button></div>`;
      body.querySelector('#vp-seen').onchange = e => { const b = body.querySelector('#vp-confirm'); b.disabled = !e.target.checked; b.style.opacity = e.target.checked ? 1 : .5; };
      if (hasProof) {
        const r = await AuroraScan.scan(order.proofUrl, order.expected, p => { const el = body.querySelector('#vp-pct'); if (el) el.textContent = Math.round(p * 100); });
        const box = body.querySelector('#vp-scan'); if (!box) return;
        const v = verdictStyle[r.verdict] || verdictStyle.unreadable;
        box.innerHTML = `<div style="font-weight:700;color:${v[0]};margin-bottom:8px">Scan: ${v[1]}</div>${(r.chips || []).map(chip).join('')}` +
          (r.verdict === 'red' ? '<div style="font-size:12.5px;color:#dc2626;margin-top:2px">The receipt shows a different amount or an old date. Check carefully before confirming.</div>' : '') +
          (r.verdict === 'unreadable' ? '<div style="font-size:12.5px;margin-top:2px">Read the picture yourself and compare with your bank app.</div>' : '');
      }
    } catch (e) { body.innerHTML = `<div style="padding:20px;color:#dc2626">${esc(e.message)}</div>`; }
  }
  function close() { const m = document.getElementById('modal-verify-pay'); if (m) m.classList.remove('open'); current = null; }
  async function confirmPay() {
    if (!current) return; const b = document.getElementById('vp-confirm'); b.disabled = true; b.textContent = 'Confirming…';
    try { await AuroraAPI.post(`/transfers/order/${current.id}/confirm`); close(); showToast('✓ Payment confirmed — the buyer has been notified'); await refresh(); }
    catch (e) { showToast(e.message, 'error'); b.disabled = false; b.textContent = '✓ I received it — confirm'; }
  }
  function askReject() { const d = document.getElementById('vp-reject'); d.style.display = 'block'; document.getElementById('vp-reason').focus(); }
  async function rejectPay() {
    if (!current) return; const reason = document.getElementById('vp-reason').value;
    try { await AuroraAPI.post(`/transfers/order/${current.id}/reject`, { reason }); close(); showToast('Buyer told — they can upload a new receipt'); await refresh(); }
    catch (e) { showToast(e.message, 'error'); }
  }

  // ---- the account buyers pay into (Earnings view) ----
  async function mountAccount() {
    const host = document.getElementById('transfer-account-card'); if (!host) return;
    let acct = null; try { acct = (await AuroraAPI.get('/transfers/account')).account; } catch {}
    const v = acct || {};
    host.innerHTML = `
      <div class="panel-header"><span class="panel-title">Bank Transfer Account</span></div>
      <p style="font-size:12.5px;color:var(--text-dim);margin:6px 0 14px">Buyers who choose “Bank transfer” pay <b>straight into this account</b>, upload their receipt, and you confirm it here. Only the buyer of an order, you and Aurora admins can ever see these details.</p>
      <div style="display:flex;flex-direction:column;gap:12px;max-width:380px">
        <div class="form-group"><label class="form-label">Bank</label><input class="form-input" id="ta-bank" list="ta-banks" maxlength="60" placeholder="e.g. GTBank, Opay" value="${esc(v.bankName || '')}"><datalist id="ta-banks">${BANKS.map(b => `<option value="${esc(b)}">`).join('')}</datalist></div>
        <div class="form-group"><label class="form-label">Account Number</label><input class="form-input" id="ta-num" inputmode="numeric" maxlength="10" placeholder="0123456789" value="${esc(v.accountNumber || '')}"></div>
        <div class="form-group"><label class="form-label">Account Name</label><input class="form-input" id="ta-name" maxlength="80" placeholder="As your bank shows it" value="${esc(v.accountName || '')}"></div>
        <div id="ta-err" class="form-hint" style="color:#ff6b6b;display:none"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn-primary" id="ta-save">${acct ? 'Update account' : 'Save account'}</button>${acct ? '<button class="btn-secondary" id="ta-remove">Stop accepting transfers</button>' : ''}</div>
        ${acct ? '<div style="font-size:12px;color:var(--aurora-green)">✓ Bank transfer is on for your shop</div>' : '<div style="font-size:12px;color:var(--text-dim)">Until you save an account, buyers cannot pay your shop by transfer.</div>'}
      </div>`;
    host.querySelector('#ta-save').onclick = async () => {
      const err = host.querySelector('#ta-err'); err.style.display = 'none';
      try {
        await AuroraAPI.request('/transfers/account', { method: 'PUT', body: { bankName: host.querySelector('#ta-bank').value, accountNumber: host.querySelector('#ta-num').value, accountName: host.querySelector('#ta-name').value } });
        showToast('✓ Bank transfer account saved'); mountAccount();
      } catch (e) { err.textContent = e.message; err.style.display = 'block'; }
    };
    const rm = host.querySelector('#ta-remove');
    if (rm) rm.onclick = async () => { if (!confirm('Buyers will no longer be able to pay your shop by bank transfer. Continue?')) return; try { await AuroraAPI.del('/transfers/account'); showToast('Bank transfer turned off'); mountAccount(); } catch (e) { showToast(e.message, 'error'); } };
  }

  return { badge, actions, blocked, verify, close, confirm: confirmPay, askReject, reject: rejectPay, mountAccount, refresh };
})();
