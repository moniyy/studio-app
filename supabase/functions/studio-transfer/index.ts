// studio-transfer — the link in "<studio> is ready for you" (Admin → Transfer to email).
// Public: the token from the email is the key (only that inbox has it).
//
// POST { op: 'info', token }             → { email, studio, slug, state, account }
//        state: 'pending' | 'accepted' | 'expired' | 'cancelled'; account: she already has a sign-in
// POST { op: 'accept', token, password } → { email, slug, created }
//        no account yet: one is made with her password; then she is the studio's owner.
//        An account with that email already: no password needed — she signs in with her own.
// Deploy: functions deploy studio-transfer --use-api --no-verify-jwt
import { cors, json, serviceClient } from '../_shared/admin.ts';
import { transferTo } from '../_shared/transfer.ts';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  // deno-lint-ignore no-explicit-any
  let b: any;
  try { b = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const token = String(b.token || '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token)) return json({ error: 'not_found' }, 404);

  const admin = serviceClient();
  const { data: t } = await admin.from('studio_transfers')
    .select('id, email, expires_at, accepted_at, cancelled_at, masters(id, slug, name, owner_id, settings)').eq('token', token).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const m = t && (t as any).masters;
  if (!t || !m) return json({ error: 'not_found' }, 404);
  const state = t.accepted_at ? 'accepted' : t.cancelled_at ? 'cancelled' : Date.parse(t.expires_at) < Date.now() ? 'expired' : 'pending';
  const { data: uid } = await admin.rpc('admin_user_id_by_email', { p_email: t.email });

  if (b.op === 'info') return json({ email: t.email, studio: m.name, slug: m.slug, state, account: !!uid });

  if (b.op === 'accept') {
    if (state !== 'pending') return json({ error: state }, 409);
    let userId: string | null = uid || null;
    let created = false;
    if (!userId) {
      const password = String(b.password || '');
      if (password.length < 8 || password.length > 72) return json({ error: 'weak_password' }, 400);
      const { data: u, error } = await admin.auth.admin.createUser({
        email: t.email, password, email_confirm: true, user_metadata: { name: (m.settings && m.settings.masterName) || '' }
      });
      if (error || !u.user) return json({ error: 'auth_error', message: error?.message }, 500);
      userId = u.user.id;
      created = true;
    }
    const why = await transferTo(admin, m, userId);
    if (why) {
      if (created) await admin.auth.admin.deleteUser(userId); // nothing half-made
      return json({ error: 'transfer_failed', message: why }, 500);
    }
    await admin.from('studio_transfers').update({ accepted_at: new Date().toISOString(), user_id: userId }).eq('id', t.id);
    // her own password from the start: no "choose a new password" screen
    if (created) await admin.from('owner_accounts').upsert({ user_id: userId, must_change_password: false });
    return json({ email: t.email, slug: m.slug, created });
  }
  return json({ error: 'unknown_op' }, 400);
});
