// admin-create-master — a new studio in one call, for the platform admin only.
//
// POST (Authorization: the admin's JWT)
//   { name, masterName, email, city, timezone, phone, instagram, slug, template,
//     style, accent, accentId, icons?: { i512, i192, i180 } (base64 PNG) }
// Creates: the master's account with a temporary password (must be changed at
// the first sign-in), the studio (14-day trial), services / policies / answers /
// texts from the niche template, hours Tue–Sat 10:00–18:00, default rules, and
// stores the app icons (monogram PNGs drawn in the admin page) in Storage.
// Anything fails on the way → everything made so far is removed again.
import { cors, json, requireAdmin, serviceClient, tempPassword } from '../_shared/admin.ts';
import { TEMPLATES } from './templates.ts';

const TZ = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];
const RESERVED = ['demo', 'admin', 'www', 'api', 'app', 'apps', 'test', 'studio', 'help', 'support', 'manifest', 'manifests', 'img', 'owner', 'login'];
const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const admin = serviceClient();
  if (!(await requireAdmin(req, admin))) return json({ error: 'forbidden' }, 403);

  // deno-lint-ignore no-explicit-any
  let b: any;
  try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const name = clean(b.name, 60);
  const masterName = clean(b.masterName, 40);
  const email = clean(b.email, 120).toLowerCase();
  const slug = clean(b.slug, 41).toLowerCase();
  const tpl = TEMPLATES[b.template];
  const style = ['noir', 'soft', 'maison'].includes(b.style) ? b.style : 'noir';
  const accent = /^#[0-9a-f]{6}$/i.test(b.accent || '') ? b.accent : null;
  if (name.length < 2) return json({ error: 'invalid_name' }, 400);
  if (!masterName) return json({ error: 'invalid_master_name' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid_email' }, 400);
  if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(slug) || RESERVED.includes(slug)) return json({ error: 'invalid_slug' }, 400);
  if (!TZ.includes(b.timezone)) return json({ error: 'invalid_timezone' }, 400);
  if (!tpl) return json({ error: 'invalid_template' }, 400);
  const { data: taken } = await admin.from('masters').select('id').eq('slug', slug).maybeSingle();
  if (taken) return json({ error: 'slug_taken' }, 409);

  // 1. her account
  const password = tempPassword();
  const { data: created, error: ue } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { name: masterName }
  });
  if (ue || !created.user) {
    return json({ error: /already|exists|registered/i.test(ue?.message || '') ? 'email_taken' : 'auth_error', message: ue?.message }, 409);
  }
  const uid = created.user.id;
  let mid: string | null = null;
  try {
    // 2. the studio
    const settings: Record<string, unknown> = {
      masterName, tagline: tpl.tagline, city: clean(b.city, 60), phone: clean(b.phone, 30),
      instagram: clean(b.instagram, 60).replace(/^@/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/\/.*$/, ''),
      policies: tpl.policies, faq: tpl.faq, prep: tpl.prep, aftercare: tpl.aftercare,
      defaultAccent: clean(b.accentId, 30) || undefined, splashStyle: 'clean'
    };
    Object.keys(settings).forEach(k => { if (settings[k] === '' || settings[k] === undefined) delete settings[k]; });
    const { data: m, error: me } = await admin.from('masters').insert({
      slug, name, owner_id: uid, timezone: b.timezone, style, accent, settings, booking_engine: 'builtin',
      auto_confirm: true, min_notice_hours: 2, max_days_ahead: 60, cancel_window_hours: 24, slot_step_min: 30,
      status: 'trial', trial_ends_at: new Date(Date.now() + 14 * 864e5).toISOString()
    }).select('id').single();
    if (me) throw me;
    mid = m.id;

    // 3. services, hours (Tue–Sat 10–18), the forced password change
    const { error: se } = await admin.from('services').insert(tpl.services.map((s, i) => ({
      master_id: mid, category: s.category, name: s.name, description: s.description, includes: s.includes || [],
      duration_min: s.duration_min, buffer_min: s.buffer_min, price: s.price, price_from: !!s.price_from,
      deposit: 0, fill_weeks: s.fill_weeks || null, active: true, sort: i
    })));
    if (se) throw se;
    const { error: he } = await admin.from('working_hours').insert([2, 3, 4, 5, 6].map(d => ({
      master_id: mid, weekday: d, start_time: '10:00', end_time: '18:00'
    })));
    if (he) throw he;
    const { error: ae } = await admin.from('owner_accounts').upsert({ user_id: uid, must_change_password: true, temp_password_at: new Date().toISOString() });
    if (ae) throw ae;

    // 4. the app icons → Storage, linked from the studio (manifest + apple-touch-icon)
    const icons: Record<string, string> = {};
    const files: [string, string][] = [['i512', 'icon-512.png'], ['i192', 'icon-192.png'], ['i180', 'apple-touch-icon.png']];
    for (const [key, file] of files) {
      const data = b.icons && typeof b.icons[key] === 'string' ? b.icons[key] : '';
      if (!data || data.length > 2_000_000) continue;
      const path = `${mid}/app/${file}`;
      const { error: up } = await admin.storage.from('studio-media').upload(path, b64(data), { contentType: 'image/png', upsert: true, cacheControl: '3600' });
      if (up) throw up;
      icons[key] = admin.storage.from('studio-media').getPublicUrl(path).data.publicUrl + '?v=' + Date.now().toString(36);
    }
    if (Object.keys(icons).length) {
      const { error: ie } = await admin.from('masters').update({ settings: { ...settings, icons } }).eq('id', mid);
      if (ie) throw ie;
    }
    return json({ id: mid, slug, name, masterName, email, password, trial_ends_at: new Date(Date.now() + 14 * 864e5).toISOString() });
  } catch (e) {
    // roll back: no half-made studios or orphan accounts
    if (mid) {
      const { data: objs } = await admin.storage.from('studio-media').list(`${mid}/app`);
      if (objs && objs.length) await admin.storage.from('studio-media').remove(objs.map(o => `${mid}/app/${o.name}`));
      await admin.from('masters').delete().eq('id', mid);
    }
    await admin.from('owner_accounts').delete().eq('user_id', uid);
    await admin.auth.admin.deleteUser(uid);
    // deno-lint-ignore no-explicit-any
    return json({ error: 'create_failed', message: String((e as any)?.message || e) }, 500);
  }
});
