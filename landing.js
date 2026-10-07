/* satinbook.com — the product page: reveal on scroll and the "Start your free trial" form
   (→ public.submit_lead: a row in leads + an email to hello@satinbook.com) */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const cfg = window.STUDIO_CONFIG || {};

  // ?ref=<slug> — the studio app whose "Powered by Satinbook" brought her here (kept for this visit)
  let ref = '';
  try {
    const r = new URLSearchParams(location.search).get('ref');
    if (r && /^[a-z0-9][a-z0-9_-]{0,60}$/i.test(r)) sessionStorage.setItem('sb:ref', r.toLowerCase());
    ref = sessionStorage.getItem('sb:ref') || '';
  } catch (e) { /* private mode */ }

  /* ---------- the bar gets a line once the page moves ---------- */
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('is-scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- reveal on scroll: as soon as a block's top is 10% into the screen ---------- */
  const items = [...document.querySelectorAll('.reveal')];
  const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if ('IntersectionObserver' in window && !still) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        // neighbours that come in together arrive just one after another
        const sibs = [...e.target.parentElement.children].filter(x => x.classList.contains('reveal'));
        e.target.style.transitionDelay = Math.min(Math.max(0, sibs.indexOf(e.target)), 3) * 40 + 'ms';
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0 });
    items.forEach(el => io.observe(el));
  } else items.forEach(el => el.classList.add('is-in'));

  /* ---------- counts: views, taps, form sends, “Powered by” visits (no cookies) ---------- */
  const rpc = (fn, body) => (cfg.supabaseUrl && cfg.supabaseAnonKey ? fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + fn, {
    method: 'POST', keepalive: true,
    headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + cfg.supabaseAnonKey },
    body: JSON.stringify(body)
  }) : Promise.reject(new Error('no backend')));
  const track = (kind, r) => rpc('track_event', { p_kind: kind, p_ref: r || '', p_path: location.pathname }).catch(() => null);
  // once per visit (this tab): a view, and where she came from
  const once = k => { try { if (sessionStorage.getItem('sb:' + k)) return false; sessionStorage.setItem('sb:' + k, '1'); } catch (e) { /* private mode */ } return true; };
  if (once('view')) track('view');
  if (ref && new URLSearchParams(location.search).get('ref') && once('ref:' + ref)) track('ref', ref);
  document.addEventListener('click', e => { const a = e.target.closest('[data-track]'); if (a) track(a.dataset.track); });
  // something broke on this page: Admin → Errors
  const reported = new Set();
  const report = (kind, message, stack, source) => {
    message = String(message || '').slice(0, 500);
    if (!message || /^Script error/i.test(message) || reported.has(message) || reported.size > 9) return;
    reported.add(message);
    rpc('log_client_error', { p: { kind, role: 'landing', message, stack: String(stack || '').slice(0, 2000), source: source || '', page: location.pathname, ua: navigator.userAgent.slice(0, 300) } }).catch(() => null);
  };
  window.addEventListener('error', e => { if (e.message && (!e.filename || e.filename.startsWith(location.origin))) report('error', e.message, e.error && e.error.stack, String(e.filename || '').replace(location.origin, '') + ':' + e.lineno); });
  window.addEventListener('unhandledrejection', e => { const r = e.reason || {}; report('rejection', r.message || String(r), r.stack); });

  /* ---------- the form ---------- */
  const form = $('#lead'), err = $('#lead-err'), btn = form.querySelector('button[type=submit]');
  const showErr = msg => { err.textContent = msg; err.hidden = !msg; };
  const bad = (name, on) => form.elements[name].closest('.field').classList.toggle('is-bad', on);
  const ERR = {
    invalid_name: 'Please add your name.',
    invalid_email: 'That email doesn’t look right — check it?',
    too_many: 'You’ve already sent this today — I’ll be in touch soon!',
    network: 'No connection. Check your internet and try again.',
    other: 'Something went wrong. Try again, or email hello@satinbook.com.'
  };
  form.addEventListener('input', e => { if (e.target.name) bad(e.target.name, false); showErr(''); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const v = n => (form.elements[n].value || '').trim();
    const name = v('name'), email = v('email');
    let first = null;
    if (name.length < 2) { bad('name', true); first = first || 'name'; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { bad('email', true); first = first || 'email'; }
    if (first) { showErr(first === 'name' ? ERR.invalid_name : ERR.invalid_email); form.elements[first].focus(); return; }
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) { showErr(ERR.other); return; }

    btn.disabled = true; btn.textContent = 'Sending…'; showErr('');
    try {
      const res = await fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/submit_lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.supabaseAnonKey, Authorization: 'Bearer ' + cfg.supabaseAnonKey },
        body: JSON.stringify({
          p_name: name, p_email: email, p_instagram: v('instagram'), p_niche: v('niche'),
          p_city: v('city'), p_ref: ref, p_hp: v('website')
        })
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const code = Object.keys(ERR).find(k => String(body.message || '').includes(k)) || 'other';
        if (code === 'invalid_email') bad('email', true);
        if (code === 'invalid_name') bad('name', true);
        throw Object.assign(new Error(code), { code });
      }
      track('lead');
      form.hidden = true;
      $('#done-title').textContent = `Got it, ${name.split(/\s+/)[0]}!`;
      $('#done-text').textContent = `I’ll write to you at ${email} within a day to set up your app. Meanwhile, tap around the demo.`;
      const done = $('#lead-done');
      done.hidden = false;
      done.focus({ preventScroll: true });
      done.scrollIntoView({ block: 'center', behavior: 'smooth' });
    } catch (x) {
      showErr(ERR[x.code] || (x instanceof TypeError ? ERR.network : ERR.other));
    } finally {
      btn.disabled = false; btn.textContent = 'Start my free trial';
    }
  });
})();
