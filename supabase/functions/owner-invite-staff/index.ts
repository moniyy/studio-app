// owner-invite-staff — a studio owner adds a master who signs in herself.
//
// POST (Authorization: the owner's JWT)
//   { master_id, name, title?, email, photo?, color?, bio?, commission_pct?, services: [{ id, price?, duration? }] }
//   or { master_id, staff_id, email }  → a sign-in for a master added earlier without one
// Makes her account with a temporary password (she must change it at the first
// sign-in), the staff row (services, the owner's hours to start with) through the
// owner's own owner_save_staff — so the same checks apply — and links the two.
// Anything fails on the way → what was made is removed again.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { cors, json, serviceClient, tempPassword } from '../_shared/admin.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const admin = serviceClient();
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const { data: who } = jwt ? await admin.auth.getUser(jwt) : { data: null };
  if (!who || !who.user) return json({ error: 'forbidden' }, 403);

  // deno-lint-ignore no-explicit-any
  let b: any;
  try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const { data: m } = await admin.from('masters').select('id, name, slug, owner_id').eq('id', String(b.master_id || '')).maybeSingle();
  if (!m || m.owner_id !== who.user.id) return json({ error: 'forbidden' }, 403);

  const email = String(b.email || '').trim().toLowerCase();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'invalid_email' }, 400);
  if (!email && b.staff_id) return json({ error: 'invalid_email' }, 400);
  if (!b.staff_id && !String(b.name || '').trim()) return json({ error: 'invalid_name' }, 400);

  // the owner's own client: owner_save_staff runs with her rights and checks
  const owner = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: 'Bearer ' + jwt } }, auth: { persistSession: false }
  });

  let uid: string | null = null;
  let password: string | null = null;
  let createdStaff: string | null = null;
  try {
    if (email) {
      password = tempPassword();
      const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: b.name || '' } });
      if (ue || !u.user) {
        return json({ error: /already|exists|registered/i.test(ue?.message || '') ? 'email_taken' : 'auth_error', message: ue?.message }, 409);
      }
      uid = u.user.id;
    }
    let staffId = b.staff_id ? String(b.staff_id) : null;
    if (staffId) {
      const { data: st } = await admin.from('staff').select('id, master_id, user_id').eq('id', staffId).maybeSingle();
      if (!st || st.master_id !== m.id) throw Object.assign(new Error('not_found'), { code: 'not_found' });
      if (st.user_id) throw Object.assign(new Error('has_login'), { code: 'has_login' });
    } else {
      const { data: row, error } = await owner.rpc('owner_save_staff', {
        p_master_id: m.id,
        p: { name: b.name, title: b.title || '', photo: b.photo || '', bio: b.bio || '', color: b.color || '', commission_pct: b.commission_pct ?? 0, services: b.services || [] }
      });
      if (error || !row) throw Object.assign(new Error(error?.message || 'save_failed'), { code: error?.message || 'save_failed' });
      staffId = row.id;
      createdStaff = row.id;
    }
    if (uid) {
      const { error: le } = await admin.from('staff').update({ user_id: uid }).eq('id', staffId);
      if (le) throw le;
      const { error: ae } = await admin.from('owner_accounts').upsert({ user_id: uid, must_change_password: true, temp_password_at: new Date().toISOString() });
      if (ae) throw ae;
    }
    const { data: list } = await owner.rpc('owner_staff', { p_master_id: m.id });
    // deno-lint-ignore no-explicit-any
    const staff = (list || []).find((x: any) => x.id === staffId);
    return json({ staff, email: email || null, password, studio: { name: m.name, slug: m.slug } });
  } catch (e) {
    if (createdStaff) await admin.from('staff').delete().eq('id', createdStaff);
    if (uid) await admin.auth.admin.deleteUser(uid);
    // deno-lint-ignore no-explicit-any
    const code = (e as any)?.code || 'invite_failed';
    return json({ error: ['not_found', 'has_login', 'forbidden'].includes(code) ? code : 'invite_failed', message: String((e as any)?.message || e) }, 400);
  }
});
