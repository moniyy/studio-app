// send-email — the app's emails through Resend (the satinbook.com domain).
//
// POST from the database (header x-push-secret = PUSH_HOOK_SECRET): { process: true }
//   → sends what is due in email_log (the queue), at most ~480 in 24 hours
// POST with the owner's JWT:
//   { preview: kind, master_id } → { subject, html, text } (Studio → Emails)
//   { test: kind, master_id }    → the preview, sent to her own email
//
// Secrets: RESEND_API_KEY, APP_BASE_URL, PUSH_HOOK_SECRET (MAIL_DRYRUN=1 for tests).
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import { dryRun, sendMail, mailConfigured } from '../_shared/mail.ts';
import {
  buildAlert, buildClientEmail, buildDay, buildInvite, buildLead, buildSystemTest, buildErrorsAlert, sample, dayLong,
  type Booking, type Built, type Studio
} from '../_shared/email-templates.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const HOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET') || '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const CLIENT = ['confirm', 'request', 'deposit', 'moved', 'cancelled', 'reminder_24', 'reminder_2', 'review', 'fill'];
const ALERTS = ['alert_new', 'alert_cancel', 'alert_move'];
const MARKETING = ['review', 'fill'];

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// deno-lint-ignore no-explicit-any
function toStudio(m: any): Studio {
  const st = m.settings || {};
  const review = String(st.reviewUrl || '');
  return {
    id: m.id, slug: m.slug, name: m.name, style: m.style || 'soft', accent: m.accent, tz: m.timezone || 'America/New_York',
    kind: m.kind || 'solo', address: st.address || '', phone: st.phone || '', masterName: st.masterName || '',
    cancelWindow: m.cancel_window_hours ?? 24, payments: st.payments || {}, reviewUrl: review, depositMode: st.depositMode === 'fee' ? 'fee' : 'deposit', cancelUnset: !!st.cancelUnset,
    reviewLabel: /instagram/i.test(review) ? 'Leave a review on Instagram' : /google|g\.page/i.test(review) ? 'Leave a review on Google' : 'Leave a review'
  };
}
// deno-lint-ignore no-explicit-any
function toBooking(b: any): Booking {
  return {
    id: b.id, service: b.service_name, serviceId: b.service_id, start: b.start_at, end: b.end_at, price: b.price,
    deposit: b.deposit, depositStatus: b.deposit_status, depositDue: b.deposit_due_at, manageToken: b.manage_token,
    status: b.status, cancelReason: b.cancel_reason, staffName: b.staff ? b.staff.name : null,
    clientName: b.clients ? b.clients.name : '', clientPhone: b.clients ? b.clients.phone : '',
    priceAsk: !!(b.services && b.services.price_on_request),
    priceLabel: (b.services && b.services.price_label) || ''
  };
}
const STUDIO_COLS = 'id, slug, name, style, accent, timezone, kind, settings, cancel_window_hours, owner_id';
const BOOKING_COLS = 'id, master_id, service_id, service_name, start_at, end_at, price, deposit, deposit_status, deposit_due_at, manage_token, status, cancel_reason, staff_id, client_id, clients(name, phone, email, unsub_token, marketing_opt_out), staff(name, user_id), services(price_on_request, price_label)';

const emails = new Map<string, string>();
async function emailOf(uid?: string | null) {
  if (!uid) return null;
  if (!emails.has(uid)) {
    const { data } = await admin.auth.admin.getUserById(uid);
    emails.set(uid, (data && data.user && data.user.email) || '');
  }
  return emails.get(uid) || null;
}

// deno-lint-ignore no-explicit-any
async function send(row: any, built: Built, s: Studio, replyTo: string | null) {
  // a dry run (tests): what would have gone out, kept with the row
  if (dryRun()) row.__dry = { text: built.text, ics: built.ics || null, reply_to: replyTo, unsub: built.unsub || null };
  const headers: Record<string, string> = {};
  if (built.unsub) { headers['List-Unsubscribe'] = `<${built.unsub}>`; headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'; }
  row.__pid = await sendMail({
    fromName: s.name, sender: 'studio', to: row.to_email, replyTo, subject: built.subject, html: built.html, text: built.text, headers,
    attachments: built.ics ? [{ filename: built.icsName || 'appointment.ics', content: built.ics, contentType: `text/calendar; charset=utf-8; method=${/METHOD:CANCEL/.test(built.ics) ? 'CANCEL' : 'PUBLISH'}` }] : undefined
  });
}

// one row of the queue → an email (or a reason not to send it any more)
// deno-lint-ignore no-explicit-any
async function processRow(row: any): Promise<{ status: string; subject?: string; error?: string }> {
  // a lead from satinbook.com → hello@ (from "Satinbook", the reply goes to her)
  // Satinbook's own: a test that sending works / a burst of app errors (to hello@)
  if (row.kind === 'system_test' || row.kind === 'errors_alert') {
    const built = row.kind === 'system_test' ? buildSystemTest(row.data || {}) : buildErrorsAlert(row.data || { count: 0 });
    row.__pid = await sendMail({ fromName: 'Satinbook', sender: 'system', to: row.to_email, subject: built.subject, html: built.html, text: built.text });
    return { status: 'sent', subject: built.subject };
  }
  if (row.kind === 'lead') {
    const { data: l } = await admin.from('leads').select('*').eq('id', row.data && row.data.lead_id).maybeSingle();
    if (!l) return { status: 'skipped', error: 'lead gone' };
    const built = buildLead(l);
    row.__pid = await sendMail({ fromName: 'Satinbook', sender: 'system', to: row.to_email, replyTo: l.email, subject: built.subject, html: built.html, text: built.text });
    return { status: 'sent', subject: built.subject };
  }
  const { data: m } = await admin.from('masters').select(STUDIO_COLS).eq('id', row.master_id).maybeSingle();
  if (!m) return { status: 'skipped', error: 'studio gone' };
  const s = toStudio(m);
  const ownerEmail = await emailOf(m.owner_id);
  if (row.kind === 'day') {
    const tz = s.tz;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
    const from = new Date(Date.now() - 36 * 3600e3).toISOString(), to = new Date(Date.now() + 36 * 3600e3).toISOString();
    let q = admin.from('bookings').select(BOOKING_COLS).eq('master_id', s.id).in('status', ['pending', 'confirmed']).gte('start_at', from).lte('start_at', to).order('start_at');
    if (row.data && row.data.staff_id) q = q.eq('staff_id', row.data.staff_id);
    const { data: list } = await q;
    const mine = (list || []).filter(b => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(b.start_at)) === today).map(toBooking);
    if (!mine.length) return { status: 'skipped', error: 'nothing today' };
    const built = buildDay(s, mine, row.data && row.data.staff_id, dayLong(new Date().toISOString(), tz));
    await send(row, built, s, null);
    return { status: 'sent', subject: built.subject };
  }
  const { data: b } = row.booking_id ? await admin.from('bookings').select(BOOKING_COLS).eq('id', row.booking_id).maybeSingle() : { data: null };
  if (!b) return { status: 'skipped', error: 'booking gone' };
  const bk = toBooking(b);
  if (ALERTS.includes(row.kind)) {
    const built = buildAlert(row.kind, s, bk, row.data || {});
    await send(row, built, s, null);
    return { status: 'sent', subject: built.subject };
  }
  if (!CLIENT.includes(row.kind)) return { status: 'skipped', error: 'unknown kind' };
  // still true? (a reminder for a booking cancelled meanwhile, an unsubscribed client…)
  if (row.kind.startsWith('reminder') && b.status !== 'confirmed') return { status: 'skipped', error: 'not confirmed any more' };
  if (row.kind === 'deposit' && b.deposit_status !== 'pending') return { status: 'skipped', error: 'deposit no longer pending' };
  if (MARKETING.includes(row.kind) && b.clients && b.clients.marketing_opt_out) return { status: 'skipped', error: 'unsubscribed' };
  const unsub = MARKETING.includes(row.kind) && b.clients ? `${SUPABASE_URL}/functions/v1/email-unsubscribe?t=${b.clients.unsub_token}` : undefined;
  const built = buildClientEmail(row.kind, s, bk, row.data || {}, unsub);
  // her answers go to her master (a salon), or the studio's owner
  const replyTo = (s.kind === 'team' && b.staff && b.staff.user_id ? await emailOf(b.staff.user_id) : null) || ownerEmail;
  await send(row, built, s, replyTo);
  return { status: 'sent', subject: built.subject };
}

async function processQueue() {
  const t0 = Date.now();
  let sent = 0, failed = 0, skipped = 0;
  while (Date.now() - t0 < 40000) {
    const { data: rows, error } = await admin.rpc('email_claim', { p_limit: 10 });
    if (error) throw error;
    if (!rows || !rows.length) break;
    for (const row of rows) {
      let r: { status: string; subject?: string; error?: string };
      try { r = await processRow(row); } catch (e) { r = { status: 'failed', error: String((e as Error).message || e).slice(0, 300) }; }
      if (r.status === 'failed' && row.attempts < 3) {
        // try again a bit later (the provider hiccuped)
        await admin.from('email_log').update({ status: 'queued', error: r.error, send_after: new Date(Date.now() + row.attempts * 5 * 60e3).toISOString() }).eq('id', row.id);
      } else {
        await admin.from('email_log').update({ status: r.status, subject: r.subject || null, error: r.error || null, sent_at: r.status === 'sent' ? new Date().toISOString() : null,
          ...(row.__dry || row.__pid ? { data: { ...(row.data || {}), ...(row.__pid ? { provider_id: row.__pid } : {}), ...(row.__dry ? { dry_run: row.__dry } : {}) } } : {}) }).eq('id', row.id);
      }
      if (r.status === 'sent') sent++; else if (r.status === 'failed') failed++; else skipped++;
    }
  }
  return { sent, failed, skipped };
}

// the dashboard: what an email looks like (sample data, her studio's look)
async function previewFor(kind: string, s: Studio): Promise<Built> {
  const sb = sample(s, s.kind === 'team' ? 'Jasmine Lee' : null);
  if (CLIENT.includes(kind)) {
    const unsub = MARKETING.includes(kind) ? `${SUPABASE_URL}/functions/v1/email-unsubscribe?t=preview` : undefined;
    const data = kind === 'moved' ? { old_start_at: new Date(Date.parse(sb.start) - 864e5).toISOString(), by: 'studio' }
      : kind === 'cancelled' ? { by: 'studio', reason: 'Sick day' } : {};
    if (kind === 'review' && !s.reviewUrl) s = { ...s, reviewUrl: 'https://g.page/r/your-review-link', reviewLabel: 'Leave a review on Google' };
    return buildClientEmail(kind, s, sb, data, unsub);
  }
  if (ALERTS.includes(kind)) return buildAlert(kind, s, sb, {});
  if (kind === 'day') {
    const b2 = { ...sb, id: 'x', start: new Date(Date.parse(sb.start) + 3 * 3600e3).toISOString(), clientName: 'Mia Lopez', service: 'Lash Lift & Tint', price: 95 };
    return buildDay(s, [sb, b2], null, dayLong(sb.start, s.tz));
  }
  if (kind === 'invite') return buildInvite(s, 'Jasmine Lee', 'jasmine@example.com', 'k7Pm-9xQa-3Tbz');
  throw new Error('unknown kind');
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }

  if (HOOK_SECRET && req.headers.get('x-push-secret') === HOOK_SECRET) {
    if (!mailConfigured()) return json({ error: 'mail not configured' }, 500);
    try { return json(await processQueue()); } catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
  }

  // the owner: preview / test
  const auth = req.headers.get('Authorization') || '';
  const user = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: me } = await user.auth.getUser();
  if (!me || !me.user) return json({ error: 'forbidden' }, 403);
  const { data: studios } = await user.rpc('owner_studios');
  // deno-lint-ignore no-explicit-any
  const st = (studios as any[] || []).find(x => x.id === body.master_id && x.role === 'owner');
  if (!st) return json({ error: 'forbidden' }, 403);
  const { data: m } = await admin.from('masters').select(STUDIO_COLS).eq('id', st.id).single();
  const s = toStudio(m);
  const kind = String(body.preview || body.test || '');
  let built: Built;
  try { built = await previewFor(kind, s); } catch { return json({ error: 'unknown_kind' }, 400); }
  if (body.preview) return json({ subject: built.subject, html: built.html, text: built.text });
  if (!mailConfigured()) return json({ error: 'mail not configured' }, 500);
  // a test to herself is logged (and so counted toward the daily limit) like any email
  try {
    const pid = await sendMail({ fromName: s.name, sender: 'studio', to: me.user.email!, subject: '[Test] ' + built.subject, html: built.html, text: built.text,
      attachments: built.ics ? [{ filename: 'appointment.ics', content: built.ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] : undefined });
    await admin.from('email_log').insert({ master_id: s.id, kind: 'test', to_email: me.user.email, to_user: me.user.id, subject: '[Test] ' + built.subject, status: 'sent', sent_at: new Date().toISOString(), data: { of: kind, provider_id: pid } });
    return json({ sent: true, to: me.user.email });
  } catch (e) {
    return json({ error: 'send_failed', message: String((e as Error).message || e) }, 502);
  }
});
