/* =========================================================
   Satinbook — the demo studio's dashboard data (satinbook.com/demo?owner=1).
   The real dashboard (cabinet.js) runs on this instead of Supabase: the same
   calls, the same answers (shapes copied from the database functions), but
   everything lives in this page's memory — nothing is sent anywhere, and a
   reload (or "Reset") starts over. Dates are counted from today, so the demo
   always has a today, a week ahead and twelve weeks of history.
   ========================================================= */
(function () {
  'use strict';

  function create(opts) {
    const data = opts.data;
    const TZ = data.timezone || 'America/New_York';
    const zonedMs = opts.zonedMs;
    const say = opts.toast || (() => {});
    const BackendError = opts.BackendError || class extends Error { constructor(code, m) { super(m || code); this.code = code; } };
    const MID = 'demo-studio';

    /* ---------- time, in the studio's time zone ---------- */
    const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    function parts(ms) {
      const o = {};
      fmt.formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
      return { y: +o.year, m: +o.month, d: +o.day, dow: DOW.indexOf(o.weekday), min: (+o.hour % 24) * 60 + +o.minute };
    }
    const pad = n => String(n).padStart(2, '0');
    const ymd = p => `${p.y}-${pad(p.m)}-${pad(p.d)}`;
    const addDays = (p, n) => { const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), dow: t.getUTCDay() }; };
    const dayStart = p => zonedMs(p.y, p.m, p.d, 0);
    const iso = ms => new Date(ms).toISOString();
    const at = (off, min) => { const p = addDays(parts(Date.now()), off); return zonedMs(p.y, p.m, p.d, min); };
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => (Math.random() * 16 | 0).toString(16)));
    const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
    // a real answer takes a moment; the dashboard is built for that
    const reply = v => new Promise(r => setTimeout(() => r(clone(v)), 70));
    const fail = code => new Promise((r, j) => setTimeout(() => j(new BackendError(code)), 70));
    let seed = 0;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const pick = list => list[Math.floor(rnd() * list.length)];

    let DB;
    function build() {
      const today = parts(Date.now());
      seed = today.y * 372 + today.m * 31 + today.d; // the same demo all day long
      const now = Date.now();

      /* ---------- the studio, its masters, services ---------- */
      const studio = {
        id: MID, slug: 'demo', name: data.name, timezone: TZ, booking_engine: 'builtin', auto_confirm: true,
        min_notice_hours: 2, max_days_ahead: 60, cancel_window_hours: 24, slot_step_min: 30,
        deposit_hold_hours: 12, noshow_deposit: 30, phone: data.phone || null, address: data.address || null,
        status: 'active', kind: 'team', created_at: iso(now - 864e5), style: data.style || 'noir', accent: data.brandAccent || '#F4A6B8'
      };
      const svcs = (data.services || []).map((s, i) => {
        const min = +s.minutes || (() => { const h = /(\d+)\s*h/.exec(s.duration || ''); const m = /(\d+)\s*m/.exec(s.duration || ''); return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0) || 60; })();
        const fullSet = /full set/i.test(s.title);
        return {
          id: s.id, name: s.title, sort: i, photo: s.photo || null, price: +s.price, active: true,
          deposit: fullSet || /lift/i.test(s.title) ? 30 : 0, category: s.category || '', includes: s.includes || [],
          buffer_min: /brow/i.test(s.title) ? 10 : 15, created_at: iso(now - 120 * 864e5),
          fill_weeks: fullSet ? 3 : /fill/i.test(s.title) ? (/2-week/i.test(s.title) ? 2 : 3) : null, price_from: false,
          description: s.description || '', duration_min: min
        };
      });
      const svc = id => svcs.find(s => s.id === id);
      const find = re => (svcs.find(s => re.test(s.name)) || svcs[0]).id;
      const S = {
        classic: find(/classic/i), hybrid: find(/hybrid/i), volume: find(/volume/i), lift: find(/lift/i),
        browLam: find(/brow lamination/i), brow: find(/brow shaping/i), fill2: find(/2-week/i), fill3: find(/3-week/i)
      };
      const ARIA = 'st-aria', JAS = 'st-jasmine';
      const staff = [
        { id: ARIA, bio: 'Lash artist and owner — soft, natural sets and brows.', name: data.masterName || 'Aria', sort: 0, color: data.brandAccent || '#F4A6B8', email: 'aria@demo.satinbook.com',
          photo: data.avatar || null, title: 'Owner · lash & brow artist', active: true, is_owner: true, has_login: true, commission_pct: 0,
          services: svcs.map(s => ({ id: s.id, price: null, duration: null })) },
        { id: JAS, bio: 'Volume and hybrid sets, 5 years. Loves a wispy look.', name: 'Jasmine', sort: 1, color: '#FF9500', email: 'jasmine@demo.satinbook.com',
          photo: null, title: 'Senior lash artist', active: true, is_owner: false, has_login: true, commission_pct: 40,
          services: svcs.filter(s => !/brow/i.test(s.name)).map(s => ({ id: s.id, price: s.id === S.volume ? 190 : null, duration: null })) }
      ];
      // Aria Mon–Sat, Jasmine Tue–Sun: the salon is open every day
      const hours = [];
      [1, 2, 3, 4, 5, 6].forEach(w => hours.push({ staff_id: ARIA, weekday: w, start: '10:00', end: '18:00' }));
      [0, 2, 3, 4, 5, 6].forEach(w => hours.push({ staff_id: JAS, weekday: w, start: '10:00', end: '18:00' }));

      /* ---------- clients ---------- */
      const C = [
        ['Jessica Moore', ['VIP'], 'Loves a natural classic. Always 5 min early.', S.classic, 2, ARIA],
        ['Taylor Brooks', [], 'Volume, wispy. Sleeps on her side — left eye sheds more.', S.volume, 3, JAS],
        ['Brianna King', [], 'Hybrid. Prefers afternoon appointments.', S.hybrid, 3, ARIA],
        ['Nicole Walker', ['VIP'], 'Brides-to-be referral. Hybrid, longer outer corners.', S.hybrid, 2, JAS],
        ['Ashley Price', ['Allergy'], 'Sensitive to cyanoacrylate fumes — sensitive glue, fan on low.', S.classic, 3, ARIA],
        ['Kayla Johnson', ['Patch test done'], 'First volume set coming up. Patch test fine.', S.volume, 3, JAS],
        ['Morgan Davis', [], 'Brow lamination every 6 weeks. Light tint.', S.browLam, 6, ARIA],
        ['Destiny Harris', [], 'Lash lift & tint — keeps them natural for work.', S.lift, 6, JAS],
        ['Lauren Scott', [], 'Brow shaping. Asked about lamination next time.', S.brow, 4, ARIA],
        ['Mia Lopez', ['New'], 'Found us on Instagram. First full set.', S.classic, 3, JAS]
      ];
      const clients = C.map(([name, tags, notes], i) => ({
        id: uuid(), name, tags, notes, phone: '+1404555' + String(1101 + i * 7).padStart(4, '0'),
        email: name.toLowerCase().replace(/[^a-z]+/g, '.') + '@example.com', created_at: iso(now - (90 + i * 3) * 864e5),
        patch_test_at: tags.includes('Patch test done') ? ymd(addDays(today, -9)) : null
      }));
      const byName = n => clients.find(c => c.name.startsWith(n));

      /* ---------- bookings ---------- */
      const bookings = [];
      const busy = {}; // staff|ymd → [[start, end]]
      const free = (st, startMs, endMs) => !(busy[st + '|' + ymd(parts(startMs))] || []).some(([a, z]) => startMs < z && endMs > a);
      const works = (st, p) => hours.some(h => h.staff_id === st && h.weekday === p.dow);
      function add(o) {
        const s = svc(o.svc);
        const start = o.start;
        const end = start + s.duration_min * 6e4;
        const k = o.staff + '|' + ymd(parts(start));
        (busy[k] = busy[k] || []).push([start, end + s.buffer_min * 6e4]);
        const st = staff.find(x => x.id === o.staff);
        const own = (st.services.find(x => x.id === s.id) || {}).price;
        const created = o.created || start - (3 + Math.floor(rnd() * 10)) * 864e5;
        const b = {
          id: uuid(), staff_id: o.staff, service_id: s.id, client_id: o.client.id, start_at: iso(start), end_at: iso(end),
          status: o.status, price: own != null ? own : s.price, service_name: s.name, client_note: o.note || '', manage_token: uuid(),
          late_cancel: !!o.late, created_by: o.by || 'client', created_at: iso(Math.min(created, now)), updated_at: iso(Math.min(o.updated || created, now)),
          cancelled_at: o.status.startsWith('cancelled') ? iso(o.cancelledAt || Math.min(start - 2 * 864e5, now)) : null,
          cancel_reason: o.reason || null, completed_at: o.status === 'completed' ? iso(end) : null, auto_completed: false,
          deposit: s.deposit, deposit_status: s.deposit ? (o.dep || (o.status === 'completed' || o.status === 'confirmed' || o.status === 'no_show' ? 'paid' : 'none')) : 'none',
          deposit_due_at: o.dep === 'pending' ? iso(now + 9 * 3600e3) : null, deposit_paid_at: null
        };
        if (b.deposit_status === 'paid') b.deposit_paid_at = iso(Math.min(created + 3600e3, now));
        bookings.push(b);
        return b;
      }

      // twelve weeks back: every client on her own rhythm (fills every 2–3 weeks, brows every 4–6)
      const TIMES = [10 * 60, 11 * 60 + 30, 13 * 60, 14 * 60 + 30, 16 * 60];
      C.forEach(([, , , main, every, pref], i) => {
        const c = clients[i];
        const step = every * 7;
        let off = -1 - Math.floor(rnd() * step) - 1;
        const visits = [];
        while (off > -84) { visits.unshift(off); off -= step + (rnd() < 0.3 ? 1 : 0); }
        visits.forEach((o, n) => {
          let p = addDays(today, o);
          let st = works(pref, p) ? pref : pref === ARIA ? JAS : ARIA;
          if (!works(st, p)) { p = addDays(today, o - 1); st = works(pref, p) ? pref : st; }
          const s = n === 0 || /brow|lift/i.test(svc(main).name) ? main : every === 2 ? S.fill2 : S.fill3;
          if (st === JAS && /brow/i.test(svc(s).name)) st = ARIA;
          const t = TIMES.map(m => zonedMs(p.y, p.m, p.d, m)).find(ms => free(st, ms, ms + svc(s).duration_min * 6e4));
          if (t == null) return;
          // most visits happen; a few don't (a no-show, a late cancel, a cancel, the studio once)
          const r = rnd();
          const status = r < 0.05 ? 'no_show' : r < 0.1 ? 'cancelled_client' : r < 0.12 ? 'cancelled_master' : 'completed';
          add({ staff: st, svc: s, client: c, start: t, status, late: status === 'cancelled_client' && rnd() < 0.4,
            reason: status === 'cancelled_master' ? 'Running a fever — so sorry!' : status === 'cancelled_client' ? 'Plans changed' : null,
            cancelledAt: status === 'cancelled_client' ? t - (rnd() < 0.4 ? 3 : 30) * 3600e3 : null });
        });
      });

      // yesterday: always a visit done, a no-show and a late cancel
      const yd = addDays(today, -1);
      const Y = (st, min, name, s, status, extra) => {
        const p = works(st, yd) ? st : st === ARIA ? JAS : ARIA;
        const t = zonedMs(yd.y, yd.m, yd.d, min);
        if (works(p, yd) && free(p, t, t + svc(s).duration_min * 6e4)) add(Object.assign({ staff: p, svc: s, client: byName(name), start: t, status }, extra || {}));
      };
      Y(ARIA, 11 * 60, 'Ashley', S.fill3, 'completed');
      Y(JAS, 12 * 60, 'Mia', S.classic, 'no_show');
      Y(ARIA, 15 * 60, 'Lauren', S.brow, 'cancelled_client', { late: true, reason: 'Stuck at work', cancelledAt: zonedMs(yd.y, yd.m, yd.d, 13 * 60 + 20) });
      Y(JAS, 15 * 60 + 30, 'Taylor', S.fill3, 'completed');

      // today: what is already behind her is done (or not), what is ahead waits
      const TODAY = [
        [ARIA, 10 * 60, 'Jessica', S.fill2, 'Just a refill, same map'],
        [JAS, 10 * 60 + 30, 'Destiny', S.lift, ''],
        [ARIA, 12 * 60 + 30, 'Morgan', S.browLam, ''],
        [JAS, 13 * 60, 'Kayla', S.volume, 'First volume set — so excited!'],
        [ARIA, 15 * 60, 'Nicole', S.hybrid, ''],
        [JAS, 16 * 60, 'Brianna', S.fill3, ''],
        [ARIA, 17 * 60, 'Mia', S.lift, '']
      ];
      const PAST = ['completed', 'completed', 'no_show', 'completed', 'cancelled_late', 'completed', 'completed'];
      const AHEAD = ['confirmed', 'awaiting', 'pending', 'confirmed', 'confirmed', 'confirmed', 'confirmed'];
      let pi = 0;
      let fi = 0;
      TODAY.forEach(([st, min, name, s, note]) => {
        if (!works(st, today)) return;
        const t = zonedMs(today.y, today.m, today.d, min);
        if (!free(st, t, t + svc(s).duration_min * 6e4)) return;
        const done = t + svc(s).duration_min * 6e4 < now;
        const k = done ? PAST[pi++ % PAST.length] : AHEAD[fi++ % AHEAD.length];
        if (k === 'cancelled_late') add({ staff: st, svc: s, client: byName(name), start: t, status: 'cancelled_client', late: true, reason: 'Babysitter cancelled', cancelledAt: Math.min(now, t - 2 * 3600e3) });
        else if (k === 'awaiting') add({ staff: st, svc: s, client: byName(name), start: t, status: 'confirmed', dep: 'pending', note, created: now - 2 * 3600e3 });
        else if (k === 'pending') add({ staff: st, svc: s, client: byName(name), start: t, status: 'pending', dep: svc(s).deposit ? 'pending' : null, note, created: now - 40 * 6e4 });
        else add({ staff: st, svc: s, client: byName(name), start: t, status: k, note });
      });

      // the week ahead: mostly confirmed, one waiting for a deposit, one request, one cancelled
      for (let off = 1; off <= 7; off++) {
        const p = addDays(today, off);
        [ARIA, JAS].forEach((st, si) => {
          if (!works(st, p)) return;
          const n = 1 + Math.floor(rnd() * 3);
          for (let k = 0; k < n; k++) {
            const c = clients[(off * 3 + si * 5 + k) % clients.length];
            const s = st === JAS ? pick([S.volume, S.hybrid, S.fill3, S.fill2, S.lift]) : pick([S.classic, S.fill2, S.browLam, S.brow, S.hybrid]);
            const t = TIMES.map(m => zonedMs(p.y, p.m, p.d, m)).find(ms => free(st, ms, ms + svc(s).duration_min * 6e4));
            if (t == null) continue;
            const special = off === 1 && k === 0 && si === 0 ? 'awaiting' : off === 2 && k === 0 ? 'pending' : off === 3 && k === 0 && si === 1 ? 'cancelled' : '';
            if (special === 'awaiting') add({ staff: st, svc: S.volume, client: c, start: t, status: 'confirmed', dep: 'pending', created: now - 3600e3 });
            else if (special === 'pending') add({ staff: st, svc: s, client: c, start: t, status: 'pending', created: now - 3 * 3600e3, note: 'Is there anything earlier this week?' });
            else if (special === 'cancelled') add({ staff: st, svc: s, client: c, start: t, status: 'cancelled_client', reason: 'Feeling unwell', cancelledAt: now - 5 * 3600e3 });
            else add({ staff: st, svc: s, client: c, start: t, status: 'confirmed' });
          }
        });
      }

      /* ---------- lash maps, looks, emails ---------- */
      const formulas = [];
      const MAPS = [['C', '8-11', '0.07', 'Classic', 'Natural, a touch longer on the outer third'], ['D', '9-13', '0.05', 'Volume', 'Wispy spikes every 5th, 4D fans'],
        ['CC', '9-12', '0.07', 'Hybrid', 'Open-eye map, longest at the center'], ['C', '8-12', '0.15', 'Classic', 'Doll eye — shorter corners'],
        ['D', '10-13', '0.05', 'Volume', 'Cat eye, 13 mm on the outer corners'], ['CC', '9-11', '0.07', 'Hybrid', 'Soft hybrid, 50/50']];
      clients.forEach((c, i) => {
        if (i > 5) return;
        const last = bookings.filter(b => b.client_id === c.id && b.status === 'completed').sort((a, b) => b.start_at.localeCompare(a.start_at))[0];
        if (!last) return;
        const [curl, lengths, thickness, lash_type, note] = MAPS[i];
        formulas.push({ id: uuid(), curl, glue: i === 4 ? 'Sensitive (3–4 s)' : 'Fast-dry (1–2 s)', note, photo: null, lengths, staff_id: last.staff_id, client_id: c.id,
          lash_type, thickness, booking_id: last.id, created_at: last.end_at });
      });
      const looks = (data.gallery || []).slice(0, 6).map((g, i) => ({
        id: 'lk-' + g.id, tag: g.tag || '', sort: i, photo: g.photo, title: g.title, is_new: i < 2, popular: !!g.popular,
        staff_id: i % 2 ? JAS : ARIA, created_at: iso(now - (i + 2) * 6 * 864e5), service_id: g.serviceId || null, before_photo: g.before || null
      }));
      const mails = bookings.filter(b => Date.parse(b.created_at) > now - 3 * 864e5).slice(0, 8).map(b => {
        const c = clients.find(x => x.id === b.client_id);
        return { kind: b.status === 'pending' ? 'request' : 'confirm', to: c.email, status: 'sent', subject: (b.status === 'pending' ? 'Request received: ' : 'You’re booked: ') + b.service_name, created_at: b.created_at, sent_at: b.created_at };
      }).concat(bookings.filter(b => b.status === 'completed' && Date.parse(b.start_at) > now - 2 * 864e5).slice(0, 3).map(b => {
        const c = clients.find(x => x.id === b.client_id);
        return { kind: 'reminder_24', to: c.email, status: 'sent', subject: 'Tomorrow: ' + b.service_name, created_at: iso(Date.parse(b.start_at) - 864e5), sent_at: iso(Date.parse(b.start_at) - 864e5) };
      })).sort((a, b) => b.created_at.localeCompare(a.created_at));

      const settings = {
        masterName: data.masterName || 'Aria', tagline: data.tagline || '', city: data.city || '', address: data.address || '', parking: data.parking || '',
        phone: data.phone || '', instagram: data.instagram || '', heroPhoto: data.heroPhoto || '', avatar: data.avatar || '',
        policies: (data.policies || []).map(p => ({ title: p.title, text: p.text })), aftercare: data.aftercare || [], prep: data.prep || [], faq: data.faq || [],
        payments: { cashapp: '$AriaLashATL', zelle: 'aria@demo.satinbook.com' }, rating: data.rating || 4.9, reviewCount: data.reviewCount || 128,
        yearsExp: 6, worksDone: 2400, worksLabel: 'sets done', reviewUrl: 'https://g.page/r/demo', defaultAccent: data.defaultAccent || undefined,
        emails: { confirm: true, changes: true, reminders: true, deposit: true, review: true, fill: true, day: false }
      };
      return { studio, staff, hours, svcs, clients, bookings, formulas, looks, timeOff: [], mails, settings };
    }
    DB = build();

    /* ---------- the same answers as the database functions ---------- */
    const staffOf = id => DB.staff.find(x => x.id === id) || null;
    const clientOf = id => DB.clients.find(x => x.id === id) || null;
    const serviceOf = id => DB.svcs.find(x => x.id === id) || null;
    const ACTIVE = ['pending', 'confirmed'];
    const noShows = cid => DB.bookings.filter(b => b.client_id === cid && b.status === 'no_show').length;
    const lastFormula = b => {
      const lim = Math.max(Date.parse(b.start_at), Date.now());
      const f = DB.formulas.filter(x => x.client_id === b.client_id && Date.parse(x.created_at) < lim).sort((a, c) => c.created_at.localeCompare(a.created_at))[0];
      return f ? { curl: f.curl, lengths: f.lengths, thickness: f.thickness, lash_type: f.lash_type, glue: f.glue, created_at: f.created_at } : null;
    };
    function row(b) {
      const s = serviceOf(b.service_id) || {};
      const st = staffOf(b.staff_id) || {};
      const c = clientOf(b.client_id) || {};
      return {
        id: b.id, status: b.status, start_at: b.start_at, end_at: b.end_at, price: b.price, service_id: b.service_id, service_name: b.service_name,
        service_photo: s.photo || null, duration_min: s.duration_min || null, staff_id: b.staff_id, staff_name: st.name || null, staff_color: st.color || null,
        client_id: b.client_id, client_name: c.name || null, client_phone: c.phone || null, client_email: c.email || null, client_tags: c.tags || [],
        client_no_shows: noShows(b.client_id), client_note: b.client_note, late_cancel: b.late_cancel, created_by: b.created_by, created_at: b.created_at,
        updated_at: b.updated_at, cancelled_at: b.cancelled_at, cancel_reason: b.cancel_reason, completed_at: b.completed_at, auto_completed: b.auto_completed,
        deposit: b.deposit, deposit_status: b.deposit_status, deposit_due_at: b.deposit_due_at, deposit_paid_at: b.deposit_paid_at, last_formula: lastFormula(b)
      };
    }
    function json(b) {
      const s = serviceOf(b.service_id) || {};
      const st = staffOf(b.staff_id) || {};
      const c = clientOf(b.client_id) || {};
      const start = Date.parse(b.start_at);
      const active = ACTIVE.includes(b.status);
      return {
        id: b.id, price: b.price, end_at: b.end_at, status: b.status, deposit: b.deposit, start_at: b.start_at, staff_id: b.staff_id, service_id: b.service_id,
        master: { kind: DB.studio.kind, name: DB.studio.name, slug: DB.studio.slug, phone: DB.settings.phone || null, address: DB.settings.address || null,
          payments: DB.settings.payments, timezone: TZ, review_url: DB.settings.reviewUrl || null, auto_confirm: DB.studio.auto_confirm, cancel_window_hours: DB.studio.cancel_window_hours },
        late_now: active && start > Date.now() && start - Date.now() < DB.studio.cancel_window_hours * 3600e3, can_change: active && start > Date.now(),
        fill_weeks: s.fill_weeks || null, staff_name: st.name || null, staff_photo: st.photo || null, updated_at: b.updated_at, client_name: c.name || null,
        client_note: b.client_note, late_cancel: b.late_cancel, cancelled_at: b.cancelled_at, completed_at: b.completed_at, duration_min: s.duration_min || null,
        manage_token: b.manage_token, service_name: b.service_name, cancel_reason: b.cancel_reason, service_photo: s.photo || null,
        client_visits: DB.bookings.filter(x => x.client_id === b.client_id && x.status === 'completed').length,
        deposit_due_at: b.deposit_due_at, deposit_status: b.deposit_status
      };
    }
    const touch = b => { b.updated_at = iso(Date.now()); };
    const sending = what => setTimeout(() => say(what, 'bell'), 1400);
    const digits = v => String(v || '').replace(/\D/g, '');
    const phoneE164 = v => { const d = digits(v); return d.length === 10 ? '+1' + d : d.length === 11 && d[0] === '1' ? '+' + d : '+' + d; };
    const hoursOf = st => DB.hours.filter(h => h.staff_id === st).map(h => ({ end: h.end, start: h.start, weekday: h.weekday })).sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
    const owner = () => DB.staff.find(x => x.is_owner);
    function schedule(staffId) {
      const st = staffId || owner().id;
      return {
        staff_id: st, hours: hoursOf(st),
        time_off: DB.timeOff.filter(o => Date.parse(o.end_at) > Date.now() && (o.staff_id === st || !o.staff_id))
          .map(o => ({ id: o.id, start_at: o.start_at, end_at: o.end_at, reason: o.reason, whole_studio: !o.staff_id })),
        rules: { auto_confirm: DB.studio.auto_confirm, slot_step_min: DB.studio.slot_step_min, max_days_ahead: DB.studio.max_days_ahead, noshow_deposit: DB.studio.noshow_deposit,
          takes_deposits: Object.values(DB.settings.payments || {}).some(v => String(v || '').trim()), min_notice_hours: DB.studio.min_notice_hours,
          deposit_hold_hours: DB.studio.deposit_hold_hours, cancel_window_hours: DB.studio.cancel_window_hours }
      };
    }
    // free starts for one master on one day: her hours, minus bookings (with buffers) and time off
    function freeStarts(stId, dateStr, svcId, ignore) {
      const s = serviceOf(svcId);
      if (!s) return [];
      const [y, m, d] = dateStr.split('-').map(Number);
      const p = { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
      const len = s.duration_min * 6e4;
      const buf = s.buffer_min * 6e4;
      const taken = DB.bookings.filter(b => b.staff_id === stId && b.id !== ignore && ACTIVE.concat('completed').includes(b.status))
        .map(b => [Date.parse(b.start_at), Date.parse(b.end_at) + ((serviceOf(b.service_id) || {}).buffer_min || 0) * 6e4]);
      const off = DB.timeOff.filter(o => !o.staff_id || o.staff_id === stId).map(o => [Date.parse(o.start_at), Date.parse(o.end_at)]);
      const out = [];
      DB.hours.filter(h => h.staff_id === stId && h.weekday === p.dow).forEach(h => {
        const [sh, sm] = h.start.split(':').map(Number);
        const [eh, em] = h.end.split(':').map(Number);
        for (let t = sh * 60 + sm; t + s.duration_min <= eh * 60 + em; t += DB.studio.slot_step_min) {
          const a = zonedMs(y, m, d, t);
          if (a < Date.now()) continue;
          if (taken.some(([x, z]) => a < z && a + len + buf > x) || off.some(([x, z]) => a < z && a + len > x)) continue;
          out.push(a);
        }
      });
      return out;
    }
    const doesService = (st, svcId) => !!st && st.active && st.services.some(x => x.id === svcId);

    /* ---------- Insights, as owner_insights ---------- */
    function insights(period, staffId) {
      const unit = period === 'month' ? 'month' : 'week';
      const nowP = parts(Date.now());
      const trunc = p => (unit === 'month' ? { y: p.y, m: p.m, d: 1 } : addDays(p, -((p.dow + 6) % 7)));
      const step = (p, n) => (unit === 'month' ? (() => { const t = new Date(Date.UTC(p.y, p.m - 1 + n, 1)); return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: 1 }; })() : addDays(p, 7 * n));
      const cur = trunc(nowP);
      const buckets = Array.from({ length: 12 }, (_, i) => step(cur, i - 11));
      const from = dayStart(buckets[0]);
      const to = dayStart(step(cur, 1));
      const bk = DB.bookings.filter(b => { const t = Date.parse(b.start_at); return t >= from && t < to && (!staffId || b.staff_id === staffId); });
      const live = b => ['pending', 'confirmed', 'completed', 'no_show'].includes(b.status);
      const sum = (l, f) => l.reduce((s, b) => s + (+f(b) || 0), 0);
      const bucketOf = b => { const p = parts(Date.parse(b.start_at)); return ymd(trunc(p)); };
      const series = buckets.map(p => {
        const k = ymd(p);
        const l = bk.filter(b => bucketOf(b) === k);
        return { start: k, cancels: l.filter(b => b.status === 'cancelled_client').length, revenue: sum(l.filter(b => b.status === 'completed'), b => b.price),
          bookings: l.filter(live).length, expected: sum(l.filter(b => ACTIVE.includes(b.status)), b => b.price), no_shows: l.filter(b => b.status === 'no_show').length,
          completed: l.filter(b => b.status === 'completed').length };
      });
      const done = bk.filter(b => b.status === 'completed');
      const doneTotal = cid => DB.bookings.filter(b => b.client_id === cid && b.status === 'completed' && Date.parse(b.start_at) < to && (!staffId || b.staff_id === staffId)).length;
      const cl = [...new Set(done.map(b => b.client_id))];
      const tops = {};
      bk.filter(live).forEach(b => { const t = tops[b.service_name] = tops[b.service_name] || { n: 0, name: b.service_name, revenue: 0 }; t.n++; if (b.status === 'completed') t.revenue += +b.price; });
      const days = [];
      for (let p = buckets[0]; dayStart(p) < to; p = addDays(p, 1)) days.push(p.dow === undefined ? addDays(p, 0) : p);
      return {
        period: unit, staff_id: staffId || null, series,
        totals: { cancels: bk.filter(b => b.status === 'cancelled_client').length, revenue: sum(done, b => b.price), bookings: bk.filter(live).length,
          no_shows: bk.filter(b => b.status === 'no_show').length, completed: done.length, late_cancels: bk.filter(b => b.status === 'cancelled_client' && b.late_cancel).length,
          deposits_paid: sum(bk.filter(b => b.deposit_status === 'paid'), b => b.deposit), studio_cancels: bk.filter(b => b.status === 'cancelled_master').length,
          deposit_expired: bk.filter(b => b.deposit_status === 'expired').length },
        top_services: Object.values(tops).sort((a, b) => b.n - a.n || b.revenue - a.revenue).slice(0, 5),
        clients: { new: cl.filter(id => doneTotal(id) < 2).length, returning: cl.filter(id => doneTotal(id) >= 2).length },
        weekday: [0, 1, 2, 3, 4, 5, 6].map(d => bk.filter(live).filter(b => parts(Date.parse(b.start_at)).dow === d).length),
        staff: staffId ? null : DB.staff.filter(st => st.active || bk.some(b => b.staff_id === st.id)).map(st => {
          const mine = bk.filter(b => b.staff_id === st.id);
          const mineDone = mine.filter(b => b.status === 'completed');
          const ids = [...new Set(mineDone.map(b => b.client_id))];
          const openMin = days.reduce((s, p) => s + DB.hours.filter(h => h.staff_id === st.id && h.weekday === p.dow)
            .reduce((x, h) => x + (Date.parse('1970-01-01T' + h.end + ':00Z') - Date.parse('1970-01-01T' + h.start + ':00Z')) / 6e4, 0), 0);
          return { id: st.id, name: st.name, color: st.color, active: st.active, clients: ids.length, revenue: sum(mineDone, b => b.price),
            bookings: mine.filter(live).length, no_shows: mine.filter(b => b.status === 'no_show').length, open_min: openMin,
            returning: ids.filter(id => DB.bookings.filter(b => b.client_id === id && b.staff_id === st.id && b.status === 'completed' && Date.parse(b.start_at) < to).length >= 2).length,
            booked_min: sum(mine.filter(live), b => (Date.parse(b.end_at) - Date.parse(b.start_at)) / 6e4) };
        })
      };
    }

    /* ---------- the API ---------- */
    const session = { access_token: 'demo', expires_at: Math.floor(Date.now() / 1000) + 86400 * 30, user: { id: 'demo-owner', email: 'aria@demo.satinbook.com' } };
    const api = {
      studios: () => reply([Object.assign({}, DB.studio, { mine: true, role: 'owner', staff_id: owner().id })]),
      account: () => reply({ must_change_password: false }),
      passwordChanged: () => reply(null),
      markInstalled: () => reply(null),
      bookings: (mid, from, to, status) => reply(DB.bookings.filter(b => b.start_at >= iso(Date.parse(from)) && b.start_at < iso(Date.parse(to)) && (!status || b.status === status))
        .sort((a, b) => a.start_at.localeCompare(b.start_at)).map(row)),
      booking: id => { const b = DB.bookings.find(x => x.id === id); return b ? reply(row(b)) : fail('not_found'); },
      setStatus(id, status, reason) {
        const b = DB.bookings.find(x => x.id === id);
        if (!b) return fail('not_found');
        if (!['confirmed', 'cancelled_master', 'completed', 'no_show'].includes(status)) return fail('bad_status');
        if (status === 'confirmed' && b.status !== 'pending') return fail('bad_status');
        if (status === 'cancelled_master' && !ACTIVE.includes(b.status)) return fail('bad_status');
        b.status = status;
        if (status === 'cancelled_master') { b.cancel_reason = String(reason || '').trim().slice(0, 300) || null; b.cancelled_at = iso(Date.now()); if (b.deposit_status === 'pending') b.deposit_status = 'none'; }
        b.completed_at = status === 'completed' ? (b.completed_at || iso(Date.now())) : null;
        b.auto_completed = false;
        touch(b);
        if (status === 'confirmed' || status === 'cancelled_master') sending('In your app this emails the client');
        return reply(json(b));
      },
      reschedule(id, startAt, force, staffId) {
        const b = DB.bookings.find(x => x.id === id);
        if (!b) return fail('not_found');
        const st = staffId || b.staff_id;
        const t = Date.parse(startAt);
        const p = parts(t);
        if (!force && !freeStarts(st, ymd(p), b.service_id, b.id).includes(t)) return fail('slot_taken');
        const len = Date.parse(b.end_at) - Date.parse(b.start_at);
        b.start_at = iso(t);
        b.end_at = iso(t + len);
        b.staff_id = st;
        touch(b);
        sending('In your app this emails the client the new time');
        return reply(json(b));
      },
      create(mid, o, force) {
        const s = serviceOf(o.serviceId);
        if (!s) return fail('service_not_found');
        const t = Date.parse(o.startAt);
        const day = ymd(parts(t));
        let st = o.staffId;
        if (!st) st = (DB.staff.filter(x => doesService(x, s.id)).find(x => freeStarts(x.id, day, s.id).includes(t)) || owner()).id;
        if (!force && !freeStarts(st, day, s.id).includes(t)) return fail('slot_taken');
        const ph = phoneE164(o.phone);
        if (digits(ph).length < 11) return fail('invalid_phone');
        let c = DB.clients.find(x => digits(x.phone) === digits(ph));
        if (!c) {
          c = { id: uuid(), name: String(o.name || '').trim() || 'Client', tags: [], notes: '', phone: ph, email: o.email || null, created_at: iso(Date.now()), patch_test_at: null };
          DB.clients.push(c);
        }
        const own = (staffOf(st).services.find(x => x.id === s.id) || {}).price;
        const b = {
          id: uuid(), staff_id: st, service_id: s.id, client_id: c.id, start_at: iso(t), end_at: iso(t + s.duration_min * 6e4), status: 'confirmed',
          price: own != null ? own : s.price, service_name: s.name, client_note: o.note || '', manage_token: uuid(), late_cancel: false, created_by: 'master',
          created_at: iso(Date.now()), updated_at: iso(Date.now()), cancelled_at: null, cancel_reason: null, completed_at: null, auto_completed: false,
          deposit: 0, deposit_status: 'none', deposit_due_at: null, deposit_paid_at: null
        };
        DB.bookings.push(b);
        sending('In your app this texts the client her booking link');
        return reply(json(b));
      },
      slots(mid, serviceId, date, ignore, staffId) {
        const list = staffId ? [staffId] : DB.staff.filter(x => doesService(x, serviceId)).map(x => x.id);
        const all = new Set();
        list.forEach(st => freeStarts(st, date, serviceId, ignore).forEach(t => all.add(t)));
        return reply([...all].sort((a, b) => a - b).map(t => iso(t).replace('.000Z', '+00:00')));
      },
      setDeposit(id, status) {
        const b = DB.bookings.find(x => x.id === id);
        if (!b) return fail('not_found');
        b.deposit_status = status;
        b.deposit_paid_at = status === 'paid' ? iso(Date.now()) : null;
        if (status !== 'pending') b.deposit_due_at = null;
        touch(b);
        return reply(row(b));
      },
      clients(mid, q) {
        const s = String(q || '').trim().toLowerCase();
        const d = digits(q);
        return reply(DB.clients.filter(c => !s || c.name.toLowerCase().includes(s) || String(c.email || '').toLowerCase().includes(s) || c.tags.some(t => t.toLowerCase().startsWith(s)) || (d && digits(c.phone).includes(d)))
          .map(c => {
            const l = DB.bookings.filter(b => b.client_id === c.id);
            const done = l.filter(b => b.status === 'completed');
            const next = l.filter(b => ACTIVE.includes(b.status) && Date.parse(b.start_at) > Date.now()).sort((a, b) => a.start_at.localeCompare(b.start_at))[0];
            return { id: c.id, name: c.name, tags: c.tags, email: c.email, notes: c.notes, phone: c.phone, spent: done.reduce((x, b) => x + b.price, 0), visits: done.length,
              cancels: l.filter(b => b.status === 'cancelled_client').length, no_shows: l.filter(b => b.status === 'no_show').length,
              last_visit: done.map(b => b.start_at).sort().pop() || null, next_visit: next ? next.start_at : null, late_cancels: l.filter(b => b.late_cancel).length };
          }).sort((a, b) => a.name.localeCompare(b.name)));
      },
      client(id) {
        const c = clientOf(id);
        if (!c) return fail('not_found');
        return reply({
          client: { id: c.id, name: c.name, tags: c.tags, email: c.email, notes: c.notes, phone: c.phone, created_at: c.created_at, patch_test_at: c.patch_test_at },
          history: DB.bookings.filter(b => b.client_id === id).sort((a, b) => b.start_at.localeCompare(a.start_at)).map(row),
          formulas: DB.formulas.filter(f => f.client_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at))
        });
      },
      setNotes(id, notes) { const c = clientOf(id); if (c) c.notes = notes; return reply(null); },
      saveClient(id, p) {
        const c = clientOf(id);
        if (!c) return fail('not_found');
        ['name', 'email', 'notes', 'tags', 'patch_test_at'].forEach(k => { if (k in p) c[k] = p[k]; });
        if ('phone' in p && p.phone) c.phone = phoneE164(p.phone);
        return api.client(id);
      },
      saveFormula(mid, f) {
        let r = f.id && DB.formulas.find(x => x.id === f.id);
        if (!r) { r = { id: uuid(), created_at: iso(Date.now()), staff_id: owner().id, photo: null, note: '' }; DB.formulas.push(r); }
        ['client_id', 'booking_id', 'curl', 'lengths', 'thickness', 'lash_type', 'glue', 'photo', 'staff_id'].forEach(k => { if (k in f) r[k] = f[k]; });
        if ('notes' in f) r.note = f.notes;
        if ('note' in f) r.note = f.note;
        return reply(r);
      },
      deleteFormula(id) { DB.formulas = DB.formulas.filter(x => x.id !== id); return reply(null); },
      schedule: (mid, staffId) => reply(schedule(staffId)),
      saveHours(mid, hours, staffId) {
        const st = staffId || owner().id;
        DB.hours = DB.hours.filter(h => h.staff_id !== st).concat((hours || []).map(h => ({ staff_id: st, weekday: +h.weekday, start: h.start, end: h.end })));
        return reply(schedule(st));
      },
      saveRules(mid, rules) {
        ['auto_confirm', 'min_notice_hours', 'max_days_ahead', 'cancel_window_hours', 'slot_step_min', 'deposit_hold_hours', 'noshow_deposit'].forEach(k => { if (rules && k in rules) DB.studio[k] = rules[k]; });
        return reply(schedule());
      },
      addTimeOff(mid, start, end, reason, staffId, whole) {
        const o = { id: uuid(), start_at: iso(Date.parse(start)), end_at: iso(Date.parse(end)), reason: reason || '', staff_id: whole ? null : (staffId || owner().id) };
        DB.timeOff.push(o);
        return reply({ id: o.id, end_at: o.end_at, reason: o.reason, start_at: o.start_at, whole_studio: !o.staff_id });
      },
      deleteTimeOff(id) { DB.timeOff = DB.timeOff.filter(x => x.id !== id); return reply(null); },
      // push: nothing leaves this page
      pushSubscribe: () => reply(null),
      pushUnsubscribe: () => reply(null),
      pushDevices: () => reply([]),
      sendTestPush() { say('In your app this sends a push to your phone', 'bell'); return reply({ sent: 0 }); },
      services: () => reply(DB.svcs.slice().sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name))),
      saveService(mid, p) {
        let s = p.id && serviceOf(p.id);
        if (!s) { s = { id: 'svc-' + uuid().slice(0, 8), sort: DB.svcs.length, created_at: iso(Date.now()), photo: null, includes: [], active: true, deposit: 0, buffer_min: 15, fill_weeks: null, price_from: false, description: '', category: '' }; DB.svcs.push(s); }
        ['name', 'price', 'duration_min', 'buffer_min', 'deposit', 'category', 'description', 'includes', 'photo', 'active', 'fill_weeks', 'price_from', 'sort'].forEach(k => { if (k in p) s[k] = p[k]; });
        if (!p.id) DB.staff.forEach(st => { if (st.is_owner) st.services.push({ id: s.id, price: null, duration: null }); });
        return reply(s);
      },
      deleteService(id) {
        if (DB.bookings.some(b => b.service_id === id && ACTIVE.includes(b.status) && Date.parse(b.start_at) > Date.now())) return fail('has_bookings');
        DB.svcs = DB.svcs.filter(x => x.id !== id);
        return reply(null);
      },
      reorder(mid, table, ids) {
        const list = table === 'looks' ? DB.looks : DB.svcs;
        ids.forEach((id, i) => { const x = list.find(y => y.id === id); if (x) x.sort = i; });
        return reply(null);
      },
      profile: () => reply({ id: MID, slug: DB.studio.slug, name: DB.studio.name, style: DB.studio.style, accent: DB.studio.accent, timezone: TZ, settings: DB.settings }),
      saveProfile(mid, p) {
        if (p.name) DB.studio.name = p.name;
        if (p.style) DB.studio.style = p.style;
        if (p.accent) DB.studio.accent = p.accent;
        if (p.settings) Object.assign(DB.settings, p.settings);
        return api.profile();
      },
      looks: () => reply(DB.looks.slice().sort((a, b) => a.sort - b.sort || b.created_at.localeCompare(a.created_at))),
      saveLook(mid, l) {
        let r = l.id && DB.looks.find(x => x.id === l.id);
        if (!r) { r = { id: 'lk-' + uuid().slice(0, 8), sort: 0, is_new: true, popular: false, created_at: iso(Date.now()), before_photo: null, staff_id: null, tag: '' }; DB.looks.forEach(x => { x.sort++; }); DB.looks.push(r); }
        ['title', 'tag', 'service_id', 'photo', 'before_photo', 'is_new', 'popular', 'staff_id'].forEach(k => { if (k in l) r[k] = l[k]; });
        return reply(r);
      },
      deleteLook(id) { DB.looks = DB.looks.filter(x => x.id !== id); return reply(null); },
      insights: (mid, period, staffId) => reply(insights(period, staffId)),
      staff: () => reply(DB.staff.slice().sort((a, b) => a.sort - b.sort)),
      saveStaff(mid, p) {
        let st = p.id && staffOf(p.id);
        if (!st) {
          if (!String(p.name || '').trim()) return fail('invalid_name');
          st = { id: 'st-' + uuid().slice(0, 8), sort: DB.staff.length, is_owner: false, has_login: false, email: null, bio: '', photo: null, title: '', color: '#34C759', commission_pct: 40, active: true, services: [] };
          DB.staff.push(st);
          // a new master works the studio's usual days until she sets her own
          [2, 3, 4, 5, 6].forEach(w => DB.hours.push({ staff_id: st.id, weekday: w, start: '10:00', end: '18:00' }));
        }
        ['name', 'title', 'bio', 'photo', 'color', 'commission_pct', 'active'].forEach(k => { if (k in p) st[k] = p[k]; });
        if (Array.isArray(p.services)) st.services = p.services.map(x => ({ id: x.id, price: x.price != null && x.price !== '' ? +x.price : null, duration: x.duration != null && x.duration !== '' ? +x.duration : null }));
        if (st.is_owner && p.name) DB.settings.masterName = p.name;
        return reply(st);
      },
      staffFuture: staffId => reply(DB.bookings.filter(b => b.staff_id === staffId && ACTIVE.includes(b.status) && Date.parse(b.start_at) > Date.now())
        .sort((a, b) => a.start_at.localeCompare(b.start_at)).map(row)),
      serviceStaff(serviceId, ids) {
        DB.staff.forEach(st => {
          const has = st.services.some(x => x.id === serviceId);
          if (ids.includes(st.id) && !has) st.services.push({ id: serviceId, price: null, duration: null });
          if (!ids.includes(st.id) && has) st.services = st.services.filter(x => x.id !== serviceId);
        });
        return reply(null);
      },
      setKind(mid, kind) { DB.studio.kind = kind === 'solo' ? 'solo' : 'team'; return reply({ kind: DB.studio.kind }); },
      payouts(mid, from, to) {
        const a = dayStart(Object.assign({}, (([y, m, d]) => ({ y, m, d }))(String(from).split('-').map(Number))));
        const z = dayStart(addDays((([y, m, d]) => ({ y, m, d }))(String(to).split('-').map(Number)), 1));
        return reply(DB.staff.slice().sort((x, y) => x.sort - y.sort).map(st => {
          const l = DB.bookings.filter(b => b.staff_id === st.id && b.status === 'completed' && Date.parse(b.start_at) >= a && Date.parse(b.start_at) < z);
          const rev = l.reduce((s, b) => s + b.price, 0);
          return { id: st.id, name: st.name, payout: Math.round(rev * st.commission_pct) / 100, visits: l.length, revenue: rev, is_owner: st.is_owner, commission_pct: st.commission_pct };
        }));
      },
      emailLog: () => reply(DB.mails),
      emailPreview(mid, kind) {
        const s = DB.svcs[0];
        const html = `<!doctype html><html><body style="margin:0;padding:28px 16px;background:#0B0B0C;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
          <div style="max-width:480px;margin:0 auto;padding:28px;border-radius:22px;background:#18181B;color:#F4F4F5">
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#A1A1AA">${DB.studio.name}</p>
          <h1 style="margin:0 0 12px;font-size:24px">You’re booked, Jessica ✨</h1>
          <p style="margin:0 0 18px;color:#D4D4D8;line-height:1.5">${s.name} · Saturday · 11:00 AM with ${owner().name}.</p>
          <p style="margin:0;padding:12px 16px;border-radius:14px;background:#27272A;color:#A1A1AA;font-size:14px">In your app, clients get emails like this one — confirmations, reminders, changes. In the demo nothing is sent.</p>
          </div></body></html>`;
        return reply({ subject: 'You’re booked: ' + s.name + ' (' + String(kind || 'confirm') + ')', html });
      },
      emailTest() { say('In your app this emails you a test', 'bell'); return reply({ to: 'you — demo, nothing was sent' }); },
      inviteStaff(body) {
        let st = body.staff_id && staffOf(body.staff_id);
        if (!st) {
          st = { id: 'st-' + uuid().slice(0, 8), sort: DB.staff.length, is_owner: false, bio: '', photo: null, color: '#5AC8FA', commission_pct: +body.commission_pct || 40, active: true,
            name: body.name || 'New master', title: body.title || '', services: (body.services || []).map(x => ({ id: x.id || x, price: null, duration: null })) };
          DB.staff.push(st);
          [2, 3, 4, 5, 6].forEach(w => DB.hours.push({ staff_id: st.id, weekday: w, start: '10:00', end: '18:00' }));
        }
        st.email = body.email || st.email;
        st.has_login = true;
        sending('In your app this emails her a sign-in');
        return reply({ staff: st, email: st.email, password: 'demo-' + Math.random().toString(36).slice(2, 8), emailed: false, studio: { name: DB.studio.name, slug: DB.studio.slug } });
      },
      // photos stay in this page (a blob: address) — nothing is uploaded
      upload: (mid, folder, blob) => reply(URL.createObjectURL(blob)),
      removeMedia: () => reply(true),
      async subscribe(mid, onChange, onStatus) { setTimeout(() => onStatus && onStatus('live'), 50); return () => {}; }
    };

    const out = {
      configured: true,
      demo: true,
      BackendError,
      vapidPublicKey: 'demo',
      errors: opts.errors || { report() {}, context() {} },
      auth: {
        session: () => reply(session),
        fresh: () => reply(session),
        signIn: () => reply(session),
        signOut: () => reply(null),
        updatePassword: () => reply(null),
        resetPassword: () => reply(null),
        verifyRecovery: () => reply(session),
        onChange: () => Promise.resolve(() => {})
      },
      owner: api,
      // "Reset": a fresh demo, as if the page was just opened
      reset() { DB = build(); }
    };
    window.StudioDemo.last = out; // (for checks from the console)
    return out;
  }

  window.StudioDemo = { create };
})();
