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

  /* ---------- reveal on scroll ---------- */
  const items = [...document.querySelectorAll('.reveal')];
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        // neighbours that come in together arrive one after another
        const sibs = [...e.target.parentElement.children].filter(x => x.classList.contains('reveal'));
        e.target.style.transitionDelay = Math.min(sibs.indexOf(e.target), 5) * 70 + 'ms';
        e.target.classList.add('is-in');
        io.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
    items.forEach(el => io.observe(el));
  } else items.forEach(el => el.classList.add('is-in'));

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
