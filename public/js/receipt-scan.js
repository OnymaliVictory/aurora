// Reads a bank-transfer screenshot and checks it against what the order expects.
// IMPORTANT: this is a HELPER, not a judge. A green result means "the receipt matches"; the seller still
// confirms against their own bank app. The scan runs in the browser of whoever opens it (the seller's
// browser decides for the seller), so nobody can fake the result by sending a made-up "scan result".
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.AuroraScan = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
  const dayNum = (y, m, d) => (y < 2000 || y > 2100 || m < 0 || m > 11 || d < 1 || d > 31 ? null : Date.UTC(y, m, d) / 86400000);

  // ---- amounts ----
  function amountsIn(text) {
    const out = []; const re = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g; let m;
    while ((m = re.exec(text))) {
      const whole = m[1].replace(/,/g, ''); if (whole.length > 10) continue; // a long digit run is an account number, not money
      const before = text.slice(Math.max(0, m.index - 4), m.index);
      out.push({ v: Number(whole + (m[2] ? '.' + m[2] : '')), marked: /(₦|ngn|\bn|#|₦)\s*$/i.test(before) });
    }
    return out;
  }
  function checkAmount(text, expected) {
    const list = amountsIn(text);
    if (list.some(a => Math.abs(a.v - expected) < 0.005)) return 'ok';
    // a clearly money-marked figure that is NOT our amount -> the receipt shows a different payment
    if (list.some(a => a.marked && a.v >= 10)) return 'mismatch';
    return 'missing';
  }

  // ---- dates (day-first, as Nigerian banks print them) ----
  function datesIn(text) {
    const t = text.toLowerCase(); const days = []; let m;
    const push = v => { if (v != null) days.push(v); };
    let re = new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-\\/,.]+' + MON + '[\\s\\-\\/,.]+(\\d{4})', 'g');
    while ((m = re.exec(t))) push(dayNum(+m[3], MONTHS[m[2]], +m[1]));
    re = new RegExp('\\b' + MON + '[\\s\\-\\/,.]+(\\d{1,2})(?:st|nd|rd|th)?,?[\\s\\-\\/,.]+(\\d{4})', 'g');
    while ((m = re.exec(t))) push(dayNum(+m[3], MONTHS[m[1]], +m[2]));
    re = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
    while ((m = re.exec(t))) push(dayNum(+m[1], +m[2] - 1, +m[3]));
    re = /\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/g;
    while ((m = re.exec(t))) { let d = +m[1], mo = +m[2]; if (mo > 12 && d <= 12) [d, mo] = [mo, d]; push(dayNum(+m[3], mo - 1, d)); }
    return days;
  }
  function checkDate(text, orderCreatedAt, now) {
    const days = datesIn(text); if (!days.length) return 'missing';
    const start = Math.floor((new Date(orderCreatedAt).getTime() + 3600e3) / 86400000); // +1h = Nigerian time
    const end = Math.floor(((now || Date.now()) + 3600e3) / 86400000) + 1;
    return days.some(d => d >= start && d <= end) ? 'ok' : 'old';
  }

  // ---- account ----
  function checkAccount(text, number, name) {
    const compact = text.replace(/(\d)[ \-](?=\d)/g, '$1');
    if (number && compact.includes(number)) return 'ok';
    const last4 = String(number || '').slice(-4);
    const masked = last4 && new RegExp('[*•xX.\\u2022]{2,}\\s*' + last4).test(text);
    const toks = String(name || '').toLowerCase().split(/[^a-z]+/).filter(w => w.length >= 3);
    const low = text.toLowerCase(); const hits = toks.filter(w => low.includes(w)).length;
    if (masked && hits >= 1) return 'ok';
    if (masked || (toks.length && hits >= Math.min(2, toks.length))) return 'partial';
    return 'missing';
  }

  // ---- reference code in the narration (O/0, I/1, S/5 ... are easy to misread, so treat them as equal) ----
  const fold = s => String(s).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/[1L]/g, 'I').replace(/5/g, 'S').replace(/2/g, 'Z').replace(/8/g, 'B');
  // true when a and b differ by at most ONE inserted, missing or wrong character
  function within1(a, b) {
    if (a === b) return true; if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  function checkReference(text, ref) {
    if (!ref) return 'missing';
    const t = fold(text), r = fold(ref); if (t.includes(r)) return 'ok';
    for (let len = r.length - 1; len <= r.length + 1; len++) for (let i = 0; i + len <= t.length; i++) if (t[i] === r[0] && within1(t.slice(i, i + len), r)) return 'ok';
    return 'missing';
  }

  function matchReceipt(text, expected, opts) {
    text = String(text || ''); expected = expected || {};
    const r = {
      amount: checkAmount(text, Number(expected.amount)),
      account: checkAccount(text, expected.accountNumber, expected.accountName),
      date: checkDate(text, expected.orderCreatedAt, opts && opts.now),
      reference: checkReference(text, expected.reference),
      readable: text.replace(/\s/g, '').length >= 25,
    };
    r.verdict = !r.readable ? 'unreadable'
      : (r.amount === 'mismatch' || r.date === 'old') ? 'red'
      : (r.amount === 'ok' && r.account === 'ok' && r.date === 'ok') ? 'green' : 'yellow';
    return r;
  }

  const LABEL = {
    green: 'Looks right', yellow: 'Check this one yourself', red: 'Does not match', unreadable: 'Could not read this image',
  };
  const CHIP = (r, e) => [
    { key: 'amount', label: 'Amount ' + (e && e.amount ? '₦' + Math.round(e.amount).toLocaleString('en-NG') : ''), state: { ok: 'ok', missing: 'unknown', mismatch: 'bad' }[r.amount] },
    { key: 'account', label: 'Store account', state: { ok: 'ok', partial: 'unknown', missing: 'unknown' }[r.account] },
    { key: 'date', label: 'Date', state: { ok: 'ok', missing: 'unknown', old: 'bad' }[r.date] },
    { key: 'reference', label: 'Reference', state: r.reference === 'ok' ? 'ok' : 'unknown' },
  ];

  // ---- OCR (browser only) ----
  const V = '5.1.1';
  const CDN = 'https://cdn.jsdelivr.net/npm/';
  let loading = null;
  function loadLib() {
    if (typeof Tesseract !== 'undefined') return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((res, rej) => {
      const s = document.createElement('script'); s.src = CDN + 'tesseract.js@' + V + '/dist/tesseract.min.js';
      s.onload = res; s.onerror = () => { loading = null; rej(new Error('Could not load the scanner.')); }; document.head.appendChild(s);
    });
    return loading;
  }
  // Big phone photos are shrunk first so the scan stays quick.
  async function toBlob(src) {
    const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
    if (typeof createImageBitmap !== 'function') return blob;
    try {
      const bmp = await createImageBitmap(blob); const max = 1800; const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(r, 'image/png'));
    } catch { return blob; }
  }
  async function readText(src, onProgress) {
    await loadLib();
    const worker = await Tesseract.createWorker('eng', 1, {
      workerPath: CDN + 'tesseract.js@' + V + '/dist/worker.min.js',
      corePath: CDN + 'tesseract.js-core@5.1.1',
      langPath: CDN + '@tesseract.js-data/eng@1.0.0/4.0.0_best_int',
      logger: m => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress || 0); },
    });
    try { const { data } = await worker.recognize(await toBlob(src)); return data.text || ''; }
    finally { try { await worker.terminate(); } catch {} }
  }
  // Never throws: a failed scan just means "check it yourself".
  async function scan(src, expected, onProgress) {
    try { const text = await readText(src, onProgress); const r = matchReceipt(text, expected); r.chips = CHIP(r, expected); r.title = LABEL[r.verdict]; return r; }
    catch (e) { console.warn('[receipt-scan]', e && e.message ? e.message : e); return { verdict: 'unreadable', title: LABEL.unreadable, chips: [], error: e.message, readable: false }; }
  }

  return { matchReceipt, scan, readText, checkAmount, checkDate, checkAccount, checkReference, datesIn, amountsIn, LABEL, CHIP };
});
