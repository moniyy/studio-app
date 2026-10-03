// admin-master-action — what needs the service role, for the platform admin only.
//
// POST (Authorization: the admin's JWT)
//   { action: 'reset_password', master_id }       → { email, password } (shown once)
//   { action: 'delete', master_id, confirm: slug } → removes the studio, its photos
//                                                    and the accounts of its master (and her team)
// Status, billing and notes are saved with the admin_save_studio RPC instead.
import { cors, json, requireAdmin, serviceClient, tempPassword } from '../_shared/admin.ts';

const FOLDERS = ['app', 'services', 'cover', 'avatar', 'looks', 'formulas', 'team', 'misc'];

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const admin = serviceClient();
  const me = await requireAdmin(req, admin);
  if (!me) return json({ error: 'forbidden' }, 403);

  // deno-lint-ignore no-explicit-any
  let b: any;
  try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const { data: m } = await admin.from('masters').select('id, slug, owner_id').eq('id', String(b.master_id || '')).maybeSingle();
  if (!m) return json({ error: 'not_found' }, 404);

  if (b.action === 'reset_password') {
    if (!m.owner_id) return json({ error: 'no_owner' }, 409);
    const password = tempPassword();
    const { data: u, error } = await admin.auth.admin.updateUserById(m.owner_id, { password });
    if (error) return json({ error: 'auth_error', message: error.message }, 500);
    await admin.from('owner_accounts').upsert({ user_id: m.owner_id, must_change_password: true, temp_password_at: new Date().toISOString() });
    return json({ email: u.user?.email || '', password });
  }

  if (b.action === 'delete') {
    if (String(b.confirm || '') !== m.slug) return json({ error: 'confirm_mismatch' }, 400);
    for (const f of FOLDERS) {
      const { data: objs } = await admin.storage.from('studio-media').list(`${m.id}/${f}`, { limit: 1000 });
      if (objs && objs.length) await admin.storage.from('studio-media').remove(objs.map(o => `${m.id}/${f}/${o.name}`));
    }
    // a salon: its masters' sign-ins (read before the staff rows go with the studio)
    const { data: crew } = await admin.from('staff').select('user_id').eq('master_id', m.id).eq('is_owner', false).not('user_id', 'is', null);
    const { error } = await admin.from('masters').delete().eq('id', m.id); // services, bookings, clients, staff… go with it
    if (error) return json({ error: 'delete_failed', message: error.message }, 500);
    // her account goes too — unless she runs another studio or is an admin
    let accountRemoved = false;
    if (m.owner_id && m.owner_id !== me.id) {
      const { count } = await admin.from('masters').select('id', { count: 'exact', head: true }).eq('owner_id', m.owner_id);
      const { data: isAdmin } = await admin.from('admins').select('user_id').eq('user_id', m.owner_id).maybeSingle();
      if (!count && !isAdmin) { await admin.auth.admin.deleteUser(m.owner_id); accountRemoved = true; }
    }
    // each master's account too — unless she is on another team, runs a studio or is an admin
    let staffRemoved = 0;
    for (const { user_id: uid } of crew || []) {
      if (uid === me.id) continue;
      const { count: own } = await admin.from('masters').select('id', { count: 'exact', head: true }).eq('owner_id', uid);
      const { count: other } = await admin.from('staff').select('id', { count: 'exact', head: true }).eq('user_id', uid);
      const { data: adm } = await admin.from('admins').select('user_id').eq('user_id', uid).maybeSingle();
      if (!own && !other && !adm) { await admin.auth.admin.deleteUser(uid); staffRemoved++; }
    }
    return json({ deleted: true, slug: m.slug, accountRemoved, staffRemoved });
  }

  return json({ error: 'unknown_action' }, 400);
});
