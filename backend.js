/* =========================================================
   Studio App — backend (Supabase) data layer.
   No UI here. supabase-js is loaded from the CDN only when a
   master with the built-in booking engine (or her dashboard)
   actually needs it — demo masters never load it.
   Every call goes through an RPC (see supabase/migrations):
   clients never read tables directly.
   ========================================================= */
(function () {
  'use strict';

  const cfg = window.STUDIO_CONFIG || {};
  const configured = /^https?:\/\//.test(cfg.supabaseUrl || '') && !!cfg.supabaseAnonKey &&
    !/YOUR-/i.test(String(cfg.supabaseUrl) + cfg.supabaseAnonKey);
  const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
  const MEDIA_BUCKET = 'studio-media';

  /* Errors carry a short code the UI can translate: slot_taken, invalid_phone,
     network, not_found, forbidden, … (the RPCs raise these as messages) */
  class BackendError extends Error {
    constructor(code, message) { super(message || code); this.code = code; }
  }
  const KNOWN = ['slot_taken', 'invalid_phone', 'invalid_email', 'invalid_name', 'too_many', 'not_found',
    'not_active', 'too_late', 'not_bookable', 'service_not_found', 'outside_hours', 'bad_status', 'forbidden',
    'hours_overlap', 'hours_invalid', 'phone_taken', 'too_big', 'timeout', 'paused'];
  const TIMEOUT = 15000;
  function toError(e) {
    if (e instanceof BackendError) return e;
    const msg = String((e && (e.message || e.msg || e.error_description)) || e || '');
    if (KNOWN.includes(msg)) return new BackendError(msg);
    if (e && e.name === 'AbortError') return new BackendError('timeout', msg);
    if (/fetch|network|load failed|NetworkError|timed? ?out/i.test(msg) || (e && e.name === 'TypeError')) return new BackendError('network', msg);
    if (e && (e.code === '42501' || /permission denied|JWT/i.test(msg))) return new BackendError('forbidden', msg);
    return new BackendError('unknown', msg);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (window.supabase && window.supabase.createClient) { resolve(); return; }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => reject(new BackendError('network', 'Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  // A request that hangs (lost network, a frozen tab woken on iOS…) becomes a clear error
  function withTimeout(p, ms, onAbort) {
    let t;
    return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => { if (onAbort) onAbort(); rej(new BackendError('timeout', 'timed out')); }, ms || TIMEOUT); })])
      .finally(() => clearTimeout(t));
  }

  /* Every request: aborted after 8 s and tried once more on an abort or a
     network error. iOS freezes an installed app in the background; on the way
     back the first request often sits on a dead connection — the second one
     gets a fresh socket. Only requests that are safe to repeat are repeated
     (reads, the token refresh, create_booking with its request id); a write is
     repeated only when it failed at once (it never reached the server). */
  const FETCH_MS = 8000;
  const SAFE_RPC = /^(get_\w+|create_booking|my_account|am_i_admin|admin_studios|admin_slug_free|owner_(studios|bookings|booking|schedule|clients|client|services|profile|looks|insights|slots|push_devices|setup))$/;
  function safeToRepeat(url, method) {
    if (!method || /^(GET|HEAD)$/i.test(method)) return true;
    const m = /\/rest\/v1\/rpc\/(\w+)/.exec(url);
    if (m) return SAFE_RPC.test(m[1]);
    return /\/auth\/v1\/token/.test(url);
  }
  async function sturdyFetch(input, init) {
    init = init || {};
    const url = typeof input === 'string' ? input : input.url;
    const outer = init.signal;
    const once = async () => {
      const ctl = new AbortController();
      const stop = () => ctl.abort();
      if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', stop, { once: true }); }
      const t = setTimeout(stop, FETCH_MS);
      try { return await fetch(input, Object.assign({}, init, { signal: ctl.signal })); }
      finally { clearTimeout(t); if (outer) outer.removeEventListener('abort', stop); }
    };
    const t0 = Date.now();
    try { return await once(); } catch (e) {
      if (outer && outer.aborted) throw e; // the caller gave up itself
      const quick = Date.now() - t0 < 1500 && e.name !== 'AbortError';
      if (!safeToRepeat(url, init.method) && !quick) throw e;
      return once();
    }
  }

  let clientP = null;
  function client() {
    if (!configured) return Promise.reject(new BackendError('not_configured'));
    if (!clientP) {
      clientP = withTimeout(loadScript(SDK), 20000).then(() => window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: {
          persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'studio-app-auth',
          // no cross-tab navigator.locks: a lock left behind by a suspended iOS tab
          // used to block every later request silently (only a reload helped)
          lock: (name, acquireTimeout, fn) => fn()
        },
        global: { fetch: sturdyFetch },
        realtime: { params: { eventsPerSecond: 5 } }
      })).catch(e => { clientP = null; throw toError(e); });
    }
    return clientP;
  }

  /* The token: refreshed before the first request after a wake-up if it runs
     out within a minute; the SDK's refresh timer is paused while hidden. */
  let freshP = null;
  async function freshSession() {
    const sb = await client();
    const { data } = await sb.auth.getSession();
    const s = data && data.session;
    if (!s) return null;
    if (s.expires_at && s.expires_at * 1000 - Date.now() < 60000) {
      if (!freshP) freshP = withTimeout(sb.auth.refreshSession(), 18000).finally(() => { freshP = null; });
      try { const r = await freshP; return (r.data && r.data.session) || s; } catch (e) { return s; }
    }
    return s;
  }
  document.addEventListener('visibilitychange', () => {
    if (!clientP) return; // this page doesn't use the SDK
    clientP.then(sb => {
      if (document.visibilityState === 'visible') { sb.auth.startAutoRefresh(); freshSession().catch(() => null); }
      else sb.auth.stopAutoRefresh();
    }).catch(() => null);
  });
  const jwtProblem = res => res.status === 401 || /JWT|token.*expired|PGRST30[0-9]/i.test(`${res.error.message || ''} ${res.error.code || ''}`);

  // the master's calls (her session is attached by supabase-js); an expired
  // token is refreshed and the call repeated once, quietly
  async function rpc(fn, args) {
    const sb = await client();
    await freshSession().catch(() => null);
    const call = () => withTimeout(sb.rpc(fn, args || {}), 2 * FETCH_MS + 2000);
    let res;
    try {
      res = await call();
      if (res.error && jwtProblem(res)) {
        await withTimeout(sb.auth.refreshSession(), 18000);
        res = await call();
      }
    } catch (e) { throw toError(e); }
    if (res.error) throw toError(res.error);
    return res.data;
  }

  // clients' calls: a plain fetch to the RPC — no SDK, no session, no locks.
  // Same answers as through supabase-js.
  async function publicRpc(fn, args) {
    if (!configured) throw new BackendError('not_configured');
    let res;
    try {
      res = await withTimeout(sturdyFetch(`${cfg.supabaseUrl}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + cfg.supabaseAnonKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(args || {})
      }), 2 * FETCH_MS + 2000);
    } catch (e) { throw toError(e); }
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (e) { body = text; }
    if (!res.ok) throw toError(body && body.message ? body : { message: 'HTTP ' + res.status });
    return body;
  }
  // set-returning RPCs come back as [value] or [{fn: value}] depending on the server
  const scalars = rows => (Array.isArray(rows) ? rows : []).map(x => (x && typeof x === 'object' && !Array.isArray(x) ? Object.values(x)[0] : x));

  /* ---------- public (clients) ---------- */
  const publicApi = {
    profile: slug => publicRpc('get_public_profile', { p_slug: slug }),
    openings: (slug, serviceId, fromDate, days, ignore) =>
      publicRpc('get_openings', { p_slug: slug, p_service_id: serviceId, p_from: fromDate, p_days: days, p_ignore: ignore || null }).then(scalars),
    slots: (slug, serviceId, date, ignore) =>
      publicRpc('get_available_slots', { p_slug: slug, p_service_id: serviceId, p_date: date, p_ignore: ignore || null }).then(scalars),
    // requestId: the same id on a retry returns the same booking (never two)
    createBooking: (slug, o) => publicRpc('create_booking', {
      p_slug: slug, p_service_id: o.serviceId, p_start_at: o.startAt,
      p_name: o.name, p_phone: o.phone, p_email: o.email || null, p_note: o.note || null, p_request_id: o.requestId || null
    }),
    getBooking: token => publicRpc('get_booking', { p_token: token }),
    cancelBooking: (token, reason) => publicRpc('cancel_booking', { p_token: token, p_reason: reason || null }),
    rescheduleBooking: (token, startAt) => publicRpc('reschedule_booking', { p_token: token, p_new_start_at: startAt })
  };

  /* ---------- auth (the master) ---------- */
  const auth = {
    async session() {
      const sb = await client();
      const { data } = await sb.auth.getSession();
      return data.session || null;
    },
    // the session, refreshed first if it is about to run out (call after a wake-up)
    fresh: () => freshSession(),
    async signIn(email, password) {
      const sb = await client();
      const { data, error } = await withTimeout(sb.auth.signInWithPassword({ email, password }));
      if (error) throw new BackendError(/invalid login|credentials/i.test(error.message) ? 'bad_login' : toError(error).code, error.message);
      return data.session;
    },
    async updatePassword(password) {
      const sb = await client();
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw new BackendError(toError(error).code, error.message);
    },
    async signOut() {
      const sb = await client();
      await sb.auth.signOut();
    },
    async onChange(cb) {
      const sb = await client();
      const { data } = sb.auth.onAuthStateChange((event, session) => cb(event, session));
      return () => data.subscription.unsubscribe();
    }
  };

  /* ---------- owner (signed-in master) ---------- */
  const owner = {
    studios: () => rpc('owner_studios'),
    bookings: (mid, from, to, status) => rpc('owner_bookings', { p_master_id: mid, p_from: from, p_to: to, p_status: status || null }),
    booking: id => rpc('owner_booking', { p_booking_id: id }),
    setStatus: (id, status, reason) => rpc('owner_set_status', { p_booking_id: id, p_status: status, p_reason: reason || null }),
    reschedule: (id, startAt, force) => rpc('owner_reschedule', { p_booking_id: id, p_new_start_at: startAt, p_force: !!force }),
    create: (mid, o, force) => rpc('owner_create_booking', {
      p_master_id: mid, p_service_id: o.serviceId, p_start_at: o.startAt, p_name: o.name, p_phone: o.phone,
      p_email: o.email || null, p_note: o.note || null, p_force: !!force
    }),
    slots: (mid, serviceId, date, ignore) =>
      rpc('owner_slots', { p_master_id: mid, p_service_id: serviceId, p_date: date, p_ignore: ignore || null }).then(scalars),
    clients: (mid, q) => rpc('owner_clients', { p_master_id: mid, p_q: q || null }),
    client: id => rpc('owner_client', { p_client_id: id }),
    setNotes: (id, notes) => rpc('owner_set_client_notes', { p_client_id: id, p_notes: notes }),
    schedule: mid => rpc('owner_schedule', { p_master_id: mid }),
    saveHours: (mid, hours) => rpc('owner_save_hours', { p_master_id: mid, p_hours: hours }),
    saveRules: (mid, rules) => rpc('owner_save_rules', { p_master_id: mid, p_rules: rules }),
    addTimeOff: (mid, start, end, reason) => rpc('owner_add_time_off', { p_master_id: mid, p_start_at: start, p_end_at: end, p_reason: reason || '' }),
    deleteTimeOff: id => rpc('owner_delete_time_off', { p_id: id }),

    /* Web Push: this device's subscription, and a test message to all her devices */
    pushSubscribe: (mid, sub, label) => rpc('owner_push_subscribe', {
      p_master_id: mid, p_endpoint: sub.endpoint, p_p256dh: sub.keys.p256dh, p_auth: sub.keys.auth, p_label: label || ''
    }),
    pushUnsubscribe: endpoint => rpc('owner_push_unsubscribe', { p_endpoint: endpoint }),
    pushDevices: mid => rpc('owner_push_devices', { p_master_id: mid }),
    async sendTestPush(mid) {
      const sb = await client();
      const { data, error } = await withTimeout(sb.functions.invoke('send-push', { body: { master_id: mid } }));
      if (error) throw toError(error);
      return data;
    },

    /* Studio: services, profile, looks, clients, lash map */
    services: mid => rpc('owner_services', { p_master_id: mid }),
    saveService: (mid, svc) => rpc('owner_save_service', { p_master_id: mid, p: svc }),
    deleteService: id => rpc('owner_delete_service', { p_id: id }),
    reorder: (mid, table, ids) => rpc('owner_reorder', { p_master_id: mid, p_table: table, p_ids: ids }),
    profile: mid => rpc('owner_profile', { p_master_id: mid }),
    saveProfile: (mid, p) => rpc('owner_save_profile', { p_master_id: mid, p }),
    looks: mid => rpc('owner_looks', { p_master_id: mid }),
    saveLook: (mid, look) => rpc('owner_save_look', { p_master_id: mid, p: look }),
    deleteLook: id => rpc('owner_delete_look', { p_id: id }),
    saveClient: (id, p) => rpc('owner_save_client', { p_client_id: id, p }),
    saveFormula: (mid, f) => rpc('owner_save_formula', { p_master_id: mid, p: f }),
    deleteFormula: id => rpc('owner_delete_formula', { p_id: id }),
    // her account: a studio made in the admin starts with a temporary password
    account: () => rpc('my_account'),
    passwordChanged: () => rpc('owner_password_changed'),
    markInstalled: mid => rpc('owner_mark_installed', { p_master_id: mid }),
    // 'paid' (received) · 'waived' (not needed) · 'pending' (undo)
    setDeposit: (id, status) => rpc('owner_set_deposit', { p_booking_id: id, p_status: status }),
    insights: (mid, period) => rpc('owner_insights', { p_master_id: mid, p_period: period || 'week' }),

    /* Photos → Storage "studio-media/<master_id>/<folder>/<uuid>.<ext>" (public URLs) */
    async upload(mid, folder, blob) {
      const sb = await client();
      const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
      const id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(36).slice(2);
      const path = `${mid}/${folder}/${id}.${ext}`;
      const bucket = sb.storage.from(MEDIA_BUCKET);
      const { error } = await withTimeout(bucket.upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false }), 60000);
      if (error) throw toError(error);
      return bucket.getPublicUrl(path).data.publicUrl;
    },
    // only our own uploads are removed; anything else (e.g. stock photos) is left alone
    async removeMedia(url) {
      const marker = `/storage/v1/object/public/${MEDIA_BUCKET}/`;
      const i = String(url || '').indexOf(marker);
      if (i < 0) return false;
      const sb = await client();
      const { error } = await withTimeout(sb.storage.from(MEDIA_BUCKET).remove([decodeURIComponent(url.slice(i + marker.length).split('?')[0])]));
      return !error;
    },

    /* Realtime: calls onChange({type, record, old}) for this master's bookings.
       onStatus('live' | 'down') tells the dashboard whether to poll instead. */
    async subscribe(mid, onChange, onStatus) {
      const sb = await client();
      const ch = sb.channel('bookings-' + mid)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bookings', filter: 'master_id=eq.' + mid },
          p => onChange({ type: p.eventType, record: p.new, old: p.old }))
        .subscribe(status => {
          if (status === 'SUBSCRIBED') onStatus && onStatus('live');
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') onStatus && onStatus('down');
        });
      return () => { try { sb.removeChannel(ch); } catch (e) { /* already gone */ } };
    }
  };

  /* ---------- the platform admin (?admin=1) ---------- */
  // Edge Functions answer {error: 'slug_taken'…} with a non-2xx status: that code becomes the error
  async function invoke(fn, body, ms) {
    const sb = await client();
    await freshSession().catch(() => null);
    let res;
    try { res = await withTimeout(sb.functions.invoke(fn, { body }), ms || 30000); } catch (e) { throw toError(e); }
    if (res.error) {
      let code = 'unknown';
      let msg = res.error.message;
      try { const j = await res.error.context.json(); code = j.error || code; msg = j.message || msg; } catch (e) { if (/fetch|network/i.test(msg || '')) code = 'network'; }
      throw new BackendError(code, msg);
    }
    return res.data;
  }
  const admin = {
    isAdmin: () => rpc('am_i_admin'),
    studios: () => rpc('admin_studios'),
    slugFree: slug => rpc('admin_slug_free', { p_slug: slug }),
    save: (id, p) => rpc('admin_save_studio', { p_id: id, p }),
    create: body => invoke('admin-create-master', body, 60000),
    resetPassword: id => invoke('admin-master-action', { action: 'reset_password', master_id: id }),
    remove: (id, slug) => invoke('admin-master-action', { action: 'delete', master_id: id, confirm: slug })
  };

  window.StudioBackend = Object.assign({ configured, client, BackendError, auth, owner, admin, vapidPublicKey: cfg.vapidPublicKey || '' }, publicApi);
})();
