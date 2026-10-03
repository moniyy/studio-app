// email-unsubscribe — the link in "How was your visit?" and "Time for your fill" emails
// (required in the US). GET ?t=<token> → a small page; POST (Gmail / Apple one-click) → 200.
// Bookings, changes and reminders keep coming: they are about her own appointments.
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } });
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const page = (title: string, text: string, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F7F5F2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1C1A19}
main{max-width:420px;margin:24px;padding:36px 30px;border-radius:28px;background:#fff;text-align:center}h1{margin:0 0 10px;font-size:26px}p{margin:0;font-size:16px;line-height:1.5;color:#6B6660}
@media (prefers-color-scheme:dark){body{background:#0E0E11;color:#F4F4F5}main{background:#18181B}p{color:#A1A1AA}}</style></head>
<body><main><h1>${esc(title)}</h1><p>${text}</p></main></body></html>`, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

Deno.serve(async req => {
  const t = new URL(req.url).searchParams.get('t') || '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) {
    return req.method === 'POST' ? new Response('bad token', { status: 400 }) : page('Link not valid', 'This unsubscribe link is not complete. Open it again from the email.', 400);
  }
  const { data, error } = await anon.rpc('email_unsubscribe', { p_token: t });
  if (req.method === 'POST') return new Response(error ? 'not found' : 'ok', { status: error ? 404 : 200 });
  if (error) return page('Link not valid', 'We couldn’t find this subscription — maybe it was removed already.', 404);
  // deno-lint-ignore no-explicit-any
  const studio = (data as any).studio || 'the studio';
  return page('You’re unsubscribed', `${esc(studio)} won’t send you review and fill reminders any more. Emails about your own bookings (confirmations, changes, reminders) still arrive.`);
});
