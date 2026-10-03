/* =========================================================
   Studio App — the master's dashboard ("cabinet").
   Loaded on demand (?owner=1 or a long press on the monogram /
   avatar) for studios with the built-in booking engine.
   Sign in by email + password → Today (with Requests), Calendar,
   Clients (CRM + lash map), Insights (real numbers from the database),
   Studio (profile, look, services, looks, payments & deposits, hours,
   texts, assistant answers). New bookings and cancellations arrive
   live (Supabase Realtime; polling when it isn't available).
   All UI helpers come from app.js through `kit`.
   ========================================================= */
(function () {
  'use strict';

  let K = null;      // kit from app.js
  let root = null;   // .cab element
  const S = {
    session: null, studio: null, tab: 'today', day: 0, cal: 'day',
    sched: null, cache: {}, pending: [], clients: null, q: '',
    known: null, self: new Set(), live: false, unsub: null, poll: 0,
    badges: { today: 0, calendar: 0, requests: 0 }, queue: [], audio: null,
    showCx: (() => { try { return localStorage.getItem('studio-app:cab:showCancelled') !== '0'; } catch (e) { return true; } })(),
    email: '', busy: false, hrs: null, hrsDirty: false,
    // a salon: the masters, each one's hours, the calendar / hours filter
    team: null, scheds: {}, calStaff: null, hrsStaff: null, hsched: null, insStaff: null
  };

  const TABS = [
    { id: 'today', label: 'Today', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>' },
    { id: 'calendar', label: 'Calendar', icon: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>' },
    { id: 'clients', label: 'Clients', icon: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5"/><path d="M16 5.5a3.2 3.2 0 0 1 0 6.2M18.5 14.8c1.6.7 2.6 2.2 3 4.2"/>' },
    { id: 'insights', label: 'Insights', icon: '<path d="M5 19.5V12M10 19.5V5.5M15 19.5v-5M20 19.5V9"/>' },
    { id: 'studio', label: 'Studio', icon: '<path d="M4 10.5 12 4l8 6.5V20H4z"/><path d="M9.5 20v-5.5h5V20"/>' }
  ];
  // a master in a salon: her own day, clients, numbers and hours — no Studio
  const STAFF_TABS = TABS.slice(0, 4).concat({ id: 'hours', label: 'My hours', icon: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13.5V16l1.8 1"/>' });
  const tabBtn = t => `<button class="cab__tab" data-cab-tab="${t.id}"><span class="cab__tabic">${icon(t.icon)}<i class="cab__badge" data-badge="${t.id}" hidden></i></span><span>${t.label}</span></button>`;
  const ACTIVE = ['pending', 'confirmed'];

  /* ---------- small helpers ---------- */
  const $ = (s, el) => K.$(s, el || root);
  const $$ = (s, el) => K.$$(s, el || root);
  const esc = v => K.esc(v);
  const icon = d => K.svg(d);
  const minOf = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
  const hhmm = min => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  const dayStartIso = off => { const d = K.studioDate(off); return new Date(K.zonedMs(d.year, d.month + 1, d.day, 0)).toISOString(); };
  const isoAt = (off, min) => { const d = K.studioDate(off); return new Date(K.zonedMs(d.year, d.month + 1, d.day, min)).toISOString(); };
  const spot = iso => K.studioSpot(iso);
  const timeRange = b => `${K.fmtClock(spot(b.start_at).min)} – ${K.fmtClock(spot(b.end_at).min)}`;
  const whenLine = b => `${K.dayLabel(spot(b.start_at).off, false)} · ${K.fmtClock(spot(b.start_at).min)}`;
  const phoneText = p => (p ? K.maskPhone(p) : '');
  const telHref = p => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
  const smsHref = p => 'sms:' + String(p || '').replace(/[^\d+]/g, '');
  const money = v => K.price(Math.round(+v || 0));
  const isActive = b => ACTIVE.includes(b.status);
  const err = e => K.errText(e);
  const ago = iso => {
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return m + ' min ago';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' h ago';
    return Math.round(h / 24) + ' d ago';
  };
  const statusLabel = s => ({ pending: 'Request', confirmed: 'Confirmed', completed: 'Completed', no_show: 'No-show', cancelled_client: 'Cancelled by client', cancelled_master: 'Cancelled by you' }[s] || s);

  /* ---------- a salon: the owner sees every master, a master only herself ---------- */
  const isStaff = () => !!S.studio && S.studio.role === 'staff';
  const isTeam = () => !!S.studio && S.studio.kind === 'team';
  const teamView = () => isTeam() && !isStaff(); // the owner (or the admin, looking)
  const ownStaff = () => (S.studio && S.studio.staff_id) || null;
  const crew = () => (S.team || []).filter(x => x.active);
  const crewById = id => (S.team || []).find(x => x.id === id) || null;
  const firstOf = n => String(n || '').trim().split(/\s+/)[0] || '';
  const monoOf = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase();
  const crewAv = st => (st && st.photo
    ? `<img class="crew-av" src="${esc(K.sized(K.safeUrl(st.photo), 120))}" alt="">`
    : `<span class="crew-av crew-av--mono" style="--c:${esc((st && st.color) || '#8E8E93')}">${esc(monoOf(st && st.name))}</span>`);
  const crewDot = color => `<i class="crew-dot" style="--c:${esc(color || '#8E8E93')}"></i>`;
  // "Jasmine" on a booking (the owner's view of a salon)
  const crewTag = b => (teamView() && b && b.staff_name ? `<span class="crew-tag" style="--c:${esc(b.staff_color || '#8E8E93')}">${esc(firstOf(b.staff_name))}</span>` : '');
  const CREW_COLORS = ['#AF52DE', '#FF9500', '#34C759', '#007AFF', '#FF2D55', '#5AC8FA', '#A2845E', '#FF6B6B'];
  const doesSvc = (st, svcId) => !!st && (st.services || []).some(x => x.id === svcId);

  /* =========================================================
     Open / close
     ========================================================= */
  async function open(kit, opts) {
    K = kit;
    if (root) { if (opts && opts.booking && S.studio) openBooking(opts.booking); return; }
    S.target = (opts && opts.booking) || null;
    S.auto = !!(opts && opts.auto);
    K.onCabinet && K.onCabinet(true);
    K.closeNotice && K.closeNotice();
    if (!(opts && opts.quiet)) K.haptic();
    root = document.createElement('div');
    root.className = 'cab';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Studio dashboard');
    root.innerHTML = `
      <header class="cab__bar">
        <span class="cab__mono">${esc(K.initials())}</span>
        <span class="cab__who"><b>${esc(K.data.name)}</b><small id="cab-live">Dashboard</small></span>
        <button class="cab__ic" data-cab-new aria-label="New booking" hidden>${icon('<path d="M12 5v14M5 12h14"/>')}</button>
        <button class="cab__ic" data-cab-menu aria-label="Account" hidden>${icon('<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1-3.3 3.8-5 7-5s6 1.7 7 5"/>')}</button>
        <button class="cab__done" data-cab-close>Done</button>
      </header>
      <div class="cab__banner" id="cab-banner" role="status" aria-live="polite"></div>
      <main class="cab__main" id="cab-main"></main>
      <nav class="cab__tabs" id="cab-tabs" hidden>
        ${TABS.map(tabBtn).join('')}
      </nav>`;
    (document.getElementById('shell') || document.body).appendChild(root);
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    root.addEventListener('submit', e => { if (e.target.id === 'cab-signin') { e.preventDefault(); signIn(); } });
    ['pointerdown', 'touchend', 'keydown'].forEach(t => document.addEventListener(t, unlockAudio, true));
    K.pushOverlay(() => close(true));
    const g = K.G();
    if (g) K.ensure(g.fromTo(root, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out', clearProps: 'transform,opacity' }));

    renderLoading();
    document.addEventListener('visibilitychange', onVisible);
    try {
      S.session = await K.Backend.auth.session();
      if (S.session) {
        restoreLocal(); // the dashboard from the last visit, at once
        await enter();
      }
      else if (S.auto) { K.setOwnerHere && K.setOwnerHere(false); close(); } // signed out meanwhile: stay in the client app
      else renderAuth();
    } catch (e) {
      renderAuth(err(e));
    }
  }

  function close(fromHistory) {
    if (!root) return;
    K.onCabinet && K.onCabinet(false);
    stopLive();
    document.removeEventListener('visibilitychange', onVisible);
    document.removeEventListener('click', onClick);
    document.removeEventListener('input', onInput);
    document.removeEventListener('change', onChange);
    const el = root;
    root = null;
    const g = K.G();
    if (g) K.ensure(g.to(el, { opacity: 0, y: 24, duration: 0.28, ease: 'power2.in', onComplete: () => el.remove() }));
    else el.remove();
    if (!fromHistory) K.popOverlay();
  }

  function renderLoading() {
    $('#cab-main').innerHTML = `<div class="cab-load"><i class="spin"></i></div>`;
  }

  /* =========================================================
     Sign in — email + password (emails come in part 2 with own SMTP)
     ========================================================= */
  function renderAuth(msg) {
    $('#cab-tabs').hidden = true;
    $('[data-cab-new]').hidden = true;
    $('[data-cab-menu]').hidden = true;
    $('#cab-main').innerHTML = `
      <form class="cab-auth" id="cab-signin" autocomplete="on" novalidate>
        <span class="cab-auth__mono">${esc(K.initials())}</span>
        <h1>Studio dashboard</h1>
        <p>Sign in to see bookings, clients and your hours for ${esc(K.data.name)}.</p>
        <label class="field"><span>Email</span>
          <input id="cab-email" name="email" type="email" inputmode="email" autocomplete="username" autocapitalize="off" spellcheck="false" enterkeyhint="next" placeholder="you@studio.com" value="${esc(S.email)}"></label>
        <label class="field"><span>Password</span>
          <span class="pw"><input id="cab-pass" name="password" type="password" autocomplete="current-password" enterkeyhint="go" placeholder="Your password">
          <button type="button" class="pw__eye" data-pw-eye aria-label="Show password">${icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>')}</button></span></label>
        <button type="submit" class="btn btn--primary btn--block" data-cab-signin${S.busy ? ' disabled' : ''}>${S.busy ? K.spinner() : 'Sign in'}</button>
        ${msg ? `<p class="cab-auth__err" role="alert">${esc(msg)}</p>` : ''}
        ${K.data.ownerDemo ? '<button type="button" class="cab-link" data-cab-demo>See the dashboard with demo data</button>' : ''}
      </form>`;
    const f = $(S.email ? '#cab-pass' : '#cab-email');
    if (f && !K.IS_IOS) setTimeout(() => f.focus(), 350);
  }

  async function signIn() {
    const email = String(($('#cab-email') || {}).value || '').trim().toLowerCase();
    const pass = String(($('#cab-pass') || {}).value || '');
    S.email = email;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { renderAuth('Enter your email address'); return; }
    if (!pass) { renderAuth('Enter your password'); return; }
    S.busy = true;
    renderAuth();
    try {
      S.session = await K.Backend.auth.signIn(email, pass);
      S.busy = false;
      K.haptic([10, 30, 10]);
      await enter();
    } catch (e) {
      S.busy = false;
      renderAuth(e.code === 'bad_login' ? 'Wrong email or password' : err(e));
    }
  }

  /* What the dashboard showed last time (this device, this account): shown at
     once on the next start while the fresh data is on its way */
  function saveLocal() {
    if (!S.session || !S.studio || !S.known) return;
    try {
      K.store.set('cab', {
        uid: S.session.user && S.session.user.id, at: Date.now(), studio: S.studio, sched: S.sched,
        from: S.knownFrom, to: S.knownTo, known: [...S.known.values()], team: S.team, scheds: S.scheds
      });
    } catch (e) { /* storage full: next time loads from the network */ }
  }
  function restoreLocal() {
    const c = K.store.get('cab');
    if (!c || !c.studio || c.studio.slug !== K.SLUG || !S.session || !S.session.user || c.uid !== S.session.user.id) return false;
    S.studio = c.studio;
    S.readonly = c.studio.mine === false;
    S.sched = c.sched || { hours: [], time_off: [], rules: {} };
    S.team = c.team || null;
    S.scheds = c.scheds || {};
    applyBookings(c.known || [], c.from, c.to, true);
    S.lastSync = Date.now(); // enter() is fetching the fresh copy right now
    showChrome();
    go(S.tab, true);
    return true;
  }
  function showChrome() {
    // the tabs follow the role: a master in a salon has no Studio tab
    const nav = $('#cab-tabs');
    const role = isStaff() ? 'staff' : 'owner';
    if (nav.dataset.role !== role) {
      nav.dataset.role = role;
      nav.innerHTML = (isStaff() ? STAFF_TABS : TABS).map(tabBtn).join('');
      paintBadges();
    }
    nav.hidden = false;
    $('[data-cab-new]').hidden = false;
    $('[data-cab-menu]').hidden = false;
  }
  const WINDOW = () => ({ from: Date.now() - 14 * 864e5, to: Date.now() + 120 * 864e5 });
  const windowBookings = (mid, w) => K.Backend.owner.bookings(mid, new Date(w.from).toISOString(), new Date(w.to).toISOString());

  /* Signed in: which studio is this account for? Everything that doesn't depend
     on the answer goes out at the same time (the studio id from last time) */
  async function enter() {
    const shown = !!S.studio;
    if (!shown) renderLoading();
    const guess = S.studio && S.studio.id;
    const w = WINDOW();
    let list, sched, books, acct;
    try {
      [list, sched, books, acct] = await Promise.all([
        K.Backend.owner.studios(),
        guess ? K.Backend.owner.schedule(guess).catch(() => null) : null,
        guess ? windowBookings(guess, w).catch(() => null) : null,
        K.Backend.owner.account().catch(() => null)
      ]);
    } catch (e) {
      if (shown) { S.stale = true; setLiveLabel(); startLive(); return; } // keep what's on screen
      renderEnterError(e);
      return;
    }
    const studio = (list || []).find(m => m.slug === K.SLUG) || null;
    // the platform admin may open any studio's dashboard — to look, never to change
    S.readonly = !!studio && studio.mine === false;
    root.classList.toggle('is-readonly', S.readonly);
    // a studio made in the admin: her own password first (no Studio / Client view switch yet)
    if (studio && !S.readonly && acct && acct.must_change_password) { S.studio = studio; renderForcePassword(); return; }
    K.setOwnerHere && K.setOwnerHere(!!studio && !S.readonly);
    if (!studio) K.store.remove('cab');
    if (!studio && S.auto) { close(); return; }
    if (!studio) {
      S.studio = null;
      $('#cab-tabs').hidden = true;
      $('#cab-main').innerHTML = `
        <div class="cab-auth">
          <span class="cab-auth__mono">${esc(K.initials())}</span>
          <h1>Not your studio yet</h1>
          <p>You’re signed in as <b>${esc((S.session && S.session.user && S.session.user.email) || '')}</b>, but this account doesn’t manage ${esc(K.data.name)}. Ask for the studio to be set up with this email, or sign in with another one.</p>
          <button class="btn btn--soft btn--block" data-cab-signout>Sign out</button>
        </div>`;
      return;
    }
    if (!S.studio || S.studio.id !== studio.id || S.studio.role !== studio.role) { S.team = null; S.scheds = {}; S.calStaff = null; S.hrsStaff = null; S.hsched = null; S.insStaff = null; }
    S.studio = studio;
    if (isStaff() && !STAFF_TABS.some(t => t.id === S.tab) && S.tab !== 'requests') S.tab = 'today';
    if (studio.id !== guess) {
      [sched, books] = await Promise.all([K.Backend.owner.schedule(studio.id).catch(() => null), windowBookings(studio.id, w).catch(() => null)]);
    }
    S.sched = sched || S.sched || { hours: [], time_off: [], rules: {} };
    S.stale = !books;
    if (books) { S.lastSync = Date.now(); applyBookings(books, w.from, w.to, true); }
    else if (!S.known) { try { await syncChanges(true); } catch (e) { /* the view says so */ } }
    showChrome();
    startLive();
    if (!shown) go(S.tab, true); else refreshView();
    if (S.target) { const id = S.target; S.target = null; setTimeout(() => openBooking(id), shown ? 150 : 450); }
  }
  /* First sign-in with the temporary password from the admin: choose her own (noir screen) */
  function renderForcePassword(msg) {
    $('#cab-tabs').hidden = true;
    $('[data-cab-new]').hidden = true;
    $('[data-cab-menu]').hidden = true;
    root.classList.add('is-forcepw');
    const email = (S.session && S.session.user && S.session.user.email) || '';
    $('#cab-main').innerHTML = `
      <form class="cab-force" id="cab-force" autocomplete="on" onsubmit="return false">
        <span class="cab-force__mono">${esc(K.initials())}</span>
        <h1>Choose your password</h1>
        <p>You signed in with a temporary password. Pick your own to finish setting up <b>${esc(K.data.name)}</b>.</p>
        <input type="email" autocomplete="username" value="${esc(email)}" hidden>
        <label class="field"><span>New password</span>
          <span class="pw"><input id="fp-new" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters">
          <button type="button" class="pw__eye" data-pw-eye aria-label="Show password">${icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>')}</button></span></label>
        <label class="field"><span>Repeat it</span><input id="fp-new2" type="password" autocomplete="new-password" placeholder="The same password"></label>
        <button type="submit" class="btn btn--block cab-force__go" data-fp-save>Save and continue</button>
        ${msg ? `<p class="cab-auth__err" role="alert">${esc(msg)}</p>` : ''}
        <button type="button" class="cab-link cab-force__out" data-cab-signout>Sign out</button>
      </form>`;
    const f = $('#fp-new');
    if (f && !K.IS_IOS) setTimeout(() => f.focus(), 350);
  }
  async function saveForcedPassword(btn) {
    const a = ($('#fp-new') || {}).value || '';
    const b = ($('#fp-new2') || {}).value || '';
    if (a.length < 8) { renderForcePassword('Use at least 8 characters'); return; }
    if (a !== b) { renderForcePassword('The passwords don’t match'); return; }
    if (btn) { btn.disabled = true; btn.innerHTML = K.spinner(); }
    try {
      await K.Backend.auth.updatePassword(a);
      await K.Backend.owner.passwordChanged();
      root.classList.remove('is-forcepw');
      K.haptic([10, 30, 10]);
      K.toast('Password saved — welcome!', 'ok');
      renderLoading();
      S.studio = null;
      await enter();
    } catch (e) {
      renderForcePassword(/different|same/i.test(e.message || '') ? 'Pick a password different from the temporary one' : /weak|short|least/i.test(e.message || '') ? 'Pick a stronger password' : err(e));
    }
  }

  function renderEnterError(e) {
    $('#cab-main').innerHTML = `
      <div class="cab-auth">
        <span class="cab-auth__mono">${esc(K.initials())}</span>
        <h1>Can’t reach the studio</h1>
        <p>${esc(err(e))}</p>
        <button class="btn btn--primary btn--block" data-cab-reenter>Try again</button>
      </div>`;
  }

  /* Back from the background (iOS freezes an installed app): token first,
     then the news — what's on screen stays until the fresh data is in */
  function onVisible() {
    if (document.visibilityState !== 'visible' || !root || !S.studio) return;
    K.Backend.auth.fresh().catch(() => null).then(() => {
      if (!root || !S.studio) return;
      syncChanges();
      if (S.tab !== 'today' && S.tab !== 'calendar' && S.tab !== 'requests') refreshView();
    });
  }

  /* =========================================================
     Live updates: Realtime → refetch + diff; polling as fallback
     ========================================================= */
  async function startLive() {
    stopLive();
    try {
      S.unsub = await K.Backend.owner.subscribe(S.studio.id, () => scheduleSync(), st => {
        S.live = st === 'live';
        setLiveLabel();
      });
    } catch (e) { S.live = false; }
    setLiveLabel();
    // a safety net: poll often while Realtime is down, rarely when it's up
    let n = 0;
    S.poll = setInterval(() => { n++; if (!S.live || n % 4 === 0) syncChanges(); }, 15000);
  }
  function stopLive() {
    clearInterval(S.poll);
    if (S.unsub) { try { S.unsub(); } catch (e) { /* gone */ } }
    S.unsub = null;
  }
  function setLiveLabel() {
    const el = $('#cab-live');
    if (el) el.innerHTML = S.readonly ? 'Admin view · read only' : S.stale ? 'Offline — showing saved' : S.live ? '<i class="cab-dot"></i>Live' : 'Up to date';
  }
  let syncTimer = 0;
  const scheduleSync = () => { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncChanges(), 350); };

  /* All bookings from two weeks back to four months ahead, kept in one map:
     Today, Calendar and Requests are drawn from it (no request per view).
     A refetch replaces only what changed; other ranges stay cached. */
  let syncP = null;
  function syncChanges(first) {
    if (!S.studio) return Promise.resolve();
    if (syncP) return syncP;
    const w = WINDOW();
    syncP = windowBookings(S.studio.id, w)
      .then(list => { S.stale = false; S.lastSync = Date.now(); setLiveLabel(); applyBookings(list, w.from, w.to, first); })
      .catch(e => { S.stale = true; setLiveLabel(); if (first && !S.known) throw e; })
      .finally(() => { syncP = null; });
    return syncP;
  }
  // merge what an action already told us (status, time…) — the next sync confirms it
  function patchKnown(id, fields) {
    const k = S.known && S.known.get(id);
    if (!k || !fields) return;
    ['status', 'start_at', 'end_at', 'cancel_reason', 'late_cancel', 'deposit_status', 'deposit_paid_at', 'completed_at', 'auto_completed']
      .forEach(f => { if (f in fields) k[f] = fields[f]; });
    S.pending = [...S.known.values()].filter(b => b.status === 'pending' && Date.parse(b.start_at) > Date.now());
    S.badges.requests = S.pending.length;
    saveLocal();
  }
  function applyBookings(list, from, to, first) {
    const prev = S.known;
    S.known = new Map(list.map(b => [b.id, b]));
    S.knownFrom = from;
    S.knownTo = to;
    S.pending = list.filter(b => b.status === 'pending' && Date.parse(b.start_at) > Date.now());
    // cached ranges outside the window: drop only those a changed booking touches
    if (prev) {
      const moved = [];
      list.forEach(b => { const o = prev.get(b.id); if (!o || o.updated_at !== b.updated_at) { moved.push(b.start_at); if (o) moved.push(o.start_at); } });
      prev.forEach((o, id) => { if (!S.known.has(id)) moved.push(o.start_at); });
      Object.keys(S.cache).forEach(key => {
        const [off, days] = key.split(':').map(Number);
        const a = Date.parse(dayStartIso(off));
        const z = Date.parse(dayStartIso(off + days));
        if (moved.some(t => { const x = Date.parse(t); return x >= a && x < z; })) delete S.cache[key];
      });
    }
    if (!first && prev) {
      list.forEach(b => {
        const old = prev.get(b.id);
        if (S.self.has(b.id)) return;
        if (!old && b.created_by === 'client' && isActive(b)) notify(b.status === 'pending' ? 'request' : 'new', b);
        else if (old && isActive(old) && b.status === 'cancelled_master' && b.deposit_status === 'expired') notify('expired', b);
        else if (old && isActive(old) && b.status === 'cancelled_client') notify('cancel', b);
        else if (old && isActive(b) && Date.parse(old.start_at) !== Date.parse(b.start_at)) notify('move', b, old);
      });
    }
    S.self.clear();
    S.badges.requests = S.pending.length;
    paintBadges();
    saveLocal();
    if (!first && ['today', 'calendar', 'requests'].includes(S.tab)) refreshView();
  }

  function notify(kind, b, old) {
    const svc = b.service_name;
    const o = spot(b.start_at).off;
    const when = `${o === 0 ? 'Today' : o === 1 ? 'Tomorrow' : K.dayLabel(o, false)} ${K.fmtClock(spot(b.start_at).min)}`;
    if (kind === 'cancel' && b.late_cancel) kind = 'late';
    const win = (S.studio && S.studio.cancel_window_hours) || 24;
    const at = o === 0 ? K.fmtClock(spot(b.start_at).min) : when;
    const text = {
      new: `New booking: ${b.client_name} · ${svc} · ${when}`,
      request: `New request: ${b.client_name} · ${svc} · ${when}`,
      cancel: `Cancelled: ${b.client_name} · ${svc} · ${at}`,
      late: `Late cancel: ${b.client_name} · ${svc} · ${at} — less than ${win}h notice`,
      expired: `Released: ${b.client_name} · ${at} — the deposit didn’t arrive`,
      move: `Moved: ${b.client_name} · ${svc} → ${when}`
    }[kind];
    S.queue.push({ kind, text, id: b.id });
    if (kind !== 'request') {
      const t = spot(b.start_at).off === 0 ? 'today' : 'calendar';
      if (S.tab !== t) S.badges[t]++;
    }
    paintBadges();
    if (typeof navigator.vibrate === 'function' && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) {
      try { navigator.vibrate(kind === 'cancel' || kind === 'late' || kind === 'expired' ? [40, 60, 40] : [25, 40, 25]); } catch (e) { /* not allowed */ }
    }
    chime(kind === 'cancel' || kind === 'late' || kind === 'expired');
    showBanner();
  }

  let bannerBusy = false;
  function showBanner() {
    if (bannerBusy || !S.queue.length || !root) return;
    bannerBusy = true;
    const n = S.queue.shift();
    const el = $('#cab-banner');
    el.className = `cab__banner cab__banner--${n.kind} is-on`;
    el.innerHTML = `<button data-cab-b="${esc(n.id)}"><i>${icon(n.kind === 'cancel' || n.kind === 'late' || n.kind === 'expired' ? '<path d="M6 6l12 12M18 6 6 18"/>' : n.kind === 'move' ? '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>' : '<path d="M12 5v14M5 12h14"/>')}</i><span>${esc(n.text)}</span></button>`;
    setTimeout(() => {
      el.classList.remove('is-on');
      setTimeout(() => { bannerBusy = false; showBanner(); }, 400);
    }, 4200);
  }

  // Sound is allowed only after the user has tapped: create / resume the context
  // inside that tap and play one silent sample (what iOS Safari needs)
  function unlockAudio() {
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      if (!S.audio) S.audio = new C();
      if (S.audio.state !== 'running') S.audio.resume();
      const buf = S.audio.createBuffer(1, 1, 22050);
      const src = S.audio.createBufferSource();
      src.buffer = buf;
      src.connect(S.audio.destination);
      src.start(0);
    } catch (e) { S.audio = null; return; }
    if (S.audio && S.audio.state === 'running') {
      ['pointerdown', 'touchend', 'keydown'].forEach(t => document.removeEventListener(t, unlockAudio, true));
    }
  }
  // iOS suspends ("interrupts") audio in the background — wait for the next tap
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.audio && S.audio.state !== 'running') {
      ['pointerdown', 'touchend', 'keydown'].forEach(t => document.addEventListener(t, unlockAudio, true));
    }
  });
  // a soft two-note chime (falling for a cancellation)
  function chime(down) {
    const a = S.audio;
    if (!a || a.state !== 'running') return; // not unlocked yet: stay quiet, no errors
    const notes = down ? [784, 587] : [659, 988];
    notes.forEach((f, i) => {
      const o = a.createOscillator();
      const g = a.createGain();
      const t = a.currentTime + i * 0.13;
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + 0.55);
    });
  }

  function paintBadges() {
    if (!root) return;
    const shown = { today: S.badges.today + S.badges.requests, calendar: S.badges.calendar };
    Object.keys(shown).forEach(k => {
      const b = $(`[data-badge="${k}"]`);
      if (!b) return;
      const n = shown[k];
      b.hidden = !n;
      b.textContent = n > 9 ? '9+' : String(n || '');
    });
  }

  /* =========================================================
     Tabs
     ========================================================= */
  /* Every view = a loader (network → memory) and a renderer (memory → HTML).
     A tab shows what is in memory at once and redraws quietly when the fresh
     data is in; a spinner only when there has never been anything to show.
     Forms she is filling in are never redrawn under her fingers. */
  const NO_DATA = new Error('no data yet');
  const need = v => { if (v == null) throw NO_DATA; return v; };
  const MEM = {};
  const memLoad = async (k, f) => (MEM[k] = await f());
  const loadSched = async () => { S.sched = await K.Backend.owner.schedule(S.studio.id); saveLocal(); };
  // a salon (owner): the masters and each one's hours — at most once a minute unless forced
  async function loadTeam(force, evenSolo) {
    if (isStaff() || !S.studio || !(isTeam() || evenSolo)) return;
    if (S.team && !force && Date.now() - (S.teamAt || 0) < 60000) return;
    const team = await K.Backend.owner.staff(S.studio.id);
    const scheds = {};
    await Promise.all(team.filter(x => x.active).map(x => K.Backend.owner.schedule(S.studio.id, x.id).then(r => { scheds[x.id] = r; }, () => null)));
    S.team = team;
    S.scheds = scheds;
    S.teamAt = Date.now();
    saveLocal();
  }
  // the hours page: whose (the owner may pick any master)
  const hrsFor = () => S.hrsStaff || ownStaff();
  async function loadHrs() {
    const r = await K.Backend.owner.schedule(S.studio.id, S.hrsStaff || null);
    if (!S.hrsStaff || S.hrsStaff === ownStaff()) { S.sched = r; saveLocal(); }
    if (S.hrsStaff) S.scheds[S.hrsStaff] = r;
    S.hsched = r;
  }
  function hrsSched() {
    if (S.hsched && S.hsched.staff_id && S.hsched.staff_id === hrsFor()) return S.hsched;
    if (!S.hrsStaff || S.hrsStaff === ownStaff()) return S.sched;
    return S.scheds[S.hrsStaff] || null;
  }
  const insKey = () => 'ins:' + (S.insPer || 'week') + ':' + (S.insStaff || '');
  const knownFresh = () => (S.known && Date.now() - (S.lastSync || 0) < 30000 ? null : syncChanges(true));
  const LOAD = {
    today: () => Promise.all([knownFresh(), isStaff() ? null : loadSetup(), loadTeam().catch(() => null)]),
    requests: () => knownFresh(),
    calendar: () => Promise.all([loadCalendar(), loadTeam().catch(() => null)]),
    clients: () => memLoad('cl:' + S.q, () => K.Backend.owner.clients(S.studio.id, S.q)),
    insights: () => Promise.all([
      memLoad(insKey(), () => K.Backend.owner.insights(S.studio.id, S.insPer || 'week', S.insStaff)),
      teamView() && !S.insStaff ? loadPayouts() : null
    ]),
    team: () => Promise.all([loadTeam(true, true), loadServices(true)]),
    studio: () => Promise.all([loadProfile(true), loadServices(true), loadLooks(true)]),
    profile: () => loadProfile(true),
    style: () => loadProfile(true),
    texts: () => loadProfile(true),
    faq: () => loadProfile(true),
    promo: () => loadProfile(true),
    loyalty: () => loadProfile(true),
    services: () => Promise.all([loadServices(true), loadProfile(true), loadTeam().catch(() => null)]),
    looks: () => Promise.all([loadLooks(true), loadServices(true)]),
    payments: () => Promise.all([loadProfile(true), loadSched(), loadServices(true)]),
    hours: () => (S.hrsDirty ? null : Promise.all([loadHrs(), loadTeam().catch(() => null)]))
  };
  const RENDER = {
    today: () => todayHTML(), calendar: () => calendarHTML(), requests: () => requestsHTML(), clients: () => clientsHTML(),
    hours: () => hoursHTML(), studio: () => studioHTML(), insights: () => insightsHTML(), payments: () => paymentsHTML(),
    profile: () => profileHTML(), style: () => styleHTML(), services: () => servicesHTML(), looks: () => looksHTML(),
    texts: () => textsHTML(), faq: () => faqHTML(), promo: () => promoHTML(), loyalty: () => loyaltyEditHTML(),
    team: () => teamHTML()
  };
  const EDITORS = new Set(['profile', 'style', 'texts', 'faq', 'payments', 'hours', 'promo', 'loyalty']);

  async function go(tab, initial) {
    // a master in a salon: only her own tabs
    if (isStaff() && !STAFF_TABS.some(t => t.id === tab) && tab !== 'requests') tab = 'today';
    S.tab = tab;
    S.dirty = false;
    if (tab === 'today' || tab === 'calendar') S.badges[tab] = 0;
    paintBadges();
    $$('.cab__tab').forEach(b => b.classList.toggle('is-active', b.dataset.cabTab === (isStaff() ? tab : PARENT[tab] || tab)));
    if (S2.edit && !['service', 'look', 'formula'].includes(S2.edit.kind)) cleanupUnsaved();
    const main = $('#cab-main');
    main.innerHTML = `<div class="cab__view" data-view="${tab}"></div>`;
    main.scrollTop = 0;
    if (!initial) K.haptic();
    const shown = await paint(tab, !initial).catch(() => false);
    const view = $('.cab__view');
    if (!shown && view && S.tab === tab && view.__html == null) view.innerHTML = '<div class="cab-load"><i class="spin"></i></div>';
    load(tab, !shown);
  }

  // draw the current tab from memory; false = nothing in memory yet
  async function paint(tab, animate) {
    const view = $('.cab__view');
    if (!root || !view || S.tab !== tab || !RENDER[tab]) return false;
    let html;
    try { html = await RENDER[tab](); } catch (e) { if (e === NO_DATA) return false; throw e; }
    if (!root || S.tab !== tab || view !== $('.cab__view')) return true;
    if (view.__html === html) return true;
    const first = view.__html == null;
    const keep = !first && tab === 'clients' && document.activeElement && document.activeElement.id === 'cab-q';
    view.__html = html;
    if (keep) { $('#cab-clients').innerHTML = clientsListHTML(); return true; }
    const main = $('#cab-main');
    const y = main.scrollTop;
    view.innerHTML = html;
    afterRender(tab, first);
    if (!first) main.scrollTop = y;
    else if (animate) K.springIn($$('.cab__view > *'), { stagger: 0.04, y: 14, duration: 0.5 });
    return true;
  }

  // fetch, then redraw quietly (not while she is editing a form)
  async function load(tab, animate) {
    try { await (LOAD[tab] ? LOAD[tab]() : null); } catch (e) {
      const view = $('.cab__view');
      if (!root || S.tab !== tab || !view) return;
      if (view.__html == null) view.innerHTML = `<div class="cab-empty"><b>${esc(err(e))}</b><button class="btn btn--soft btn--sm" data-cab-retry>Try again</button></div>`;
      else { S.stale = true; setLiveLabel(); }
      return;
    }
    if (!root || S.tab !== tab || (EDITORS.has(tab) && S.dirty)) return;
    try { await paint(tab, animate); } catch (e) { /* keep what's on screen */ }
  }

  // state changed here (a toggle, a day): redraw now, then refresh in the background
  function refreshView(animate) {
    if (!root || !S.studio) return;
    const tab = S.tab;
    if (EDITORS.has(tab) && S.dirty) return;
    paint(tab, animate).catch(() => null).then(() => load(tab, animate));
  }
  // redraw from memory only (in-view state like hours being edited)
  function repaint() { if (root && S.studio) paint(S.tab).catch(() => null); }

  const byStart = (a, z) => Date.parse(a.start_at) - Date.parse(z.start_at);
  function bookingsFor(fromOff, days) {
    const a = Date.parse(dayStartIso(fromOff));
    const z = Date.parse(dayStartIso(fromOff + days));
    if (S.known && S.knownFrom <= a && z <= S.knownTo) {
      return [...S.known.values()].filter(b => { const t = Date.parse(b.start_at); return t >= a && t < z; }).sort(byStart);
    }
    const hit = S.cache[fromOff + ':' + days];
    if (hit) return hit;
    throw NO_DATA;
  }
  function calRange() {
    if (S.cal !== 'week') return [S.day, 1];
    const d0 = K.studioDate(S.day);
    return [S.day - ((d0.dow + 6) % 7), 7];
  }
  async function loadCalendar() {
    const [off, days] = calRange();
    const a = Date.parse(dayStartIso(off));
    const z = Date.parse(dayStartIso(off + days));
    if (S.knownFrom <= a && z <= S.knownTo) return knownFresh();
    S.cache[off + ':' + days] = await K.Backend.owner.bookings(S.studio.id, dayStartIso(off), dayStartIso(off + days));
  }

  /* ---------- TODAY ---------- */
  async function todayHTML() {
    const list = await bookingsFor(0, 1);
    const live = list.filter(b => !b.status.startsWith('cancelled'));
    const counted = live.filter(b => b.status !== 'no_show');
    const revenue = counted.reduce((s, b) => s + (+b.price || 0), 0);
    const now = Date.now();
    const next = live.filter(b => isActive(b) && Date.parse(b.end_at) > now).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))[0];
    // a salon (owner): free time of every master; the day as one list with the master on each
    const team = teamView() && S.team;
    const free = team ? [] : freeWindows(0, list);
    const freeMin = team
      ? crew().reduce((s, st) => s + freeWindows(0, list.filter(b => b.staff_id === st.id), S.scheds[st.id]).reduce((x, w) => x + (w.e - w.s), 0), 0)
      : free.reduce((s, w) => s + (w.e - w.s), 0);
    const d = K.studioDate(0);
    return `
      <header class="cab-h"><span class="eyebrow">${K.DAY_NAMES[d.dow]}, ${K.MONTHS[d.month]} ${d.day}</span><h1>Today</h1></header>
      ${S.studio && S.studio.status === 'paused' ? '<div class="card dep-warn"><span><b>Your app is paused</b><small>Clients see a short-break page and can’t book right now. Reach out to turn it back on.</small></span></div>' : ''}
      <div class="cab-stats card">
        <div><b class="num">${money(revenue)}</b><small>Revenue</small></div>
        <div><b class="num">${counted.length}</b><small>${counted.length === 1 ? 'Client' : 'Clients'}</small></div>
        <div><b class="num">${freeMin >= 60 ? Math.floor(freeMin / 60) + 'h' + (freeMin % 60 ? ' ' + (freeMin % 60) + 'm' : '') : freeMin + 'm'}</b><small>Free</small></div>
      </div>
      ${setupHTML()}
      <div id="cab-push"></div>
      ${next ? nextClientHTML(next) : `<div class="card cab-next cab-next--none"><b>${live.length ? 'All done for today' : 'No clients today'}</b><span>${free.length ? 'Free windows are below — tap one to book a client.' : 'Enjoy the quiet.'}</span></div>`}
      ${depositsWaitingHTML()}
      ${S.pending.length ? `<button class="cab-req card" data-cab-tab="requests">${icon('<path d="M4 6.5h16v11H4z"/><path d="m4 7 8 6 8-6"/>')}<span><b>${S.pending.length} request${S.pending.length > 1 ? 's' : ''} waiting</b><small>Approve or decline</small></span>${K.I.chevR}</button>` : ''}
      ${tlHead(team ? 'Everyone today' : 'Timeline')}
      ${team ? crewListHTML(list) : timelineHTML(0, list)}
      ${free.length ? `
      <div class="group-label">Free windows</div>
      <div class="cab-free">${free.map(w => `<button class="chip" data-cab-new-at="0:${w.s}">${K.fmtClock(w.s)} – ${K.fmtClock(w.e)}</button>`).join('')}</div>` : ''}`;
  }

  function nextClientHTML(b) {
    const started = Date.parse(b.start_at) <= Date.now();
    return `
      <section class="card cab-next" data-cab-b="${esc(b.id)}" role="button" tabindex="0">
        <div class="cab-next__top"><span class="eyebrow">${started ? 'In the chair now' : 'Next client'}</span><span class="cab-next__in">${started ? 'until ' + K.fmtClock(spot(b.end_at).min) : K.countdown(b.start_at)}</span></div>
        <h2>${esc(b.client_name || 'Client')}${tagBadges(b.client_tags, b.client_no_shows)}</h2>
        <p class="num">${esc(b.service_name)} · ${timeRange(b)}${teamView() && b.staff_name ? ` · with ${esc(firstOf(b.staff_name))}` : ''}</p>
        ${b.deposit_status === 'pending' ? `<span class="bstat bstat--deposit">Deposit ${money(b.deposit)} not received</span>` : ''}
        ${b.last_formula ? `<p class="cab-last num">${icon(LASH)}<span>Last time: <b>${esc(formulaLine(b.last_formula))}</b></span></p>` : ''}
        ${b.client_note ? `<p class="cab-next__note">“${esc(b.client_note)}”</p>` : ''}
        ${b.status === 'pending' ? '<span class="bstat bstat--pending">Not confirmed yet</span>' : ''}
        <div class="cab-next__actions">
          ${b.client_phone ? `<a class="btn btn--primary" href="${esc(telHref(b.client_phone))}">${K.I.phone}Call</a>
          <a class="btn btn--soft" href="${esc(smsHref(b.client_phone))}">${icon('<path d="M20.5 11.8a8.3 8.3 0 0 1-12.2 7.3L3.5 20.5l1.4-4.6a8.3 8.3 0 1 1 15.6-4.1z"/>')}Text</a>` : ''}
        </div>
      </section>`;
  }

  /* the day of a salon (owner): everyone's bookings in one list, the master on each */
  function crewListHTML(list) {
    const rows = list.filter(b => S.showCx || !b.status.startsWith('cancelled'));
    if (!rows.length) return '<p class="cab-muted">No bookings today.</p>';
    return `<div class="list crew-list">${rows.map(b => `
      <button class="row row--link crew-row${b.status.startsWith('cancelled') ? ' is-cx' : ''}" data-cab-b="${esc(b.id)}">
        <span class="crew-row__time num">${K.fmtClock(spot(b.start_at).min)}</span>
        <span class="row__label">${esc(b.client_name || 'Client')}<span class="row__sub">${esc(b.service_name)}${b.status === 'pending' ? ' · request' : b.status.startsWith('cancelled') ? ' · cancelled' : b.status === 'no_show' ? ' · no-show' : ''}</span></span>
        ${crewTag(b)}
        <span class="row__chev">${K.I.chevR}</span>
      </button>`).join('')}</div>`;
  }

  /* open working time not taken by bookings or time off (one master's schedule; default: mine) */
  function freeWindows(off, list, sched) {
    const sc = sched || S.sched || {};
    const dow = K.studioDate(off).dow;
    let wins = (sc.hours || []).filter(h => h.weekday === dow).map(h => ({ s: minOf(h.start), e: minOf(h.end) }));
    const busy = list.filter(isActive).map(b => ({ s: spot(b.start_at).min, e: spot(b.end_at).min }))
      .concat(timeOffOn(off, sc));
    if (off === 0) {
      const nowMin = K.studioSpot(Date.now()).min;
      busy.push({ s: 0, e: Math.ceil(nowMin / 15) * 15 });
    }
    busy.forEach(x => {
      wins = wins.flatMap(w => (x.e <= w.s || x.s >= w.e) ? [w] : [{ s: w.s, e: x.s }, { s: x.e, e: w.e }].filter(p => p.e - p.s > 0));
    });
    return wins.filter(w => w.e - w.s >= 30);
  }
  function timeOffOn(off, sched) {
    const start = Date.parse(dayStartIso(off));
    const end = Date.parse(dayStartIso(off + 1));
    return (((sched || S.sched || {}).time_off) || []).filter(t => Date.parse(t.start_at) < end && Date.parse(t.end_at) > start).map(t => ({
      s: Date.parse(t.start_at) <= start ? 0 : spot(t.start_at).min,
      e: Date.parse(t.end_at) >= end ? 24 * 60 : spot(t.end_at).min,
      reason: t.reason
    }));
  }

  /* ---------- Timeline (Today + Calendar day) ---------- */
  const PX = 1.25; // px per minute
  // o: { sched (whose hours; default mine), staff (a new booking here is hers), from / to (a shared scale), bare (a column) }
  function timelineHTML(off, list, o) {
    o = o || {};
    const sc = o.sched || S.sched || {};
    const dow = K.studioDate(off).dow;
    const hours = (sc.hours || []).filter(h => h.weekday === dow).map(h => ({ s: minOf(h.start), e: minOf(h.end) }));
    const span = b => ({ b, s: spot(b.start_at).min, e: Math.max(spot(b.start_at).min + 15, spot(b.end_at).off > spot(b.start_at).off ? 24 * 60 : spot(b.end_at).min) });
    const items = list.filter(b => !b.status.startsWith('cancelled')).map(span);
    // cancelled ones stay visible (faded); if a new booking took the time, they step aside
    const cx = S.showCx ? list.filter(b => b.status.startsWith('cancelled')).map(span)
      .map(c => Object.assign(c, { side: items.some(i => i.s < c.e && c.s < i.e) })) : [];
    // cancelled ones that overlap each other share their area in lanes
    cx.sort((a, z) => a.s - z.s);
    for (let i = 0, cluster = [], end = -1; i <= cx.length; i++) {
      const c = cx[i];
      if (!c || c.s >= end) {
        const lanes = [];
        cluster.forEach(x => { let l = lanes.findIndex(e => e <= x.s); if (l < 0) { l = lanes.length; lanes.push(0); } lanes[l] = x.e; x.lane = l; });
        cluster.forEach(x => { x.lanes = lanes.length; });
        cluster = [];
        end = -1;
      }
      if (c) { cluster.push(c); end = Math.max(end, c.e); }
    }
    const cxPos = c => { const base = c.side ? 50 : 0; const w = (100 - base) / (c.lanes || 1); const l = base + w * (c.lane || 0); return `left:calc(${l.toFixed(2)}% + 4px);right:calc(${(100 - l - w).toFixed(2)}% + 4px);`; };
    const offs = timeOffOn(off, sc);
    let from = o.from != null ? o.from : Math.min(9 * 60, ...hours.map(h => h.s), ...items.map(i => i.s));
    let to = o.to != null ? o.to : Math.max(18 * 60, ...hours.map(h => h.e), ...items.map(i => i.e));
    from = Math.floor(from / 60) * 60;
    to = Math.min(24 * 60, Math.ceil(to / 60) * 60);
    const y = m => ((m - from) * PX).toFixed(1);
    const lines = [];
    for (let m = from; m <= to; m += 60) lines.push(`<div class="tl__h" style="top:${y(m)}px">${o.bare ? '' : `<span>${m < 24 * 60 ? K.fmtTime(m) : ''}</span>`}</div>`);
    const nowMin = off === 0 ? K.studioSpot(Date.now()).min : -1;
    return `
      <div class="tl${o.bare ? ' tl--col' : ''}" style="height:${((to - from) * PX).toFixed(0)}px" data-tl="${off}" data-from="${from}"${o.staff ? ` data-staff="${esc(o.staff)}"` : ''}>
        ${hours.map(h => `<i class="tl__open" style="top:${y(h.s)}px;height:${((h.e - h.s) * PX).toFixed(1)}px"></i>`).join('')}
        ${lines.join('')}
        ${offs.map(o => `<div class="tl__off" style="top:${y(Math.max(from, o.s))}px;height:${((Math.min(to, o.e) - Math.max(from, o.s)) * PX).toFixed(1)}px"><span>${esc(o.reason || 'Time off')}</span></div>`).join('')}
        ${items.map(({ b, s, e }) => `
          <button class="tl__b tl__b--${b.status}${e - s < 40 ? ' is-short' : ''}" data-cab-b="${esc(b.id)}" style="top:${y(s)}px;height:${Math.max(26, (e - s) * PX - 3).toFixed(1)}px">
            <b>${esc(b.client_name || 'Client')}${b.deposit_status === 'pending' && isActive(b) ? ' <em class="tl__dep" title="Deposit not received">$</em>' : ''}</b><span>${esc(b.service_name)}</span><small class="num">${timeRange(b)}</small>
          </button>`).join('')}
        ${cx.map(c => { const { b, s, e } = c; return `
          <button class="tl__b tl__b--cx${e - s < 40 ? ' is-short' : ''}${c.side || c.lanes > 1 ? ' is-narrow' : ''}" data-cab-b="${esc(b.id)}" style="${cxPos(c)}top:${y(s)}px;height:${Math.max(26, (e - s) * PX - 3).toFixed(1)}px">
            <b>${esc(b.client_name || 'Client')}</b>
            <span class="tl__tags"><em class="tl__tag">${b.status === 'cancelled_client' ? 'Cancelled by client' : 'Cancelled by you'}</em>${b.late_cancel ? '<em class="tl__tag tl__tag--late">Late cancel</em>' : ''}</span>
            <small class="num"><s>${timeRange(b)}</s></small>
          </button>`; }).join('')}
        ${nowMin >= from && nowMin <= to ? `<i class="tl__now" style="top:${y(nowMin)}px"></i>` : ''}
      </div>
      ${!items.length && !hours.length && !o.bare ? '<p class="cab-muted">Closed this day.</p>' : ''}`;
  }

  /* A salon's day (owner): a column per master, one time scale, scrolls sideways on a phone */
  function crewDayHTML(off, list) {
    const cols = crew();
    const dow = K.studioDate(off).dow;
    let from = 9 * 60;
    let to = 18 * 60;
    cols.forEach(st => ((S.scheds[st.id] || {}).hours || []).filter(h => h.weekday === dow).forEach(h => { from = Math.min(from, minOf(h.start)); to = Math.max(to, minOf(h.end)); }));
    list.forEach(b => { if (S.showCx || !b.status.startsWith('cancelled')) { from = Math.min(from, spot(b.start_at).min); to = Math.max(to, spot(b.end_at).off > spot(b.start_at).off ? 24 * 60 : spot(b.end_at).min); } });
    from = Math.floor(from / 60) * 60;
    to = Math.min(24 * 60, Math.ceil(to / 60) * 60);
    const marks = [];
    for (let m = from; m < to; m += 60) marks.push(`<span style="top:${((m - from) * PX).toFixed(1)}px">${K.fmtTime(m)}</span>`);
    return `
      <div class="crew-day">
        <div class="crew-day__axis" style="height:${((to - from) * PX).toFixed(0)}px">${marks.join('')}</div>
        ${cols.map(st => `
        <div class="crew-day__col">
          <button class="crew-day__head" data-crew-cal="${esc(st.id)}" style="--c:${esc(st.color || '#8E8E93')}">${crewAv(st)}<b>${esc(firstOf(st.name))}</b></button>
          ${timelineHTML(off, list.filter(b => b.staff_id === st.id), { sched: S.scheds[st.id] || { hours: [], time_off: [] }, staff: st.id, from, to, bare: true })}
        </div>`).join('')}
      </div>`;
  }
  // All · Jasmine · Mia … (the owner's calendar)
  function crewChipsHTML(attr, sel) {
    return `<div class="crew-chips" role="radiogroup">
      <button class="chip${sel ? '' : ' is-active'}" ${attr}="" role="radio" aria-checked="${!sel}">All</button>
      ${crew().map(st => `<button class="chip${sel === st.id ? ' is-active' : ''}" ${attr}="${esc(st.id)}" role="radio" aria-checked="${sel === st.id}">${crewDot(st.color)}${esc(firstOf(st.name))}</button>`).join('')}
    </div>`;
  }

  // section title + the "Show cancelled" switch
  function tlHead(title) {
    return `<div class="cab-tlhead"><span class="group-label">${title}</span>
      <label class="cab-cx">Show cancelled<button class="switch" role="switch" aria-checked="${S.showCx}" data-cab-showcx aria-label="Show cancelled bookings"></button></label></div>`;
  }

  /* ---------- CALENDAR (date + Day/Week stay pinned on top) ---------- */
  async function calendarHTML() {
    const seg = `<div class="segmented cab-seg" role="radiogroup" style="--n:2;--idx:${S.cal === 'week' ? 1 : 0}"><i class="segmented__thumb"></i>
      <button role="radio" data-cab-cal="day" aria-checked="${S.cal === 'day'}">Day</button>
      <button role="radio" data-cab-cal="week" aria-checked="${S.cal === 'week'}">Week</button></div>`;
    // a salon (owner): everyone side by side, or one master (chips)
    const team = teamView() && S.team && crew().length > 0;
    if (team && S.calStaff && !crewById(S.calStaff)) S.calStaff = null;
    const who = team ? S.calStaff : null;
    const mine = l => (who ? l.filter(b => b.staff_id === who) : l);
    const chips = team ? crewChipsHTML('data-crew-cal', who) : '';
    if (S.cal === 'week') {
      const d0 = K.studioDate(S.day);
      const start = S.day - ((d0.dow + 6) % 7); // Monday
      const list = mine(bookingsFor(start, 7));
      const a = K.studioDate(start);
      const b = K.studioDate(start + 6);
      return `
        <div class="cab-pin">
          <header class="cab-h cab-h--row"><h1>Calendar</h1>${seg}</header>
          <div class="cab-nav">
            <button class="cab__ic" data-cab-shift="-7" aria-label="Previous week">${K.I.chevL}</button>
            <b>${K.MONTHS[a.month]} ${a.day} – ${a.month !== b.month ? K.MONTHS[b.month] + ' ' : ''}${b.day}</b>
            <button class="cab__ic" data-cab-shift="7" aria-label="Next week">${K.I.chevR}</button>
            ${S.day !== 0 ? '<button class="cab-today" data-cab-today>Today</button>' : ''}
          </div>
          ${chips}
        </div>
        ${weekHTML(start, list, who ? S.scheds[who] : team ? null : S.sched)}`;
    }
    const all = bookingsFor(S.day, 1);
    const list = mine(all);
    const sc = who ? S.scheds[who] || { hours: [], time_off: [] } : S.sched;
    return `
      <div class="cab-pin">
        <header class="cab-h cab-h--row"><h1>Calendar</h1>${seg}</header>
        <div class="cab-nav">
          <button class="cab__ic" data-cab-shift="-1" aria-label="Previous day">${K.I.chevL}</button>
          <b>${esc(K.dayLabel(S.day, true))}</b>
          <button class="cab__ic" data-cab-shift="1" aria-label="Next day">${K.I.chevR}</button>
          ${S.day !== 0 ? '<button class="cab-today" data-cab-today>Today</button>' : ''}
        </div>
        ${chips}
      </div>
      ${tlHead('Day')}
      ${team && !who ? `<div class="cab-day cab-day--crew">${crewDayHTML(S.day, all)}</div>` : `
      <div class="cab-day" data-swipe>${timelineHTML(S.day, list, { sched: sc, staff: who })}</div>
      ${(() => { const free = S.day >= 0 ? freeWindows(S.day, list, sc) : []; return free.length ? `
      <div class="group-label">Free windows</div>
      <div class="cab-free">${free.map(w => `<button class="chip" data-cab-new-at="${S.day}:${w.s}${who ? ':' + esc(who) : ''}">${K.fmtClock(w.s)} – ${K.fmtClock(w.e)}</button>`).join('')}</div>` : ''; })()}`}`;
  }

  // sched: whose open hours are shaded (none for "everyone" in a salon)
  function weekHTML(start, list, sched) {
    const from = 8 * 60;
    const to = 20 * 60;
    const H = 7 * 60 / 60; // not used: rows are percentage based
    void H;
    const cols = [];
    for (let i = 0; i < 7; i++) {
      const off = start + i;
      const d = K.studioDate(off);
      const day = list.filter(b => spot(b.start_at).off === off && (S.showCx || !b.status.startsWith('cancelled')));
      const open = ((sched || {}).hours || []).filter(h => h.weekday === d.dow);
      cols.push(`
        <div class="wk__col${off === 0 ? ' is-today' : ''}">
          <button class="wk__d" data-cab-goday="${off}"><small>${K.DAY_SHORT[d.dow].charAt(0)}</small><b class="num">${d.day}</b></button>
          <div class="wk__body">
            ${open.map(h => `<i class="wk__open" style="top:${pct(minOf(h.start), from, to)}%;height:${pct(minOf(h.end), from, to) - pct(minOf(h.start), from, to)}%"></i>`).join('')}
            ${day.map(b => { const s = spot(b.start_at).min; const e = Math.max(s + 20, spot(b.end_at).min); return `<button class="wk__b tl__b--${b.status}${b.status.startsWith('cancelled') ? ' tl__b--cx' : ''}${teamView() && b.staff_color ? ' wk__b--crew' : ''}" data-cab-b="${esc(b.id)}" style="top:${pct(s, from, to)}%;height:${pct(e, from, to) - pct(s, from, to)}%${teamView() && b.staff_color ? ';--c:' + esc(b.staff_color) : ''}" aria-label="${esc(b.client_name)} ${esc(whenLine(b))}${teamView() && b.staff_name ? ' · ' + esc(b.staff_name) : ''}"><span>${esc(String(b.client_name || '').split(' ')[0])}</span></button>`; }).join('')}
          </div>
          <span class="wk__n num">${day.filter(b => !b.status.startsWith('cancelled')).length || ''}</span>
        </div>`);
    }
    const marks = [9, 12, 15, 18].map(h => `<span style="top:${pct(h * 60, from, to)}%">${h > 12 ? h - 12 : h}${h >= 12 ? 'p' : 'a'}</span>`).join('');
    return `<div class="wk" data-swipe-week><div class="wk__marks">${marks}</div>${cols.join('')}</div>`;
  }
  const pct = (m, from, to) => Math.max(0, Math.min(100, ((m - from) / (to - from)) * 100));

  /* ---------- REQUESTS ---------- */
  function requestsHTML() {
    const list = S.pending.slice().sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));
    const auto = S.sched && S.sched.rules && S.sched.rules.auto_confirm;
    return `
      ${backHTML('requests')}
      <header class="cab-h"><h1>Requests</h1></header>
      ${list.length ? `<p class="cab-muted">Swipe right to approve, left to decline.</p>
      <div class="cab-reqs">${list.map(b => `
        <div class="req" data-req="${esc(b.id)}">
          <div class="req__bg"><span class="req__yes">${K.I.check}Approve</span><span class="req__no">Decline${K.I.x}</span></div>
          <div class="req__card card">
            <div class="req__top"><b>${esc(b.client_name || 'Client')}</b>${crewTag(b)}<small>${ago(b.created_at)}</small></div>
            <p class="num">${esc(b.service_name)} · ${esc(whenLine(b))}</p>
            ${b.client_note ? `<p class="req__note">“${esc(b.client_note)}”</p>` : ''}
            <div class="req__actions">
              <button class="btn btn--soft btn--sm" data-req-no="${esc(b.id)}">Decline</button>
              <button class="btn btn--primary btn--sm" data-req-yes="${esc(b.id)}">Approve</button>
            </div>
          </div>
        </div>`).join('')}</div>` : `
      <div class="cab-empty">${K.art('bell')}<b>No requests</b><span>${auto ? 'Auto-confirm is on — new bookings are confirmed instantly. You can change it in Studio → Hours.' : 'New booking requests will show up here.'}</span></div>`}`;
  }

  async function decide(id, yes) {
    if (S.readonly) { readOnly(); refreshView(); return; }
    const card = $(`[data-req="${id}"]`);
    if (card) card.classList.add(yes ? 'is-yes' : 'is-no');
    S.self.add(id);
    try {
      await K.Backend.owner.setStatus(id, yes ? 'confirmed' : 'cancelled_master', yes ? null : 'Declined');
      K.haptic(yes ? [10, 30, 10] : 20);
      patchKnown(id, { status: yes ? 'confirmed' : 'cancelled_master' });
      S.pending = S.pending.filter(b => b.id !== id);
      S.badges.requests = S.pending.length;
      paintBadges();
      const g = K.G();
      if (card && g) K.ensure(g.to(card, { height: 0, opacity: 0, marginTop: 0, duration: 0.35, ease: 'power2.in', onComplete: () => { card.remove(); if (!S.pending.length) refreshView(); } }));
      else refreshView();
      K.toast(yes ? 'Approved — the client will see it' : 'Declined', 'ok');
      K.onDataChanged();
    } catch (e) {
      if (card) { card.classList.remove('is-yes', 'is-no'); resetSwipe(card); }
      K.toast(err(e), 'x');
    }
  }

  /* swipe a request card: right = approve, left = decline */
  function bindSwipes() {
    $$('.req').forEach(row => {
      const card = $('.req__card', row);
      let st = null;
      card.addEventListener('pointerdown', e => {
        if (e.target.closest('button')) return;
        st = { x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, lock: null };
      });
      card.addEventListener('pointermove', e => {
        if (!st) return;
        const dx = e.clientX - st.x;
        const dy = e.clientY - st.y;
        if (!st.lock && Math.hypot(dx, dy) > 8) {
          st.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
          if (st.lock === 'x') card.setPointerCapture(st.id);
        }
        if (st.lock !== 'x') return;
        st.dx = dx;
        card.style.transform = `translateX(${dx}px)`;
        row.classList.toggle('to-yes', dx > 30);
        row.classList.toggle('to-no', dx < -30);
      });
      const end = () => {
        if (!st) return;
        const dx = st.dx;
        const id = row.dataset.req;
        st = null;
        if (dx > 100) { card.style.transition = 'transform .25s ease-in'; card.style.transform = 'translateX(110%)'; decide(id, true); return; }
        if (dx < -100) { card.style.transition = 'transform .25s ease-in'; card.style.transform = 'translateX(-110%)'; decide(id, false); return; }
        resetSwipe(row);
      };
      card.addEventListener('pointerup', end);
      card.addEventListener('pointercancel', end);
    });
  }
  function resetSwipe(row) {
    const card = $('.req__card', row);
    if (!card) return;
    card.style.transition = 'transform .4s cubic-bezier(.32,1.15,.5,1)';
    card.style.transform = '';
    row.classList.remove('to-yes', 'to-no');
    setTimeout(() => { card.style.transition = ''; }, 420);
  }

  /* ---------- CLIENTS ---------- */
  async function clientsHTML() {
    S.clients = need(MEM['cl:' + S.q]);
    return `
      <header class="cab-h"><h1>Clients</h1></header>
      <label class="search">${K.I.search}<input id="cab-q" type="search" placeholder="Name, phone, email or tag" value="${esc(S.q)}" autocomplete="off" enterkeyhint="search"></label>
      <div id="cab-clients">${clientsListHTML()}</div>`;
  }
  function clientsListHTML() {
    const list = S.clients || [];
    if (!list.length) return `<div class="cab-empty">${K.art('heart')}<b>${S.q ? 'Nobody found' : 'No clients yet'}</b><span>${S.q ? 'Try a part of the name or the last digits of the phone.' : 'Everyone who books shows up here.'}</span></div>`;
    return `<div class="list">${list.map(c => `
      <button class="row row--link cl-row" data-cab-client="${esc(c.id)}">
        <span class="cl-av">${esc(String(c.name || '?').trim().charAt(0).toUpperCase())}</span>
        <span class="row__label">${esc(c.name)}${tagBadges(c.tags, c.no_shows)}<span class="row__sub num">${esc(phoneText(c.phone))}${c.next_visit ? ' · next ' + esc(K.dayLabel(spot(c.next_visit).off, false)) : ''}</span></span>
        <span class="row__value num">${c.visits ? c.visits + '×' : 'new'}</span>
        <span class="row__chev">${K.I.chevR}</span>
      </button>`).join('')}</div>`;
  }
  let qTimer = 0;
  function onSearch(v) {
    S.q = v;
    clearTimeout(qTimer);
    qTimer = setTimeout(async () => {
      try { S.clients = await memLoad('cl:' + S.q, () => K.Backend.owner.clients(S.studio.id, S.q)); } catch (e) { return; }
      const box = $('#cab-clients');
      if (box) box.innerHTML = clientsListHTML();
    }, 250);
  }

  async function openClient(id) {
    K.haptic();
    K.Sheet.open(el => { el.innerHTML = `<div class="ob" data-sheet-scroll><div class="cab-load"><i class="spin"></i></div></div>`; }, { detent: 'large' });
    try {
      const r = await K.Backend.owner.client(id);
      const box = K.$('.ob', K.Sheet.el());
      if (!box || !r) return;
      const c = r.client;
      const h = r.history || [];
      S2.client = c;
      S2.formulas = r.formulas || [];
      const noShows = h.filter(b => b.status === 'no_show').length;
      const done = h.filter(b => b.status === 'completed');
      const spent = done.reduce((s, b) => s + (+b.price || 0), 0);
      box.innerHTML = `
        <header class="ob__head"><span class="eyebrow">Client</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
        <h2>${esc(c.name)}${tagBadges(c.tags, noShows)}</h2>
        <p class="ob__sub num">${esc(phoneText(c.phone))}${c.email ? ' · ' + esc(c.email) : ''}${spent ? ' · ' + money(spent) + ' spent' : ''} <button class="cab-link cab-link--in" data-ct-edit>Edit</button></p>
        <div class="ob__actions">
          <a class="btn btn--soft" href="${esc(telHref(c.phone))}">${K.I.phone}Call</a>
          <a class="btn btn--soft" href="${esc(smsHref(c.phone))}">${icon('<path d="M20.5 11.8a8.3 8.3 0 0 1-12.2 7.3L3.5 20.5l1.4-4.6a8.3 8.3 0 1 1 15.6-4.1z"/>')}Text</a>
          <button class="btn btn--primary" data-cab-new-for="${esc(c.id)}" data-name="${esc(c.name)}" data-phone="${esc(c.phone)}" data-email="${esc(c.email || '')}">${icon('<path d="M12 5v14M5 12h14"/>')}Book</button>
        </div>
        <div class="cl-stats">
          <div><b class="num">${done.length}</b><small>Visits</small></div>
          <div><b class="num">${h.filter(b => b.status === 'cancelled_client').length}</b><small>Cancellations</small></div>
          <div class="${h.some(b => b.late_cancel) ? 'is-bad' : ''}"><b class="num">${h.filter(b => b.late_cancel).length}</b><small>Late cancels</small></div>
          <div class="${h.some(b => b.status === 'no_show') ? 'is-bad' : ''}"><b class="num">${h.filter(b => b.status === 'no_show').length}</b><small>No-shows</small></div>
        </div>
        ${noShows >= 2 ? `<div class="ob-flag">${icon('<path d="M12 8v5M12 16.5v.01"/><circle cx="12" cy="12" r="8.5"/>')}<span><b>${noShows} no-shows</b> — a deposit is asked on every booking she makes.</span></div>` : ''}
        <div id="crm-box">${crmHTML(c, S2.formulas)}</div>
        <label class="field"><span>Your notes</span><textarea id="cl-notes" rows="4" maxlength="2000" placeholder="Allergies, preferences, what she likes to talk about…">${esc(c.notes)}</textarea></label>
        <button class="btn btn--soft btn--block" data-cl-save="${esc(c.id)}">Save notes</button>
        <div class="group-label">History</div>
        <div class="list">${h.length ? h.map(b => `
          <button class="row row--link" data-cab-b="${esc(b.id)}">
            <span class="row__label">${esc(b.service_name)}<span class="row__sub num">${esc(whenLine(b))}${b.price != null ? ' · ' + money(b.price) : ''}</span></span>
            <span class="cl-tags">${b.late_cancel ? '<em class="tl__tag tl__tag--late">Late</em>' : ''}<span class="bstat bstat--${b.status}">${esc(statusLabel(b.status))}</span></span>
          </button>`).join('') : '<div class="row"><span class="row__label">No visits yet</span></div>'}</div>`;
      K.springIn(K.$$('.ob > *', K.Sheet.el()), { stagger: 0.03, y: 10, duration: 0.45 });
    } catch (e) { K.toast(err(e), 'x'); }
  }

  async function saveNotes(id) {
    const v = (K.$('#cl-notes', K.Sheet.el()) || {}).value || '';
    try {
      await K.Backend.owner.saveClient(id, { notes: v });
      K.haptic();
      K.toast('Notes saved', 'ok');
      const c = (S.clients || []).find(x => x.id === id);
      if (c) c.notes = v;
    } catch (e) { K.toast(err(e), 'x'); }
  }

  /* ---------- HOURS ---------- */
  async function hoursHTML() {
    // whose hours: mine, or (the owner of a salon) the master picked above
    const sc = need(hrsSched());
    if (!S.hrs || !S.hrsDirty) {
      S.hrs = {};
      for (let d = 0; d < 7; d++) S.hrs[d] = (sc.hours || []).filter(h => h.weekday === d).map(h => ({ s: h.start, e: h.end }));
    }
    const r = sc.rules || {};
    const staffView = isStaff();
    const pickCrew = teamView() && S.team && crew().length > 1;
    const her = S.hrsStaff && S.hrsStaff !== ownStaff() ? crewById(S.hrsStaff) : null;
    const order = [1, 2, 3, 4, 5, 6, 0];
    const sel = (name, value, opts, fmt) => `<select class="cab-sel" data-rule="${name}">${opts.map(o => `<option value="${o}"${+o === +value ? ' selected' : ''}>${fmt(o)}</option>`).join('')}</select>`;
    const hrsFmt = h => (h === 0 ? 'None' : h < 24 ? h + ' h' : h / 24 + (h === 24 ? ' day' : ' days'));
    return `
      ${backHTML('hours')}
      <header class="cab-h"><h1>${staffView ? 'My hours' : 'Hours & rules'}</h1></header>
      ${pickCrew ? `<div class="crew-chips crew-chips--hrs">${crew().map(st => `<button class="chip${st.id === hrsFor() ? ' is-active' : ''}" data-crew-hrs="${esc(st.id)}">${crewDot(st.color)}${esc(firstOf(st.name))}</button>`).join('')}</div>` : ''}
      <div class="group-label">${her ? esc(firstOf(her.name)) + '’s working hours' : 'Working hours'}</div>
      <div class="list hrs">
        ${order.map(d => {
          const ints = S.hrs[d] || [];
          const open = ints.length > 0;
          return `
          <div class="row row--stack hrs__day">
            <div class="row__head"><span class="row__label">${K.DAY_NAMES[d]}</span>
              <span class="row__value">${open ? '' : 'Closed'}</span>
              <button class="switch" role="switch" aria-checked="${open}" data-hrs-toggle="${d}" aria-label="${K.DAY_NAMES[d]} open"></button></div>
            ${open ? `<div class="hrs__ints">${ints.map((x, i) => `
              <div class="hrs__int">
                <input type="time" step="900" value="${x.s}" data-hrs-s="${d}:${i}" aria-label="Opens">
                <span>–</span>
                <input type="time" step="900" value="${x.e}" data-hrs-e="${d}:${i}" aria-label="Closes">
                ${ints.length > 1 ? `<button class="hrs__del" data-hrs-del="${d}:${i}" aria-label="Remove">${K.I.x}</button>` : '<span class="hrs__del-sp"></span>'}
              </div>`).join('')}
              <button class="hrs__add" data-hrs-add="${d}">${icon('<path d="M12 5v14M5 12h14"/>')}Add hours after a break</button>
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>
      <button class="btn btn--primary btn--block" data-hrs-save${S.hrsDirty ? '' : ' disabled'}>Save working hours</button>

      <div class="group-label">Time off</div>
      <div class="list">
        ${(sc.time_off || []).map(t => `
          <div class="row">
            <span class="row__label">${esc(t.reason || 'Time off')}<span class="row__sub num">${esc(offRange(t))}${isTeam() && t.whole_studio ? ' · whole studio' : ''}</span></span>
            ${staffView && t.whole_studio ? '' : `<button class="hrs__del" data-toff-del="${esc(t.id)}" aria-label="Delete">${K.I.x}</button>`}
          </div>`).join('') || '<div class="row"><span class="row__label cab-muted">No time off planned</span></div>'}
      </div>
      ${toffFormHTML()}
      ${staffView ? '' : `

      <div class="group-label">Booking rules</div>
      <div class="list">
        <div class="row"><span class="row__label">Auto-confirm<span class="row__sub">Off: every booking waits in Requests</span></span>
          <button class="switch" role="switch" aria-checked="${!!r.auto_confirm}" data-rule-auto aria-label="Auto-confirm"></button></div>
        <div class="row"><span class="row__label">Minimum notice<span class="row__sub">How soon before a visit clients can book</span></span>
          ${sel('min_notice_hours', r.min_notice_hours, [0, 1, 2, 4, 12, 24, 48], hrsFmt)}</div>
        <div class="row"><span class="row__label">Book ahead<span class="row__sub">How far into the future</span></span>
          ${sel('max_days_ahead', r.max_days_ahead, [7, 14, 30, 60, 90, 180, 365], d => d + ' days')}</div>
        <div class="row"><span class="row__label">Free cancellation<span class="row__sub">Later = marked as a late cancellation</span></span>
          ${sel('cancel_window_hours', r.cancel_window_hours, [0, 12, 24, 48, 72], h => (h ? 'up to ' + h + ' h' : 'any time'))}</div>
        <div class="row"><span class="row__label">Start times every</span>
          ${sel('slot_step_min', r.slot_step_min, [15, 20, 30, 45, 60], m => m + ' min')}</div>
      </div>
      <p class="cab-muted">Clients see these rules on the Review step.${isTeam() ? ' They are the same for every master.' : ''}</p>`}`;
  }
  function offRange(t) {
    const a = spot(t.start_at);
    const b = spot(t.end_at);
    const whole = a.min === 0 && (b.min === 0);
    if (whole) return `${K.dayLabel(a.off, false)}${b.off - 1 > a.off ? ' – ' + K.dayLabel(b.off - 1, false) : ''} · all day`;
    if (a.off === b.off) return `${K.dayLabel(a.off, false)} · ${K.fmtClock(a.min)} – ${K.fmtClock(b.min)}`;
    return `${K.dayLabel(a.off, false)} ${K.fmtClock(a.min)} – ${K.dayLabel(b.off, false)} ${K.fmtClock(b.min)}`;
  }
  function toffFormHTML() {
    const d = K.studioDate(1);
    const key = `${d.year}-${String(d.month + 1).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
    return `
      <details class="card toff">
        <summary>${icon('<path d="M12 5v14M5 12h14"/>')}Add time off</summary>
        <div class="toff__grid">
          <label class="field"><span>From</span><input type="date" id="toff-sd" value="${key}"></label>
          <label class="field"><span>&nbsp;</span><input type="time" id="toff-st" value="00:00" step="900"></label>
          <label class="field"><span>To</span><input type="date" id="toff-ed" value="${key}"></label>
          <label class="field"><span>&nbsp;</span><input type="time" id="toff-et" value="23:45" step="900"></label>
        </div>
        <label class="field"><span>Reason <em>optional, only you see it</em></span><input id="toff-r" maxlength="120" placeholder="Vacation, dentist, training…"></label>
        ${teamView() ? '<label class="tick"><input type="checkbox" id="toff-all"><i aria-hidden="true">' + K.I.check + '</i><span>The whole studio is closed (every master)</span></label>' : ''}
        <button class="btn btn--primary btn--block" data-toff-add>Add time off</button>
      </details>`;
  }

  function readHours() {
    const flat = [];
    for (let d = 0; d < 7; d++) (S.hrs[d] || []).forEach(x => flat.push({ weekday: d, start: x.s, end: x.e }));
    for (let d = 0; d < 7; d++) {
      const ints = (S.hrs[d] || []).map(x => ({ s: minOf(x.s), e: minOf(x.e) })).sort((a, b) => a.s - b.s);
      for (let i = 0; i < ints.length; i++) {
        if (!(ints[i].e > ints[i].s)) return { error: `${K.DAY_NAMES[d]}: closing time must be after opening` };
        if (i && ints[i].s < ints[i - 1].e) return { error: `${K.DAY_NAMES[d]}: the hours overlap` };
      }
    }
    return { flat };
  }

  async function saveHours() {
    const r = readHours();
    if (r.error) { K.toast(r.error, 'x'); return; }
    try {
      const sc = await K.Backend.owner.saveHours(S.studio.id, r.flat, S.hrsStaff || null);
      S.hsched = sc;
      if (sc.staff_id) S.scheds[sc.staff_id] = sc;
      if (!S.hrsStaff || S.hrsStaff === ownStaff()) S.sched = sc;
      S.hrsDirty = false;
      K.haptic([10, 30, 10]);
      K.toast('Working hours saved', 'ok');
      K.onDataChanged();
      S.dirty = false;
      saveLocal();
      refreshView();
    } catch (e) { K.toast(e.code === 'hours_overlap' ? 'Two intervals on one day overlap' : err(e), 'x'); }
  }

  async function addTimeOff() {
    const v = id => ($('#' + id) || {}).value || '';
    const [sy, sm, sd] = v('toff-sd').split('-').map(Number);
    const [ey, em, ed] = v('toff-ed').split('-').map(Number);
    if (!sy || !ey) { K.toast('Pick the dates', 'x'); return; }
    const start = new Date(K.zonedMs(sy, sm, sd, minOf(v('toff-st') || '00:00'))).toISOString();
    let endMin = minOf(v('toff-et') || '23:45');
    if (endMin >= 23 * 60 + 45) endMin = 24 * 60; // "until the end of the day"
    const end = new Date(K.zonedMs(ey, em, ed, endMin)).toISOString();
    if (Date.parse(end) <= Date.parse(start)) { K.toast('The end must be after the start', 'x'); return; }
    const all = !!($('#toff-all') || {}).checked;
    const whose = hrsFor();
    try {
      await K.Backend.owner.addTimeOff(S.studio.id, start, end, v('toff-r'), S.hrsStaff || null, all);
      if (all) S.teamAt = 0; // everyone's calendar changed
      // bookings inside the new time off are not touched — say so
      const clash = [...(S.known || new Map()).values()].filter(b => isActive(b) && (all || !whose || b.staff_id === whose) && Date.parse(b.start_at) < Date.parse(end) && Date.parse(b.end_at) > Date.parse(start));
      K.toast(clash.length ? `Added — ${clash.length} booking${clash.length > 1 ? 's' : ''} still in that time` : 'Time off added', clash.length ? 'bell' : 'ok');
      K.haptic();
      K.onDataChanged();
      S.hrsDirty = false;
      S.dirty = false;
      refreshView();
    } catch (e) { K.toast(err(e), 'x'); }
  }

  async function saveRule(name, value) {
    try {
      S.sched = await K.Backend.owner.saveRules(S.studio.id, { [name]: value });
      if (name === 'auto_confirm') S.studio.auto_confirm = value;
      K.haptic();
      K.toast('Saved', 'ok');
      K.onDataChanged();
    } catch (e) { K.toast(err(e), 'x'); refreshView(); }
  }

  /* =========================================================
     STUDIO — she runs everything herself: profile, look, services,
     looks, texts, assistant answers. Photos go to Supabase Storage.
     ========================================================= */
  const PARENT = { requests: 'today', hours: 'studio', services: 'studio', profile: 'studio', style: 'studio', looks: 'studio', texts: 'studio', faq: 'studio', payments: 'studio', promo: 'studio', loyalty: 'studio', team: 'studio' };
  const SUB_TITLE = { requests: 'Today', hours: 'Studio', services: 'Studio', profile: 'Studio', style: 'Studio', looks: 'Studio', texts: 'Studio', faq: 'Studio', payments: 'Studio', promo: 'Studio', loyalty: 'Studio', team: 'Studio' };
  // a master's "My hours" is a tab of its own (no way back to a Studio she doesn't have)
  const backHTML = tab => PARENT[tab] && !(isStaff() && tab === 'hours') ? `<button class="cab-back cab-back--top" data-cab-tab="${PARENT[tab]}">${K.I.chevL}${SUB_TITLE[tab]}</button>` : '';
  const S2 = { profile: null, services: null, looks: null, edit: null };

  async function loadProfile(force) {
    if (!S2.profile || force) S2.profile = await K.Backend.owner.profile(S.studio.id);
    return S2.profile;
  }
  async function loadServices(force) {
    if (!S2.services || force) S2.services = await K.Backend.owner.services(S.studio.id);
    return S2.services;
  }
  async function loadLooks(force) {
    if (!S2.looks || force) S2.looks = await K.Backend.owner.looks(S.studio.id);
    return S2.looks;
  }
  // after any save: clients see it right away (the client app reloads the studio)
  function published() { K.reloadStudio && K.reloadStudio(); K.onDataChanged && K.onDataChanged(); }

  /* ---------- photos: pick → shrink to ~1600px WebP (JPEG where WebP can't be made) → upload ---------- */
  const toBlob = (canvas, type, q) => new Promise(res => canvas.toBlob(b => res(b), type, q));
  async function shrink(file) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {
      src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
    }
    const w0 = src.width || src.naturalWidth;
    const h0 = src.height || src.naturalHeight;
    const k = Math.min(1, 1600 / Math.max(w0, h0));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w0 * k);
    canvas.height = Math.round(h0 * k);
    canvas.getContext('2d').drawImage(src, 0, 0, canvas.width, canvas.height);
    let blob = await toBlob(canvas, 'image/webp', 0.82);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.85); // older Safari
    return blob;
  }
  // must be called straight from a tap (opens the photo picker)
  function pickPhoto(folder, onDone, onBusy) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      if (!/^image\//.test(file.type) && !/\.(heic|heif|jpe?g|png|webp)$/i.test(file.name)) { K.toast('That isn’t a photo', 'x'); return; }
      onBusy && onBusy(true);
      try {
        const blob = await shrink(file);
        if (blob.size > 5 * 1024 * 1024) throw new Error('too_big');
        const url = await K.Backend.owner.upload(S.studio.id, folder, blob);
        onDone(url);
      } catch (e) {
        K.toast(e.message === 'too_big' ? 'That photo is too large' : 'Upload failed — ' + err(e).toLowerCase(), 'x');
      } finally { onBusy && onBusy(false); }
    }, { once: true });
    input.click();
  }
  // a photo slot inside a form: preview + Upload / Change / Remove
  function photoSlot(key, url, label, kind) {
    return `
      <div class="phf${url ? '' : ' is-empty'}" data-phf="${key}" data-kind="${kind || 'misc'}" data-label="${esc(label)}">
        <span class="phf__img">${url ? `<img src="${esc(url)}" alt="">` : icon('<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m20.5 16-5-5-8 8"/>')}</span>
        <span class="phf__body"><b>${esc(label)}</b><small>${url ? 'Looks good' : 'From your camera roll — we shrink it for you'}</small></span>
        <span class="phf__acts">
          <button type="button" class="btn btn--soft btn--sm" data-phf-pick="${key}">${url ? 'Change' : 'Upload'}</button>
          ${url ? `<button type="button" class="phf__del" data-phf-del="${key}" aria-label="Remove photo">${K.I.x}</button>` : ''}
        </span>
      </div>`;
  }
  // replace one slot after an upload / removal
  function setSlot(slot, url) {
    if (slot && slot.isConnected) slot.outerHTML = photoSlot(slot.dataset.phf, url, slot.dataset.label, slot.dataset.kind);
  }
  // uploaded but never saved → removed when the editor closes unsaved
  function trackUpload(url) { (S2.edit && (S2.edit.__new = S2.edit.__new || [])).push(url); }
  async function cleanupUnsaved() {
    const e = S2.edit;
    S2.edit = null;
    if (e && e.__new && !e.__saved) e.__new.forEach(u => K.Backend.owner.removeMedia(u).catch(() => null));
  }
  async function dropReplaced(oldUrl, newUrl) {
    if (oldUrl && oldUrl !== newUrl) K.Backend.owner.removeMedia(oldUrl).catch(() => null);
  }

  /* ---------- the Studio tab ---------- */
  async function studioHTML() {
    const p = need(S2.profile);
    const svcs = need(S2.services);
    const looks = need(S2.looks);
    const st = p.settings || {};
    const row = (tab, ic, label, value) => `
      <button class="row row--link" data-cab-tab="${tab}">
        <span class="row__icon">${icon(ic)}</span>
        <span class="row__label">${label}</span>
        ${value != null ? `<span class="row__value num">${esc(String(value))}</span>` : ''}
        <span class="row__chev">${K.I.chevR}</span>
      </button>`;
    return `
      <header class="cab-h"><span class="eyebrow">${esc(location.host + location.pathname.replace(/\/$/, ''))}/?m=${esc(K.SLUG)}</span><h1>Studio</h1></header>
      ${depositWarnHTML()}
      <div class="group-label">Your page</div>
      <div class="list">
        ${row('profile', '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 19.5c1-3.3 3.8-5 7-5s6 1.7 7 5"/>', 'Profile & photos', st.tagline ? '' : 'Add')}
        ${row('style', '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12h8.5"/>', 'Look & feel', ({ soft: 'Soft', maison: 'Maison', noir: 'Noir' })[p.style] || '')}
        ${row('services', '<path d="M10 3.5l1.8 4.9 4.9 1.8-4.9 1.8L10 16.9l-1.8-4.9-4.9-1.8 4.9-1.8z"/>', 'Services', svcs.filter(s => s.active).length)}
        ${row('looks', '<rect x="3.5" y="4" width="17" height="16" rx="4"/><circle cx="9" cy="9.5" r="1.5"/><path d="m20.5 15-4-4L7 20"/>', 'Looks', looks.length)}
        ${row('promo', '<path d="M4 9.5h16v10H4z"/><path d="M12 9.5v10M3 6.5h18v3H3zM12 6.5c-1.5-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3.5-2-5 1"/>', 'Promo banner', st.promo && st.promo.on ? 'On' : 'Off')}
        ${row('loyalty', '<rect x="3" y="5.5" width="18" height="13" rx="3"/><circle cx="8" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="16" cy="12" r="1.3"/>', 'Loyalty card', st.loyalty && st.loyalty.on ? 'On' : 'Off')}
      </div>
      <div class="group-label">Booking</div>
      <div class="list">
        ${row('team', '<circle cx="9" cy="8.5" r="3.2"/><circle cx="16.5" cy="9.5" r="2.6"/><path d="M3 19.5c.8-3.2 3.2-5 6-5s5.2 1.8 6 5M15 14.6c2.6-.3 5 1.2 5.8 4.9"/>', 'Team', isTeam() ? (S.team ? crew().length + (crew().length === 1 ? ' master' : ' masters') : 'Team') : 'Solo')}
        ${row('hours', '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>', 'Hours, time off & rules')}
        ${row('payments', '<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10.5h18M7 15h4"/>', 'Payments & deposits', Object.values(st.payments || {}).some(v => String(v || '').trim()) ? 'On' : 'Off')}
        ${row('texts', '<path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>', 'Policies & texts')}
        ${row('faq', '<path d="M20.5 11.8a8.3 8.3 0 0 1-12.2 7.3L3.5 20.5l1.4-4.6a8.3 8.3 0 1 1 15.6-4.1z"/>', 'Assistant answers', (st.faq || []).length)}
      </div>
      <button class="btn btn--soft btn--block" data-cab-close>${icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>')}See it as a client</button>`;
  }

  /* ---------- Team (a salon): Solo / Team, the masters, their sign-ins ---------- */
  async function teamHTML() {
    const team = need(S.team);
    need(S2.services);
    const solo = !isTeam();
    return `
      ${backHTML('team')}
      <header class="cab-h cab-h--row"><h1>Team</h1>${solo ? '' : `<button class="btn btn--primary btn--sm" data-crew-new>${icon('<path d="M12 5v14M5 12h14"/>')}Add</button>`}</header>
      <div class="segmented crew-kind" role="radiogroup" style="--n:2;--idx:${solo ? 0 : 1}"><i class="segmented__thumb"></i>
        <button role="radio" data-crew-kind="solo" aria-checked="${solo}">Solo</button><button role="radio" data-crew-kind="team" aria-checked="${!solo}">Team</button></div>
      <p class="cab-muted">${solo
        ? 'Just you. Switch to Team when other masters work in your studio — clients then choose who they book with.'
        : 'Clients choose a master — or “Any available” — when they book. Each master signs in with her own email and sees only her own calendar, clients and numbers.'}</p>
      ${solo ? '' : `
      <div class="list crew-team">${team.map(st => `
        <button class="row row--link crew-team__row${st.active ? '' : ' is-off'}" data-crew-edit="${esc(st.id)}">
          ${crewAv(st)}
          <span class="row__label">${esc(st.name)}${st.is_owner ? ' <em class="crew-you">You</em>' : ''}<span class="row__sub">${esc([
            st.title,
            (st.services || []).length + ' service' + ((st.services || []).length === 1 ? '' : 's'),
            +st.commission_pct ? +st.commission_pct + '%' : '',
            !st.active ? 'Inactive' : st.is_owner ? '' : st.has_login ? 'Signs in' : 'No sign-in yet'
          ].filter(Boolean).join(' · '))}</span></span>
          <span class="row__chev">${K.I.chevR}</span>
        </button>`).join('')}</div>
      ${crew().length < 2 ? '<p class="cab-muted">Clients see the team once a second master is added.</p>' : ''}`}`;
  }

  async function setKind(kind) {
    if (kind === (isTeam() ? 'team' : 'solo')) return;
    try {
      await K.Backend.owner.setKind(S.studio.id, kind);
      S.studio.kind = kind;
      S.teamAt = 0;
      K.haptic([10, 30, 10]);
      K.toast(kind === 'team' ? 'Team is on — add your masters' : 'Back to Solo', 'ok');
      saveLocal();
      published();
      refreshView();
    } catch (e) {
      K.toast(e.code === 'team_has_staff' ? 'Turn off the other masters first' : err(e), 'x');
      refreshView();
    }
  }

  // add / edit a master: photo, name, title, bio, color, commission, what she does (her own price / time)
  function openCrewEditor(st) {
    const svcs = (S2.services || []).filter(s => s.active);
    const isNew = !st;
    const s = st || { name: '', title: '', bio: '', photo: '', color: CREW_COLORS[(S.team || []).length % CREW_COLORS.length], commission_pct: 40, services: svcs.map(x => ({ id: x.id })), active: true, has_login: false };
    const mine = {};
    (s.services || []).forEach(x => { mine[x.id] = x; });
    S2.edit = { kind: 'crew', id: s.id || null, photo: s.photo || '', color: s.color || CREW_COLORS[0], __orig: { photo: s.photo || '' } };
    K.haptic();
    K.Sheet.open(el => {
      el.innerHTML = `
        <div class="ob" data-sheet-scroll>
          <header class="ob__head"><span class="eyebrow">${isNew ? 'New master' : s.is_owner ? 'You' : 'Master'}</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
          <form class="bk-form" id="crew-form" onsubmit="return false">
            ${photoSlot('photo', s.photo, 'Photo', 'team')}
            <label class="field"><span>Name</span><input name="name" maxlength="60" value="${esc(s.name)}" placeholder="Jasmine Lee"></label>
            <label class="field"><span>Title <em>optional</em></span><input name="title" maxlength="60" value="${esc(s.title || '')}" placeholder="Senior lash artist"></label>
            <label class="field"><span>About <em>optional, clients see it</em></span><textarea name="bio" rows="3" maxlength="400" placeholder="Volume sets, 6 years, loves a soft wispy look">${esc(s.bio || '')}</textarea></label>
            <div class="field"><span>Color in the calendar</span>
              <div class="crew-colors">${CREW_COLORS.map(c => `<button type="button" class="crew-color${c === S2.edit.color ? ' is-active' : ''}" data-crew-color="${c}" style="--c:${c}" aria-label="Color ${c}"></button>`).join('')}</div></div>
            ${s.is_owner ? '' : `<label class="field"><span>Commission, % <em>her share of each visit — for Payouts</em></span><input name="commission_pct" type="number" inputmode="decimal" min="0" max="100" step="1" value="${esc(+s.commission_pct || 0)}"></label>`}
            ${s.is_owner ? '' : s.has_login ? `
            <div class="row"><span class="row__label">Signs in as<span class="row__sub">${esc(s.email || '')}</span></span></div>` : `
            <label class="field"><span>Her email <em>${isNew ? 'to sign in — or leave empty and add it later' : 'to give her a sign-in'}</em></span><input name="email" type="email" inputmode="email" autocapitalize="off" spellcheck="false" placeholder="jasmine@gmail.com"></label>`}
            <div class="group-label">What she does</div>
            <p class="cab-muted">Her own price or time only if it differs from the menu.</p>
            <div class="list crew-svcs">${svcs.map(x => { const o = mine[x.id]; return `
              <div class="row row--stack crew-svc">
                <label class="tick"><input type="checkbox" data-crew-svc="${esc(x.id)}"${o ? ' checked' : ''}><i aria-hidden="true">${K.I.check}</i><span>${esc(x.name)} <small class="num">${money(x.price)} · ${durText(x.duration_min)}</small></span></label>
                <div class="form-2 crew-svc__own">
                  <label class="field"><span>Her price, $</span><input type="number" inputmode="decimal" min="0" step="1" data-crew-price="${esc(x.id)}" value="${esc(o && o.price != null ? +o.price : '')}" placeholder="${esc(+x.price)}"></label>
                  <label class="field"><span>Her time</span><select class="cab-sel cab-sel--wide" data-crew-dur="${esc(x.id)}"><option value="">${durText(x.duration_min)}</option>${DURATIONS.map(m => `<option value="${m}"${o && +o.duration === m ? ' selected' : ''}>${durText(m)}</option>`).join('')}</select></label>
                </div>
              </div>`; }).join('') || '<div class="row"><span class="row__label cab-muted">Add services first</span></div>'}</div>
          </form>
          <button class="btn btn--primary btn--block" data-crew-save>${isNew ? 'Add master' : 'Save'}</button>
          ${!isNew ? `<button class="btn btn--soft btn--block" data-crew-hours="${esc(s.id)}">${icon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>')}${s.is_owner ? 'My' : 'Her'} hours & time off</button>` : ''}
          ${!isNew && !s.is_owner ? (s.active
            ? `<button class="btn btn--soft btn--block ob__danger" data-crew-off="${esc(s.id)}">Turn off — she no longer takes bookings</button>`
            : `<button class="btn btn--soft btn--block" data-crew-on="${esc(s.id)}">Turn back on</button>`) : ''}
        </div>`;
    }, { detent: 'large' });
  }

  function readCrewForm() {
    const f = K.$('#crew-form', K.Sheet.el());
    const v = n => (f.elements[n] ? f.elements[n].value.trim() : '');
    const services = K.$$('[data-crew-svc]', K.Sheet.el()).filter(c => c.checked).map(c => {
      const id = c.dataset.crewSvc;
      const p = K.$(`[data-crew-price="${id}"]`, K.Sheet.el());
      const d = K.$(`[data-crew-dur="${id}"]`, K.Sheet.el());
      return { id, price: p && p.value !== '' ? +p.value : null, duration: d && d.value ? +d.value : null };
    });
    return {
      name: v('name'), title: v('title'), bio: v('bio'), email: v('email').toLowerCase(),
      commission_pct: f.elements.commission_pct ? Math.max(0, Math.min(100, +v('commission_pct') || 0)) : undefined,
      photo: S2.edit.photo || '', color: S2.edit.color, services
    };
  }

  async function saveCrew(btn) {
    const p = readCrewForm();
    const id = S2.edit.id;
    if (!p.name) { K.toast('Add her name', 'x'); return; }
    if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) { K.toast('Check the email', 'x'); return; }
    if (!p.services.length) { K.toast('Pick at least one service she does', 'x'); return; }
    await busyBtn(btn, async () => {
      let invite = null;
      const body = { name: p.name, title: p.title, bio: p.bio, photo: p.photo, color: p.color, services: p.services };
      if (p.commission_pct !== undefined) body.commission_pct = p.commission_pct;
      if (!id && p.email) {
        // her account + the master in one go (Edge Function)
        invite = await K.Backend.owner.inviteStaff(Object.assign({ master_id: S.studio.id, email: p.email }, body));
      } else {
        await K.Backend.owner.saveStaff(S.studio.id, Object.assign(id ? { id } : {}, body));
        if (id && p.email) invite = await K.Backend.owner.inviteStaff({ master_id: S.studio.id, staff_id: id, email: p.email });
      }
      dropReplaced(S2.edit.__orig.photo, S2.edit.photo);
      S2.edit.__saved = true;
      await loadTeam(true).catch(() => null);
      published();
      if (invite && invite.password) { openInvite(invite, p.name); return; }
      K.toast(id ? 'Saved' : `${firstOf(p.name)} is on the team`, 'ok');
      K.Sheet.close();
      refreshView();
    });
  }

  // the message with her sign-in (the temporary password is shown only now)
  function inviteText(r, name) {
    const link = `${location.origin}${location.pathname}?m=${encodeURIComponent(K.SLUG)}&owner=1`;
    return [
      `Hi ${firstOf(name) || 'there'}! 👋`,
      '',
      `You’re on the team at ${S.studio.name} ✨ Your bookings, clients and hours are in our app.`,
      '',
      `1. On your iPhone, open this link in Safari: ${link}`,
      '2. Tap Share → Add to Home Screen, then open the app from your Home Screen.',
      `3. Sign in with ${r.email} and this temporary password: ${r.password}`,
      '4. Choose your own password when the app asks.',
      '5. On Today, turn on notifications so you hear about new bookings.'
    ].join('\n');
  }
  function openInvite(r, name) {
    const text = inviteText(r, name);
    S.inviteText = text;
    K.haptic([10, 30, 10]);
    K.Sheet.open(el => {
      el.innerHTML = `
        <div class="ob" data-sheet-scroll>
          <header class="ob__head"><span class="eyebrow">Invite</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
          <h2>${esc(firstOf(name))} can sign in ✨</h2>
          <p class="ob__sub">Send her this message. The temporary password is shown only now — she picks her own at the first sign-in.</p>
          <div class="card bk-sum crew-inv">
            <div class="bk-row"><span>Email</span><b>${esc(r.email)}</b></div>
            <div class="bk-row"><span>Temporary password</span><b class="num crew-pw">${esc(r.password)}</b></div>
          </div>
          <label class="field"><span>Message</span><textarea class="crew-msg" rows="11" readonly>${esc(text)}</textarea></label>
          <button class="btn btn--primary btn--block" data-crew-copy>Copy message</button>
          <button class="btn btn--soft btn--block" data-sheet-close>Done</button>
        </div>`;
    }, { detent: 'large' });
    refreshView();
  }
  async function copyText(text, what) {
    try { await navigator.clipboard.writeText(text); K.toast(what || 'Copied', 'ok'); } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); K.toast(what || 'Copied', 'ok'); } catch (x) { K.toast('Copy didn’t work — select the text and copy it', 'x'); }
      ta.remove();
    }
  }

  // turn a master off: her upcoming bookings go to another master or are cancelled first
  async function crewOff(id, btn) {
    const st = crewById(id);
    await busyBtn(btn, async () => {
      try {
        await K.Backend.owner.saveStaff(S.studio.id, { id, active: false });
      } catch (e) {
        if (e.code === 'has_bookings') { openReassign(id); return; }
        throw e;
      }
      await loadTeam(true).catch(() => null);
      published();
      K.toast(`${firstOf(st && st.name)} is off — she no longer takes bookings`, 'ok');
      K.Sheet.close();
      refreshView();
    });
  }
  async function crewOn(id, btn) {
    await busyBtn(btn, async () => {
      await K.Backend.owner.saveStaff(S.studio.id, { id, active: true });
      await loadTeam(true).catch(() => null);
      published();
      K.toast('She takes bookings again', 'ok');
      K.Sheet.close();
      refreshView();
    });
  }
  async function openReassign(id) {
    S2.reassign = { id, list: null };
    K.Sheet.open(el => { el.innerHTML = '<div class="ob" data-sheet-scroll><div class="cab-load"><i class="spin"></i></div></div>'; }, { detent: 'large' });
    await paintReassign();
  }
  async function paintReassign() {
    const r = S2.reassign;
    if (!r) return;
    try { r.list = await K.Backend.owner.staffFuture(r.id); } catch (e) { K.toast(err(e), 'x'); return; }
    const box = K.$('.ob', K.Sheet.el());
    if (!box || S2.reassign !== r) return;
    const st = crewById(r.id) || { name: '' };
    box.innerHTML = `
      <header class="ob__head"><span class="eyebrow">Reassign</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
      <h2>${r.list.length ? `${esc(firstOf(st.name))} has ${r.list.length} upcoming booking${r.list.length > 1 ? 's' : ''}` : 'All set'}</h2>
      <p class="ob__sub">${r.list.length ? 'Give each one to a master who is free then, or cancel it — the client sees it in the app.' : `Nothing is left in ${esc(firstOf(st.name))}’s calendar.`}</p>
      <div class="crew-re">${r.list.map(b => `
        <div class="card crew-re__b">
          <b>${esc(b.client_name || 'Client')}</b>
          <small class="num">${esc(b.service_name)} · ${esc(whenLine(b))}</small>
          <div class="crew-chips">${(b.options || []).map(o => `<button class="chip" data-crew-move="${esc(b.id)}|${esc(o.id)}|${esc(b.start_at)}">${crewDot(o.color)}${esc(firstOf(o.name))}</button>`).join('') || '<span class="cab-muted">Nobody else is free then</span>'}</div>
          <button class="cab-link ob__danger" data-crew-cx="${esc(b.id)}">Cancel this booking</button>
        </div>`).join('')}</div>
      ${r.list.length ? '' : `<button class="btn btn--primary btn--block" data-crew-off="${esc(r.id)}">Turn ${esc(firstOf(st.name))} off now</button>`}`;
  }
  async function crewMove(val, btn) {
    const [bid, sid, at] = val.split('|');
    await busyBtn(btn, async () => {
      S.self.add(bid);
      try {
        await K.Backend.owner.reschedule(bid, at, false, sid);
      } catch (e) {
        // outside her hours by the rules, but free: the owner decided — move it anyway
        if (e.code === 'outside_hours') await K.Backend.owner.reschedule(bid, at, true, sid);
        else throw e;
      }
      K.toast(`Moved to ${firstOf((crewById(sid) || {}).name)}`, 'ok');
      K.onDataChanged();
      syncChanges(true).catch(() => null);
      await paintReassign();
    });
  }
  async function crewCancel(bid, btn) {
    if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Tap again to cancel it'; K.haptic(20); return; }
    await busyBtn(btn, async () => {
      S.self.add(bid);
      await K.Backend.owner.setStatus(bid, 'cancelled_master', 'Your master is no longer available — please book another time');
      K.toast('Cancelled — the client will see it', 'ok');
      K.onDataChanged();
      syncChanges(true).catch(() => null);
      await paintReassign();
    });
  }

  /* ---------- Profile & photos ---------- */
  const PROFILE_FIELDS = [
    ['masterName', 'Your first name', 'Aria'],
    ['tagline', 'Subtitle', 'Lashes & brows that wake up ready'],
    ['city', 'City', 'Atlanta, GA'],
    ['address', 'Address', '1080 Peachtree St NE, Suite 4B'],
    ['parking', 'Parking', 'Free 2-hour parking in the garage'],
    ['phone', 'Phone', '(404) 555-0142'],
    ['instagram', 'Instagram', '@yourstudio'],
    ['reviewUrl', 'Review link (Google / Instagram)', 'https://g.page/r/…']
  ];
  async function profileHTML() {
    const p = need(S2.profile);
    const st = p.settings || {};
    S2.edit = { kind: 'profile', heroPhoto: st.heroPhoto || '', avatar: st.avatar || '', __orig: { heroPhoto: st.heroPhoto || '', avatar: st.avatar || '' } };
    return `
      ${backHTML('profile')}
      <header class="cab-h"><h1>Profile</h1></header>
      <form class="bk-form" id="pf-form" onsubmit="return false">
        ${photoSlot('heroPhoto', st.heroPhoto, 'Cover photo (Home)', 'cover')}
        ${photoSlot('avatar', st.avatar, 'Your photo', 'avatar')}
        <label class="field"><span>Studio name</span><input name="name" maxlength="80" value="${esc(p.name)}"></label>
        ${PROFILE_FIELDS.map(([k, label, ph]) => `
          <label class="field"><span>${esc(label)}</span>
            ${k === 'parking' ? `<textarea name="${k}" rows="2" maxlength="300" placeholder="${esc(ph)}">${esc(st[k] || '')}</textarea>`
              : `<input name="${k}" maxlength="${k === 'reviewUrl' ? 300 : 120}" value="${esc(st[k] || '')}" placeholder="${esc(ph)}"${k === 'phone' ? ' type="tel" inputmode="tel"' : k === 'reviewUrl' ? ' type="url" inputmode="url" autocapitalize="off"' : ''}></label>`}
          `).join('')}
        <div class="group-label">Numbers on your page</div>
        <p class="cab-muted">Only what’s true — leave a field empty and that block isn’t shown.</p>
        <div class="form-2">
          <label class="field"><span>Rating (1–5)</span><input name="rating" type="number" inputmode="decimal" min="1" max="5" step="0.1" value="${esc(st.rating || '')}" placeholder="4.9"></label>
          <label class="field"><span>Number of reviews</span><input name="reviewCount" type="number" inputmode="numeric" min="0" step="1" value="${esc(st.reviewCount || '')}" placeholder="—"></label>
        </div>
        <div class="form-2">
          <label class="field"><span>Years of experience</span><input name="yearsExp" type="number" inputmode="numeric" min="0" max="60" step="1" value="${esc(st.yearsExp || '')}" placeholder="—"></label>
          <label class="field"><span>Works done</span><input name="worksDone" type="number" inputmode="numeric" min="0" step="1" value="${esc(st.worksDone || '')}" placeholder="—"></label>
        </div>
        <label class="field"><span>Works are called</span><input name="worksLabel" maxlength="24" value="${esc(st.worksLabel || '')}" placeholder="sets done"></label>
      </form>
      <button class="btn btn--primary btn--block" data-pf-save>Save profile</button>`;
  }
  async function saveProfileForm(btn) {
    const f = $('#pf-form');
    const val = n => (f.elements[n] ? f.elements[n].value.trim() : '');
    const ig = val('instagram').replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, '');
    const url = val('reviewUrl');
    if (url && !/^https:\/\//i.test(url)) { K.toast('The review link should start with https://', 'x'); return; }
    const settings = {};
    PROFILE_FIELDS.forEach(([k]) => { settings[k] = val(k) || null; });
    settings.instagram = ig || null;
    const rating = val('rating') === '' ? null : +val('rating');
    if (rating != null && !(rating >= 1 && rating <= 5)) { K.toast('The rating goes from 1 to 5', 'x'); return; }
    const whole = n => (val(n) === '' || !(+val(n) > 0) ? null : Math.round(+val(n)));
    settings.rating = rating;
    settings.reviewCount = whole('reviewCount');
    settings.yearsExp = whole('yearsExp');
    settings.worksDone = whole('worksDone');
    settings.worksLabel = val('worksLabel') || null;
    settings.heroPhoto = S2.edit.heroPhoto || null;
    settings.avatar = S2.edit.avatar || null;
    await busyBtn(btn, async () => {
      S2.profile = await K.Backend.owner.saveProfile(S.studio.id, { name: val('name'), settings });
      dropReplaced(S2.edit.__orig.heroPhoto, S2.edit.heroPhoto);
      dropReplaced(S2.edit.__orig.avatar, S2.edit.avatar);
      S2.edit.__saved = true;
      S2.edit.__orig = { heroPhoto: S2.edit.heroPhoto, avatar: S2.edit.avatar };
      K.toast('Profile saved', 'ok');
      published();
    });
  }
  // a button that shows a spinner while its work runs, and always comes back
  async function busyBtn(btn, work) {
    const label = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = K.spinner(); }
    try { await work(); S.dirty = false; K.haptic([10, 30, 10]); } catch (e) { K.toast(err(e), 'x'); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
  }

  /* ---------- Look & feel (style + accent, live preview) ---------- */
  // the preview's colors per style and theme (as the client app draws them)
  const STYLE_LOOK = {
    soft: { font: "'Plus Jakarta Sans', system-ui, sans-serif", w: 800, r: 16, light: { bg: '#F7F5F2', card: '#FFFFFF', text: '#16161A' }, dark: { bg: '#0E0E11', card: '#1C1C21', text: '#F4F4F6' } },
    maison: { font: "'Fraunces', Georgia, serif", w: 400, r: 14, light: { bg: '#F7F3EE', card: '#FFFFFF', text: '#2A211C' }, dark: { bg: '#0F0D0C', card: '#1E1A17', text: '#F2EAE0' } },
    noir: { font: "'Inter', system-ui, sans-serif", w: 700, r: 14, light: { bg: '#F2F2F7', card: '#FFFFFF', text: '#0A0A0B' }, dark: { bg: '#000000', card: '#1C1C1E', text: '#F5F5F7' } }
  };
  async function styleHTML() {
    const p = need(S2.profile);
    const st = p.settings || {};
    S2.edit = { kind: 'style', style: p.style || 'noir', accent: st.defaultAccent || null, pv: (K.theme && K.theme()) === 'dark' ? 'dark' : 'light' };
    return `
      ${backHTML('style')}
      <header class="cab-h"><h1>Look & feel</h1></header>
      <div id="sty-box">${styleBoxHTML()}</div>
      <button class="btn btn--primary btn--block" data-sty-save>Save look</button>
      <p class="cab-muted">Clients can still switch light / dark and pick their own accent in the app.</p>`;
  }
  function styleBoxHTML() {
    const e = S2.edit;
    const list = K.accentsFor(e.style, e.pv);
    if (!e.accent || !list.some(a => a.id === e.accent)) e.accent = list[0].id;
    const acc = list.find(a => a.id === e.accent).color;
    const L = STYLE_LOOK[e.style];
    const C = L[e.pv] || L.light;
    const name = (S2.profile && S2.profile.name) || K.data.name;
    const st = (S2.profile && S2.profile.settings) || {};
    const rating = +st.rating > 0 ? `★ ${(+st.rating).toFixed(1)} · ` : ''; // only her real rating
    // text on the accent: dark on light accents, white on deep ones (as the app does)
    const rgb = [1, 3, 5].map(i => parseInt(acc.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    const onAcc = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] > 0.45 ? '#111111' : '#FFFFFF';
    return `
      <div class="sty-block">
        <span class="sty-label">Style</span>
        <div class="segmented" role="radiogroup" style="--n:3;--idx:${['soft', 'maison', 'noir'].indexOf(e.style)}"><i class="segmented__thumb"></i>
          ${['soft', 'maison', 'noir'].map(x => `<button role="radio" data-sty="${x}" aria-checked="${x === e.style}">${x.charAt(0).toUpperCase() + x.slice(1)}</button>`).join('')}
        </div>
      </div>
      <div class="sty-block">
        <span class="sty-label">Accent</span>
        <div class="sty-acc" role="radiogroup" aria-label="Accent">
          ${list.map(a => `<button class="swatch" role="radio" data-sty-acc="${a.id}" aria-checked="${a.id === e.accent}" aria-label="${esc(a.name)}" style="--c:${a.color}">${K.I.check}</button>`).join('')}
        </div>
      </div>
      <div class="sty-block">
        <span class="sty-label sty-label--row">Preview
          <span class="segmented sty-pv" role="radiogroup" aria-label="Preview theme" style="--n:2;--idx:${e.pv === 'dark' ? 1 : 0}"><i class="segmented__thumb"></i>
            <button role="radio" data-sty-pv="light" aria-checked="${e.pv !== 'dark'}">Light</button><button role="radio" data-sty-pv="dark" aria-checked="${e.pv === 'dark'}">Dark</button></span></span>
      <div class="sty-prev sty-prev--${e.pv}" style="--pb:${C.bg};--pc:${C.card};--pt:${C.text};--pa:${acc};--pon:${onAcc};--pf:${L.font};--pw:${L.w};--pr:${L.r}px">
        <div class="sty-prev__hero"><span>${esc(name)}</span><small>${rating}Book in two taps</small></div>
        <div class="sty-prev__card">
          <b>Next available</b><span class="sty-prev__time">Today 3:30 PM</span>
          <div class="sty-prev__chips"><i class="on">3:30 PM</i><i>5:00 PM</i><i>Tomorrow</i></div>
          <span class="sty-prev__btn">Book</span>
        </div>
      </div>
      </div>`;
  }
  async function saveStyle(btn) {
    const e = S2.edit;
    const acc = K.accentsFor(e.style, 'light').find(a => a.id === e.accent); // the brand color is the light one
    await busyBtn(btn, async () => {
      S2.profile = await K.Backend.owner.saveProfile(S.studio.id, { style: e.style, accent: /^#[0-9a-f]{6}$/i.test(acc && acc.color) ? acc.color : null, settings: { defaultAccent: e.accent } });
      K.toast('Look saved — clients see it now', 'ok');
      published();
    });
  }

  /* ---------- Services (add / edit / hide / delete / drag to reorder) ---------- */
  const CATS = ['Lashes', 'Brows', 'Nails', 'Other'];
  const DURATIONS = [15, 20, 30, 40, 45, 50, 60, 75, 90, 105, 120, 135, 150, 165, 180, 210, 240, 270, 300];
  const durText = m => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ' ' + (m % 60) + 'm' : ''}` : m + ' min');
  async function servicesHTML() {
    const list = need(S2.services);
    return `
      ${backHTML('services')}
      <header class="cab-h cab-h--row"><h1>Services</h1><button class="btn btn--primary btn--sm" data-svc-new>${icon('<path d="M12 5v14M5 12h14"/>')}Add</button></header>
      ${depositWarnHTML()}
      ${list.length ? `<p class="cab-muted">Drag ≡ to change the order clients see. Tap to edit.</p>
      <div class="list sortable" data-sort="services">${list.map(s => `
        <div class="row svc-row${s.active ? '' : ' is-hidden'}" data-id="${esc(s.id)}">
          <button class="drag" data-drag aria-label="Drag to reorder">${icon('<path d="M5 8h14M5 12h14M5 16h14"/>')}</button>
          <img class="svc-row__img" src="${esc(K.photoSrc({ photo: s.photo, category: s.category, title: s.name }, 160))}" data-ph="${K.svcKind({ category: s.category, title: s.name })}" alt="">
          <button class="svc-row__main" data-svc-edit="${esc(s.id)}">
            <b>${esc(s.name)}</b>
            <small class="num">${esc(s.category)} · ${durText(s.duration_min)}${s.buffer_min ? ' + ' + s.buffer_min + 'm' : ''} · ${s.price_from ? 'from ' : ''}${money(s.price)}${+s.deposit ? ' · deposit ' + money(s.deposit) : ''}${s.active ? '' : ' · hidden'}</small>
          </button>
          <span class="row__chev">${K.I.chevR}</span>
        </div>`).join('')}</div>` : `<div class="cab-empty">${K.art('sparkles')}<b>No services yet</b><span>Add your first one — clients can book it right away.</span></div>`}`;
  }
  function openServiceEditor(svc) {
    const s = svc || { name: '', category: 'Lashes', description: '', duration_min: 60, buffer_min: 15, price: '', price_from: false, deposit: 0, photo: '', active: true, fill_weeks: null };
    S2.edit = { kind: 'service', id: s.id || null, photo: s.photo || '', __orig: { photo: s.photo || '' } };
    const cats = [...new Set(CATS.concat((S2.services || []).map(x => x.category)))];
    K.haptic();
    K.Sheet.open(el => {
      el.innerHTML = `
        <div class="ob" data-sheet-scroll>
          <header class="ob__head"><span class="eyebrow">${s.id ? 'Edit service' : 'New service'}</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
          <form class="bk-form" id="svc-form" onsubmit="return false">
            ${photoSlot('photo', s.photo, 'Photo', 'services')}
            <label class="field"><span>Name</span><input name="name" maxlength="80" value="${esc(s.name)}" placeholder="Classic Full Set"></label>
            <div class="field"><span>Category</span>
              <div class="chips-wrap" data-cat-chips>${cats.map(c => `<button type="button" class="chip${c === s.category ? ' is-active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
              <input name="category_custom" class="chip-input" maxlength="30" placeholder="Other name…" value="${cats.includes(s.category) ? '' : esc(s.category)}"></div></div>
            <label class="field"><span>Description</span><textarea name="description" rows="3" maxlength="600" placeholder="What she gets, how it feels, how long it lasts">${esc(s.description || '')}</textarea></label>
            <div class="form-2">
              <label class="field"><span>Duration</span><select class="cab-sel cab-sel--wide" name="duration_min">${DURATIONS.concat(DURATIONS.includes(s.duration_min) ? [] : [s.duration_min]).sort((a, b) => a - b).map(m => `<option value="${m}"${m === s.duration_min ? ' selected' : ''}>${durText(m)}</option>`).join('')}</select></label>
              <label class="field"><span>Buffer after</span><select class="cab-sel cab-sel--wide" name="buffer_min">${[0, 5, 10, 15, 20, 30, 45, 60].map(m => `<option value="${m}"${m === +s.buffer_min ? ' selected' : ''}>${m ? m + ' min' : 'None'}</option>`).join('')}</select></label>
            </div>
            <div class="form-2">
              <label class="field"><span>Price, $</span><input name="price" type="number" inputmode="decimal" min="0" step="1" value="${esc(s.price === '' ? '' : +s.price)}" placeholder="120"></label>
              <label class="field"><span>Deposit, $</span><input name="deposit" type="number" inputmode="decimal" min="0" step="1" value="${esc(+s.deposit || '')}" placeholder="0"></label>
            </div>
            <label class="tick"><input type="checkbox" name="price_from"${s.price_from ? ' checked' : ''}><i aria-hidden="true">${K.I.check}</i><span>Show as “from $” (the price can be higher)</span></label>
            <label class="field"><span>Fill reminder</span><select class="cab-sel cab-sel--wide" name="fill_weeks">${[['', 'None'], [2, 'After 2 weeks'], [3, 'After 3 weeks'], [4, 'After 4 weeks'], [5, 'After 5 weeks'], [6, 'After 6 weeks'], [8, 'After 8 weeks']].map(([v, l]) => `<option value="${v}"${String(v) === String(s.fill_weeks || '') ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
            <div class="row hrs-switch"><span class="row__label">Visible to clients<span class="row__sub">Off: hidden from the app, nothing is deleted</span></span><button type="button" class="switch" role="switch" aria-checked="${s.active !== false}" data-svc-active></button></div>
            ${teamView() && S.team && crew().length > 1 ? `
            <div class="field"><span>Who does it</span>
              <div class="chips-wrap" data-svc-crew>${crew().map(st => `<button type="button" class="chip${!s.id || doesSvc(st, s.id) ? ' is-active' : ''}" data-svc-who="${esc(st.id)}">${crewDot(st.color)}${esc(firstOf(st.name))}</button>`).join('')}</div></div>` : ''}
          </form>
          <button class="btn btn--primary btn--block" data-svc-save>${s.id ? 'Save service' : 'Add service'}</button>
          ${s.id ? '<button class="btn btn--soft btn--block ob__danger" data-svc-del>Delete service</button>' : ''}
        </div>`;
    }, { detent: 'large' });
  }
  async function saveService(btn) {
    const f = K.$('#svc-form', K.Sheet.el());
    const v = n => f.elements[n] ? f.elements[n].value.trim() : '';
    const custom = v('category_custom');
    const chip = K.$('[data-cat-chips] .chip.is-active', K.Sheet.el());
    const svc = {
      id: S2.edit.id || undefined, name: v('name'), category: custom || (chip ? chip.dataset.cat : 'Other'),
      description: v('description'), duration_min: +v('duration_min'), buffer_min: +v('buffer_min'),
      price: v('price') === '' ? null : +v('price'), deposit: +v('deposit') || 0, price_from: f.elements.price_from.checked,
      fill_weeks: v('fill_weeks') || '', photo: S2.edit.photo || '',
      active: K.$('[data-svc-active]', K.Sheet.el()).getAttribute('aria-checked') === 'true'
    };
    if (!svc.name) { K.toast('Add a name', 'x'); return; }
    if (svc.price == null || !(svc.price >= 0)) { K.toast('Add a price', 'x'); return; }
    if (svc.deposit > svc.price && svc.price > 0) { K.toast('The deposit is bigger than the price', 'x'); return; }
    // a salon: who does it (all chips on = everyone, the default for a new one)
    const whoBox = K.$('[data-svc-crew]', K.Sheet.el());
    const who = whoBox ? K.$$('[data-svc-who]', whoBox).filter(c => c.classList.contains('is-active')).map(c => c.dataset.svcWho) : null;
    if (who && !who.length) { K.toast('Pick at least one master who does it', 'x'); return; }
    await busyBtn(btn, async () => {
      const saved = await K.Backend.owner.saveService(S.studio.id, svc);
      if (who && saved && saved.id && (svc.id || who.length < crew().length)) {
        await K.Backend.owner.serviceStaff(saved.id, who);
      }
      if (who) S.teamAt = 0;
      dropReplaced(S2.edit.__orig.photo, S2.edit.photo);
      S2.edit.__saved = true;
      K.toast(svc.id ? 'Service saved' : 'Service added — clients can book it', 'ok');
      K.Sheet.close();
      published();
      if (S.tab === 'services') refreshView();
    });
  }
  async function deleteService(btn) {
    if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Tap again to delete'; K.haptic(20); setTimeout(() => { if (btn.isConnected) { btn.dataset.sure = ''; btn.textContent = 'Delete service'; } }, 3000); return; }
    await busyBtn(btn, async () => {
      await K.Backend.owner.deleteService(S2.edit.id);
      if (S2.edit.__orig.photo) K.Backend.owner.removeMedia(S2.edit.__orig.photo).catch(() => null);
      S2.edit.__saved = true;
      K.toast('Service deleted — past bookings keep its name', 'ok');
      K.Sheet.close();
      published();
      refreshView();
    });
  }

  /* drag ≡ to reorder (services, looks) */
  function bindSortable() {
    const box = $('.sortable');
    if (!box) return;
    box.addEventListener('pointerdown', e => {
      const h = e.target.closest('[data-drag]');
      if (!h) return;
      e.preventDefault();
      if (S.readonly) { readOnly(); return; }
      const row = h.closest('[data-id]');
      const rows = () => [...box.querySelectorAll('[data-id]')];
      const startY = e.clientY;
      const r0 = row.getBoundingClientRect();
      let moved = false;
      row.classList.add('is-dragging');
      // listeners on window: moving the row in the DOM drops any pointer capture
      const move = ev => {
        if (ev.pointerId !== e.pointerId) return;
        const dy = ev.clientY - startY;
        if (Math.abs(dy) > 3) moved = true;
        row.style.transform = `translateY(${dy}px)`;
        const mid = r0.top + r0.height / 2 + dy;
        const others = rows().filter(x => x !== row);
        const before = others.find(x => { const b = x.getBoundingClientRect(); return mid < b.top + b.height / 2; });
        const nextSib = row.nextElementSibling;
        if (before !== nextSib && (before || nextSib)) {
          const old = row.getBoundingClientRect().top;
          if (before) box.insertBefore(row, before); else box.appendChild(row);
          const now = row.getBoundingClientRect().top;
          // keep the row under the finger after the DOM jump
          const cur = parseFloat((row.style.transform.match(/-?[\d.]+/) || [0])[0]);
          row.style.transform = `translateY(${cur - (now - old)}px)`;
          K.haptic(5);
        }
      };
      const up = async () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        row.classList.remove('is-dragging');
        row.style.transform = '';
        if (!moved) return;
        const ids = rows().map(x => x.dataset.id);
        try {
          await K.Backend.owner.reorder(S.studio.id, box.dataset.sort, ids);
          K.toast('Order saved', 'ok');
          published();
        } catch (x) { K.toast(err(x), 'x'); refreshView(); }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    });
  }

  /* ---------- Looks (portfolio) ---------- */
  async function looksHTML() {
    const list = need(S2.looks);
    const svcs = need(S2.services);
    return `
      ${backHTML('looks')}
      <header class="cab-h cab-h--row"><h1>Looks</h1><button class="btn btn--primary btn--sm" data-look-new>${icon('<path d="M12 5v14M5 12h14"/>')}Add</button></header>
      ${list.length ? `<p class="cab-muted">Clients pick a look and book it in two taps. Drag ≡ to reorder.</p>
      <div class="list sortable" data-sort="looks">${list.map(l => `
        <div class="row svc-row" data-id="${esc(l.id)}">
          <button class="drag" data-drag aria-label="Drag to reorder">${icon('<path d="M5 8h14M5 12h14M5 16h14"/>')}</button>
          <img class="svc-row__img svc-row__img--look" src="${esc(l.photo)}" alt="">
          <button class="svc-row__main" data-look-edit="${esc(l.id)}">
            <b>${esc(l.title)}${l.is_new ? ' <em class="lk-new">NEW</em>' : ''}</b>
            <small>${esc([l.tag, (svcs.find(s => s.id === l.service_id) || {}).name].filter(Boolean).join(' · ') || 'No tag yet')}${l.before_photo ? ' · before/after' : ''}</small>
          </button>
          <span class="row__chev">${K.I.chevR}</span>
        </div>`).join('')}</div>` : `<div class="cab-empty">${K.art('sparkles')}<b>No looks yet</b><span>Upload your best work — clients book by the look they love.</span></div>`}`;
  }
  function openLookEditor(look) {
    const l = look || { title: '', tag: '', service_id: '', photo: '', before_photo: '', is_new: true, popular: false };
    S2.edit = { kind: 'look', id: l.id || null, photo: l.photo || '', before_photo: l.before_photo || '', __orig: { photo: l.photo || '', before_photo: l.before_photo || '' } };
    const tags = [...new Set((S2.looks || []).map(x => x.tag).filter(Boolean).concat(['Classic', 'Hybrid', 'Volume', 'Brows']))].slice(0, 8);
    K.haptic();
    K.Sheet.open(el => {
      el.innerHTML = `
        <div class="ob" data-sheet-scroll>
          <header class="ob__head"><span class="eyebrow">${l.id ? 'Edit look' : 'New look'}</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
          <form class="bk-form" id="look-form" onsubmit="return false">
            ${photoSlot('photo', l.photo, 'Photo of your work', 'looks')}
            <label class="field"><span>Name of the look</span><input name="title" maxlength="60" value="${esc(l.title)}" placeholder="Wispy Cat Eye"></label>
            <label class="field"><span>Tag</span><input name="tag" maxlength="30" value="${esc(l.tag)}" placeholder="Hybrid" list="look-tags"></label>
            <div class="chips-wrap">${tags.map(t => `<button type="button" class="chip" data-tag-pick="${esc(t)}">${esc(t)}</button>`).join('')}</div>
            <label class="field"><span>Service to book</span><select class="cab-sel cab-sel--wide" name="service_id"><option value="">—</option>${(S2.services || []).filter(s => s.active).map(s => `<option value="${esc(s.id)}"${s.id === l.service_id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
            ${photoSlot('before_photo', l.before_photo, 'Before photo (optional)', 'looks')}
            <div class="row hrs-switch"><span class="row__label">Mark as New</span><button type="button" class="switch" role="switch" aria-checked="${!!l.is_new}" data-look-flag="is_new"></button></div>
            <div class="row hrs-switch"><span class="row__label">Most booked</span><button type="button" class="switch" role="switch" aria-checked="${!!l.popular}" data-look-flag="popular"></button></div>
          </form>
          <button class="btn btn--primary btn--block" data-look-save>${l.id ? 'Save look' : 'Add look'}</button>
          ${l.id ? '<button class="btn btn--soft btn--block ob__danger" data-look-del>Delete look</button>' : ''}
        </div>`;
    }, { detent: 'large' });
  }
  async function saveLook(btn) {
    const f = K.$('#look-form', K.Sheet.el());
    const flag = k => K.$(`[data-look-flag="${k}"]`, K.Sheet.el()).getAttribute('aria-checked') === 'true';
    const look = {
      id: S2.edit.id || undefined, title: f.elements.title.value.trim(), tag: f.elements.tag.value.trim(),
      service_id: f.elements.service_id.value, photo: S2.edit.photo, before_photo: S2.edit.before_photo || '',
      is_new: flag('is_new'), popular: flag('popular')
    };
    if (!look.photo) { K.toast('Upload a photo first', 'x'); return; }
    if (!look.title) { K.toast('Give the look a name', 'x'); return; }
    await busyBtn(btn, async () => {
      await K.Backend.owner.saveLook(S.studio.id, look);
      dropReplaced(S2.edit.__orig.photo, S2.edit.photo);
      dropReplaced(S2.edit.__orig.before_photo, S2.edit.before_photo);
      S2.edit.__saved = true;
      K.toast(look.id ? 'Look saved' : 'Look added', 'ok');
      K.Sheet.close();
      published();
      if (S.tab === 'looks') refreshView();
    });
  }
  async function deleteLook(btn) {
    if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Tap again to delete'; K.haptic(20); setTimeout(() => { if (btn.isConnected) { btn.dataset.sure = ''; btn.textContent = 'Delete look'; } }, 3000); return; }
    await busyBtn(btn, async () => {
      await K.Backend.owner.deleteLook(S2.edit.id);
      [S2.edit.__orig.photo, S2.edit.__orig.before_photo].filter(Boolean).forEach(u => K.Backend.owner.removeMedia(u).catch(() => null));
      S2.edit.__saved = true;
      K.toast('Look deleted', 'ok');
      K.Sheet.close();
      published();
      refreshView();
    });
  }

  /* ---------- Policies & texts ---------- */
  const POLICY = [
    ['Deposit', /deposit/i, 'A $30 deposit secures your spot and goes toward your service.'],
    ['Cancellations', /cancel/i, 'Free to cancel or move up to 24 hours before.'],
    ['Late arrivals', /late/i, 'After 15 minutes we may need to shorten your service.'],
    ['No-shows', /no.?show/i, 'A missed visit without notice is charged the full deposit.']
  ];
  async function textsHTML() {
    const st = need(S2.profile).settings || {};
    const pol = st.policies || [];
    const find = re => (pol.find(p => re.test(p.title)) || {}).text || '';
    S2.edit = { kind: 'texts', aftercare: (st.aftercare || []).map(a => ({ step: a.step || '', text: a.text || '' })) };
    return `
      ${backHTML('texts')}
      <header class="cab-h"><h1>Policies & texts</h1></header>
      <form class="bk-form" id="tx-form" onsubmit="return false">
        <div class="group-label">Policies</div>
        ${POLICY.map(([t, re, ph]) => `<label class="field"><span>${t}</span><textarea name="pol_${t}" rows="2" maxlength="500" placeholder="${esc(ph)}">${esc(find(re))}</textarea></label>`).join('')}
        <div class="group-label">Before your visit</div>
        <label class="field"><span>One tip per line</span><textarea name="prep" rows="4" maxlength="1200" placeholder="Come with clean lashes — no mascara">${esc((st.prep || []).join('\n'))}</textarea></label>
        <div class="group-label">Aftercare</div>
        <div id="ac-list">${aftercareHTML()}</div>
        <button type="button" class="hrs__add" data-ac-add>${icon('<path d="M12 5v14M5 12h14"/>')}Add a step</button>
      </form>
      <button class="btn btn--primary btn--block" data-tx-save>Save texts</button>`;
  }
  function aftercareHTML() {
    return S2.edit.aftercare.map((a, i) => `
      <div class="ac-step card">
        <div class="ac-step__top"><b class="num">${i + 1}</b><button type="button" class="hrs__del" data-ac-del="${i}" aria-label="Remove step">${K.I.x}</button></div>
        <input class="ac-in" data-ac="${i}:step" maxlength="80" value="${esc(a.step)}" placeholder="Keep them dry for 24 hours">
        <textarea class="ac-in" data-ac="${i}:text" rows="2" maxlength="400" placeholder="Why and how">${esc(a.text)}</textarea>
      </div>`).join('') || '<p class="cab-muted">No aftercare steps yet.</p>';
  }
  async function saveTexts(btn) {
    const f = $('#tx-form');
    const st = (S2.profile && S2.profile.settings) || {};
    const known = POLICY.map(p => p[1]);
    const kept = (st.policies || []).filter(p => !known.some(re => re.test(p.title)));
    const policies = POLICY.map(([t]) => ({ title: t, text: f.elements['pol_' + t].value.trim() })).filter(p => p.text).concat(kept);
    const prep = f.elements.prep.value.split('\n').map(x => x.trim()).filter(Boolean).slice(0, 12);
    const aftercare = S2.edit.aftercare.map(a => ({ step: a.step.trim(), text: a.text.trim() })).filter(a => a.step);
    await busyBtn(btn, async () => {
      S2.profile = await K.Backend.owner.saveProfile(S.studio.id, { settings: { policies, prep, aftercare } });
      K.toast('Texts saved', 'ok');
      published();
    });
  }

  /* ---------- Assistant answers (FAQ) ---------- */
  const STOP = new Set('what when where which with your have does about there their this that from will would could should much many how can the and for are you our'.split(' '));
  const autoKeywords = q => [...new Set(String(q).toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !STOP.has(w)))].slice(0, 8);
  async function faqHTML() {
    const st = need(S2.profile).settings || {};
    S2.edit = { kind: 'faq', faq: (st.faq || []).map(f => ({ q: f.q || '', a: f.a || '', extra: (f.keywords || []).filter(k => !autoKeywords(f.q).includes(k)).join(', ') })) };
    return `
      ${backHTML('faq')}
      <header class="cab-h cab-h--row"><h1>Assistant</h1><button class="btn btn--primary btn--sm" data-faq-add>${icon('<path d="M12 5v14M5 12h14"/>')}Add</button></header>
      <p class="cab-muted">The assistant in the Ask tab answers with these. Prices, hours and openings it knows by itself.</p>
      <div id="faq-list">${faqListHTML()}</div>
      <button class="btn btn--primary btn--block" data-faq-save>Save answers</button>`;
  }
  function faqListHTML() {
    return S2.edit.faq.map((f, i) => `
      <div class="ac-step card">
        <div class="ac-step__top"><b>Q${i + 1}</b><button type="button" class="hrs__del" data-faq-del="${i}" aria-label="Remove">${K.I.x}</button></div>
        <input class="ac-in" data-faq="${i}:q" maxlength="140" value="${esc(f.q)}" placeholder="Do you do bottom lashes?">
        <textarea class="ac-in" data-faq="${i}:a" rows="3" maxlength="600" placeholder="The answer clients see">${esc(f.a)}</textarea>
        <input class="ac-in ac-in--sm" data-faq="${i}:extra" maxlength="200" value="${esc(f.extra)}" placeholder="Also answers to (optional): bottom, lower lashes">
      </div>`).join('') || '<div class="cab-empty"><b>No answers yet</b><span>Add the questions clients ask you most.</span></div>';
  }
  async function saveFaq(btn) {
    const faq = S2.edit.faq.filter(f => f.q.trim() && f.a.trim()).map(f => ({
      q: f.q.trim(), a: f.a.trim(),
      keywords: [...new Set(autoKeywords(f.q).concat(f.extra.split(',').map(x => x.trim().toLowerCase()).filter(Boolean)))]
    }));
    await busyBtn(btn, async () => {
      S2.profile = await K.Backend.owner.saveProfile(S.studio.id, { settings: { faq } });
      K.toast('Answers saved', 'ok');
      published();
    });
  }

  /* ---------- CRM: tags, contacts, lash map ---------- */
  const TAGS = ['VIP', 'New', 'Allergy', 'Patch test done'];
  const CURLS = ['J', 'B', 'C', 'CC', 'D', 'L'];
  const THICK = ['0.03', '0.05', '0.07', '0.10', '0.12', '0.15'];
  const TYPES = ['Classic', 'Hybrid', 'Volume', 'Mega volume'];
  const LENGTHS = Array.from({ length: 11 }, (_, i) => i + 6); // 6–16 mm
  // "C · 10–13 · 0.07 Hybrid"
  const formulaLine = f => f ? [f.curl, f.lengths, [f.thickness, f.lash_type].filter(Boolean).join(' ')].filter(Boolean).join(' · ') : '';
  const LASH = '<path d="M3 10c2.5 3 5.5 4.5 9 4.5s6.5-1.5 9-4.5"/><path d="M5.5 12.6 4 15M9 14.2l-.8 2.8M12 14.5V17.5M15 14.2l.8 2.8M18.5 12.6 20 15"/>';
  const TAG_CLS = { VIP: 'vip', New: 'new', Allergy: 'warn', 'Patch test done': 'ok' };
  const tagBadges = (tags, noShows) => {
    const list = (tags || []).map(t => `<em class="ctag ctag--${TAG_CLS[t] || 'x'}">${esc(t === 'Patch test done' ? 'Patch ✓' : t)}</em>`);
    if (noShows >= 2) list.push(`<em class="ctag ctag--warn">${noShows} no-shows</em>`);
    return list.length ? ` <span class="ctags">${list.join('')}</span>` : '';
  };

  // an editor in a sheet closed without saving → its fresh uploads are removed
  document.addEventListener('sheet:closed', () => {
    if (root && S2.edit && ['service', 'look', 'formula'].includes(S2.edit.kind)) cleanupUnsaved();
  });

  function crmHTML(c, formulas) {
    const tags = c.tags || [];
    return `
      <div class="group-label">Tags</div>
      <div class="chips-wrap">${TAGS.map(t => `<button class="chip${tags.includes(t) ? ' is-active' : ''}${t === 'Allergy' ? ' chip--warn' : ''}" data-ctag="${esc(t)}">${esc(t)}</button>`).join('')}</div>
      ${tags.includes('Patch test done') ? `<label class="field"><span>Patch test date</span><input type="date" data-patch-date value="${esc(c.patch_test_at || '')}"></label>` : ''}
      <div class="group-label cab-tlhead"><span>Lash map</span><button class="cab-link" data-fm-new="${esc(c.id)}">${icon('<path d="M12 5v14M5 12h14"/>')}Add</button></div>
      ${formulas.length ? `<div class="list">${formulas.map(f => `
        <button class="row row--link fm-row" data-fm-edit="${esc(f.id)}">
          ${f.photo ? `<img src="${esc(f.photo)}" alt="">` : `<span class="fm-ic">${icon('<path d="M3 10c2.5 3 5.5 4.5 9 4.5s6.5-1.5 9-4.5"/><path d="M5.5 12.6 4 15M9 14.2l-.8 2.8M12 14.5V17.5M15 14.2l.8 2.8M18.5 12.6 20 15"/>')}</span>`}
          <span class="row__label">${esc(formulaLine(f) || 'Formula')}<span class="row__sub">${esc(K.dayLabel(spot(f.created_at).off, false))}${f.glue ? ' · ' + esc(f.glue) : ''}${f.note ? ' · ' + esc(f.note.slice(0, 40)) : ''}</span></span>
          <span class="row__chev">${K.I.chevR}</span>
        </button>`).join('')}</div>` : '<p class="cab-muted">Write down curl, lengths and thickness after each visit — next time it’s right on her booking.</p>'}`;
  }

  async function toggleTag(t) {
    const c = S2.client;
    if (!c) return;
    const tags = (c.tags || []).includes(t) ? c.tags.filter(x => x !== t) : (c.tags || []).concat(t);
    try {
      const r = await K.Backend.owner.saveClient(c.id, { tags });
      S2.client = r.client;
      S2.formulas = r.formulas;
      K.haptic();
      const box = K.$('#crm-box', K.Sheet.el());
      if (box) box.innerHTML = crmHTML(S2.client, S2.formulas);
    } catch (e) { K.toast(err(e), 'x'); }
  }

  function openFormulaEditor(clientId, f, bookingId) {
    const x = f || { curl: '', lengths: '', thickness: '', lash_type: '', glue: localStorage.getItem('studio-app:cab:glue') || '', note: '', photo: '' };
    const [from, to] = String(x.lengths || '').split(/[–-]/).map(n => parseInt(n, 10));
    S2.edit = { kind: 'formula', id: x.id || null, client_id: clientId, booking_id: (f && f.booking_id) || bookingId || null, curl: x.curl, thickness: x.thickness, lash_type: x.lash_type, photo: x.photo || '', __orig: { photo: x.photo || '' } };
    const chips = (name, list, cur) => `<div class="chips-wrap" data-fm-chips="${name}">${list.map(v => `<button type="button" class="chip${v === cur ? ' is-active' : ''}" data-fm-pick="${name}:${esc(v)}">${esc(v)}</button>`).join('')}</div>`;
    const sel = (name, cur) => `<select class="cab-sel cab-sel--wide" name="${name}"><option value="">—</option>${LENGTHS.map(n => `<option value="${n}"${n === cur ? ' selected' : ''}>${n} mm</option>`).join('')}</select>`;
    K.Sheet.open(el => {
      el.innerHTML = `
        <div class="ob" data-sheet-scroll>
          <header class="ob__head"><span class="eyebrow">Lash map</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
          <h2>${esc((S2.client && S2.client.name) || 'Formula')}</h2>
          <form class="bk-form" id="fm-form" onsubmit="return false">
            <div class="field"><span>Curl</span>${chips('curl', CURLS, x.curl)}</div>
            <div class="form-2"><label class="field"><span>Lengths from</span>${sel('len_from', from)}</label><label class="field"><span>to</span>${sel('len_to', to)}</label></div>
            <div class="field"><span>Thickness</span>${chips('thickness', THICK, x.thickness)}</div>
            <div class="field"><span>Type</span>${chips('lash_type', TYPES, x.lash_type)}</div>
            <label class="field"><span>Glue</span><input name="glue" maxlength="60" value="${esc(x.glue || '')}" placeholder="Sky S+"></label>
            <label class="field"><span>Note</span><textarea name="note" rows="2" maxlength="1000" placeholder="Shorter inner corners, sensitive left eye">${esc(x.note || '')}</textarea></label>
            ${photoSlot('photo', x.photo, 'After photo', 'formulas')}
          </form>
          <button class="btn btn--primary btn--block" data-fm-save>Save lash map</button>
          ${x.id ? '<button class="btn btn--soft btn--block ob__danger" data-fm-del>Delete</button>' : ''}
        </div>`;
    }, { detent: 'large' });
  }
  async function saveFormula(btn) {
    const f = K.$('#fm-form', K.Sheet.el());
    const e = S2.edit;
    const a = +f.elements.len_from.value;
    const b = +f.elements.len_to.value;
    const lengths = a && b ? `${Math.min(a, b)}–${Math.max(a, b)}` : a || b ? String(a || b) : '';
    const glue = f.elements.glue.value.trim();
    const p = { id: e.id || undefined, client_id: e.client_id, booking_id: e.booking_id || '', curl: e.curl || '', lengths, thickness: e.thickness || '', lash_type: e.lash_type || '', glue, note: f.elements.note.value.trim(), photo: e.photo || '' };
    if (!p.curl && !lengths && !p.thickness && !p.lash_type && !p.note) { K.toast('Fill in at least one thing', 'x'); return; }
    await busyBtn(btn, async () => {
      await K.Backend.owner.saveFormula(S.studio.id, p);
      try { if (glue) localStorage.setItem('studio-app:cab:glue', glue); } catch (x) { /* private mode */ }
      dropReplaced(e.__orig.photo, e.photo);
      e.__saved = true;
      K.toast('Lash map saved', 'ok');
      syncChanges(true); // "Last time" on her bookings
      const cid = e.client_id;
      openClient(cid);
    });
  }
  async function deleteFormula(btn) {
    if (btn.dataset.sure !== '1') { btn.dataset.sure = '1'; btn.textContent = 'Tap again to delete'; return; }
    await busyBtn(btn, async () => {
      await K.Backend.owner.deleteFormula(S2.edit.id);
      if (S2.edit.__orig.photo) K.Backend.owner.removeMedia(S2.edit.__orig.photo).catch(() => null);
      S2.edit.__saved = true;
      const cid = S2.edit.client_id;
      openClient(cid);
    });
  }

  // edit contacts (name, phone, email) in place
  function openContactEditor() {
    const c = S2.client;
    K.Sheet.open(el => {
      el.innerHTML = `
        <div class="ob" data-sheet-scroll>
          <header class="ob__head"><span class="eyebrow">Contacts</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
          <form class="bk-form" id="ct-form" onsubmit="return false">
            <label class="field"><span>Name</span><input name="name" maxlength="80" value="${esc(c.name)}"></label>
            <label class="field"><span>Phone</span><input name="phone" type="tel" inputmode="tel" value="${esc(K.maskPhone(c.phone))}"></label>
            <label class="field"><span>Email</span><input name="email" type="email" inputmode="email" autocapitalize="off" value="${esc(c.email || '')}"></label>
          </form>
          <button class="btn btn--primary btn--block" data-ct-save>Save</button>
        </div>`;
    }, { detent: 'medium' });
  }
  async function saveContacts(btn) {
    const f = K.$('#ct-form', K.Sheet.el());
    const cid = S2.client.id;
    await busyBtn(btn, async () => {
      await K.Backend.owner.saveClient(cid, { name: f.elements.name.value.trim(), phone: f.elements.phone.value, email: f.elements.email.value.trim() });
      S.clients = null;
      K.toast('Contacts saved', 'ok');
      openClient(cid);
    });
  }

  function onStudioClick(t) {
    let el;
    if ((el = t.closest('[data-pf-save]'))) { saveProfileForm(el); return true; }
    if ((el = t.closest('[data-sty]'))) { S2.edit.style = el.dataset.sty; S2.edit.accent = null; $('#sty-box').innerHTML = styleBoxHTML(); K.haptic(); return true; }
    if ((el = t.closest('[data-sty-acc]'))) { S2.edit.accent = el.dataset.styAcc; $('#sty-box').innerHTML = styleBoxHTML(); K.haptic(); return true; }
    if ((el = t.closest('[data-sty-pv]'))) { S2.edit.pv = el.dataset.styPv; $('#sty-box').innerHTML = styleBoxHTML(); K.haptic(); return true; }
    if ((el = t.closest('[data-sty-save]'))) { saveStyle(el); return true; }
    if ((el = t.closest('[data-svc-new]'))) { openServiceEditor(null); return true; }
    if ((el = t.closest('[data-svc-edit]'))) { openServiceEditor((S2.services || []).find(s => s.id === el.dataset.svcEdit)); return true; }
    if ((el = t.closest('[data-svc-save]'))) { saveService(el); return true; }
    if ((el = t.closest('[data-svc-del]'))) { deleteService(el); return true; }
    if ((el = t.closest('[data-svc-active]'))) { el.setAttribute('aria-checked', el.getAttribute('aria-checked') !== 'true'); K.haptic(); return true; }
    if ((el = t.closest('[data-cat]'))) {
      K.$$('[data-cat-chips] .chip', K.Sheet.el()).forEach(c => c.classList.toggle('is-active', c === el));
      const ci = K.$('[name="category_custom"]', K.Sheet.el());
      if (ci) ci.value = '';
      K.haptic();
      return true;
    }
    if ((el = t.closest('[data-look-new]'))) { openLookEditor(null); return true; }
    if ((el = t.closest('[data-look-edit]'))) { openLookEditor((S2.looks || []).find(l => l.id === el.dataset.lookEdit)); return true; }
    if ((el = t.closest('[data-look-save]'))) { saveLook(el); return true; }
    if ((el = t.closest('[data-look-del]'))) { deleteLook(el); return true; }
    if ((el = t.closest('[data-look-flag]'))) { el.setAttribute('aria-checked', el.getAttribute('aria-checked') !== 'true'); K.haptic(); return true; }
    if ((el = t.closest('[data-tag-pick]'))) { const i = K.$('#look-form [name="tag"]', K.Sheet.el()); if (i) i.value = el.dataset.tagPick; K.haptic(); return true; }
    if ((el = t.closest('[data-phf-pick]'))) {
      if (el.disabled) return true;
      const slot = el.closest('.phf');
      const edit = S2.edit;
      const label = el.textContent;
      pickPhoto(slot.dataset.kind, url => {
        trackUpload(url);
        // the editor may have been closed meanwhile: then the upload is dropped
        if (S2.edit !== edit || !slot.isConnected) { K.Backend.owner.removeMedia(url).catch(() => null); return; }
        edit[slot.dataset.phf] = url;
        setSlot(slot, url);
      }, on => { el.disabled = on; el.innerHTML = on ? K.spinner() : esc(label); slot.classList.toggle('is-busy', on); });
      return true;
    }
    if ((el = t.closest('[data-phf-del]'))) {
      const slot = el.closest('.phf');
      if (S2.edit) S2.edit[slot.dataset.phf] = '';
      setSlot(slot, '');
      K.haptic();
      return true;
    }
    if ((el = t.closest('[data-tx-save]'))) { saveTexts(el); return true; }
    if ((el = t.closest('[data-ac-add]'))) { S2.edit.aftercare.push({ step: '', text: '' }); $('#ac-list').innerHTML = aftercareHTML(); return true; }
    if ((el = t.closest('[data-ac-del]'))) { S2.edit.aftercare.splice(+el.dataset.acDel, 1); $('#ac-list').innerHTML = aftercareHTML(); return true; }
    if ((el = t.closest('[data-faq-add]'))) { S2.edit.faq.push({ q: '', a: '', extra: '' }); $('#faq-list').innerHTML = faqListHTML(); const last = $$('#faq-list [data-faq$=":q"]').pop(); if (last) last.focus(); return true; }
    if ((el = t.closest('[data-faq-del]'))) { S2.edit.faq.splice(+el.dataset.faqDel, 1); $('#faq-list').innerHTML = faqListHTML(); return true; }
    if ((el = t.closest('[data-faq-save]'))) { saveFaq(el); return true; }
    // CRM
    if ((el = t.closest('[data-ctag]'))) { toggleTag(el.dataset.ctag); return true; }
    if ((el = t.closest('[data-ct-edit]'))) { openContactEditor(); return true; }
    if ((el = t.closest('[data-ct-save]'))) { saveContacts(el); return true; }
    if ((el = t.closest('[data-fm-new]'))) {
      const cid = el.dataset.fmNew;
      const bid = el.dataset.booking || null;
      if (bid && ob.b && (!S2.client || S2.client.id !== cid)) S2.client = { id: cid, name: ob.b.client_name };
      openFormulaEditor(cid, null, bid);
      return true;
    }
    if ((el = t.closest('[data-fm-edit]'))) { const f = (S2.formulas || []).find(x => x.id === el.dataset.fmEdit); const cid = S2.client.id; openFormulaEditor(cid, f); return true; }
    if ((el = t.closest('[data-fm-pick]'))) {
      const [name, v] = el.dataset.fmPick.split(':');
      S2.edit[name] = S2.edit[name] === v ? '' : v;
      K.$$(`[data-fm-chips="${name}"] .chip`, K.Sheet.el()).forEach(c => c.classList.toggle('is-active', c.dataset.fmPick === `${name}:${S2.edit[name]}`));
      K.haptic();
      return true;
    }
    if ((el = t.closest('[data-fm-save]'))) { saveFormula(el); return true; }
    // deposits & payments, insights
    if ((el = t.closest('[data-dep-set]'))) { setDeposit(el.dataset.depSet, el); return true; }
    if ((el = t.closest('[data-setup-push]'))) { openPushSheet(); return true; }
    if ((el = t.closest('[data-setup-install]'))) { openInstallHelp(); return true; }
    if ((el = t.closest('[data-setup-installed]'))) {
      K.store.set('installedSeen', true);
      K.Backend.owner.markInstalled(S.studio.id).catch(() => null);
      K.Sheet.close();
      refreshView();
      return true;
    }
    if ((el = t.closest('[data-pr-flag], [data-ly-on]'))) {
      if (S.readonly) { readOnly(); return true; }
      el.setAttribute('aria-checked', el.getAttribute('aria-checked') !== 'true');
      K.haptic();
      return true;
    }
    if ((el = t.closest('[data-pr-save]'))) { savePromo(el); return true; }
    if ((el = t.closest('[data-ly-save]'))) { saveLoyalty(el); return true; }
    if ((el = t.closest('[data-pay-save]'))) { savePayments(el); return true; }
    if ((el = t.closest('[data-ins-per]'))) { S.insPer = el.dataset.insPer; S.insSel = null; K.haptic(); refreshView(); return true; }
    if ((el = t.closest('[data-crew-ins]'))) { S.insStaff = el.dataset.crewIns || null; S.insSel = null; K.haptic(); refreshView(); return true; }
    if ((el = t.closest('[data-pay-copy]'))) { copyText(payoutsText(), 'Payouts copied'); return true; }
    // team
    if ((el = t.closest('[data-crew-kind]'))) { setKind(el.dataset.crewKind); return true; }
    if ((el = t.closest('[data-crew-new]'))) { openCrewEditor(null); return true; }
    if ((el = t.closest('[data-crew-edit]'))) { openCrewEditor(crewById(el.dataset.crewEdit)); return true; }
    if ((el = t.closest('[data-crew-color]'))) {
      S2.edit.color = el.dataset.crewColor;
      K.$$('[data-crew-color]', K.Sheet.el()).forEach(c => c.classList.toggle('is-active', c === el));
      K.haptic();
      return true;
    }
    if ((el = t.closest('[data-crew-save]'))) { saveCrew(el); return true; }
    if ((el = t.closest('[data-crew-copy]'))) { copyText(S.inviteText || '', 'Message copied'); return true; }
    if ((el = t.closest('[data-crew-hours]'))) { S.hrsStaff = el.dataset.crewHours; S.hrs = null; S.hrsDirty = false; S.hsched = null; K.Sheet.close(); go('hours'); return true; }
    if ((el = t.closest('[data-crew-off]'))) { crewOff(el.dataset.crewOff, el); return true; }
    if ((el = t.closest('[data-crew-on]'))) { crewOn(el.dataset.crewOn, el); return true; }
    if ((el = t.closest('[data-crew-move]'))) { crewMove(el.dataset.crewMove, el); return true; }
    if ((el = t.closest('[data-crew-cx]'))) { crewCancel(el.dataset.crewCx, el); return true; }
    if ((el = t.closest('[data-svc-who]'))) { el.classList.toggle('is-active'); K.haptic(); return true; }
    if ((el = t.closest('[data-ins-bar]'))) {
      S.insSel = +el.dataset.insBar;
      $$('[data-ins-bar]').forEach(x => x.classList.toggle('is-sel', x === el));
      const cap = $('#ins-cap');
      if (cap && S.ins) cap.innerHTML = insCaption(S.ins, S.insSel);
      K.haptic(5);
      return true;
    }
    if ((el = t.closest('[data-fm-del]'))) { deleteFormula(el); return true; }
    return false;
  }

  /* ---------- Promo banner (off until she turns it on) ---------- */
  function promoHTML() {
    const pr = (need(S2.profile).settings || {}).promo || {};
    return `
      ${backHTML('promo')}
      <header class="cab-h"><h1>Promo banner</h1></header>
      <p class="cab-muted">A card on your Home page that opens booking. Off by default.</p>
      <form class="bk-form" id="pr-form" onsubmit="return false">
        <div class="row hrs-switch"><span class="row__label">Show the banner</span><button type="button" class="switch" role="switch" aria-checked="${!!pr.on}" data-pr-flag="on"></button></div>
        <label class="field"><span>Badge</span><input name="badge" maxlength="24" value="${esc(pr.badge || '')}" placeholder="NEW CLIENT −15%"></label>
        <label class="field"><span>Title</span><input name="title" maxlength="60" value="${esc(pr.title || '')}" placeholder="Your first set, a little sweeter"></label>
        <label class="field"><span>Text</span><textarea name="text" rows="2" maxlength="160" placeholder="Take 15% off any full set on your first visit.">${esc(pr.text || '')}</textarea></label>
        <div class="row hrs-switch"><span class="row__label">New clients only<span class="row__sub">Hidden for anyone who has booked from her phone before</span></span><button type="button" class="switch" role="switch" aria-checked="${pr.newOnly !== false}" data-pr-flag="newOnly"></button></div>
      </form>
      <button class="btn btn--primary btn--block" data-pr-save>Save banner</button>
      <p class="cab-muted">The discount isn’t applied automatically — honor it at checkout.</p>`;
  }
  async function savePromo(btn) {
    const f = $('#pr-form');
    const flag = k => $(`[data-pr-flag="${k}"]`).getAttribute('aria-checked') === 'true';
    const promo = { on: flag('on'), newOnly: flag('newOnly'), badge: f.elements.badge.value.trim(), title: f.elements.title.value.trim(), text: f.elements.text.value.trim() };
    if (promo.on && !promo.title && !promo.text) { K.toast('Add a title or a text', 'x'); return; }
    await busyBtn(btn, async () => {
      S2.profile = await K.Backend.owner.saveProfile(S.studio.id, { settings: { promo } });
      K.toast(promo.on ? 'Banner is on' : 'Banner is off', 'ok');
      published();
    });
  }

  /* ---------- Loyalty card: stamps from real completed visits ---------- */
  function loyaltyEditHTML() {
    const ly = (need(S2.profile).settings || {}).loyalty || {};
    const total = +ly.total || 6;
    return `
      ${backHTML('loyalty')}
      <header class="cab-h"><h1>Loyalty card</h1></header>
      <p class="cab-muted">Each completed visit is a stamp. Clients see their card after their first booking — counted by their phone number.</p>
      <form class="bk-form" id="ly-form" onsubmit="return false">
        <div class="row hrs-switch"><span class="row__label">Loyalty card</span><button type="button" class="switch" role="switch" aria-checked="${!!ly.on}" data-ly-on></button></div>
        <label class="field"><span>Reward on visit number</span><select class="cab-sel cab-sel--wide" name="total">${[4, 5, 6, 8, 10, 12].map(n => `<option value="${n}"${n === total ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <label class="field"><span>Reward</span><input name="reward" maxlength="60" value="${esc(ly.reward || '')}" placeholder="50% off your fill"></label>
      </form>
      <button class="btn btn--primary btn--block" data-ly-save>Save loyalty card</button>`;
  }
  async function saveLoyalty(btn) {
    const f = $('#ly-form');
    const loyalty = { on: $('[data-ly-on]').getAttribute('aria-checked') === 'true', total: +f.elements.total.value, reward: f.elements.reward.value.trim() };
    if (loyalty.on && !loyalty.reward) { K.toast('Say what the reward is', 'x'); return; }
    await busyBtn(btn, async () => {
      S2.profile = await K.Backend.owner.saveProfile(S.studio.id, { settings: { loyalty } });
      K.toast(loyalty.on ? 'Loyalty card is on' : 'Loyalty card is off', 'ok');
      published();
    });
  }

  /* ---------- Read-only (the platform admin looking at a studio) ---------- */
  const RO_BLOCK = ['[data-crew-kind]', '[data-crew-new]', '[data-crew-save]', '[data-crew-off]', '[data-crew-on]', '[data-crew-move]', '[data-crew-cx]',
    '[data-pf-save]', '[data-sty-save]', '[data-sty]', '[data-sty-acc]', '[data-svc-new]', '[data-svc-save]', '[data-svc-del]',
    '[data-look-new]', '[data-look-save]', '[data-look-del]', '[data-tx-save]', '[data-faq-save]', '[data-faq-add]', '[data-pay-save]',
    '[data-pr-save]', '[data-ly-save]', '[data-hrs-save]', '[data-hrs-toggle]', '[data-hrs-add]', '[data-hrs-del]', '[data-toff-add]',
    '[data-toff-del]', '[data-rule-auto]', '[data-ob-set]', '[data-ob-cancel]', '[data-ob-move]', '[data-dep-set]', '[data-req-yes]',
    '[data-req-no]', '[data-cab-new]', '[data-cab-new-at]', '[data-cab-new-for]', '[data-fm-new]', '[data-fm-save]', '[data-fm-del]',
    '[data-ct-edit]', '[data-ct-save]', '[data-ctag]', '[data-cl-save]', '[data-phf-pick]', '[data-phf-del]', '[data-push-on]',
    '[data-push-off]', '[data-push-test]', '[data-pw-save]', '[data-drag]', '[data-setup-push]', '[data-setup-installed]'].join(',');
  let roToast = 0;
  function readOnly() {
    if (Date.now() - roToast < 1500) return;
    roToast = Date.now();
    K.toast('Read only — this is the admin view', 'x');
  }

  /* ---------- "Finish setting up" (Today) — until everything is in place ---------- */
  async function loadSetup() {
    if (K.store.get('setupDone')) return;
    if (isStandalone() && !S.readonly) {
      K.store.set('installedSeen', true);
      // tell the admin's list too (once per device)
      if (!K.store.get('installedSent')) K.Backend.owner.markInstalled(S.studio.id).then(() => K.store.set('installedSent', true)).catch(() => null);
    }
    // each part on its own: one slow answer never hides the whole card
    await Promise.all([
      loadProfile(true).catch(() => null), loadServices(true).catch(() => null), loadLooks(true).catch(() => null),
      S.readonly ? null : memLoad('push', () => K.Backend.owner.pushDevices(S.studio.id)).catch(() => null)
    ]);
    // Today was drawn before these arrived: put the card in now
    if (S.tab === 'today') repaint();
  }
  function setupItems() {
    const p = S2.profile;
    const svcs = S2.services;
    const looks = S2.looks;
    if (!p || !svcs || !looks) return null;
    const st = p.settings || {};
    const active = svcs.filter(s => s.active);
    return [
      { label: 'Cover and profile photo', done: !!(st.heroPhoto && st.avatar), attr: 'data-cab-tab="profile"' },
      { label: 'A photo on every service', done: active.length > 0 && active.every(s => s.photo), attr: 'data-cab-tab="services"' },
      { label: 'Working hours', done: ((S.sched && S.sched.hours) || []).length > 0, attr: 'data-cab-tab="hours"' },
      { label: 'Payments & deposits', done: takesDeposits(st), attr: 'data-cab-tab="payments"' },
      { label: 'Policies for clients', done: (st.policies || []).some(x => x && String(x.text || '').trim()), attr: 'data-cab-tab="texts"' },
      { label: 'At least 3 looks', done: looks.length >= 3, attr: 'data-cab-tab="looks"' },
      { label: 'Notifications on', done: (MEM.push || []).length > 0 || (S.push && S.push.state === 'on'), attr: 'data-setup-push' },
      { label: 'App on your Home Screen', done: isStandalone() || !!K.store.get('installedSeen') || !!S.studio.app_installed, attr: 'data-setup-install' }
    ];
  }
  function setupHTML() {
    if (isStaff() || K.store.get('setupDone')) return '';
    const items = setupItems();
    if (!items) return '';
    const n = items.filter(x => x.done).length;
    if (n === items.length) { K.store.set('setupDone', true); return ''; }
    return `
      <section class="card setup">
        <div class="setup__top"><b>Finish setting up</b><span class="num">${n} of ${items.length}</span></div>
        <span class="setup__bar"><i style="width:${Math.round((n / items.length) * 100)}%"></i></span>
        <div class="setup__list">${items.map(x => `
          <button class="setup__row${x.done ? ' is-done' : ''}" ${x.attr}>
            <i class="setup__chk">${x.done ? K.I.check : ''}</i><span>${esc(x.label)}</span>${x.done ? '' : K.I.chevR}
          </button>`).join('')}</div>
      </section>`;
  }
  // "Notifications on" in the checklist: the same controls as the Today card, in a sheet
  async function openPushSheet() {
    K.Sheet.open(el => {
      el.innerHTML = `
        <div class="ob" data-sheet-scroll>
          <header class="ob__head"><span class="eyebrow">Notifications</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
          <div id="cab-push-sheet"><div class="cab-load"><i class="spin"></i></div></div>
        </div>`;
    }, { detent: 'medium' });
    paintPush();
  }
  function openInstallHelp() {
    K.Sheet.open(el => {
      el.innerHTML = `
        <div class="ob" data-sheet-scroll>
          <header class="ob__head"><span class="eyebrow">Home Screen</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
          <h2>Put ${esc(K.data.name)} on your Home Screen</h2>
          <p class="ob__sub">It opens straight into this dashboard, like an app — and on iPhone that’s where notifications work.</p>
          <ol class="a2hs__steps">${K.IS_IOS ? `
            <li>Open this page in <b>Safari</b></li>
            <li>Tap <b>Share</b> ${icon('<path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M6 11v8.5h12V11"/>')}</li>
            <li>Choose <b>Add to Home Screen</b> → <b>Add</b></li>` : `
            <li>Open the browser menu <b>⋮</b></li>
            <li>Choose <b>Install app</b> or <b>Add to Home screen</b></li>`}
            <li>Open it from your Home Screen</li>
          </ol>
          <button class="btn btn--soft btn--block" data-setup-installed>It’s on my Home Screen</button>
        </div>`;
    }, { detent: 'medium' });
  }
  const takesDeposits = st => Object.values((st && st.payments) || {}).some(v => String(v || '').trim());
  // deposits set on services while there is no way to pay them
  function depositWarnHTML() {
    const p = S2.profile;
    const svcs = S2.services;
    if (!p || !svcs || takesDeposits(p.settings)) return '';
    const n = svcs.filter(s => s.active && +s.deposit > 0).length;
    if (!n) return '';
    return `
      <div class="card dep-warn">
        <span><b>Deposits are set on ${n} service${n > 1 ? 's' : ''}, but payments are off</b><small>Clients aren’t asked for them until you add a way to get paid.</small></span>
        <button class="btn btn--primary btn--sm" data-cab-tab="payments">Turn on</button>
      </div>`;
  }

  /* ---------- Deposits: what she sees and does ---------- */
  const whenAt = iso => `${K.dayLabel(spot(iso).off, false)} ${K.fmtClock(spot(iso).min)}`;
  function obDepositHTML(b) {
    if (!(+b.deposit > 0) || b.deposit_status === 'none') return '';
    const live = isActive(b);
    const sub = {
      pending: b.deposit_due_at ? `Not received yet · auto-cancels ${whenAt(b.deposit_due_at)} if it doesn’t arrive` : 'Not received yet',
      paid: `Received${b.deposit_paid_at ? ' ' + ago(b.deposit_paid_at) : ''}`,
      waived: 'Not needed for this visit',
      expired: 'Never arrived — the booking was released'
    }[b.deposit_status] || '';
    return `
      <div class="card ob-dep ob-dep--${b.deposit_status}">
        <div class="ob-dep__top"><span class="ob-dep__ic">${icon('<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10.5h18M7 15h4"/>')}</span>
          <span><b>Deposit ${money(b.deposit)}</b><small>${esc(sub)}</small></span></div>
        ${b.deposit_status === 'pending' && live && !isStaff() ? `
        <button class="btn btn--primary btn--block" data-dep-set="paid">${K.I.check}Mark deposit received</button>
        <button class="cab-link" data-dep-set="waived">Not needed this time</button>` : ''}
        ${(b.deposit_status === 'paid' || b.deposit_status === 'waived') && live && !isStaff() ? '<button class="cab-link" data-dep-set="pending">Undo</button>' : ''}
      </div>`;
  }
  async function setDeposit(status, btn) {
    const b = ob.b;
    if (!b) return;
    await busyBtn(btn, async () => {
      const r = await K.Backend.owner.setDeposit(b.id, status);
      ob.b = Object.assign({}, b, r);
      patchKnown(b.id, r);
      K.toast({ paid: 'Deposit received — her booking says Confirmed', waived: 'No deposit needed for this visit', pending: 'Back to waiting for the deposit' }[status], 'ok');
      renderOb();
      refreshView();
    });
  }
  function depositsWaitingHTML() {
    if (isStaff()) return ''; // payments are the owner's
    const list = [...(S.known || new Map()).values()]
      .filter(b => isActive(b) && b.deposit_status === 'pending' && Date.parse(b.start_at) > Date.now())
      .sort((a, z) => Date.parse(a.start_at) - Date.parse(z.start_at));
    if (!list.length) return '';
    return `
      <div class="group-label">Awaiting deposit</div>
      <div class="list">${list.slice(0, 6).map(b => `
        <button class="row row--link" data-cab-b="${esc(b.id)}">
          <span class="row__label">${esc(b.client_name || 'Client')}<span class="row__sub num">${esc(b.service_name)} · ${esc(whenLine(b))}</span></span>
          <span class="bstat bstat--deposit num">${money(b.deposit)}</span>
          <span class="row__chev">${K.I.chevR}</span>
        </button>`).join('')}</div>`;
  }

  /* ---------- Payments & deposits ---------- */
  const PAY_FIELDS = [
    ['cashapp', 'Cash App $cashtag', '$yourstudio'],
    ['zelle', 'Zelle — email or phone', 'you@studio.com'],
    ['venmo', 'Venmo username', '@yourstudio'],
    ['paypal', 'PayPal.me', 'paypal.me/yourstudio'],
    ['square', 'Square payment link', 'https://square.link/u/…']
  ];
  async function paymentsHTML() {
    const p = need(S2.profile);
    const sch = need(S.sched);
    const pay = (p.settings || {}).payments || {};
    const r = sch.rules || {};
    const sel = (name, value, opts, fmt) => `<select class="cab-sel" data-rule="${name}">${opts.map(o => `<option value="${o}"${+o === +value ? ' selected' : ''}>${fmt(o)}</option>`).join('')}</select>`;
    return `
      ${backHTML('payments')}
      <header class="cab-h"><h1>Payments & deposits</h1></header>
      <p class="cab-muted">Clients send deposits straight to you — we never touch the money. Add at least one way to get paid and every service with a deposit asks for it after booking.</p>
      <form class="bk-form" id="pay-form" onsubmit="return false">
        ${PAY_FIELDS.map(([k, label, ph]) => `<label class="field"><span>${esc(label)}</span><input name="${k}" maxlength="${k === 'square' ? 300 : 80}" value="${esc(pay[k] || '')}" placeholder="${esc(ph)}" autocapitalize="off" spellcheck="false"${k === 'square' ? ' type="url" inputmode="url"' : k === 'zelle' ? ' inputmode="email"' : ''}></label>`).join('')}
      </form>
      <button class="btn btn--primary btn--block" data-pay-save>Save payment details</button>
      <div class="group-label">Deposit rules</div>
      <div class="list">
        <div class="row"><span class="row__label">Time to pay<span class="row__sub">Not received by then → the booking is cancelled, the time freed and you get a notification</span></span>
          ${sel('deposit_hold_hours', r.deposit_hold_hours, [0, 1, 2, 4, 6, 12, 24, 48], h => (h ? h + ' h' : 'No limit'))}</div>
        <div class="row"><span class="row__label">After 2 no-shows<span class="row__sub">That client pays a deposit on every booking, even for services without one</span></span>
          ${sel('noshow_deposit', r.noshow_deposit, [10, 20, 25, 30, 40, 50, 75, 100], v => money(v))}</div>
      </div>
      <p class="cab-muted">The deposit for each service is set in Services.</p>`;
  }
  async function savePayments(btn) {
    const f = $('#pay-form');
    const v = n => f.elements[n].value.trim();
    const pay = {
      cashapp: v('cashapp').replace(/^\$/, '').replace(/^https?:\/\/(www\.)?cash\.app\/\$?/i, '').replace(/[/?#].*$/, ''),
      zelle: v('zelle'),
      venmo: v('venmo').replace(/^@/, '').replace(/^https?:\/\/(www\.)?venmo\.com\/(u\/)?/i, '').replace(/[/?#].*$/, ''),
      paypal: v('paypal').replace(/^(https?:\/\/)?(www\.)?paypal\.me\//i, '').replace(/[/?#].*$/, ''),
      square: v('square')
    };
    if (pay.square && !/^https:\/\//i.test(pay.square)) { K.toast('The Square link should start with https://', 'x'); return; }
    if (pay.cashapp && !/^[A-Za-z][\w-]{0,30}$/.test(pay.cashapp)) { K.toast('Check the $cashtag', 'x'); return; }
    Object.keys(pay).forEach(k => { if (!pay[k]) delete pay[k]; });
    if (pay.cashapp) pay.cashapp = '$' + pay.cashapp;
    if (pay.venmo) pay.venmo = '@' + pay.venmo;
    await busyBtn(btn, async () => {
      S2.profile = await K.Backend.owner.saveProfile(S.studio.id, { settings: { payments: Object.keys(pay).length ? pay : null } });
      K.toast(Object.keys(pay).length ? 'Saved — deposits are on' : 'Saved — no online deposits', 'ok');
      published();
      S.dirty = false;
      refreshView();
    });
  }

  /* ---------- INSIGHTS (from the real bookings) ---------- */
  const MON3 = i => String(K.MONTHS[i]).slice(0, 3);
  const insLabel = (iso, per, long) => {
    const [y, m, d] = iso.split('-').map(Number);
    return per === 'month' ? (long ? `${K.MONTHS[m - 1]} ${y}` : MON3(m - 1)) : `${long ? 'Week of ' : ''}${MON3(m - 1)} ${d}`;
  };
  function insCaption(d, i) {
    const s = d.series[i];
    if (!s) return '';
    return `<b>${esc(insLabel(s.start, d.period, true))}</b><span class="num">${money(s.revenue)} earned${+s.expected ? ' · ' + money(s.expected) + ' booked ahead' : ''} · ${s.bookings} booking${s.bookings === 1 ? '' : 's'}${s.no_shows ? ' · ' + s.no_shows + ' no-show' + (s.no_shows > 1 ? 's' : '') : ''}</span>`;
  }
  // payouts by commission for a period (owner of a salon)
  const ymd = off => { const d = K.studioDate(off); return `${d.year}-${String(d.month + 1).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`; };
  function payRange() {
    if (!S.payFrom) { const d = K.studioDate(0); S.payFrom = `${d.year}-${String(d.month + 1).padStart(2, '0')}-01`; S.payTo = ymd(0); }
    return [S.payFrom, S.payTo];
  }
  async function loadPayouts() {
    const [a, z] = payRange();
    MEM['pay:' + a + ':' + z] = await K.Backend.owner.payouts(S.studio.id, a, z);
  }
  const fmtYmd = s => { const [y, m, d] = s.split('-').map(Number); return `${MON3(m - 1)} ${d}, ${y}`; };
  function payoutsText() {
    const [a, z] = payRange();
    const list = MEM['pay:' + a + ':' + z] || [];
    const total = list.reduce((s, x) => s + (+x.payout || 0), 0);
    return [
      `Payouts · ${S.studio.name}`,
      `${fmtYmd(a)} – ${fmtYmd(z)} · completed visits`,
      '',
      ...list.map(x => `${x.name}${x.is_owner ? ' (owner)' : ''} — ${x.visits} visit${x.visits === 1 ? '' : 's'} · ${money(x.revenue)} · ${+x.commission_pct}% → ${money(x.payout)}`),
      '',
      `Total to masters: ${money(total)}`
    ].join('\n');
  }
  function crewInsightsHTML(d) {
    const rows = d.staff || [];
    if (!rows.length) return '';
    const [a, z] = payRange();
    const pay = MEM['pay:' + a + ':' + z];
    return `
      <div class="group-label">By master</div>
      <div class="card crew-ins">
        <div class="crew-ins__row crew-ins__row--h"><span></span><span>Revenue</span><span>Visits</span><span>Load</span><span>Return</span><span>No-show</span></div>
        ${rows.map(x => `
        <div class="crew-ins__row${x.active ? '' : ' is-off'}">
          <span class="crew-ins__name">${crewDot(x.color)}${esc(firstOf(x.name))}</span>
          <span class="num">${money(x.revenue)}</span>
          <span class="num">${x.bookings}</span>
          <span class="num">${+x.open_min ? Math.round((+x.booked_min / +x.open_min) * 100) + '%' : '—'}</span>
          <span class="num">${x.returning}/${x.clients}</span>
          <span class="num${x.no_shows ? ' is-bad' : ''}">${x.no_shows}</span>
        </div>`).join('')}
      </div>
      <p class="cab-muted">Last 12 ${d.period === 'month' ? 'months' : 'weeks'}. Load = booked time out of her working hours.</p>
      <div class="group-label">Payouts</div>
      <div class="card crew-pay">
        <div class="form-2">
          <label class="field"><span>From</span><input type="date" data-pay-from value="${esc(a)}"></label>
          <label class="field"><span>To</span><input type="date" data-pay-to value="${esc(z)}"></label>
        </div>
        ${pay ? `
        <div class="list crew-pay__list">${pay.map(x => `
          <div class="row"><span class="row__label">${esc(x.name)}<span class="row__sub num">${x.visits} visit${x.visits === 1 ? '' : 's'} · ${money(x.revenue)} · ${+x.commission_pct}%</span></span><span class="row__value num">${money(x.payout)}</span></div>`).join('') || '<div class="row"><span class="row__label cab-muted">No completed visits</span></div>'}</div>
        <div class="crew-pay__total"><span>Total to masters</span><b class="num">${money(pay.reduce((s, x) => s + (+x.payout || 0), 0))}</b></div>
        <button class="btn btn--soft btn--block" data-pay-copy>Copy as text</button>` : '<div class="cab-load"><i class="spin"></i></div>'}
      </div>`;
  }

  async function insightsHTML() {
    const per = S.insPer || 'week';
    const d = need(MEM[insKey()]);
    S.ins = d;
    const t = d.totals;
    const ser = d.series || [];
    const sel = S.insSel != null ? S.insSel : ser.length - 1;
    const max = Math.max(1, ...ser.map(s => +s.revenue + +s.expected));
    const seen = t.completed + t.no_shows;
    const nsRate = seen ? Math.round((t.no_shows / seen) * 100) : 0;
    const top = d.top_services || [];
    const topMax = Math.max(1, ...top.map(s => s.n));
    const cl = d.clients || { new: 0, returning: 0 };
    const clAll = cl.new + cl.returning;
    const order = [1, 2, 3, 4, 5, 6, 0];
    const wd = d.weekday || [];
    const wdMax = Math.max(1, ...wd);
    const kpi = (v, l, bad) => `<div class="${bad ? 'is-bad' : ''}"><b class="num">${v}</b><small>${l}</small></div>`;
    return `
      <header class="cab-h cab-h--row"><h1>Insights</h1>
        <div class="segmented ins-seg" role="radiogroup" style="--n:2;--idx:${per === 'month' ? 1 : 0}"><i class="segmented__thumb"></i>
          <button role="radio" data-ins-per="week" aria-checked="${per === 'week'}">Weeks</button><button role="radio" data-ins-per="month" aria-checked="${per === 'month'}">Months</button></div>
      </header>
      ${teamView() && S.team && crew().length > 1 ? crewChipsHTML('data-crew-ins', S.insStaff) : ''}
      <p class="cab-muted">Last 12 ${per === 'month' ? 'months' : 'weeks'} · ${isStaff() ? 'your own bookings' : S.insStaff && crewById(S.insStaff) ? esc(firstOf(crewById(S.insStaff).name)) + '’s bookings' : isTeam() ? 'the whole studio' : 'from your bookings'}</p>
      <div class="ins-kpi card">
        ${kpi(money(t.revenue), 'Revenue')}
        ${kpi(t.bookings, 'Bookings')}
        ${kpi(nsRate + '%', 'No-show rate', nsRate >= 10)}
        ${kpi(t.late_cancels, 'Late cancels', t.late_cancels > 0)}
      </div>
      <div class="card ins-chart">
        <div class="ins-cap" id="ins-cap">${insCaption(d, sel)}</div>
        <div class="ins-bars" role="list">${ser.map((s, i) => `
          <button class="ins-bar${i === sel ? ' is-sel' : ''}" data-ins-bar="${i}" role="listitem" aria-label="${esc(insLabel(s.start, per, true))}: ${money(s.revenue)}">
            <span class="ins-bar__col"><i class="ins-bar__exp" style="height:${((+s.expected / max) * 100).toFixed(1)}%"></i><i class="ins-bar__rev" style="height:${((+s.revenue / max) * 100).toFixed(1)}%"></i></span>
            <small>${i % (per === 'month' ? 2 : 3) === (ser.length - 1) % (per === 'month' ? 2 : 3) ? esc(insLabel(s.start, per)) : ''}</small>
          </button>`).join('')}</div>
        <div class="ins-legend"><span><i class="ins-dot"></i>Earned</span><span><i class="ins-dot ins-dot--exp"></i>Booked ahead</span></div>
      </div>
      <div class="group-label">Cancellations & no-shows</div>
      <div class="list">
        <div class="row"><span class="row__label">Cancelled by clients<span class="row__sub">${t.late_cancels} late (inside your free-cancellation window)</span></span><span class="row__value num">${t.cancels}</span></div>
        <div class="row"><span class="row__label">Cancelled by you</span><span class="row__value num">${t.studio_cancels - t.deposit_expired}</span></div>
        <div class="row"><span class="row__label">Released — deposit not received</span><span class="row__value num">${t.deposit_expired}</span></div>
        <div class="row"><span class="row__label">No-shows<span class="row__sub">${nsRate}% of visits that were due</span></span><span class="row__value num">${t.no_shows}</span></div>
        ${+t.deposits_paid ? `<div class="row"><span class="row__label">Deposits received</span><span class="row__value num">${money(t.deposits_paid)}</span></div>` : ''}
      </div>
      <div class="group-label">Top services</div>
      <div class="list ins-top">${top.length ? top.map(s => `
        <div class="row row--stack">
          <div class="row__head"><span class="row__label">${esc(s.name)}</span><span class="row__value num">${s.n} · ${money(s.revenue)}</span></div>
          <span class="ins-meter"><i style="width:${((s.n / topMax) * 100).toFixed(1)}%"></i></span>
        </div>`).join('') : '<div class="row"><span class="row__label cab-muted">No bookings yet</span></div>'}</div>
      <div class="group-label">Clients</div>
      <div class="card ins-cl">
        <div class="ins-split">${clAll ? `<i class="ins-split__new" style="flex:${cl.new}"></i><i class="ins-split__ret" style="flex:${cl.returning}"></i>` : '<i class="ins-split__none"></i>'}</div>
        <div class="ins-legend"><span><i class="ins-dot"></i>New · <b class="num">${cl.new}</b></span><span><i class="ins-dot ins-dot--ret"></i>Returning · <b class="num">${cl.returning}</b></span></div>
      </div>
      <div class="group-label">Busiest days</div>
      <div class="card ins-wd">${order.map(i => `
        <div class="ins-wd__d"><span class="ins-wd__col"><i style="height:${(((wd[i] || 0) / wdMax) * 100).toFixed(1)}%"></i></span><b class="num">${wd[i] || 0}</b><small>${K.DAY_NAMES[i].slice(0, 3)}</small></div>`).join('')}</div>
      ${teamView() && !S.insStaff ? crewInsightsHTML(d) : ''}`;
  }

  function onStudioInput(t) {
    if (t.dataset && t.dataset.ac) { const [i, k] = t.dataset.ac.split(':'); S2.edit.aftercare[+i][k] = t.value; return true; }
    if (t.dataset && t.dataset.faq) { const [i, k] = t.dataset.faq.split(':'); S2.edit.faq[+i][k] = t.value; return true; }
    if (t.matches && t.matches('[name="category_custom"]') && t.value) { K.$$('[data-cat-chips] .chip', K.Sheet.el()).forEach(c => c.classList.remove('is-active')); return true; }
    return false;
  }
  async function onStudioChange(t) {
    if (t.matches && t.matches('[data-patch-date]') && S2.client) {
      try { const r = await K.Backend.owner.saveClient(S2.client.id, { patch_test_at: t.value }); S2.client = r.client; K.toast('Patch test date saved', 'ok'); } catch (e) { K.toast(err(e), 'x'); }
      return true;
    }
    return false;
  }

  /* =========================================================
     Push notifications (Web Push) — this device
     States: install (iPhone in Safari) · off · on · blocked · unsupported
     Permission is asked only when she taps "Turn on notifications".
     ========================================================= */
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushApi = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64uToU8 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  function deviceLabel() {
    const ua = navigator.userAgent;
    const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad|Macintosh.*Mobile/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
      : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'This device';
    const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /Firefox|FxiOS/.test(ua) ? 'Firefox' : /Safari/.test(ua) ? 'Safari' : '';
    return dev + (isStandalone() ? ' · app' : br ? ' · ' + br : '');
  }

  async function pushState() {
    if (!K.Backend.vapidPublicKey) return { state: 'nokey' };
    if (K.IS_IOS && !isStandalone()) return { state: 'install' };
    if (!pushApi()) return { state: 'unsupported' };
    if (Notification.permission === 'denied') return { state: 'blocked' };
    const reg = await withTimeout(navigator.serviceWorker.ready, 5000);
    const sub = await reg.pushManager.getSubscription();
    if (sub && Notification.permission === 'granted') return { state: 'on', sub };
    return { state: 'off' };
  }

  async function paintPush() {
    const sheetBox = K.Sheet.isOpen() && K.$('#cab-push-sheet', K.Sheet.el());
    if (!$('#cab-push') && !sheetBox) return;
    let st;
    try { st = await pushState(); } catch (e) { st = { state: 'unsupported' }; }
    S.push = st;
    if (S.readonly) st = { state: 'nokey' };
    if (st.state === 'on' && !S.readonly) {
      saveSub(st.sub, true); // keep the server copy fresh
      if (!(MEM.push || []).length) { MEM.push = [{ device_label: deviceLabel() }]; if (S.tab === 'today') repaint(); }
    }
    // while "Finish setting up" is on Today it carries the notifications step — no second card
    const b2 = $('#cab-push');
    if (b2) b2.innerHTML = $('.setup') ? '' : pushCardHTML(st);
    const b3 = K.Sheet.isOpen() && K.$('#cab-push-sheet', K.Sheet.el());
    if (b3) b3.innerHTML = pushCardHTML(st) || '<p class="cab-muted">Notifications aren’t set up for this app yet.</p>';
  }

  const BELL = '<path d="M6 9.5a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4s2-1.5 2-6.5z"/><path d="M10 19.5a2 2 0 0 0 4 0"/>';
  function pushCardHTML(st) {
    const appName = esc(K.data.name);
    switch (st.state) {
      case 'nokey': return '';
      case 'on': return `
        <div class="card push push--on">
          <div class="push__row"><i class="push__dot"></i><span><b>Notifications on</b><small>${esc(deviceLabel())} · new bookings, requests, cancellations</small></span></div>
          <div class="push__actions">
            <button class="btn btn--soft btn--sm" data-push-test>${icon(BELL)}Send test notification</button>
            <button class="cab-link" data-push-off>Turn off</button>
          </div>
        </div>`;
      case 'install': return `
        <div class="card push">
          <div class="push__head"><span class="push__ic">${icon(BELL)}</span><b>Get notified about bookings</b></div>
          <p>On iPhone, notifications work in the installed app. <b>Add the app to your Home Screen first</b>, then open it from there and turn them on here.</p>
          <div class="a2hs" aria-hidden="true">
            <div class="a2hs__screen">
              <div class="a2hs__sheet"><span class="a2hs__item">${icon('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8v8M8 12h8"/>')}Add to Home Screen</span></div>
              <div class="a2hs__bar"><i></i><span class="a2hs__share">${icon('<path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M6 11v8.5h12V11"/>')}</span><i></i><i></i></div>
              <span class="a2hs__finger"></span>
            </div>
          </div>
          <ol class="a2hs__steps">
            <li>Tap <b>Share</b> ${icon('<path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M6 11v8.5h12V11"/>')} in Safari</li>
            <li>Choose <b>Add to Home Screen</b></li>
            <li>Open <b>${appName}</b> from your Home Screen</li>
          </ol>
        </div>`;
      case 'blocked': return `
        <div class="card push push--blocked">
          <div class="push__head"><span class="push__ic">${icon(BELL)}</span><b>Notifications are blocked</b></div>
          <p>${K.IS_IOS
            ? `Open <b>Settings → Notifications → ${appName}</b> and turn on <b>Allow Notifications</b>, then come back here.`
            : /Android/.test(navigator.userAgent)
              ? 'Tap <b>⋮ → Settings → Site settings → Notifications</b> and allow this site — or tap the lock icon next to the address.'
              : 'Click the <b>lock icon</b> next to the address → <b>Notifications → Allow</b>, then reload the page.'}</p>
          <button class="btn btn--soft btn--sm" data-push-recheck>I’ve turned them on</button>
        </div>`;
      case 'unsupported': return `
        <div class="card push push--muted">
          <div class="push__head"><span class="push__ic">${icon(BELL)}</span><b>Notifications aren’t available here</b></div>
          <p>Use the installed app on iPhone (iOS 16.4 or newer), or Chrome, Edge or Safari on Android and computers.</p>
        </div>`;
      default: return `
        <div class="card push">
          <div class="push__head"><span class="push__ic">${icon(BELL)}</span><b>Get notified about bookings</b></div>
          <p>New bookings, requests and cancellations — the moment they happen, even when the app is closed.</p>
          <button class="btn btn--primary btn--block" data-push-on>Turn on notifications</button>
        </div>`;
    }
  }

  async function saveSub(sub, quiet) {
    try {
      await K.Backend.owner.pushSubscribe(S.studio.id, sub.toJSON(), deviceLabel());
      return true;
    } catch (e) {
      if (!quiet) K.toast(err(e), 'x');
      return false;
    }
  }

  // called straight from the tap: the permission prompt needs that gesture
  async function pushOn(btn) {
    if (!pushApi()) { paintPush(); return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      if (perm === 'denied') K.toast('Notifications are blocked', 'x');
      paintPush();
      return;
    }
    if (btn) { btn.disabled = true; btn.innerHTML = K.spinner(); }
    try {
      const reg = await withTimeout(navigator.serviceWorker.ready, 8000);
      const key = b64uToU8(K.Backend.vapidPublicKey);
      let sub = await reg.pushManager.getSubscription();
      if (sub) {
        // made with another server key? start over
        const old = sub.options && sub.options.applicationServerKey && new Uint8Array(sub.options.applicationServerKey);
        if (old && (old.length !== key.length || old.some((v, i) => v !== key[i]))) { await sub.unsubscribe(); sub = null; }
      }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      if (await saveSub(sub)) {
        K.haptic([10, 30, 10]);
        K.toast('Notifications on', 'ok');
      }
    } catch (e) {
      // permission is granted but the browser can't subscribe: private window, push off in the browser…
      K.toast(Notification.permission === 'denied' ? 'Notifications are blocked' : 'This browser can’t turn them on here — not in a private window?', 'x');
    }
    paintPush();
  }

  async function pushOff() {
    try {
      const reg = await withTimeout(navigator.serviceWorker.ready, 5000);
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        await K.Backend.owner.pushUnsubscribe(endpoint).catch(() => null);
      }
      K.toast('Notifications off on this device', 'ok');
    } catch (e) { K.toast(err(e), 'x'); }
    paintPush();
  }

  async function pushTest(btn) {
    if (btn) { btn.disabled = true; btn.innerHTML = K.spinner(); }
    try {
      const r = await K.Backend.owner.sendTestPush(S.studio.id);
      K.toast(r && r.sent ? `Test sent to ${r.sent} device${r.sent > 1 ? 's' : ''}` : 'No device got it — turn notifications off and on again', r && r.sent ? 'bell' : 'x');
    } catch (e) { K.toast(err(e), 'x'); }
    paintPush();
  }

  /* =========================================================
     Booking card (sheet): status actions, move, cancel
     ========================================================= */
  const ob = { id: null, b: null, mode: 'view', reason: null, busy: false, pick: null };

  async function openBooking(id) {
    ob.id = id;
    ob.b = (S.known && S.known.get(id)) || null;
    ob.mode = 'view';
    ob.reason = null;
    ob.busy = false;
    K.haptic();
    K.Sheet.open(el => { el.innerHTML = `<div class="ob" data-sheet-scroll><div class="cab-load"><i class="spin"></i></div></div>`; }, { detent: 'large' });
    if (ob.b) renderOb(true);
    try {
      const fresh = await K.Backend.owner.booking(id);
      if (fresh && ob.id === id) { ob.b = fresh; if (ob.mode === 'view') renderOb(!ob.b); }
    } catch (e) { if (!ob.b) K.toast(err(e), 'x'); }
  }

  function renderOb(animate) {
    const box = K.$('.ob', K.Sheet.el());
    const b = ob.b;
    if (!box || !b) return;
    if (ob.mode === 'move') { box.innerHTML = pickerShell('Move appointment', b); loadPicker(); return; }
    const future = Date.parse(b.start_at) > Date.now();
    const started = !future;
    const actions = [];
    if (b.status === 'pending') {
      actions.push(`<button class="btn btn--primary" data-ob-set="confirmed">${K.I.check}Confirm</button>`);
      actions.push(`<button class="btn btn--soft" data-ob-cancel>Decline</button>`);
    }
    if (isActive(b) && future) {
      actions.push(`<button class="btn btn--soft" data-ob-move>${icon('<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>')}${teamView() && crew().length > 1 ? 'Move' : 'Reschedule'}</button>`);
      if (b.status !== 'pending') actions.push(`<button class="btn btn--soft ob__danger" data-ob-cancel>${K.I.x}Cancel</button>`);
    }
    if (isActive(b) && started) {
      actions.push(`<button class="btn btn--primary" data-ob-set="completed">${K.I.check}Mark completed</button>`);
      actions.push(`<button class="btn btn--soft ob__danger" data-ob-set="no_show">No-show</button>`);
    }
    // completed by the clock (2 h after the end) — she can still correct it
    if (b.status === 'completed' && b.auto_completed) actions.push(`<button class="btn btn--soft ob__danger" data-ob-set="no_show">It was a no-show</button>`);
    box.innerHTML = `
      <header class="ob__head"><span class="ob__stats"><span class="bstat bstat--${b.status}">${esc(statusLabel(b.status))}${b.status === 'completed' && b.auto_completed ? ' · auto' : ''}</span>${b.deposit_status === 'pending' && isActive(b) ? '<span class="bstat bstat--deposit">Deposit pending</span>' : ''}</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
      <h2>${esc(b.client_name || 'Client')}${tagBadges(b.client_tags, b.client_no_shows)}</h2>
      <p class="ob__sub num">${esc(K.dayLabel(spot(b.start_at).off, true))} · ${timeRange(b)}${future && isActive(b) ? ` · <em>${K.countdown(b.start_at)}</em>` : ''}</p>
      ${ob.mode === 'cancel' ? `
      <div class="card mg__confirm">
        <b>${b.status === 'pending' ? 'Decline this request?' : 'Cancel this appointment?'}</b>
        <p>The client sees it the next time she opens the app${b.client_phone ? ' — a quick text is kind too' : ''}.</p>
        <div class="mg__reasons">${['Sick day', 'Schedule change', 'Emergency', 'Other'].map(x => `<button class="chip${ob.reason === x ? ' is-active' : ''}" data-ob-reason="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <div class="mg__row">
          <button class="btn btn--soft" data-ob-keep>Keep</button>
          <button class="btn btn--danger" data-ob-cancel-yes${ob.busy ? ' disabled' : ''}>${ob.busy ? K.spinner() : b.status === 'pending' ? 'Decline' : 'Cancel it'}</button>
        </div>
      </div>` : actions.length ? `<div class="ob__grid">${actions.join('')}</div>` : ''}
      ${obDepositHTML(b)}
      <div class="card bk-sum">
        <div class="bk-row"><span>Service</span><b>${esc(b.service_name)}</b></div>
        ${teamView() && b.staff_name ? `<div class="bk-row"><span>Master</span><b>${crewDot(b.staff_color)}${esc(b.staff_name)}</b></div>` : ''}
        ${b.price != null ? `<div class="bk-row"><span>Price</span><b class="num">${money(b.price)}</b></div>` : ''}
        <div class="bk-row"><span>Phone</span><b class="num">${esc(phoneText(b.client_phone))}</b></div>
        ${b.client_email ? `<div class="bk-row"><span>Email</span><b>${esc(b.client_email)}</b></div>` : ''}
        ${b.client_note ? `<div class="bk-row bk-row--addr"><span>Note</span><b>${esc(b.client_note)}</b></div>` : ''}
        <div class="bk-row"><span>Booked</span><b>${esc(ago(b.created_at))} · ${b.created_by === 'master' ? 'by you' : 'online'}</b></div>
        ${b.late_cancel ? '<div class="bk-row bk-row--accent"><span>Late change</span><b>Yes</b></div>' : ''}
        ${b.cancel_reason ? `<div class="bk-row bk-row--addr"><span>Reason</span><b>${esc(b.cancel_reason)}</b></div>` : ''}
        ${b.last_formula ? `<div class="bk-row"><span>Last time</span><b class="num">${esc(formulaLine(b.last_formula))}</b></div>` : ''}
      </div>
      ${b.client_id && (started || b.status === 'completed') && !b.status.startsWith('cancelled') ? `<button class="btn btn--soft btn--block" data-fm-new="${esc(b.client_id)}" data-booking="${esc(b.id)}">${icon(LASH)}Write today’s lash map</button>` : ''}
      ${b.client_phone ? `
      <div class="ob__actions">
        <a class="btn btn--soft" href="${esc(telHref(b.client_phone))}">${K.I.phone}Call</a>
        <a class="btn btn--soft" href="${esc(smsHref(b.client_phone))}">${icon('<path d="M20.5 11.8a8.3 8.3 0 0 1-12.2 7.3L3.5 20.5l1.4-4.6a8.3 8.3 0 1 1 15.6-4.1z"/>')}Text</a>
      </div>` : ''}
      ${b.client_id ? `<button class="mg__link" data-cab-client="${esc(b.client_id)}">Client card ${K.I.chevR}</button>` : ''}`;
    if (animate) K.springIn(K.$$('.ob > *', K.Sheet.el()), { stagger: 0.03, y: 10, duration: 0.45 });
  }

  async function setStatus(status, reason) {
    const b = ob.b;
    if (!b || ob.busy) return;
    ob.busy = true;
    if (ob.mode === 'cancel') renderOb();
    S.self.add(b.id);
    try {
      const res = await K.Backend.owner.setStatus(b.id, status, reason || null);
      ob.b = Object.assign({}, b, res); // keep the dashboard's fields (phone, tags…)
      patchKnown(b.id, res);
      ob.mode = 'view';
      ob.busy = false;
      K.haptic([10, 30, 10]);
      K.toast({ confirmed: 'Confirmed', completed: 'Marked completed', no_show: 'Marked as a no-show', cancelled_master: b.status === 'pending' ? 'Declined' : 'Cancelled — the client will see it' }[status], 'ok');
      renderOb(true);
      if (status === 'confirmed' || status === 'cancelled_master') K.onDataChanged();
      syncChanges(true).then(() => refreshView());
    } catch (e) {
      ob.busy = false;
      K.toast(err(e), 'x');
      renderOb();
    }
  }

  /* ---------- day + time picker (move / new booking) ---------- */
  function pickerShell(title, b) {
    const p = ob.pick || (ob.pick = { off: b ? Math.max(0, spot(b.start_at).off) : 0, min: null, iso: null, slots: null, custom: '', force: false, staff: b ? b.staff_id : null });
    return `
      <header class="ob__head"><button class="cab-back" data-ob-back>${K.I.chevL}Back</button><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
      <h2>${esc(title)}</h2>
      ${b ? `<p class="ob__sub">${esc(b.client_name)} · ${esc(b.service_name)} · now ${esc(whenLine(b))}${teamView() && b.staff_name ? ' with ' + esc(firstOf(b.staff_name)) : ''}</p>` : ''}
      ${pkCrewHTML(b ? b.service_id : nb.svc)}
      ${dayStripHTML(p.off)}
      <div class="bk-label">${esc(K.dayLabel(p.off, true))}</div>
      <div class="times" id="pk-times">${'<i class="time time--sk"></i>'.repeat(6)}</div>
      <label class="field pk-custom"><span>Or another time</span><input type="time" step="300" id="pk-custom" value="${esc(p.custom)}"></label>
      <div id="pk-warn"></div>
      <button class="btn btn--primary btn--block" data-pk-go disabled>${b ? 'Move here' : 'Next'}</button>`;
  }
  // a salon (owner): which master — only those who do this service; their times below
  function pkCrewHTML(svcId) {
    const p = ob.pick;
    if (!teamView() || !S.team || !p) return '';
    const list = crew().filter(st => doesSvc(st, svcId));
    if (!list.length) return '';
    if (!list.some(st => st.id === p.staff)) p.staff = (list.find(st => st.id === ownStaff()) || list[0]).id;
    if (list.length < 2) return '';
    return `<div class="crew-chips crew-chips--pk" id="pk-crew">${list.map(st => `<button class="chip${st.id === p.staff ? ' is-active' : ''}" data-pk-staff="${esc(st.id)}">${crewDot(st.color)}${esc(firstOf(st.name))}</button>`).join('')}</div>`;
  }
  function dayStripHTML(sel) {
    const n = Math.max(14, sel + 4);
    return `<div class="days pk-days" role="listbox">${Array.from({ length: n }, (_, i) => {
      const d = K.studioDate(i);
      return `<button class="day${i === sel ? ' is-selected' : ''}" data-pk-day="${i}"><small>${i === 0 ? 'Today' : K.DAY_SHORT[d.dow]}</small><b class="num">${d.day}</b><i></i></button>`;
    }).join('')}</div>`;
  }
  async function loadPicker() {
    const p = ob.pick;
    const svc = ob.mode === 'move' ? ob.b.service_id : nb.svc;
    const off = p.off;
    const box = K.$('#pk-times', K.Sheet.el());
    if (!svc) { if (box) box.innerHTML = '<div class="times__empty">Pick a service first</div>'; return; }
    const sel = K.$('.pk-days .is-selected', K.Sheet.el());
    if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest' });
    try {
      const staff = teamView() ? p.staff || null : null;
      const list = await K.Backend.owner.slots(S.studio.id, svc, K.dateKey(off), ob.mode === 'move' ? ob.b.id : null, staff);
      if (p.off !== off || (teamView() ? p.staff || null : null) !== staff) return;
      p.slots = list.map(iso => ({ iso: new Date(Date.parse(iso)).toISOString(), min: spot(iso).min }));
    } catch (e) { p.slots = []; }
    paintPicker();
  }
  function paintPicker() {
    const p = ob.pick;
    const box = K.$('#pk-times', K.Sheet.el());
    if (!box) return;
    box.innerHTML = p.slots && p.slots.length
      ? p.slots.map(x => `<button class="time${x.min === p.min && !p.custom ? ' is-selected' : ''}" data-pk-time="${x.min}">${K.fmtClock(x.min)}</button>`).join('')
      : '<div class="times__empty">No openings by your rules this day — use “another time” below.</div>';
    const go = K.$('[data-pk-go]', K.Sheet.el());
    if (go) go.disabled = !pickIso();
    const w = K.$('#pk-warn', K.Sheet.el());
    if (w) w.innerHTML = p.force ? `<div class="bk-notice">${K.I.clock}<span>Outside your hours or rules. Tap again to book it anyway.</span></div>` : '';
  }
  function pickIso() {
    const p = ob.pick;
    if (p.custom) return isoAt(p.off, minOf(p.custom));
    const x = p.slots && p.slots.find(s => s.min === p.min);
    return x ? x.iso : null;
  }

  async function moveIt() {
    const iso = pickIso();
    if (!iso || ob.busy) return;
    ob.busy = true;
    S.self.add(ob.b.id);
    // a salon (owner): maybe to another master — checked for her time
    const to = teamView() && ob.pick.staff && ob.pick.staff !== ob.b.staff_id ? ob.pick.staff : null;
    try {
      const prev = ob.b;
      const res = await K.Backend.owner.reschedule(ob.b.id, iso, ob.pick.force, to);
      ob.b = Object.assign({}, prev, res, to ? { staff_name: (crewById(to) || {}).name, staff_color: (crewById(to) || {}).color } : {});
      ob.busy = false;
      ob.mode = 'view';
      ob.pick = null;
      K.haptic([10, 30, 10]);
      K.toast(to ? `Moved to ${firstOf((crewById(to) || {}).name)} — the client will see it` : 'Moved — the client will see the new time', 'ok');
      renderOb(true);
      K.onDataChanged();
      syncChanges(true).then(() => refreshView());
    } catch (e) {
      ob.busy = false;
      if (e.code === 'outside_hours' && !ob.pick.force) { ob.pick.force = true; paintPicker(); K.haptic(20); return; }
      K.toast(e.code === 'slot_taken' && to ? `${firstOf((crewById(to) || {}).name)} is busy then — pick another time` : err(e), 'x');
      if (e.code === 'slot_taken') loadPicker();
    }
  }

  /* =========================================================
     New booking (the master books a client who called)
     ========================================================= */
  const nb = { svc: null, name: '', phone: '', email: '', note: '', step: 'time', sugg: [] };

  function openNew(at, who) {
    if (S.readonly) { readOnly(); return; }
    nb.svc = nb.svc && K.data.services.some(s => s.id === nb.svc) ? nb.svc : (K.data.services[0] && K.data.services[0].id);
    Object.assign(nb, { name: '', phone: '', email: '', note: '', step: 'time', sugg: [] }, who || {});
    ob.mode = 'new';
    ob.b = null;
    ob.busy = false;
    ob.pick = {
      off: at ? at.off : S.tab === 'calendar' ? Math.max(0, S.day) : 0, min: at ? at.min : null, iso: null, slots: null, custom: '', force: false,
      // a salon (owner): the column she tapped, the master in the calendar filter, or herself
      staff: (at && at.staff) || (S.tab === 'calendar' && S.calStaff) || ownStaff()
    };
    K.haptic();
    K.Sheet.open(el => { el.innerHTML = '<div class="ob" data-sheet-scroll></div>'; }, { detent: 'large' });
    renderNew(true);
  }

  function renderNew(animate) {
    const box = K.$('.ob', K.Sheet.el());
    if (!box) return;
    if (nb.step === 'time') {
      box.innerHTML = `
        <header class="ob__head"><span class="eyebrow">New booking</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
        <h2>When?</h2>
        <label class="field"><span>Service</span>
          <select class="cab-sel cab-sel--wide" data-nb-svc>${K.data.services.map(s => `<option value="${esc(s.id)}"${s.id === nb.svc ? ' selected' : ''}>${esc(s.title)} · ${esc(s.duration)} · ${esc(K.price(s.price))}</option>`).join('')}</select></label>
        ${pickerShell('', null).replace(/<header[\s\S]*?<\/header>\s*<h2><\/h2>/, '')}`;
      loadPicker().then(() => {
        // a tap on the timeline / a free window → preselect that time
        const p = ob.pick;
        if (p.min != null && !(p.slots || []).some(x => x.min === p.min)) { p.custom = hhmm(p.min); const c = K.$('#pk-custom', K.Sheet.el()); if (c) c.value = p.custom; paintPicker(); }
      });
    } else {
      const iso = pickIso();
      const s = K.data.services.find(x => x.id === nb.svc);
      box.innerHTML = `
        <header class="ob__head"><button class="cab-back" data-nb-back>${K.I.chevL}Back</button><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
        <h2>Who’s coming?</h2>
        <p class="ob__sub">${esc(s ? s.title : '')} · ${esc(K.dayLabel(spot(iso).off, false))} · ${K.fmtClock(spot(iso).min)}${teamView() && crewById(ob.pick.staff) && crew().length > 1 ? ' · with ' + esc(firstOf(crewById(ob.pick.staff).name)) : ''}</p>
        <div class="bk-form">
          <label class="field"><span>Name</span><input data-nb="name" value="${esc(nb.name)}" autocomplete="off" placeholder="Start typing — we’ll find returning clients"></label>
          <div class="nb-sugg" id="nb-sugg"></div>
          <label class="field"><span>Phone</span><input data-nb="phone" type="tel" inputmode="tel" value="${esc(K.maskPhone(nb.phone))}" placeholder="(404) 555-0123"></label>
          <label class="field"><span>Email <em>optional</em></span><input data-nb="email" type="email" value="${esc(nb.email)}"></label>
          <label class="field"><span>Note <em>optional</em></span><textarea data-nb="note" rows="2" maxlength="500">${esc(nb.note)}</textarea></label>
        </div>
        <div id="pk-warn"></div>
        <button class="btn btn--primary btn--block" data-nb-create${nbValid() ? '' : ' disabled'}>${ob.busy ? K.spinner() : 'Book it'}</button>`;
    }
    if (animate) K.springIn(K.$$('.ob > *', K.Sheet.el()), { stagger: 0.03, y: 10, duration: 0.45 });
  }
  const nbValid = () => nb.name.trim().length > 0 && K.phoneDigits(nb.phone).length >= 10;

  let suggTimer = 0;
  function suggest() {
    clearTimeout(suggTimer);
    const q = nb.name.trim();
    const box = K.$('#nb-sugg', K.Sheet.el());
    if (!box) return;
    if (q.length < 2) { box.innerHTML = ''; return; }
    suggTimer = setTimeout(async () => {
      try { nb.sugg = (await K.Backend.owner.clients(S.studio.id, q)).slice(0, 4); } catch (e) { nb.sugg = []; }
      const b2 = K.$('#nb-sugg', K.Sheet.el());
      if (b2) b2.innerHTML = nb.sugg.map((c, i) => `<button class="chip" data-nb-pick="${i}">${esc(c.name)} · ${esc(phoneText(c.phone))}</button>`).join('');
    }, 220);
  }

  async function createIt() {
    const iso = pickIso();
    if (!iso || !nbValid() || ob.busy) return;
    ob.busy = true;
    renderNew();
    try {
      const b = await K.Backend.owner.create(S.studio.id, {
        serviceId: nb.svc, startAt: iso, name: nb.name.trim(), phone: nb.phone, email: nb.email.trim(), note: nb.note.trim(),
        staffId: teamView() ? ob.pick.staff || null : null
      }, ob.pick.force);
      S.self.add(b.id);
      ob.busy = false;
      K.Sheet.close();
      K.haptic([10, 30, 10]);
      K.toast(`Booked: ${nb.name.trim()} · ${whenLine(b)}`, 'ok');
      K.onDataChanged();
      await syncChanges(true);
      refreshView();
    } catch (e) {
      ob.busy = false;
      if (e.code === 'outside_hours' && !ob.pick.force) {
        ob.pick.force = true;
        renderNew();
        const w = K.$('#pk-warn', K.Sheet.el());
        if (w) w.innerHTML = `<div class="bk-notice">${K.I.clock}<span>That time is outside your hours or booking rules. Tap “Book it” again to book anyway.</span></div>`;
        K.haptic(20);
        return;
      }
      renderNew();
      K.toast(err(e), 'x');
      if (e.code === 'slot_taken') { nb.step = 'time'; renderNew(); }
    }
  }

  /* =========================================================
     Events
     ========================================================= */
  function onClick(e) {
    if (!root) return;
    const t = e.target;
    let el;
    // inside the dashboard or one of its sheets only
    const inSheet = t.closest('.sheet');
    if (!t.closest('.cab') && !inSheet) return;

    if ((el = t.closest('[data-cab-close]'))) { close(); return; }
    if ((el = t.closest('[data-fp-save]'))) { e.preventDefault(); saveForcedPassword(el); return; }
    // the admin's view: looking is fine, changing is not
    if (S.readonly && t.closest(RO_BLOCK)) { e.preventDefault(); e.stopPropagation(); readOnly(); return; }
    if ((el = t.closest('[data-cab-tab]'))) { go(el.dataset.cabTab); return; }
    if ((el = t.closest('[data-pw-eye]'))) {
      const inp = el.parentElement.querySelector('input');
      inp.type = inp.type === 'password' ? 'text' : 'password';
      el.classList.toggle('is-on', inp.type === 'text');
      el.setAttribute('aria-label', inp.type === 'text' ? 'Hide password' : 'Show password');
      return;
    }
    if ((el = t.closest('[data-pw-save]'))) { changePassword(); return; }
    if ((el = t.closest('[data-cab-demo]'))) { close(); setTimeout(() => K.demo(), 350); return; }
    if ((el = t.closest('[data-cab-signout]'))) { signOut(); return; }
    if ((el = t.closest('[data-cab-menu]'))) { openMenu(); return; }
    if ((el = t.closest('[data-cab-retry]'))) { S.cache = {}; S.lastSync = 0; refreshView(true); return; }
    if ((el = t.closest('[data-cab-reenter]'))) { renderLoading(); enter(); return; }
    // anything she touches in a form: no quiet redraws until she leaves it
    if (EDITORS.has(S.tab) && t.closest('.cab__view')) S.dirty = true;
    if ((el = t.closest('[data-cab-new]'))) { openNew(null); return; }
    if ((el = t.closest('[data-cab-new-at]'))) { const [o, m, st] = el.dataset.cabNewAt.split(':'); openNew({ off: +o, min: +m, staff: st || null }); return; }
    if ((el = t.closest('[data-cab-new-for]'))) {
      const who = { name: el.dataset.name, phone: el.dataset.phone, email: el.dataset.email };
      openNew(null, who);
      return;
    }
    if ((el = t.closest('[data-cab-b]'))) {
      const id = el.dataset.cabB;
      if (inSheet) { openBooking(id); } else openBooking(id);
      return;
    }
    if ((el = t.closest('[data-cab-client]'))) {
      const id = el.dataset.cabClient;
      if (inSheet) { openClient(id); } else openClient(id);
      return;
    }
    if ((el = t.closest('[data-cl-save]'))) { saveNotes(el.dataset.clSave); return; }
    if (onStudioClick(t)) return;
    // calendar
    if ((el = t.closest('[data-push-on]'))) { if (!el.disabled) pushOn(el); return; }
    if ((el = t.closest('[data-push-off]'))) { pushOff(); return; }
    if ((el = t.closest('[data-push-test]'))) { if (!el.disabled) pushTest(el); return; }
    if ((el = t.closest('[data-push-recheck]'))) { paintPush(); return; }
    if ((el = t.closest('[data-cab-showcx]'))) {
      S.showCx = !S.showCx;
      try { localStorage.setItem('studio-app:cab:showCancelled', S.showCx ? '1' : '0'); } catch (x) { /* private mode */ }
      K.haptic();
      refreshView();
      return;
    }
    if ((el = t.closest('[data-cab-cal]'))) { S.cal = el.dataset.cabCal; refreshView(true); K.haptic(); return; }
    if ((el = t.closest('[data-cab-shift]'))) { shiftDay(+el.dataset.cabShift); return; }
    if ((el = t.closest('[data-cab-today]'))) { S.day = 0; refreshView(true); return; }
    if ((el = t.closest('[data-cab-goday]'))) { S.day = +el.dataset.cabGoday; S.cal = 'day'; refreshView(true); K.haptic(); return; }
    // a salon: one master / everyone (calendar), whose hours
    if ((el = t.closest('[data-crew-cal]'))) { S.calStaff = el.dataset.crewCal || null; K.haptic(); refreshView(); return; }
    if ((el = t.closest('[data-crew-hrs]'))) {
      if (S.hrsDirty && !confirm('Leave without saving the hours?')) return;
      S.hrsStaff = el.dataset.crewHrs === ownStaff() ? null : el.dataset.crewHrs;
      S.hrs = null;
      S.hrsDirty = false;
      S.hsched = null;
      S.dirty = false;
      K.haptic();
      refreshView();
      return;
    }
    // requests
    if ((el = t.closest('[data-req-yes]'))) { decide(el.dataset.reqYes, true); return; }
    if ((el = t.closest('[data-req-no]'))) { decide(el.dataset.reqNo, false); return; }
    // hours
    if ((el = t.closest('[data-hrs-toggle]'))) {
      const d = +el.dataset.hrsToggle;
      S.hrs[d] = S.hrs[d] && S.hrs[d].length ? [] : [{ s: '09:00', e: '17:00' }];
      S.hrsDirty = true;
      K.haptic();
      repaint();
      return;
    }
    if ((el = t.closest('[data-hrs-add]'))) {
      const d = +el.dataset.hrsAdd;
      const last = S.hrs[d][S.hrs[d].length - 1];
      const s = Math.min(minOf(last.e) + 60, 22 * 60);
      S.hrs[d].push({ s: hhmm(s), e: hhmm(Math.min(s + 180, 23 * 60 + 45)) });
      S.hrsDirty = true;
      repaint();
      return;
    }
    if ((el = t.closest('[data-hrs-del]'))) {
      const [d, i] = el.dataset.hrsDel.split(':').map(Number);
      S.hrs[d].splice(i, 1);
      S.hrsDirty = true;
      repaint();
      return;
    }
    if ((el = t.closest('[data-hrs-save]'))) { if (!el.disabled) saveHours(); return; }
    if ((el = t.closest('[data-toff-add]'))) { addTimeOff(); return; }
    if ((el = t.closest('[data-toff-del]'))) {
      K.Backend.owner.deleteTimeOff(el.dataset.toffDel).then(() => { K.toast('Time off removed', 'ok'); K.onDataChanged(); S.dirty = false; refreshView(); }, x => K.toast(err(x), 'x'));
      return;
    }
    if ((el = t.closest('[data-rule-auto]'))) {
      const on = el.getAttribute('aria-checked') !== 'true';
      el.setAttribute('aria-checked', on);
      saveRule('auto_confirm', on);
      return;
    }
    // booking card
    if ((el = t.closest('[data-ob-set]'))) { setStatus(el.dataset.obSet); return; }
    if ((el = t.closest('[data-ob-cancel]'))) { ob.mode = 'cancel'; ob.reason = null; K.haptic(); renderOb(); return; }
    if ((el = t.closest('[data-ob-keep]'))) { ob.mode = 'view'; renderOb(); return; }
    if ((el = t.closest('[data-ob-reason]'))) { ob.reason = ob.reason === el.dataset.obReason ? null : el.dataset.obReason; renderOb(); return; }
    if ((el = t.closest('[data-ob-cancel-yes]'))) { if (!el.disabled) setStatus('cancelled_master', ob.reason || (ob.b.status === 'pending' ? 'Declined' : null)); return; }
    if ((el = t.closest('[data-ob-move]'))) { ob.mode = 'move'; ob.pick = null; renderOb(); return; }
    if ((el = t.closest('[data-ob-back]'))) { if (ob.mode === 'new') return; ob.mode = 'view'; ob.pick = null; renderOb(true); return; }
    // picker
    if ((el = t.closest('[data-pk-day]'))) {
      ob.pick.off = +el.dataset.pkDay;
      ob.pick.min = null;
      ob.pick.slots = null;
      ob.pick.force = false;
      K.$$('[data-pk-day]', K.Sheet.el()).forEach(x => x.classList.toggle('is-selected', x === el));
      const lab = K.$('.bk-label', K.Sheet.el());
      if (lab) lab.textContent = K.dayLabel(ob.pick.off, true);
      const box = K.$('#pk-times', K.Sheet.el());
      if (box) box.innerHTML = '<i class="time time--sk"></i>'.repeat(6);
      K.haptic();
      loadPicker();
      return;
    }
    if ((el = t.closest('[data-pk-staff]'))) {
      ob.pick.staff = el.dataset.pkStaff;
      ob.pick.min = null;
      ob.pick.slots = null;
      ob.pick.force = false;
      K.$$('[data-pk-staff]', K.Sheet.el()).forEach(x => x.classList.toggle('is-active', x === el));
      const box = K.$('#pk-times', K.Sheet.el());
      if (box) box.innerHTML = '<i class="time time--sk"></i>'.repeat(6);
      K.haptic();
      loadPicker();
      return;
    }
    if ((el = t.closest('[data-pk-time]'))) {
      ob.pick.min = +el.dataset.pkTime;
      ob.pick.custom = '';
      ob.pick.force = false;
      const c = K.$('#pk-custom', K.Sheet.el());
      if (c) c.value = '';
      K.haptic();
      paintPicker();
      return;
    }
    if ((el = t.closest('[data-pk-go]'))) {
      if (el.disabled) return;
      if (ob.mode === 'move') moveIt();
      else { nb.step = 'who'; renderNew(true); }
      return;
    }
    if ((el = t.closest('[data-nb-back]'))) { nb.step = 'time'; renderNew(true); return; }
    if ((el = t.closest('[data-nb-pick]'))) {
      const c = nb.sugg[+el.dataset.nbPick];
      if (c) { nb.name = c.name; nb.phone = c.phone; nb.email = c.email || ''; renderNew(); K.haptic(); }
      return;
    }
    if ((el = t.closest('[data-nb-create]'))) { if (!el.disabled) createIt(); return; }
    // tap on an empty spot of a timeline → new booking at that time
    if ((el = t.closest('.tl')) && !t.closest('.tl__b')) {
      const r = el.getBoundingClientRect();
      const from = +el.dataset.from;
      const min = Math.round((from + (e.clientY - r.top) / PX) / 15) * 15;
      openNew({ off: +el.dataset.tl, min, staff: el.dataset.staff || null });
    }
  }

  function onInput(e) {
    if (!root) return;
    const t = e.target;
    if (t.id === 'cab-q') { onSearch(t.value); return; }
    if (onStudioInput(t)) return;
    if (t.id === 'pk-custom') {
      ob.pick.custom = t.value;
      ob.pick.min = null;
      ob.pick.force = false;
      paintPicker();
      return;
    }
    if (t.dataset && t.dataset.nb) {
      const k = t.dataset.nb;
      if (k === 'phone') { const m = K.maskPhone(t.value); if (m !== t.value) t.value = m; }
      nb[k] = t.value;
      ob.pick.force = false;
      const btn = K.$('[data-nb-create]', K.Sheet.el());
      if (btn) btn.disabled = !nbValid();
      if (k === 'name') suggest();
      return;
    }
    if (t.dataset && (t.dataset.hrsS || t.dataset.hrsE)) {
      const [d, i] = (t.dataset.hrsS || t.dataset.hrsE).split(':').map(Number);
      if (t.dataset.hrsS) S.hrs[d][i].s = t.value; else S.hrs[d][i].e = t.value;
      S.hrsDirty = true;
      const b = $('[data-hrs-save]');
      if (b) b.disabled = false;
    }
  }

  function onChange(e) {
    if (!root) return;
    const t = e.target;
    if (S.readonly && t.closest && t.closest('.cab, .sheet') && (t.dataset.rule || t.matches('[data-patch-date]'))) { readOnly(); repaint(); return; }
    if (t.dataset && t.dataset.rule) { saveRule(t.dataset.rule, +t.value); return; }
    onStudioChange(t);
    if (t.matches && t.matches('[data-nb-svc]')) {
      nb.svc = t.value;
      ob.pick.slots = null;
      ob.pick.min = null;
      // a salon: only the masters who do this one
      const chips = K.$('#pk-crew', K.Sheet.el());
      const html = pkCrewHTML(nb.svc);
      if (chips) chips.outerHTML = html || '<span id="pk-crew"></span>';
      else if (html) { const days = K.$('.pk-days', K.Sheet.el()); if (days) days.insertAdjacentHTML('beforebegin', html); }
      loadPicker();
    }
    if (t.matches && t.matches('[data-pay-from], [data-pay-to]')) {
      if (t.matches('[data-pay-from]')) S.payFrom = t.value; else S.payTo = t.value;
      if (S.payFrom && S.payTo && S.payFrom <= S.payTo) loadPayouts().then(repaint, x => K.toast(err(x), 'x'));
    }
  }

  function afterRender(tab, first) {
    if (tab === 'today') paintPush();
    if (tab === 'requests') bindSwipes();
    if (tab === 'services' || tab === 'looks') bindSortable();
    if (tab === 'calendar') bindDaySwipe();
    if (tab === 'calendar' && S.cal === 'day' && first) scrollToNow();
  }
  // the day opens at the current time (or the first booking, or opening time), below the pinned header
  function scrollToNow() {
    const main = $('#cab-main');
    const target = $('.cab-day .tl__now') || $('.cab-day .tl__b') || $('.cab-day .tl__open');
    if (!main || !target) return;
    const pin = $('.cab-pin');
    const top = target.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop;
    main.scrollTop = Math.max(0, top - (pin ? pin.offsetHeight : 0) - 70);
  }

  function shiftDay(d) {
    S.day += d;
    const g = K.G();
    const box = $('.cab-day, .wk');
    if (g && box) K.ensure(g.fromTo(box, { x: d > 0 ? 40 : -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, ease: 'power3.out', clearProps: 'transform,opacity', delay: 0.08 }));
    K.haptic();
    refreshView();
    requestAnimationFrame(scrollToNow);
  }

  // swipe left / right on the day (or week) → next / previous
  function bindDaySwipe() {
    const area = $('[data-swipe], [data-swipe-week]');
    if (!area) return;
    const step = area.hasAttribute('data-swipe-week') ? 7 : 1;
    let st = null;
    area.addEventListener('pointerdown', e => { st = { x: e.clientX, y: e.clientY, t: Date.now() }; });
    area.addEventListener('pointerup', e => {
      if (!st) return;
      const dx = e.clientX - st.x;
      const dy = e.clientY - st.y;
      const quick = Date.now() - st.t < 600;
      st = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4 && quick) {
        // swallow the click that follows a swipe
        const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
        area.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => area.removeEventListener('click', stop, { capture: true }), 60);
        shiftDay(dx < 0 ? step : -step);
      }
    });
  }

  function openMenu() {
    const email = (S.session && S.session.user && S.session.user.email) || '';
    K.Sheet.open(el => {
      el.innerHTML = `
        <div class="ob" data-sheet-scroll>
          <header class="ob__head"><span class="eyebrow">Account</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
          <h2>${esc(S.studio.name)}</h2>
          <p class="ob__sub">Signed in as ${esc(email)}</p>
          <div class="list">
            <div class="row"><span class="row__label">Live updates<span class="row__sub">${S.live ? 'Connected — new bookings appear instantly' : 'Checking every 15 seconds'}</span></span></div>
            <div class="row"><span class="row__label">Online booking link<span class="row__sub">${esc(location.origin + location.pathname + '?m=' + K.SLUG)}</span></span></div>
          </div>
          <div class="group-label">Change password</div>
          <form class="bk-form" id="pw-form" autocomplete="on" onsubmit="return false">
            <input type="email" autocomplete="username" value="${esc(email)}" hidden>
            <label class="field"><span>New password</span>
              <span class="pw"><input id="pw-new" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters">
              <button type="button" class="pw__eye" data-pw-eye aria-label="Show password">${icon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>')}</button></span></label>
            <label class="field"><span>Repeat it</span><input id="pw-new2" type="password" autocomplete="new-password" placeholder="The same password"></label>
            <button class="btn btn--primary btn--block" type="button" data-pw-save>Save new password</button>
          </form>
          <button class="btn btn--soft btn--block" data-cab-signout>Sign out</button>
        </div>`;
    }, { detent: 'large' });
  }

  async function changePassword() {
    const a = (K.$('#pw-new', K.Sheet.el()) || {}).value || '';
    const b = (K.$('#pw-new2', K.Sheet.el()) || {}).value || '';
    if (a.length < 8) { K.toast('Use at least 8 characters', 'x'); return; }
    if (a !== b) { K.toast('The passwords don’t match', 'x'); return; }
    const btn = K.$('[data-pw-save]', K.Sheet.el());
    if (btn) { btn.disabled = true; btn.innerHTML = K.spinner(); }
    try {
      await K.Backend.auth.updatePassword(a);
      K.haptic([10, 30, 10]);
      K.toast('Password changed', 'ok');
      K.Sheet.close();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = 'Save new password'; }
      K.toast(/different|same/i.test(e.message) ? 'That’s already your password' : /weak|short|least/i.test(e.message) ? 'Pick a stronger password' : err(e), 'x');
    }
  }

  async function signOut() {
    try { await K.Backend.auth.signOut(); } catch (e) { /* offline: the local session is cleared anyway */ }
    if (K.Sheet.isOpen()) K.Sheet.close();
    stopLive();
    S.session = null;
    S.studio = null;
    K.setOwnerHere && K.setOwnerHere(false);
    S.known = null;
    S.team = null;
    S.scheds = {};
    S.calStaff = S.hrsStaff = S.hsched = S.insStaff = null;
    K.store.remove('cab');
    Object.keys(MEM).forEach(k => delete MEM[k]);
    S2.profile = S2.services = S2.looks = null;
    K.toast('Signed out', 'ok');
    renderAuth();
  }

  window.StudioCabinet = { open, close: () => close() };
})();
