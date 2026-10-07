// Sending email through Resend (https://resend.com, the satinbook.com domain) —
// shared by send-email, owner-invite-staff and admin-master-action.
// The API key lives only in Supabase secrets: RESEND_API_KEY.
//
// Two senders:
//   studio — "<Studio name> <bookings@satinbook.com>", Reply-To the master's own email
//   system — "Satinbook <hello@satinbook.com>" (invites, new passwords)
// (MAIL_BOOKINGS / MAIL_SYSTEM secrets override the addresses.)

export type Attachment = { filename: string; content: string; contentType: string };
export type Mail = {
  fromName: string;          // "Bella Brows" (studio) — ignored for system emails
  sender?: 'studio' | 'system';
  to: string;
  replyTo?: string | null;   // the master's own email: clients' answers go to her
  subject: string;
  html: string;
  text: string;
  attachments?: Attachment[];
  headers?: Record<string, string>;
};

const KEY = () => Deno.env.get('RESEND_API_KEY') || '';
export const BOOKINGS_FROM = () => Deno.env.get('MAIL_BOOKINGS') || 'bookings@satinbook.com';
export const SYSTEM_FROM = () => Deno.env.get('MAIL_SYSTEM') || 'hello@satinbook.com';

// MAIL_DRYRUN=1 (tests only): everything runs, nothing is sent — the email is kept in the log instead
export const dryRun = () => Deno.env.get('MAIL_DRYRUN') === '1';
export const mailConfigured = () => dryRun() || !!KEY();

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

// → the provider's message id (for delivery checks)
export async function sendMail(m: Mail): Promise<string> {
  if (dryRun()) return 'dry-run';
  // reserved test domains never deliver (RFC 2606): a bounce would only hurt the domain's reputation
  if (/@(example\.(com|org|net)|[^@]+\.(test|invalid|example|localhost))$/i.test(m.to)) throw new Error('reserved test domain — not sent');
  // quotes, brackets and line breaks never reach the From header
  const clean = (s: string) => String(s || '').replace(/["\r\n<>]/g, '').slice(0, 60).trim();
  const from = m.sender === 'system'
    ? `Satinbook <${SYSTEM_FROM()}>`
    : `${clean(m.fromName) || 'Satinbook'} <${BOOKINGS_FROM()}>`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from, to: [m.to], subject: m.subject, html: m.html, text: m.text,
      ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      ...(m.headers && Object.keys(m.headers).length ? { headers: m.headers } : {}),
      ...(m.attachments && m.attachments.length ? {
        attachments: m.attachments.map(a => ({ filename: a.filename, content: b64(a.content), content_type: a.contentType }))
      } : {})
    })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`resend ${res.status}: ${(j && (j.message || j.name)) || 'error'}`);
  return String(j.id || '');
}

// the app's address: one setting (APP_BASE_URL), e.g. https://satinbook.com/
export const appBase = () => {
  const b = Deno.env.get('APP_BASE_URL') || 'https://satinbook.com/';
  return b.endsWith('/') ? b : b + '/';
};
export const studioLink = (slug: string, query = '') => `${appBase()}${encodeURIComponent(slug)}${query ? '?' + query : ''}`;
