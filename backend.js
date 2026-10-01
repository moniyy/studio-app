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

  /* Errors carry a short code the UI can translate: slot_taken, invalid_phone,
     network, not_found, forbidden, … (the RPCs raise these as messages) */
  class BackendError extends Error {
    constructor(code, message) { super(message || code); this.code = code; }
  }
  const KNOWN = ['slot_taken', 'invalid_phone', 'invalid_email', 'invalid_name', 'too_many', 'not_found',
    'not_active', 'too_late', 'not_bookable', 'service_not_found', 'outside_hours', 'bad_status', 'forbidden',
    'hours_overlap', 'hours_invalid'];
  function toError(e) {
    if (e instanceof BackendError) return e;
    const msg = String((e && (e.message || e.msg || e.error_description)) || e || '');
    if (KNOWN.includes(msg)) return new BackendError(msg);
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

  let clientP = null;
  function client() {
    if (!configured) return Promise.reject(new BackendError('not_configured'));
    if (!clientP) {
      clientP = loadScript(SDK).then(() => window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: 'studio-app-auth' },
        realtime: { params: { eventsPerSecond: 5 } }
      })).catch(e => { clientP = null; throw toError(e); });
    }
    return clientP;
  }

  async function rpc(fn, args) {
    const sb = await client();
    let res;
    try { res = await sb.rpc(fn, args || {}); } catch (e) { throw toError(e); }
    if (res.error) throw toError(res.error);
    return res.data;
  }
  // set-returning RPCs come back as [value] or [{fn: value}] depending on the server
  const scalars = rows => (Array.isArray(rows) ? rows : []).map(x => (x && typeof x === 'object' && !Array.isArray(x) ? Object.values(x)[0] : x));

  /* ---------- public (clients) ---------- */
  const publicApi = {
    profile: slug => rpc('get_public_profile', { p_slug: slug }),
    openings: (slug, serviceId, fromDate, days, ignore) =>
      rpc('get_openings', { p_slug: slug, p_service_id: serviceId, p_from: fromDate, p_days: days, p_ignore: ignore || null }).then(scalars),
    slots: (slug, serviceId, date, ignore) =>
      rpc('get_available_slots', { p_slug: slug, p_service_id: serviceId, p_date: date, p_ignore: ignore || null }).then(scalars),
    createBooking: (slug, o) => rpc('create_booking', {
      p_slug: slug, p_service_id: o.serviceId, p_start_at: o.startAt,
      p_name: o.name, p_phone: o.phone, p_email: o.email || null, p_note: o.note || null
    }),
    getBooking: token => rpc('get_booking', { p_token: token }),
    cancelBooking: (token, reason) => rpc('cancel_booking', { p_token: token, p_reason: reason || null }),
    rescheduleBooking: (token, startAt) => rpc('reschedule_booking', { p_token: token, p_new_start_at: startAt })
  };

  /* ---------- auth (the master) ---------- */
  const auth = {
    async session() {
      const sb = await client();
      const { data } = await sb.auth.getSession();
      return data.session || null;
    },
    async signIn(email, password) {
      const sb = await client();
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
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

  window.StudioBackend = Object.assign({ configured, client, BackendError, auth, owner }, publicApi);
})();
