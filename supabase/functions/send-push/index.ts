// send-push — Web Push to every device of a master.
//
// Two callers:
//   1. the bookings trigger (pg_net) with header x-push-secret = PUSH_HOOK_SECRET
//      body: { kind: 'new' | 'request' | 'cancel' | 'move', booking_id, old_start_at? }
//   2. the dashboard's "Send test notification" with the master's own JWT
//      body: { master_id }
// Subscriptions answering 404 / 410 are deleted.
//
// Secrets (npx supabase secrets set …): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
// VAPID_SUBJECT, PUSH_HOOK_SECRET. SUPABASE_URL / _ANON_KEY / _SERVICE_ROLE_KEY are built in.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { sendPush, type Vapid } from './webpush.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const HOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET') || '';
const VAPID: Vapid = {
  publicKey: Deno.env.get('VAPID_PUBLIC_KEY') || '',
  privateKey: Deno.env.get('VAPID_PRIVATE_KEY') || '',
  subject: Deno.env.get('VAPID_SUBJECT') || 'https://moniyy.github.io/studio-app/'
};

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// "Today 2:00 PM" / "Fri 2:00 PM" in the studio's time zone
function when(iso: string, tz: string): string {
  const d = new Date(iso);
  const day = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(x);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(d);
  const tomorrow = new Date(Date.now() + 864e5);
  if (day(d) === day(new Date())) return `Today ${time}`;
  if (day(d) === day(tomorrow)) return `Tomorrow ${time}`;
  return `${new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d)} ${time}`;
}

type Message = { title: string; body: string; url: string; tag: string; booking?: string };

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  if (!VAPID.publicKey || !VAPID.privateKey) return json({ error: 'vapid keys missing' }, 500);

  let input: Record<string, string>;
  try { input = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  let masterId: string;
  let message: Message;

  if (HOOK_SECRET && req.headers.get('x-push-secret') === HOOK_SECRET) {
    // ---- from the bookings trigger ----
    const { data: b } = await admin
      .from('bookings')
      .select('id, master_id, status, start_at, late_cancel, service_name, clients(name), masters(slug, timezone, cancel_window_hours)')
      .eq('id', input.booking_id)
      .single();
    if (!b) return json({ error: 'booking not found' }, 404);
    // deno-lint-ignore no-explicit-any
    const bk = b as any;
    const m = bk.masters;
    const name = (bk.clients && bk.clients.name) || 'Client';
    const at = when(bk.start_at, m.timezone);
    const url = `./?m=${encodeURIComponent(m.slug)}&owner=1&booking=${bk.id}`;
    masterId = bk.master_id;
    switch (input.kind) {
      case 'new':
        message = { title: 'New booking ✨', body: `${name} · ${bk.service_name} · ${at}`, url, tag: `${bk.id}-new` };
        break;
      case 'request':
        message = { title: 'New request ⏳', body: `${name} · ${bk.service_name} · ${at} — tap to approve`, url, tag: `${bk.id}-new` };
        break;
      case 'cancel':
        message = bk.late_cancel
          ? { title: 'Late cancel', body: `${name} · ${at} — less than ${m.cancel_window_hours}h notice`, url, tag: `${bk.id}-cancel` }
          : { title: 'Cancelled', body: `${name} · ${at}`, url, tag: `${bk.id}-cancel` };
        break;
      case 'move':
        message = { title: 'Rescheduled', body: `${name} → ${at}`, url, tag: `${bk.id}-move` };
        break;
      default:
        return json({ error: 'unknown kind' }, 400);
    }
    message.booking = bk.id;
  } else {
    // ---- "Send test notification" from the dashboard (her own JWT) ----
    const auth = req.headers.get('Authorization') || '';
    const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: studios, error } = await user.rpc('owner_studios');
    // deno-lint-ignore no-explicit-any
    const st = !error && (studios as any[] || []).find(x => x.id === input.master_id);
    if (!st) return json({ error: 'forbidden' }, 403);
    masterId = st.id;
    message = {
      title: 'Notifications are on ✓',
      body: `You’ll hear about new bookings and cancellations at ${st.name} right here.`,
      url: `./?m=${encodeURIComponent(st.slug)}&owner=1`,
      tag: 'test'
    };
  }

  const { data: subs } = await admin.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('master_id', masterId);
  const results = await Promise.all((subs || []).map(async s => {
    try { return { id: s.id, ...(await sendPush(s, message, VAPID)) }; } catch (e) { return { id: s.id, ok: false, status: 0, gone: false, text: String(e) }; }
  }));
  const gone = results.filter(r => r.gone).map(r => r.id);
  if (gone.length) await admin.from('push_subscriptions').delete().in('id', gone);
  return json({
    sent: results.filter(r => r.ok).length,
    removed: gone.length,
    failed: results.filter(r => !r.ok && !r.gone).map(r => ({ status: r.status, text: r.text }))
  });
});
