/* =========================================================
   Studio App — the platform owner's admin (?admin=1).
   Loaded by app.js instead of a studio. Sign in with email + password;
   only accounts in public.admins get in (every call is checked by the
   database / the Edge Functions, not only here).
   • Studios: setup progress, last sign-in, bookings, trial / billing,
     notes; open the app, the dashboard (read only), reset the password,
     pause, delete.
   • New studio: one screen → Edge Function admin-create-master (the app
     icon is drawn here as a monogram and stored with the studio).
   • Welcome kit: links, the temporary password (shown once), a printable
     QR card and a ready message for the master.
   ========================================================= */
(function () {
  'use strict';

  let K = null;
  let root = null;
  const A = { session: null, list: null, view: 'list', q: '', form: null, kit: null, busy: false };

  const $ = (s, el) => (el || root).querySelector(s);
  const $$ = (s, el) => Array.from((el || root).querySelectorAll(s));
  const esc = v => K.esc(v);
  const icon = d => K.svg(d);
  const APP = () => location.origin + location.pathname.replace(/[^/]*$/, '');
  const clientLink = slug => `${APP()}?m=${slug}`;
  const ownerLink = slug => `${APP()}?m=${slug}&owner=1`;
  const TZ = [['America/New_York', 'Eastern'], ['America/Chicago', 'Central'], ['America/Denver', 'Mountain'],
    ['America/Los_Angeles', 'Pacific'], ['America/Anchorage', 'Alaska'], ['Pacific/Honolulu', 'Hawaii']];
  const NICHES = [['lashes', 'Lashes'], ['brows', 'Brows'], ['nails', 'Nails'], ['lashes-brows', 'Lashes + Brows'], ['hair', 'Hair'], ['makeup', 'Makeup']];
  const STYLES = [['noir', 'Noir'], ['soft', 'Soft'], ['maison', 'Maison']];
  const ERR = {
    slug_taken: 'That link is already taken — try another one',
    invalid_slug: 'The link can use letters, numbers and dashes',
    email_taken: 'There is already an account with this email',
    invalid_email: 'Check the email address',
    invalid_name: 'Add the studio name',
    invalid_master_name: 'Add her first name',
    invalid_timezone: 'Pick a time zone',
    invalid_template: 'Pick a niche',
    forbidden: 'This is for the platform admin only',
    confirm_mismatch: 'The link you typed doesn’t match',
    network: 'Connection problem — try again',
    timeout: 'Connection problem — try again'
  };
  const errText = e => ERR[e && e.code] || (e && e.message) || 'Something went wrong — try again';

  /* =========================================================
     Open, sign in
     ========================================================= */
  function open(kit) {
    K = kit;
    root = document.createElement('div');
    root.className = 'adm';
    (document.getElementById('app') || document.body).appendChild(root);
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    root.addEventListener('submit', e => { e.preventDefault(); if (e.target.id === 'adm-signin') signIn(); });
    start();
  }

  async function start() {
    root.innerHTML = '<div class="adm-load"><i class="spin"></i></div>';
    try { A.session = await K.Backend.auth.session(); } catch (e) { A.session = null; }
    if (!A.session) { renderSignIn(); return; }
    let ok = false;
    try { ok = await K.Backend.admin.isAdmin(); } catch (e) { renderSignIn(errText(e)); return; }
    if (!ok) { renderNotAdmin(); return; }
    go('list');
  }

  function renderSignIn(msg) {
    root.innerHTML = `
      <form class="adm-auth" id="adm-signin" autocomplete="on" novalidate>
        <span class="adm-auth__mark">SA</span>
        <h1>Studio App · Admin</h1>
        <p>Sign in with the platform owner’s account.</p>
        <label class="field"><span>Email</span><input id="adm-email" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="you@example.com"></label>
        <label class="field"><span>Password</span><input id="adm-pass" type="password" autocomplete="current-password" placeholder="Your password"></label>
        <button type="submit" class="btn btn--primary btn--block" data-a-signin>${A.busy ? K.spinner() : 'Sign in'}</button>
        ${msg ? `<p class="adm-err" role="alert">${esc(msg)}</p>` : ''}
      </form>`;
  }
  async function signIn() {
    const email = ($('#adm-email').value || '').trim().toLowerCase();
    const pass = $('#adm-pass').value || '';
    if (!email || !pass) { renderSignIn('Enter your email and password'); return; }
    A.busy = true;
    const btn = $('[data-a-signin]');
    if (btn) { btn.disabled = true; btn.innerHTML = K.spinner(); }
    try {
      A.session = await K.Backend.auth.signIn(email, pass);
      A.busy = false;
      await start();
    } catch (e) {
      A.busy = false;
      renderSignIn(e.code === 'bad_login' ? 'Wrong email or password' : errText(e));
    }
  }
  function renderNotAdmin() {
    root.innerHTML = `
      <div class="adm-auth">
        <span class="adm-auth__mark">SA</span>
        <h1>Not available</h1>
        <p>This page is only for the platform admin. You’re signed in as <b>${esc((A.session && A.session.user && A.session.user.email) || '')}</b>.</p>
        <button class="btn btn--soft btn--block" data-a-signout>Sign out</button>
      </div>`;
  }
  async function signOut() {
    try { await K.Backend.auth.signOut(); } catch (e) { /* the local session is cleared anyway */ }
    A.session = null;
    A.list = null;
    renderSignIn();
  }

  /* =========================================================
     Views
     ========================================================= */
  function go(view) {
    A.view = view;
    if (view === 'list') renderList();
    else if (view === 'new') renderNew();
    else if (view === 'kit') renderKit();
    root.scrollTop = 0;
    window.scrollTo(0, 0);
  }
  const barHTML = (title, back) => `
    <header class="adm-bar">
      ${back ? `<button class="adm-back" data-a-go="list">${K.I.chevL}Studios</button>` : '<b class="adm-logo">Studio App <em>Admin</em></b>'}
      <span class="adm-bar__sp"></span>
      ${back ? '' : `<button class="btn btn--primary btn--sm" data-a-go="new">${icon('<path d="M12 5v14M5 12h14"/>')}New studio</button>`}
      <button class="adm-ic" data-a-signout aria-label="Sign out" title="Sign out">${icon('<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 17l5-5-5-5M15 12H4"/>')}</button>
    </header>
    ${title ? `<h1 class="adm-title">${title}</h1>` : ''}`;

  /* ---------- the list ---------- */
  const day = 864e5;
  const fmtDate = iso => { if (!iso) return '—'; const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined }); };
  const ago = iso => {
    if (!iso) return 'never';
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 2) return 'just now';
    if (m < 60) return m + ' min ago';
    if (m < 60 * 24) return Math.round(m / 60) + ' h ago';
    return Math.round(m / 60 / 24) + ' d ago';
  };
  function trialInfo(s) {
    if (s.status !== 'trial' || !s.trial_ends_at) return null;
    const left = Math.ceil((Date.parse(s.trial_ends_at) - Date.now()) / day);
    return { left, warn: left <= 3, text: left < 0 ? 'Trial ended' : left === 0 ? 'Trial ends today' : `Trial · ${left} day${left === 1 ? '' : 's'} left` };
  }
  const pill = s => {
    const t = trialInfo(s);
    if (s.status === 'paused') return '<span class="adm-pill adm-pill--paused">Paused</span>';
    if (t) return `<span class="adm-pill adm-pill--trial${t.warn ? ' is-warn' : ''}">${esc(t.text)}</span>`;
    return '<span class="adm-pill adm-pill--active">Active</span>';
  };
  const mono = name => String(name || '').trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase() || 'S';

  async function renderList() {
    root.innerHTML = barHTML('') + '<main class="adm-main"><div class="adm-load"><i class="spin"></i></div></main>';
    try { A.list = await K.Backend.admin.studios(); } catch (e) {
      $('.adm-main').innerHTML = `<div class="adm-empty"><b>${esc(errText(e))}</b><button class="btn btn--soft btn--sm" data-a-go="list">Try again</button></div>`;
      return;
    }
    paintList();
  }
  function paintList() {
    const all = A.list || [];
    const q = A.q.trim().toLowerCase();
    const list = q ? all.filter(s => [s.name, s.slug, s.master_name, s.owner_email].some(v => String(v || '').toLowerCase().includes(q))) : all;
    const soon = all.filter(s => { const t = trialInfo(s); return t && t.warn; }).length;
    const main = $('.adm-main');
    if (!main) return;
    main.innerHTML = `
      <div class="adm-head">
        <div><h1>Studios</h1><p class="adm-muted">${all.length} studio${all.length === 1 ? '' : 's'}${soon ? ` · <b class="adm-warn-text">${soon} trial${soon > 1 ? 's' : ''} ending soon</b>` : ''}</p></div>
        <label class="search adm-search">${K.I.search}<input type="search" data-a-q placeholder="Name, link, email" value="${esc(A.q)}" autocomplete="off"></label>
      </div>
      ${list.length ? `<div class="adm-grid">${list.map(cardHTML).join('')}</div>` : `<div class="adm-empty"><b>${all.length ? 'Nothing found' : 'No studios yet'}</b>${all.length ? '' : '<button class="btn btn--primary" data-a-go="new">Create the first studio</button>'}</div>`}`;
  }
  function cardHTML(s) {
    const t = trialInfo(s);
    const done = (s.setup || []).filter(Boolean).length;
    const total = (s.setup || []).length || 8;
    return `
      <article class="adm-card${t && t.warn ? ' is-warn' : ''}${s.status === 'paused' ? ' is-paused' : ''}" data-id="${esc(s.id)}">
        <div class="adm-card__top">
          ${s.icon ? `<img class="adm-card__icon" src="${esc(s.icon)}" alt="">` : `<span class="adm-card__icon adm-card__icon--mono">${esc(mono(s.name))}</span>`}
          <div class="adm-card__who"><b>${esc(s.name)}</b><small>${esc([s.master_name, s.owner_email].filter(Boolean).join(' · ') || 'no owner')}</small><small class="adm-link">?m=${esc(s.slug)}</small></div>
          ${pill(s)}
        </div>
        <div class="adm-stats">
          <div><small>Setup</small><b class="num">${done}/${total}</b><i class="adm-meter"><i style="width:${Math.round((done / total) * 100)}%"></i></i></div>
          <div><small>Last sign-in</small><b>${esc(ago(s.last_sign_in_at))}</b></div>
          <div><small>Bookings · 30 days</small><b class="num">${s.bookings_30d || 0}</b></div>
          <div><small>Next payment</small><b>${esc(fmtDate(s.next_payment_at))}</b></div>
          <div><small>Per month</small><b class="num">${s.monthly_price != null ? '$' + (+s.monthly_price).toFixed(+s.monthly_price % 1 ? 2 : 0) : '—'}</b></div>
        </div>
        <label class="adm-notes"><span>Notes</span><textarea rows="2" maxlength="4000" data-a-notes="${esc(s.id)}" placeholder="Only you see these">${esc(s.admin_notes || '')}</textarea></label>
        <details class="adm-edit">
          <summary>Status & billing</summary>
          <div class="adm-edit__grid">
            <label class="field"><span>Status</span><select class="cab-sel cab-sel--wide" data-a-field="status">${['trial', 'active', 'paused'].map(v => `<option value="${v}"${v === s.status ? ' selected' : ''}>${v.charAt(0).toUpperCase() + v.slice(1)}</option>`).join('')}</select></label>
            <label class="field"><span>Trial ends</span><input type="date" data-a-field="trial_ends_at" value="${esc((s.trial_ends_at || '').slice(0, 10))}"></label>
            <label class="field"><span>Next payment</span><input type="date" data-a-field="next_payment_at" value="${esc(s.next_payment_at || '')}"></label>
            <label class="field"><span>Per month, $</span><input type="number" inputmode="decimal" min="0" step="1" data-a-field="monthly_price" value="${s.monthly_price != null ? esc(+s.monthly_price) : ''}" placeholder="39"></label>
          </div>
          <button class="btn btn--primary btn--sm" data-a-billing="${esc(s.id)}">Save</button>
        </details>
        <div class="adm-actions">
          <a class="btn btn--soft btn--sm" href="${esc(clientLink(s.slug))}" target="_blank" rel="noopener">Open app</a>
          <a class="btn btn--soft btn--sm" href="${esc(ownerLink(s.slug))}" target="_blank" rel="noopener" title="Read only">Dashboard</a>
          <button class="btn btn--soft btn--sm" data-a-kit="${esc(s.id)}">Welcome kit</button>
          <button class="btn btn--soft btn--sm" data-a-reset="${esc(s.id)}">Reset password</button>
          <button class="btn btn--soft btn--sm" data-a-pause="${esc(s.id)}">${s.status === 'paused' ? 'Resume' : 'Pause'}</button>
          <button class="btn btn--soft btn--sm adm-danger" data-a-del="${esc(s.id)}">Delete</button>
        </div>
      </article>`;
  }
  const byId = id => (A.list || []).find(s => s.id === id);
  function replaceStudio(row) {
    if (!row || !A.list) return;
    A.list = A.list.map(s => (s.id === row.id ? row : s));
    const el = $(`.adm-card[data-id="${row.id}"]`);
    if (el) el.outerHTML = cardHTML(row);
  }

  async function saveBilling(id, btn) {
    const card = $(`.adm-card[data-id="${id}"]`);
    const v = k => (($(`[data-a-field="${k}"]`, card) || {}).value || '').trim();
    const p = { status: v('status'), trial_ends_at: v('trial_ends_at') ? v('trial_ends_at') + 'T23:59:00' : '', next_payment_at: v('next_payment_at'), monthly_price: v('monthly_price') };
    await busy(btn, async () => { replaceStudio(await K.Backend.admin.save(id, p)); K.toast('Saved', 'ok'); });
  }
  let notesTimer = 0;
  function saveNotes(id, text) {
    clearTimeout(notesTimer);
    notesTimer = setTimeout(async () => {
      try {
        const row = await K.Backend.admin.save(id, { admin_notes: text });
        A.list = A.list.map(s => (s.id === id ? row : s)); // keep the textarea she is typing in
      } catch (e) { K.toast(errText(e), 'x'); }
    }, 700);
  }
  async function togglePause(id, btn) {
    const s = byId(id);
    if (!s) return;
    const next = s.status === 'paused' ? (s.trial_ends_at && Date.parse(s.trial_ends_at) > Date.now() ? 'trial' : 'active') : 'paused';
    if (next === 'paused' && !(await confirmBox(`Pause ${s.name}?`, 'Clients will see “This studio’s app is taking a short break” and can’t book. The master can still sign in.', 'Pause'))) return;
    await busy(btn, async () => {
      replaceStudio(await K.Backend.admin.save(id, { status: next }));
      K.toast(next === 'paused' ? 'Paused — clients see the short-break page' : 'Back on', 'ok');
    });
  }
  async function resetPassword(id, btn) {
    const s = byId(id);
    if (!s || !(await confirmBox(`New temporary password for ${s.name}?`, `${s.owner_email || 'The master'} will have to choose a new password at the next sign-in. The old one stops working now.`, 'Reset password'))) return;
    await busy(btn, async () => {
      const r = await K.Backend.admin.resetPassword(id);
      A.kit = { id: s.id, slug: s.slug, name: s.name, masterName: s.master_name, email: r.email || s.owner_email, password: r.password, trial_ends_at: s.status === 'trial' ? s.trial_ends_at : null };
      go('kit');
    });
  }
  async function deleteStudio(id) {
    const s = byId(id);
    if (!s) return;
    const typed = await confirmBox(`Delete ${s.name}?`,
      `This removes the studio, every booking, client and photo${s.owner_email ? `, and ${s.owner_email}’s account` : ''}. It can’t be undone. Type <b>${esc(s.slug)}</b> to confirm.`,
      'Delete forever', { type: s.slug, danger: true });
    if (!typed) return;
    try {
      await K.Backend.admin.remove(id, s.slug);
      A.list = A.list.filter(x => x.id !== id);
      paintList();
      K.toast(`${s.name} deleted`, 'ok');
    } catch (e) { K.toast(errText(e), 'x'); }
  }

  /* ---------- New studio (one screen) ---------- */
  function slugify(v) {
    return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  }
  function renderNew() {
    const f = A.form || (A.form = { name: '', masterName: '', email: '', city: '', timezone: 'America/New_York', phone: '', instagram: '', slug: '', slugTouched: false, slugState: null, template: 'lashes', style: 'noir', accent: null });
    root.innerHTML = barHTML('New studio', true) + `
      <main class="adm-main">
        <form class="adm-form" id="adm-new" onsubmit="return false" autocomplete="off">
          <div class="adm-form__grid">
            <label class="field"><span>Studio name</span><input data-f="name" maxlength="60" value="${esc(f.name)}" placeholder="Bella Brows"></label>
            <label class="field"><span>App link</span>
              <span class="adm-slug"><em>…/?m=</em><input data-f="slug" maxlength="40" value="${esc(f.slug)}" placeholder="bella-brows" autocapitalize="off" spellcheck="false"></span>
              <small class="adm-slug__state" id="adm-slug-state">${slugStateHTML()}</small></label>
            <label class="field"><span>Her first name</span><input data-f="masterName" maxlength="40" value="${esc(f.masterName)}" placeholder="Bella"></label>
            <label class="field"><span>Her email (sign-in)</span><input data-f="email" type="email" inputmode="email" maxlength="120" value="${esc(f.email)}" placeholder="bella@example.com" autocapitalize="off"></label>
            <label class="field"><span>City</span><input data-f="city" maxlength="60" value="${esc(f.city)}" placeholder="Austin, TX"></label>
            <label class="field"><span>Time zone</span><select class="cab-sel cab-sel--wide" data-f="timezone">${TZ.map(([v, l]) => `<option value="${v}"${v === f.timezone ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
            <label class="field"><span>Phone</span><input data-f="phone" type="tel" inputmode="tel" maxlength="30" value="${esc(f.phone)}" placeholder="(512) 555-0123"></label>
            <label class="field"><span>Instagram</span><input data-f="instagram" maxlength="60" value="${esc(f.instagram)}" placeholder="@bellabrows" autocapitalize="off"></label>
          </div>
          <div class="field"><span>Niche — services, policies, answers and texts to start from</span>
            <div class="chips-wrap">${NICHES.map(([v, l]) => `<button type="button" class="chip${v === f.template ? ' is-active' : ''}" data-f-tpl="${v}">${l}</button>`).join('')}</div></div>
          <div class="adm-form__look">
            <div class="field"><span>Style</span>
              <div class="segmented" role="radiogroup" style="--n:3;--idx:${STYLES.findIndex(x => x[0] === f.style)}"><i class="segmented__thumb"></i>
                ${STYLES.map(([v, l]) => `<button type="button" role="radio" data-f-style="${v}" aria-checked="${v === f.style}">${l}</button>`).join('')}</div>
              <div class="sty-acc" role="radiogroup" aria-label="Accent">${accentsHTML()}</div></div>
            <div class="adm-icon-prev"><canvas id="adm-icon" width="192" height="192" aria-label="App icon"></canvas><small>App icon</small></div>
          </div>
          <p class="adm-muted">Hours Tue–Sat 10:00–18:00 · 14-day trial · she changes everything later in her dashboard.</p>
          <button class="btn btn--primary btn--block" data-a-create>Create studio</button>
        </form>
      </main>`;
    drawPreview();
  }
  function accentsHTML() {
    const f = A.form;
    const list = K.accentsFor(f.style);
    if (!f.accent || !list.some(a => a.id === f.accent)) f.accent = list[0].id;
    return list.map(a => `<button type="button" class="swatch" role="radio" data-f-acc="${esc(a.id)}" aria-checked="${a.id === f.accent}" aria-label="${esc(a.name)}" style="--c:${a.color}">${K.I.check}</button>`).join('');
  }
  const accentHex = () => { const f = A.form; const a = K.accentsFor(f.style).find(x => x.id === f.accent) || K.accentsFor(f.style)[0]; return a.color; };
  function slugStateHTML() {
    const st = A.form && A.form.slugState;
    if (!st) return '';
    if (st === 'checking') return 'Checking…';
    if (st.ok) return `<b class="adm-ok">✓ Available</b> · ${esc(clientLink(A.form.slug))}`;
    return `<b class="adm-bad">${st.reason === 'taken' ? 'Already taken' : st.reason === 'reserved' ? 'Reserved word' : 'Letters, numbers and dashes'}</b>`;
  }
  let slugTimer = 0;
  function checkSlug() {
    const f = A.form;
    clearTimeout(slugTimer);
    if (!f.slug) { f.slugState = null; paintSlug(); return; }
    f.slugState = 'checking';
    paintSlug();
    const s = f.slug;
    slugTimer = setTimeout(async () => {
      try {
        const r = await K.Backend.admin.slugFree(s);
        if (A.form && A.form.slug === s) { A.form.slugState = r; paintSlug(); }
      } catch (e) { if (A.form && A.form.slug === s) { A.form.slugState = null; paintSlug(); } }
    }, 300);
  }
  function paintSlug() { const el = $('#adm-slug-state'); if (el) el.innerHTML = slugStateHTML(); }

  /* the app icon: a monogram in the studio's style, drawn here, stored with the studio */
  async function drawIcon(size, name, style, accent) {
    if (document.fonts && document.fonts.load) {
      await Promise.all(['700 80px Inter', '400 80px Fraunces', "800 80px 'Plus Jakarta Sans'"].map(f => document.fonts.load(f).catch(() => null)));
    }
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d');
    const m = mono(name);
    const S = size;
    if (style === 'maison') {
      const g = x.createLinearGradient(0, 0, S, S);
      g.addColorStop(0, '#F8F2EA');
      g.addColorStop(1, '#E9DECF');
      x.fillStyle = g;
      x.fillRect(0, 0, S, S);
      x.strokeStyle = accent;
      x.globalAlpha = 0.55;
      x.lineWidth = Math.max(1, S * 0.012);
      x.strokeRect(S * 0.1, S * 0.1, S * 0.8, S * 0.8);
      x.globalAlpha = 1;
      x.fillStyle = mix(accent, '#2A211C', 0.45);
      x.font = `400 ${Math.round(S * (m.length > 1 ? 0.36 : 0.46))}px Fraunces, Georgia, serif`;
    } else if (style === 'soft') {
      const g = x.createLinearGradient(0, 0, S, S);
      g.addColorStop(0, mix(accent, '#FFFFFF', 0.12));
      g.addColorStop(1, mix(accent, '#000000', 0.22));
      x.fillStyle = g;
      x.fillRect(0, 0, S, S);
      x.fillStyle = '#FFFFFF';
      x.font = `800 ${Math.round(S * (m.length > 1 ? 0.38 : 0.48))}px 'Plus Jakarta Sans', system-ui, sans-serif`;
    } else {
      x.fillStyle = '#0B0B0D';
      x.fillRect(0, 0, S, S);
      const r = x.createRadialGradient(S * 0.3, S * 0.22, 0, S * 0.3, S * 0.22, S * 0.95);
      r.addColorStop(0, hexA(accent, 0.55));
      r.addColorStop(1, hexA(accent, 0));
      x.fillStyle = r;
      x.fillRect(0, 0, S, S);
      x.fillStyle = '#FFFFFF';
      x.font = `700 ${Math.round(S * (m.length > 1 ? 0.36 : 0.46))}px Inter, system-ui, sans-serif`;
    }
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(m, S / 2, S * 0.53);
    return c;
  }
  const hex = h => { const v = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(v.slice(i, i + 2), 16)); };
  const hexA = (h, a) => { const [r, g, b] = hex(h); return `rgba(${r},${g},${b},${a})`; };
  const mix = (a, b, t) => { const p = hex(a); const q = hex(b); return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  async function drawPreview() {
    const cv = $('#adm-icon');
    if (!cv || !A.form) return;
    const src = await drawIcon(192, A.form.name || 'Studio', A.form.style, accentHex());
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 192, 192);
    ctx.drawImage(src, 0, 0);
  }
  const png64 = c => c.toDataURL('image/png').split(',')[1];

  async function createStudio(btn) {
    const f = A.form;
    const bad = m => { K.toast(m, 'x'); return false; };
    if (f.name.trim().length < 2) return bad('Add the studio name');
    if (!f.slug || !(f.slugState && f.slugState.ok)) return bad(f.slugState && f.slugState.reason === 'taken' ? 'That link is already taken' : 'Check the app link');
    if (!f.masterName.trim()) return bad('Add her first name');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) return bad('Check the email address');
    await busy(btn, async () => {
      const accent = accentHex();
      const [i512, i192, i180] = await Promise.all([512, 192, 180].map(s => drawIcon(s, f.name, f.style, accent)));
      const r = await K.Backend.admin.create({
        name: f.name.trim(), masterName: f.masterName.trim(), email: f.email.trim(), city: f.city.trim(), timezone: f.timezone,
        phone: f.phone.trim(), instagram: f.instagram.trim(), slug: f.slug, template: f.template, style: f.style,
        accent, accentId: f.accent, icons: { i512: png64(i512), i192: png64(i192), i180: png64(i180) }
      });
      A.kit = { id: r.id, slug: r.slug, name: r.name, masterName: r.masterName, email: r.email, password: r.password, trial_ends_at: r.trial_ends_at, fresh: true };
      A.form = null;
      A.list = null;
      K.toast(`${r.name} is ready`, 'ok');
      go('kit');
    });
  }

  /* ---------- Welcome kit ---------- */
  function message(k) {
    const name = k.masterName || 'there';
    return [
      `Hi ${name}! 👋`,
      '',
      `Your booking app for ${k.name} is ready ✨`,
      '',
      'Set it up in 5 minutes:',
      `1. On your iPhone, open this link in Safari: ${ownerLink(k.slug)}`,
      `2. Tap Share → Add to Home Screen, then open “${k.name}” from your Home Screen.`,
      `3. Sign in with ${k.email}${k.password ? ` and this temporary password: ${k.password}` : ' (ask me for a temporary password)'}`,
      '4. Choose your own password when the app asks.',
      '5. On the Today screen, follow “Finish setting up” — photos, services, hours, payments.',
      '',
      `Your clients book here (put it in your Instagram bio): ${clientLink(k.slug)}`
    ].join('\n');
  }
  function renderKit() {
    const k = A.kit;
    if (!k) { go('list'); return; }
    root.innerHTML = barHTML('', true) + `
      <main class="adm-main adm-kit">
        <h1>${esc(k.name)} ${k.fresh ? 'is ready ✨' : '· Welcome kit'}</h1>
        <p class="adm-muted">${k.trial_ends_at ? `Trial until ${esc(fmtDate(k.trial_ends_at))}. ` : ''}Send ${esc(k.masterName || 'her')} the message below.</p>
        <div class="list adm-kit__rows">
          ${kitRow('For clients', clientLink(k.slug), true)}
          ${kitRow(`${k.masterName || 'Master'} signs in here`, ownerLink(k.slug), true)}
          ${kitRow('Email', k.email || '—', false)}
          ${k.password ? `
          <div class="row adm-kit__pw">
            <span class="row__label">Temporary password<span class="row__sub">Shown only now — if it’s lost, use Reset password</span></span>
            <code>${esc(k.password)}</code>
            <button class="btn btn--soft btn--sm" data-a-copy="${esc(k.password)}">Copy</button>
          </div>` : `
          <div class="row"><span class="row__label">Temporary password<span class="row__sub">Not shown again — use Reset password to make a new one</span></span></div>`}
        </div>
        <section class="adm-print" id="adm-print">
          <span class="adm-print__eyebrow">Book online</span>
          <b class="adm-print__name">${esc(k.name)}</b>
          <div class="adm-print__qr" id="adm-qr"></div>
          <span class="adm-print__hint">Scan with your camera to book</span>
          <span class="adm-print__link">${esc(clientLink(k.slug).replace(/^https?:\/\//, ''))}</span>
        </section>
        <button class="btn btn--soft btn--block" data-a-print>${icon('<path d="M7 9V3.5h10V9"/><rect x="3.5" y="9" width="17" height="8" rx="2"/><path d="M7 14h10v6.5H7z"/>')}Print the QR card</button>
        <div class="field adm-kit__msg"><span>Message for ${esc(k.masterName || 'her')}</span><textarea rows="13" readonly id="adm-msg">${esc(message(k))}</textarea></div>
        <button class="btn btn--primary btn--block" data-a-copy-msg>Copy message</button>
        <button class="btn btn--soft btn--block" data-a-go="list">Done</button>
      </main>`;
    makeQR($('#adm-qr'), clientLink(k.slug));
  }
  const kitRow = (label, value, link) => `
    <div class="row adm-kit__row">
      <span class="row__label">${esc(label)}<span class="row__sub adm-kit__val">${esc(value)}</span></span>
      ${link ? `<a class="btn btn--soft btn--sm" href="${esc(value)}" target="_blank" rel="noopener">Open</a>` : ''}
      <button class="btn btn--soft btn--sm" data-a-copy="${esc(value)}">Copy</button>
    </div>`;
  let qrP = null;
  function makeQR(el, text) {
    if (!el) return;
    if (!qrP) {
      qrP = new Promise((resolve, reject) => {
        if (window.QRCode) { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
        s.onload = () => resolve();
        s.onerror = () => { qrP = null; reject(new Error('qr')); };
        document.head.appendChild(s);
      });
    }
    qrP.then(() => {
      el.innerHTML = '';
      new window.QRCode(el, { text, width: 220, height: 220, colorDark: '#111111', colorLight: '#FFFFFF', correctLevel: window.QRCode.CorrectLevel.M });
    }).catch(() => { el.textContent = text; });
  }

  /* =========================================================
     Small things: busy buttons, confirm box, copy
     ========================================================= */
  async function busy(btn, work) {
    const label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = K.spinner(); }
    try { await work(); } catch (e) { K.toast(errText(e), 'x'); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
  }
  // resolves true (or the typed text when opts.type is set) / false
  function confirmBox(title, html, okLabel, opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.className = 'adm-modal';
      box.innerHTML = `
        <div class="adm-modal__card" role="dialog" aria-modal="true">
          <h2>${esc(title)}</h2>
          <p>${html}</p>
          ${opts.type ? `<input class="adm-modal__in" placeholder="${esc(opts.type)}" autocapitalize="off" spellcheck="false">` : ''}
          <div class="adm-modal__row">
            <button class="btn btn--soft" data-m="no">Cancel</button>
            <button class="btn ${opts.danger ? 'btn--danger' : 'btn--primary'}" data-m="yes"${opts.type ? ' disabled' : ''}>${esc(okLabel)}</button>
          </div>
        </div>`;
      root.appendChild(box);
      const inp = box.querySelector('.adm-modal__in');
      const yes = box.querySelector('[data-m="yes"]');
      if (inp) { inp.addEventListener('input', () => { yes.disabled = inp.value.trim() !== opts.type; }); setTimeout(() => inp.focus(), 50); }
      box.addEventListener('click', e => {
        const b = e.target.closest('[data-m]');
        if (!b && e.target !== box) return;
        const ok = b && b.dataset.m === 'yes' && !b.disabled;
        box.remove();
        resolve(ok ? (opts.type ? inp.value.trim() : true) : false);
      });
    });
  }
  async function copy(text, what) {
    try { await navigator.clipboard.writeText(text); K.toast(what || 'Copied', 'ok'); } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); K.toast(what || 'Copied', 'ok'); } catch (x) { K.toast('Copy didn’t work — select and copy it', 'x'); }
      ta.remove();
    }
  }

  /* =========================================================
     Events
     ========================================================= */
  function onClick(e) {
    if (!root || !root.contains(e.target)) return;
    const t = e.target;
    let el;
    if ((el = t.closest('[data-a-signout]'))) { signOut(); return; }
    if ((el = t.closest('[data-a-go]'))) { e.preventDefault(); go(el.dataset.aGo); return; }
    if ((el = t.closest('[data-a-billing]'))) { saveBilling(el.dataset.aBilling, el); return; }
    if ((el = t.closest('[data-a-pause]'))) { togglePause(el.dataset.aPause, el); return; }
    if ((el = t.closest('[data-a-reset]'))) { resetPassword(el.dataset.aReset, el); return; }
    if ((el = t.closest('[data-a-del]'))) { deleteStudio(el.dataset.aDel); return; }
    if ((el = t.closest('[data-a-kit]'))) {
      const s = byId(el.dataset.aKit);
      if (s) { A.kit = { id: s.id, slug: s.slug, name: s.name, masterName: s.master_name, email: s.owner_email, password: null, trial_ends_at: s.status === 'trial' ? s.trial_ends_at : null }; go('kit'); }
      return;
    }
    if ((el = t.closest('[data-a-copy]'))) { copy(el.dataset.aCopy); return; }
    if ((el = t.closest('[data-a-copy-msg]'))) { copy(($('#adm-msg') || {}).value || '', 'Message copied'); return; }
    if ((el = t.closest('[data-a-print]'))) { window.print(); return; }
    // the new-studio form
    if ((el = t.closest('[data-f-tpl]'))) { A.form.template = el.dataset.fTpl; $$('[data-f-tpl]').forEach(c => c.classList.toggle('is-active', c === el)); return; }
    if ((el = t.closest('[data-f-style]'))) {
      A.form.style = el.dataset.fStyle;
      A.form.accent = null;
      const seg = el.closest('.segmented');
      seg.style.setProperty('--idx', STYLES.findIndex(x => x[0] === A.form.style));
      $$('[data-f-style]').forEach(b => b.setAttribute('aria-checked', String(b === el)));
      $('.adm-form .sty-acc').innerHTML = accentsHTML();
      drawPreview();
      return;
    }
    if ((el = t.closest('[data-f-acc]'))) {
      A.form.accent = el.dataset.fAcc;
      $$('[data-f-acc]').forEach(b => b.setAttribute('aria-checked', String(b === el)));
      drawPreview();
      return;
    }
    if ((el = t.closest('[data-a-create]'))) { createStudio(el); }
  }
  function onInput(e) {
    if (!root || !root.contains(e.target)) return;
    const t = e.target;
    if (t.matches('[data-a-q]')) { A.q = t.value; const pos = t.selectionStart; paintList(); const q = $('[data-a-q]'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (x) { /* type=search */ } } return; }
    if (t.matches('[data-a-notes]')) { saveNotes(t.dataset.aNotes, t.value); return; }
    const k = t.dataset && t.dataset.f;
    if (!k || !A.form) return;
    A.form[k] = t.value;
    if (k === 'name') {
      if (!A.form.slugTouched) { A.form.slug = slugify(t.value); const s = $('[data-f="slug"]'); if (s) s.value = A.form.slug; checkSlug(); }
      drawPreview();
    }
    if (k === 'slug') {
      A.form.slugTouched = true;
      const v = slugify(t.value.replace(/\s/g, '-'));
      if (v !== t.value && !/-$/.test(t.value)) t.value = v;
      A.form.slug = v;
      checkSlug();
    }
  }
  function onChange(e) {
    if (!root || !root.contains(e.target)) return;
    const t = e.target;
    if (t.dataset && t.dataset.f && A.form) A.form[t.dataset.f] = t.value;
  }

  window.StudioAdmin = { open };
})();
