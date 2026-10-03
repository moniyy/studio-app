// Sending email through the studio Gmail (SMTP, port 465) — shared by send-email,
// owner-invite-staff and admin-master-action. The address and the app password
// live only in Supabase secrets: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (SMTP_FROM optional).
// Moving to a domain later = new secrets (README → "Switch to satinbook.com").
import nodemailer from 'npm:nodemailer@6.9.16';

export type Attachment = { filename: string; content: string; contentType: string };
export type Mail = {
  fromName: string;          // "Bella Brows" — the address itself is always the SMTP account
  to: string;
  replyTo?: string | null;   // the master's own email: clients' answers go to her
  subject: string;
  html: string;
  text: string;
  attachments?: Attachment[];
  headers?: Record<string, string>;
};

// deno-lint-ignore no-explicit-any
let transport: any = null;
function tx() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: Deno.env.get('SMTP_HOST') || 'smtp.gmail.com',
      port: Number(Deno.env.get('SMTP_PORT') || 465),
      secure: true,
      auth: { user: Deno.env.get('SMTP_USER'), pass: Deno.env.get('SMTP_PASS') },
      pool: true, maxConnections: 2, maxMessages: 50
    });
  }
  return transport;
}

// SMTP_DRYRUN=1 (tests only): everything runs, nothing is sent — the email is kept in the log instead
export const dryRun = () => Deno.env.get('SMTP_DRYRUN') === '1';
export const mailConfigured = () => dryRun() || !!(Deno.env.get('SMTP_USER') && Deno.env.get('SMTP_PASS'));

export async function sendMail(m: Mail): Promise<string> {
  if (dryRun()) return 'dry-run';
  // the sender address: the Gmail itself, or SMTP_FROM (a domain address, e.g. with Resend)
  const user = Deno.env.get('SMTP_FROM') || Deno.env.get('SMTP_USER')!;
  // quotes and line breaks never reach the From header
  const name = String(m.fromName || 'Studio App').replace(/["\r\n<>]/g, '').slice(0, 60);
  const info = await tx().sendMail({
    from: { name, address: user },
    to: m.to,
    replyTo: m.replyTo || undefined,
    subject: m.subject,
    html: m.html,
    text: m.text,
    attachments: m.attachments,
    headers: m.headers
  });
  return String(info.messageId || '');
}

// the app's address: one setting (APP_BASE_URL), e.g. https://moniyy.github.io/studio-app/
export const appBase = () => {
  const b = Deno.env.get('APP_BASE_URL') || 'https://moniyy.github.io/studio-app/';
  return b.endsWith('/') ? b : b + '/';
};
export const studioLink = (slug: string, query = '') => `${appBase()}${encodeURIComponent(slug)}${query ? '?' + query : ''}`;
