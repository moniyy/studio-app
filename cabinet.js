/* =========================================================
   Studio App — the master's dashboard ("cabinet").
   Loaded on demand (?owner=1 or a long press on the monogram /
   avatar) for studios with the built-in booking engine.
   Sign in by email (magic link or 6-digit code) → Today, Calendar,
   Requests, Clients, Hours. New bookings and cancellations arrive
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
    email: '', busy: false, hrs: null, hrsDirty: false
  };

  const TABS = [
    { id: 'today', label: 'Today', icon: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>' },
    { id: 'calendar', label: 'Calendar', icon: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>' },
    { id: 'requests', label: 'Requests', icon: '<path d="M4 6.5h16v11H4z"/><path d="m4 7 8 6 8-6"/>' },
    { id: 'clients', label: 'Clients', icon: '<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 19.5c.8-3.3 3.4-5 6.5-5s5.7 1.7 6.5 5"/><path d="M16 5.5a3.2 3.2 0 0 1 0 6.2M18.5 14.8c1.6.7 2.6 2.2 3 4.2"/>' },
    { id: 'hours', label: 'Hours', icon: '<path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2"/><circle cx="12" cy="12" r="5"/>' }
  ];
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

  /* =========================================================
     Open / close
     ========================================================= */
  async function open(kit, opts) {
    K = kit;
    if (root) { if (opts && opts.booking && S.studio) openBooking(opts.booking); return; }
    S.target = (opts && opts.booking) || null;
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
        ${TABS.map(t => `<button class="cab__tab" data-cab-tab="${t.id}"><span class="cab__tabic">${icon(t.icon)}<i class="cab__badge" data-badge="${t.id}" hidden></i></span><span>${t.label}</span></button>`).join('')}
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
    try {
      S.session = await K.Backend.auth.session();
      if (S.session) await enter();
      else renderAuth();
    } catch (e) {
      renderAuth(err(e));
    }
  }

  function close(fromHistory) {
    if (!root) return;
    stopLive();
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

  /* Signed in: which studio is this account for? */
  async function enter() {
    renderLoading();
    try {
      const list = await K.Backend.owner.studios();
      S.studio = (list || []).find(m => m.slug === K.SLUG) || null;
    } catch (e) {
      renderAuth(err(e));
      return;
    }
    if (!S.studio) {
      $('#cab-main').innerHTML = `
        <div class="cab-auth">
          <span class="cab-auth__mono">${esc(K.initials())}</span>
          <h1>Not your studio yet</h1>
          <p>You’re signed in as <b>${esc((S.session && S.session.user && S.session.user.email) || '')}</b>, but this account doesn’t manage ${esc(K.data.name)}. Ask for the studio to be set up with this email, or sign in with another one.</p>
          <button class="btn btn--soft btn--block" data-cab-signout>Sign out</button>
        </div>`;
      return;
    }
    $('#cab-tabs').hidden = false;
    $('[data-cab-new]').hidden = false;
    $('[data-cab-menu]').hidden = false;
    try { S.sched = await K.Backend.owner.schedule(S.studio.id); } catch (e) { S.sched = { hours: [], time_off: [], rules: {} }; }
    await syncChanges(true);
    startLive();
    go(S.tab, true);
    if (S.target) { const id = S.target; S.target = null; setTimeout(() => openBooking(id), 450); }
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
    if (el) el.innerHTML = S.live ? '<i class="cab-dot"></i>Live' : 'Up to date';
  }
  let syncTimer = 0;
  const scheduleSync = () => { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncChanges(), 350); };

  // Compare with what we knew: new bookings, client cancellations, moves
  async function syncChanges(first) {
    if (!S.studio) return;
    let list;
    try {
      const from = new Date(Date.now() - 2 * 864e5).toISOString();
      const to = new Date(Date.now() + 120 * 864e5).toISOString();
      list = await K.Backend.owner.bookings(S.studio.id, from, to);
    } catch (e) { return; }
    const prev = S.known;
    S.known = new Map(list.map(b => [b.id, b]));
    S.pending = list.filter(b => b.status === 'pending' && Date.parse(b.start_at) > Date.now());
    S.cache = {};
    if (!first && prev) {
      list.forEach(b => {
        const old = prev.get(b.id);
        if (S.self.has(b.id)) return;
        if (!old && b.created_by === 'client' && isActive(b)) notify(b.status === 'pending' ? 'request' : 'new', b);
        else if (old && isActive(old) && b.status === 'cancelled_client') notify('cancel', b);
        else if (old && isActive(b) && Date.parse(old.start_at) !== Date.parse(b.start_at)) notify('move', b, old);
      });
    }
    S.self.clear();
    S.badges.requests = S.pending.length;
    paintBadges();
    if (!first) refreshView();
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
      move: `Moved: ${b.client_name} · ${svc} → ${when}`
    }[kind];
    S.queue.push({ kind, text, id: b.id });
    if (kind !== 'request') {
      const t = spot(b.start_at).off === 0 ? 'today' : 'calendar';
      if (S.tab !== t) S.badges[t]++;
    }
    paintBadges();
    if (typeof navigator.vibrate === 'function' && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) {
      try { navigator.vibrate(kind === 'cancel' || kind === 'late' ? [40, 60, 40] : [25, 40, 25]); } catch (e) { /* not allowed */ }
    }
    chime(kind === 'cancel' || kind === 'late');
    showBanner();
  }

  let bannerBusy = false;
  function showBanner() {
    if (bannerBusy || !S.queue.length || !root) return;
    bannerBusy = true;
    const n = S.queue.shift();
    const el = $('#cab-banner');
    el.className = `cab__banner cab__banner--${n.kind} is-on`;
    el.innerHTML = `<button data-cab-b="${esc(n.id)}"><i>${icon(n.kind === 'cancel' || n.kind === 'late' ? '<path d="M6 6l12 12M18 6 6 18"/>' : n.kind === 'move' ? '<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>' : '<path d="M12 5v14M5 12h14"/>')}</i><span>${esc(n.text)}</span></button>`;
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
    Object.keys(S.badges).forEach(k => {
      const b = $(`[data-badge="${k}"]`);
      if (!b) return;
      const n = S.badges[k];
      b.hidden = !n;
      b.textContent = n > 9 ? '9+' : String(n || '');
    });
  }

  /* =========================================================
     Tabs
     ========================================================= */
  function go(tab, initial) {
    S.tab = tab;
    if (tab === 'today' || tab === 'calendar') S.badges[tab] = 0;
    paintBadges();
    $$('.cab__tab').forEach(b => b.classList.toggle('is-active', b.dataset.cabTab === tab));
    const main = $('#cab-main');
    main.innerHTML = `<div class="cab__view" data-view="${tab}"><div class="cab-load"><i class="spin"></i></div></div>`;
    main.scrollTop = 0;
    refreshView(true);
    if (!initial) K.haptic();
  }

  async function refreshView(animate) {
    if (!root || !S.studio) return;
    const view = $('.cab__view');
    if (!view) return;
    const tab = S.tab;
    try {
      let html = '';
      if (tab === 'today') html = await todayHTML();
      else if (tab === 'calendar') html = await calendarHTML();
      else if (tab === 'requests') html = requestsHTML();
      else if (tab === 'clients') html = await clientsHTML();
      else if (tab === 'hours') html = await hoursHTML();
      if (!root || S.tab !== tab) return;
      const keep = tab === 'clients' && document.activeElement && document.activeElement.id === 'cab-q';
      if (keep) { $('#cab-clients').innerHTML = clientsListHTML(); return; }
      view.innerHTML = html;
      afterRender(tab);
      if (animate) K.springIn($$('.cab__view > *'), { stagger: 0.04, y: 14, duration: 0.5 });
    } catch (e) {
      view.innerHTML = `<div class="cab-empty"><b>${esc(err(e))}</b><button class="btn btn--soft btn--sm" data-cab-retry>Try again</button></div>`;
    }
  }

  async function bookingsFor(fromOff, days) {
    const key = fromOff + ':' + days;
    if (!S.cache[key]) S.cache[key] = await K.Backend.owner.bookings(S.studio.id, dayStartIso(fromOff), dayStartIso(fromOff + days));
    return S.cache[key];
  }

  /* ---------- TODAY ---------- */
  async function todayHTML() {
    const list = await bookingsFor(0, 1);
    const live = list.filter(b => !b.status.startsWith('cancelled'));
    const counted = live.filter(b => b.status !== 'no_show');
    const revenue = counted.reduce((s, b) => s + (+b.price || 0), 0);
    const now = Date.now();
    const next = live.filter(b => isActive(b) && Date.parse(b.end_at) > now).sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at))[0];
    const free = freeWindows(0, list);
    const freeMin = free.reduce((s, w) => s + (w.e - w.s), 0);
    const d = K.studioDate(0);
    return `
      <header class="cab-h"><span class="eyebrow">${K.DAY_NAMES[d.dow]}, ${K.MONTHS[d.month]} ${d.day}</span><h1>Today</h1></header>
      <div class="cab-stats card">
        <div><b class="num">${money(revenue)}</b><small>Revenue</small></div>
        <div><b class="num">${counted.length}</b><small>${counted.length === 1 ? 'Client' : 'Clients'}</small></div>
        <div><b class="num">${freeMin >= 60 ? Math.floor(freeMin / 60) + 'h' + (freeMin % 60 ? ' ' + (freeMin % 60) + 'm' : '') : freeMin + 'm'}</b><small>Free</small></div>
      </div>
      <div id="cab-push"></div>
      ${next ? nextClientHTML(next) : `<div class="card cab-next cab-next--none"><b>${live.length ? 'All done for today' : 'No clients today'}</b><span>${free.length ? 'Free windows are below — tap one to book a client.' : 'Enjoy the quiet.'}</span></div>`}
      ${S.pending.length ? `<button class="cab-req card" data-cab-tab="requests">${icon('<path d="M4 6.5h16v11H4z"/><path d="m4 7 8 6 8-6"/>')}<span><b>${S.pending.length} request${S.pending.length > 1 ? 's' : ''} waiting</b><small>Approve or decline</small></span>${K.I.chevR}</button>` : ''}
      ${tlHead('Timeline')}
      ${timelineHTML(0, list)}
      ${free.length ? `
      <div class="group-label">Free windows</div>
      <div class="cab-free">${free.map(w => `<button class="chip" data-cab-new-at="0:${w.s}">${K.fmtClock(w.s)} – ${K.fmtClock(w.e)}</button>`).join('')}</div>` : ''}`;
  }

  function nextClientHTML(b) {
    const started = Date.parse(b.start_at) <= Date.now();
    return `
      <section class="card cab-next" data-cab-b="${esc(b.id)}" role="button" tabindex="0">
        <div class="cab-next__top"><span class="eyebrow">${started ? 'In the chair now' : 'Next client'}</span><span class="cab-next__in">${started ? 'until ' + K.fmtClock(spot(b.end_at).min) : K.countdown(b.start_at)}</span></div>
        <h2>${esc(b.client_name || 'Client')}</h2>
        <p class="num">${esc(b.service_name)} · ${timeRange(b)}</p>
        ${b.client_note ? `<p class="cab-next__note">“${esc(b.client_note)}”</p>` : ''}
        ${b.status === 'pending' ? '<span class="bstat bstat--pending">Not confirmed yet</span>' : ''}
        <div class="cab-next__actions">
          ${b.client_phone ? `<a class="btn btn--primary" href="${esc(telHref(b.client_phone))}">${K.I.phone}Call</a>
          <a class="btn btn--soft" href="${esc(smsHref(b.client_phone))}">${icon('<path d="M20.5 11.8a8.3 8.3 0 0 1-12.2 7.3L3.5 20.5l1.4-4.6a8.3 8.3 0 1 1 15.6-4.1z"/>')}Text</a>` : ''}
        </div>
      </section>`;
  }

  /* open working time not taken by bookings or time off */
  function freeWindows(off, list) {
    const dow = K.studioDate(off).dow;
    let wins = (S.sched.hours || []).filter(h => h.weekday === dow).map(h => ({ s: minOf(h.start), e: minOf(h.end) }));
    const busy = list.filter(isActive).map(b => ({ s: spot(b.start_at).min, e: spot(b.end_at).min }))
      .concat(timeOffOn(off));
    if (off === 0) {
      const nowMin = K.studioSpot(Date.now()).min;
      busy.push({ s: 0, e: Math.ceil(nowMin / 15) * 15 });
    }
    busy.forEach(x => {
      wins = wins.flatMap(w => (x.e <= w.s || x.s >= w.e) ? [w] : [{ s: w.s, e: x.s }, { s: x.e, e: w.e }].filter(p => p.e - p.s > 0));
    });
    return wins.filter(w => w.e - w.s >= 30);
  }
  function timeOffOn(off) {
    const start = Date.parse(dayStartIso(off));
    const end = Date.parse(dayStartIso(off + 1));
    return (S.sched.time_off || []).filter(t => Date.parse(t.start_at) < end && Date.parse(t.end_at) > start).map(t => ({
      s: Date.parse(t.start_at) <= start ? 0 : spot(t.start_at).min,
      e: Date.parse(t.end_at) >= end ? 24 * 60 : spot(t.end_at).min,
      reason: t.reason
    }));
  }

  /* ---------- Timeline (Today + Calendar day) ---------- */
  const PX = 1.25; // px per minute
  function timelineHTML(off, list) {
    const dow = K.studioDate(off).dow;
    const hours = (S.sched.hours || []).filter(h => h.weekday === dow).map(h => ({ s: minOf(h.start), e: minOf(h.end) }));
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
    const offs = timeOffOn(off);
    let from = Math.min(9 * 60, ...hours.map(h => h.s), ...items.map(i => i.s));
    let to = Math.max(18 * 60, ...hours.map(h => h.e), ...items.map(i => i.e));
    from = Math.floor(from / 60) * 60;
    to = Math.min(24 * 60, Math.ceil(to / 60) * 60);
    const y = m => ((m - from) * PX).toFixed(1);
    const lines = [];
    for (let m = from; m <= to; m += 60) lines.push(`<div class="tl__h" style="top:${y(m)}px"><span>${m < 24 * 60 ? K.fmtTime(m) : ''}</span></div>`);
    const nowMin = off === 0 ? K.studioSpot(Date.now()).min : -1;
    return `
      <div class="tl" style="height:${((to - from) * PX).toFixed(0)}px" data-tl="${off}" data-from="${from}">
        ${hours.map(h => `<i class="tl__open" style="top:${y(h.s)}px;height:${((h.e - h.s) * PX).toFixed(1)}px"></i>`).join('')}
        ${lines.join('')}
        ${offs.map(o => `<div class="tl__off" style="top:${y(Math.max(from, o.s))}px;height:${((Math.min(to, o.e) - Math.max(from, o.s)) * PX).toFixed(1)}px"><span>${esc(o.reason || 'Time off')}</span></div>`).join('')}
        ${items.map(({ b, s, e }) => `
          <button class="tl__b tl__b--${b.status}${e - s < 40 ? ' is-short' : ''}" data-cab-b="${esc(b.id)}" style="top:${y(s)}px;height:${Math.max(26, (e - s) * PX - 3).toFixed(1)}px">
            <b>${esc(b.client_name || 'Client')}</b><span>${esc(b.service_name)}</span><small class="num">${timeRange(b)}</small>
          </button>`).join('')}
        ${cx.map(c => { const { b, s, e } = c; return `
          <button class="tl__b tl__b--cx${e - s < 40 ? ' is-short' : ''}${c.side || c.lanes > 1 ? ' is-narrow' : ''}" data-cab-b="${esc(b.id)}" style="${cxPos(c)}top:${y(s)}px;height:${Math.max(26, (e - s) * PX - 3).toFixed(1)}px">
            <b>${esc(b.client_name || 'Client')}</b>
            <span class="tl__tags"><em class="tl__tag">${b.status === 'cancelled_client' ? 'Cancelled by client' : 'Cancelled by you'}</em>${b.late_cancel ? '<em class="tl__tag tl__tag--late">Late cancel</em>' : ''}</span>
            <small class="num"><s>${timeRange(b)}</s></small>
          </button>`; }).join('')}
        ${nowMin >= from && nowMin <= to ? `<i class="tl__now" style="top:${y(nowMin)}px"></i>` : ''}
      </div>
      ${!items.length && !hours.length ? '<p class="cab-muted">Closed this day.</p>' : ''}`;
  }

  // section title + the "Show cancelled" switch
  function tlHead(title) {
    return `<div class="cab-tlhead"><span class="group-label">${title}</span>
      <label class="cab-cx">Show cancelled<button class="switch" role="switch" aria-checked="${S.showCx}" data-cab-showcx aria-label="Show cancelled bookings"></button></label></div>`;
  }

  /* ---------- CALENDAR ---------- */
  async function calendarHTML() {
    const seg = `<div class="segmented cab-seg" role="radiogroup" style="--n:2;--idx:${S.cal === 'week' ? 1 : 0}"><i class="segmented__thumb"></i>
      <button role="radio" data-cab-cal="day" aria-checked="${S.cal === 'day'}">Day</button>
      <button role="radio" data-cab-cal="week" aria-checked="${S.cal === 'week'}">Week</button></div>`;
    if (S.cal === 'week') {
      const d0 = K.studioDate(S.day);
      const start = S.day - ((d0.dow + 6) % 7); // Monday
      const list = await bookingsFor(start, 7);
      const a = K.studioDate(start);
      const b = K.studioDate(start + 6);
      return `
        <header class="cab-h"><h1>Calendar</h1>${seg}</header>
        <div class="cab-nav">
          <button class="cab__ic" data-cab-shift="-7" aria-label="Previous week">${K.I.chevL}</button>
          <b>${K.MONTHS[a.month]} ${a.day} – ${a.month !== b.month ? K.MONTHS[b.month] + ' ' : ''}${b.day}</b>
          <button class="cab__ic" data-cab-shift="7" aria-label="Next week">${K.I.chevR}</button>
          ${S.day !== 0 ? '<button class="cab-today" data-cab-today>Today</button>' : ''}
        </div>
        ${weekHTML(start, list)}`;
    }
    const list = await bookingsFor(S.day, 1);
    return `
      <header class="cab-h"><h1>Calendar</h1>${seg}</header>
      <div class="cab-nav">
        <button class="cab__ic" data-cab-shift="-1" aria-label="Previous day">${K.I.chevL}</button>
        <b>${esc(K.dayLabel(S.day, true))}</b>
        <button class="cab__ic" data-cab-shift="1" aria-label="Next day">${K.I.chevR}</button>
        ${S.day !== 0 ? '<button class="cab-today" data-cab-today>Today</button>' : ''}
      </div>
      ${tlHead('Day')}
      <div class="cab-day" data-swipe>${timelineHTML(S.day, list)}</div>
      ${(() => { const free = S.day >= 0 ? freeWindows(S.day, list) : []; return free.length ? `
      <div class="group-label">Free windows</div>
      <div class="cab-free">${free.map(w => `<button class="chip" data-cab-new-at="${S.day}:${w.s}">${K.fmtClock(w.s)} – ${K.fmtClock(w.e)}</button>`).join('')}</div>` : ''; })()}`;
  }

  function weekHTML(start, list) {
    const from = 8 * 60;
    const to = 20 * 60;
    const H = 7 * 60 / 60; // not used: rows are percentage based
    void H;
    const cols = [];
    for (let i = 0; i < 7; i++) {
      const off = start + i;
      const d = K.studioDate(off);
      const day = list.filter(b => spot(b.start_at).off === off && (S.showCx || !b.status.startsWith('cancelled')));
      const open = (S.sched.hours || []).filter(h => h.weekday === d.dow);
      cols.push(`
        <div class="wk__col${off === 0 ? ' is-today' : ''}">
          <button class="wk__d" data-cab-goday="${off}"><small>${K.DAY_SHORT[d.dow].charAt(0)}</small><b class="num">${d.day}</b></button>
          <div class="wk__body">
            ${open.map(h => `<i class="wk__open" style="top:${pct(minOf(h.start), from, to)}%;height:${pct(minOf(h.end), from, to) - pct(minOf(h.start), from, to)}%"></i>`).join('')}
            ${day.map(b => { const s = spot(b.start_at).min; const e = Math.max(s + 20, spot(b.end_at).min); return `<button class="wk__b tl__b--${b.status}${b.status.startsWith('cancelled') ? ' tl__b--cx' : ''}" data-cab-b="${esc(b.id)}" style="top:${pct(s, from, to)}%;height:${pct(e, from, to) - pct(s, from, to)}%" aria-label="${esc(b.client_name)} ${esc(whenLine(b))}"><span>${esc(String(b.client_name || '').split(' ')[0])}</span></button>`; }).join('')}
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
      <header class="cab-h"><h1>Requests</h1></header>
      ${list.length ? `<p class="cab-muted">Swipe right to approve, left to decline.</p>
      <div class="cab-reqs">${list.map(b => `
        <div class="req" data-req="${esc(b.id)}">
          <div class="req__bg"><span class="req__yes">${K.I.check}Approve</span><span class="req__no">Decline${K.I.x}</span></div>
          <div class="req__card card">
            <div class="req__top"><b>${esc(b.client_name || 'Client')}</b><small>${ago(b.created_at)}</small></div>
            <p class="num">${esc(b.service_name)} · ${esc(whenLine(b))}</p>
            ${b.client_note ? `<p class="req__note">“${esc(b.client_note)}”</p>` : ''}
            <div class="req__actions">
              <button class="btn btn--soft btn--sm" data-req-no="${esc(b.id)}">Decline</button>
              <button class="btn btn--primary btn--sm" data-req-yes="${esc(b.id)}">Approve</button>
            </div>
          </div>
        </div>`).join('')}</div>` : `
      <div class="cab-empty">${K.art('bell')}<b>No requests</b><span>${auto ? 'Auto-confirm is on — new bookings are confirmed instantly. You can change it in Hours.' : 'New booking requests will show up here.'}</span></div>`}`;
  }

  async function decide(id, yes) {
    const card = $(`[data-req="${id}"]`);
    if (card) card.classList.add(yes ? 'is-yes' : 'is-no');
    S.self.add(id);
    try {
      await K.Backend.owner.setStatus(id, yes ? 'confirmed' : 'cancelled_master', yes ? null : 'Declined');
      K.haptic(yes ? [10, 30, 10] : 20);
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
    S.clients = await K.Backend.owner.clients(S.studio.id, S.q);
    return `
      <header class="cab-h"><h1>Clients</h1></header>
      <label class="search">${K.I.search}<input id="cab-q" type="search" placeholder="Name, phone or email" value="${esc(S.q)}" autocomplete="off" enterkeyhint="search"></label>
      <div id="cab-clients">${clientsListHTML()}</div>`;
  }
  function clientsListHTML() {
    const list = S.clients || [];
    if (!list.length) return `<div class="cab-empty">${K.art('heart')}<b>${S.q ? 'Nobody found' : 'No clients yet'}</b><span>${S.q ? 'Try a part of the name or the last digits of the phone.' : 'Everyone who books shows up here.'}</span></div>`;
    return `<div class="list">${list.map(c => `
      <button class="row row--link cl-row" data-cab-client="${esc(c.id)}">
        <span class="cl-av">${esc(String(c.name || '?').trim().charAt(0).toUpperCase())}</span>
        <span class="row__label">${esc(c.name)}<span class="row__sub num">${esc(phoneText(c.phone))}${c.next_visit ? ' · next ' + esc(K.dayLabel(spot(c.next_visit).off, false)) : ''}</span></span>
        <span class="row__value num">${c.visits ? c.visits + '×' : 'new'}</span>
        <span class="row__chev">${K.I.chevR}</span>
      </button>`).join('')}</div>`;
  }
  let qTimer = 0;
  function onSearch(v) {
    S.q = v;
    clearTimeout(qTimer);
    qTimer = setTimeout(async () => {
      try { S.clients = await K.Backend.owner.clients(S.studio.id, S.q); } catch (e) { return; }
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
      const done = h.filter(b => b.status === 'completed');
      const spent = done.reduce((s, b) => s + (+b.price || 0), 0);
      box.innerHTML = `
        <header class="ob__head"><span class="eyebrow">Client</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
        <h2>${esc(c.name)}</h2>
        <p class="ob__sub num">${esc(phoneText(c.phone))}${c.email ? ' · ' + esc(c.email) : ''}${spent ? ' · ' + money(spent) + ' spent' : ''}</p>
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
        <label class="field"><span>Your notes</span><textarea id="cl-notes" rows="4" maxlength="2000" placeholder="Lash map, allergies, preferences…">${esc(c.notes)}</textarea></label>
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
      await K.Backend.owner.setNotes(id, v);
      K.haptic();
      K.toast('Notes saved', 'ok');
      const c = (S.clients || []).find(x => x.id === id);
      if (c) c.notes = v;
    } catch (e) { K.toast(err(e), 'x'); }
  }

  /* ---------- HOURS ---------- */
  async function hoursHTML() {
    if (!S.hrs || !S.hrsDirty) {
      S.sched = await K.Backend.owner.schedule(S.studio.id);
      S.hrs = {};
      for (let d = 0; d < 7; d++) S.hrs[d] = (S.sched.hours || []).filter(h => h.weekday === d).map(h => ({ s: h.start, e: h.end }));
    }
    const r = S.sched.rules || {};
    const order = [1, 2, 3, 4, 5, 6, 0];
    const sel = (name, value, opts, fmt) => `<select class="cab-sel" data-rule="${name}">${opts.map(o => `<option value="${o}"${+o === +value ? ' selected' : ''}>${fmt(o)}</option>`).join('')}</select>`;
    const hrsFmt = h => (h === 0 ? 'None' : h < 24 ? h + ' h' : h / 24 + (h === 24 ? ' day' : ' days'));
    return `
      <header class="cab-h"><h1>Hours</h1></header>
      <div class="group-label">Working hours</div>
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
        ${(S.sched.time_off || []).map(t => `
          <div class="row">
            <span class="row__label">${esc(t.reason || 'Time off')}<span class="row__sub num">${esc(offRange(t))}</span></span>
            <button class="hrs__del" data-toff-del="${esc(t.id)}" aria-label="Delete">${K.I.x}</button>
          </div>`).join('') || '<div class="row"><span class="row__label cab-muted">No time off planned</span></div>'}
      </div>
      ${toffFormHTML()}

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
      <p class="cab-muted">Clients see these rules on the Review step.</p>`;
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
      S.sched = await K.Backend.owner.saveHours(S.studio.id, r.flat);
      S.hrsDirty = false;
      K.haptic([10, 30, 10]);
      K.toast('Working hours saved', 'ok');
      K.onDataChanged();
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
    try {
      await K.Backend.owner.addTimeOff(S.studio.id, start, end, v('toff-r'));
      // bookings inside the new time off are not touched — say so
      const clash = [...(S.known || new Map()).values()].filter(b => isActive(b) && Date.parse(b.start_at) < Date.parse(end) && Date.parse(b.end_at) > Date.parse(start));
      K.toast(clash.length ? `Added — ${clash.length} booking${clash.length > 1 ? 's' : ''} still in that time` : 'Time off added', clash.length ? 'bell' : 'ok');
      K.haptic();
      K.onDataChanged();
      S.hrsDirty = false;
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
    const box = $('#cab-push');
    if (!box) return;
    let st;
    try { st = await pushState(); } catch (e) { st = { state: 'unsupported' }; }
    S.push = st;
    if (st.state === 'on') saveSub(st.sub, true); // keep the server copy fresh
    const b2 = $('#cab-push');
    if (b2) b2.innerHTML = pushCardHTML(st);
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
      actions.push(`<button class="btn btn--soft" data-ob-move>${icon('<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>')}Reschedule</button>`);
      if (b.status !== 'pending') actions.push(`<button class="btn btn--soft ob__danger" data-ob-cancel>${K.I.x}Cancel</button>`);
    }
    if (isActive(b) && started) {
      actions.push(`<button class="btn btn--primary" data-ob-set="completed">${K.I.check}Mark completed</button>`);
      actions.push(`<button class="btn btn--soft ob__danger" data-ob-set="no_show">No-show</button>`);
    }
    box.innerHTML = `
      <header class="ob__head"><span class="bstat bstat--${b.status}">${esc(statusLabel(b.status))}</span><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
      <h2>${esc(b.client_name || 'Client')}</h2>
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
      <div class="card bk-sum">
        <div class="bk-row"><span>Service</span><b>${esc(b.service_name)}</b></div>
        ${b.price != null ? `<div class="bk-row"><span>Price</span><b class="num">${money(b.price)}</b></div>` : ''}
        <div class="bk-row"><span>Phone</span><b class="num">${esc(phoneText(b.client_phone))}</b></div>
        ${b.client_email ? `<div class="bk-row"><span>Email</span><b>${esc(b.client_email)}</b></div>` : ''}
        ${b.client_note ? `<div class="bk-row bk-row--addr"><span>Note</span><b>${esc(b.client_note)}</b></div>` : ''}
        <div class="bk-row"><span>Booked</span><b>${esc(ago(b.created_at))} · ${b.created_by === 'master' ? 'by you' : 'online'}</b></div>
        ${b.late_cancel ? '<div class="bk-row bk-row--accent"><span>Late change</span><b>Yes</b></div>' : ''}
        ${b.cancel_reason ? `<div class="bk-row bk-row--addr"><span>Reason</span><b>${esc(b.cancel_reason)}</b></div>` : ''}
      </div>
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
      ob.b = await K.Backend.owner.setStatus(b.id, status, reason || null);
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
    const p = ob.pick || (ob.pick = { off: b ? Math.max(0, spot(b.start_at).off) : 0, min: null, iso: null, slots: null, custom: '', force: false });
    return `
      <header class="ob__head"><button class="cab-back" data-ob-back>${K.I.chevL}Back</button><button class="sheet__x" data-sheet-close aria-label="Close">${K.I.x}</button></header>
      <h2>${esc(title)}</h2>
      ${b ? `<p class="ob__sub">${esc(b.client_name)} · ${esc(b.service_name)} · now ${esc(whenLine(b))}</p>` : ''}
      ${dayStripHTML(p.off)}
      <div class="bk-label">${esc(K.dayLabel(p.off, true))}</div>
      <div class="times" id="pk-times">${'<i class="time time--sk"></i>'.repeat(6)}</div>
      <label class="field pk-custom"><span>Or another time</span><input type="time" step="300" id="pk-custom" value="${esc(p.custom)}"></label>
      <div id="pk-warn"></div>
      <button class="btn btn--primary btn--block" data-pk-go disabled>${b ? 'Move here' : 'Next'}</button>`;
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
      const list = await K.Backend.owner.slots(S.studio.id, svc, K.dateKey(off), ob.mode === 'move' ? ob.b.id : null);
      if (p.off !== off) return;
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
    try {
      ob.b = await K.Backend.owner.reschedule(ob.b.id, iso, ob.pick.force);
      ob.busy = false;
      ob.mode = 'view';
      ob.pick = null;
      K.haptic([10, 30, 10]);
      K.toast('Moved — the client will see the new time', 'ok');
      renderOb(true);
      K.onDataChanged();
      syncChanges(true).then(() => refreshView());
    } catch (e) {
      ob.busy = false;
      if (e.code === 'outside_hours' && !ob.pick.force) { ob.pick.force = true; paintPicker(); K.haptic(20); return; }
      K.toast(err(e), 'x');
      if (e.code === 'slot_taken') loadPicker();
    }
  }

  /* =========================================================
     New booking (the master books a client who called)
     ========================================================= */
  const nb = { svc: null, name: '', phone: '', email: '', note: '', step: 'time', sugg: [] };

  function openNew(at, who) {
    nb.svc = nb.svc && K.data.services.some(s => s.id === nb.svc) ? nb.svc : (K.data.services[0] && K.data.services[0].id);
    Object.assign(nb, { name: '', phone: '', email: '', note: '', step: 'time', sugg: [] }, who || {});
    ob.mode = 'new';
    ob.b = null;
    ob.busy = false;
    ob.pick = { off: at ? at.off : S.tab === 'calendar' ? Math.max(0, S.day) : 0, min: at ? at.min : null, iso: null, slots: null, custom: '', force: false };
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
        <p class="ob__sub">${esc(s ? s.title : '')} · ${esc(K.dayLabel(spot(iso).off, false))} · ${K.fmtClock(spot(iso).min)}</p>
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
      const b = await K.Backend.owner.create(S.studio.id, { serviceId: nb.svc, startAt: iso, name: nb.name.trim(), phone: nb.phone, email: nb.email.trim(), note: nb.note.trim() }, ob.pick.force);
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
    if ((el = t.closest('[data-cab-retry]'))) { S.cache = {}; refreshView(true); return; }
    if ((el = t.closest('[data-cab-new]'))) { openNew(null); return; }
    if ((el = t.closest('[data-cab-new-at]'))) { const [o, m] = el.dataset.cabNewAt.split(':').map(Number); openNew({ off: o, min: m }); return; }
    if ((el = t.closest('[data-cab-new-for]'))) {
      const who = { name: el.dataset.name, phone: el.dataset.phone, email: el.dataset.email };
      K.Sheet.close();
      setTimeout(() => openNew(null, who), 380);
      return;
    }
    if ((el = t.closest('[data-cab-b]'))) {
      const id = el.dataset.cabB;
      if (inSheet) { K.Sheet.close(); setTimeout(() => openBooking(id), 380); } else openBooking(id);
      return;
    }
    if ((el = t.closest('[data-cab-client]'))) {
      const id = el.dataset.cabClient;
      if (inSheet) { K.Sheet.close(); setTimeout(() => openClient(id), 380); } else openClient(id);
      return;
    }
    if ((el = t.closest('[data-cl-save]'))) { saveNotes(el.dataset.clSave); return; }
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
    // requests
    if ((el = t.closest('[data-req-yes]'))) { decide(el.dataset.reqYes, true); return; }
    if ((el = t.closest('[data-req-no]'))) { decide(el.dataset.reqNo, false); return; }
    // hours
    if ((el = t.closest('[data-hrs-toggle]'))) {
      const d = +el.dataset.hrsToggle;
      S.hrs[d] = S.hrs[d] && S.hrs[d].length ? [] : [{ s: '09:00', e: '17:00' }];
      S.hrsDirty = true;
      K.haptic();
      refreshView();
      return;
    }
    if ((el = t.closest('[data-hrs-add]'))) {
      const d = +el.dataset.hrsAdd;
      const last = S.hrs[d][S.hrs[d].length - 1];
      const s = Math.min(minOf(last.e) + 60, 22 * 60);
      S.hrs[d].push({ s: hhmm(s), e: hhmm(Math.min(s + 180, 23 * 60 + 45)) });
      S.hrsDirty = true;
      refreshView();
      return;
    }
    if ((el = t.closest('[data-hrs-del]'))) {
      const [d, i] = el.dataset.hrsDel.split(':').map(Number);
      S.hrs[d].splice(i, 1);
      S.hrsDirty = true;
      refreshView();
      return;
    }
    if ((el = t.closest('[data-hrs-save]'))) { if (!el.disabled) saveHours(); return; }
    if ((el = t.closest('[data-toff-add]'))) { addTimeOff(); return; }
    if ((el = t.closest('[data-toff-del]'))) {
      K.Backend.owner.deleteTimeOff(el.dataset.toffDel).then(() => { K.toast('Time off removed', 'ok'); K.onDataChanged(); refreshView(); }, x => K.toast(err(x), 'x'));
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
      openNew({ off: +el.dataset.tl, min });
    }
  }

  function onInput(e) {
    if (!root) return;
    const t = e.target;
    if (t.id === 'cab-q') { onSearch(t.value); return; }
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
    if (t.dataset && t.dataset.rule) { saveRule(t.dataset.rule, +t.value); return; }
    if (t.matches && t.matches('[data-nb-svc]')) {
      nb.svc = t.value;
      ob.pick.slots = null;
      ob.pick.min = null;
      loadPicker();
    }
  }

  function afterRender(tab) {
    if (tab === 'today') paintPush();
    if (tab === 'requests') bindSwipes();
    if (tab === 'calendar') bindDaySwipe();
    if (tab === 'today' || (tab === 'calendar' && S.cal === 'day')) {
      // bring "now" (or the first booking) into view
      const now = $('.tl__now') || $('.tl__b');
      if (now && tab === 'calendar') { const main = $('#cab-main'); main.scrollTop = Math.max(0, now.offsetTop - 120); }
    }
  }

  function shiftDay(d) {
    S.day += d;
    const g = K.G();
    const box = $('.cab-day, .wk');
    if (g && box) K.ensure(g.fromTo(box, { x: d > 0 ? 40 : -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.35, ease: 'power3.out', clearProps: 'transform,opacity', delay: 0.08 }));
    K.haptic();
    refreshView();
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
    S.known = null;
    K.toast('Signed out', 'ok');
    renderAuth();
  }

  window.StudioCabinet = { open, close: () => close() };
})();
