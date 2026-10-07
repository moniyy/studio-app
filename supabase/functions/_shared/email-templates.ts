// The app's emails: one responsive layout in the studio's own style (Soft / Maison /
// Noir, her accent, her monogram), a big button, and a plain-text twin of each.
// Works with tables + inline styles (Gmail, Apple Mail, Outlook); the dark theme
// is a media query (Apple Mail follows it; Gmail recolours on its own).
import { studioLink } from './mail.ts';

// ---------- the data an email is made from ----------
export type Studio = {
  id: string; slug: string; name: string; style: string; accent: string | null; tz: string; kind: string;
  address?: string; phone?: string; masterName?: string; cancelWindow?: number;
  payments?: Record<string, string>; reviewUrl?: string; reviewLabel?: string;
};
export type Booking = {
  id: string; service: string; serviceId?: string | null; start: string; end: string; price?: number | null;
  deposit?: number | null; depositStatus?: string; depositDue?: string | null; manageToken: string;
  status: string; cancelReason?: string | null; staffName?: string | null; clientName?: string; clientPhone?: string;
};
export type Built = { subject: string; html: string; text: string; ics?: string; icsName?: string; unsub?: string };

// ---------- small helpers ----------
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const first = (n?: string | null) => String(n || '').trim().split(/\s+/)[0] || '';
export const money = (v: unknown) => {
  const n = Number(v);
  if (!isFinite(n)) return '';
  return '$' + (Number.isInteger(n) ? n.toString() : n.toFixed(2));
};
const fmt = (iso: string, tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(new Date(iso));
export const dayLong = (iso: string, tz: string) => fmt(iso, tz, { weekday: 'long', month: 'long', day: 'numeric' });
export const dayShort = (iso: string, tz: string) => fmt(iso, tz, { weekday: 'short', month: 'short', day: 'numeric' });
export const clock = (iso: string, tz: string) => fmt(iso, tz, { hour: 'numeric', minute: '2-digit' });
const initials = (name: string) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('').toUpperCase();
// who does it: the master (a salon) — or the studio's own master — or the studio
export const whoName = (s: Studio, b?: Booking) => (s.kind === 'team' ? first(b && b.staffName) || s.name : first(s.masterName) || s.name);

// ---------- look ----------
type Palette = { bg: string; card: string; text: string; muted: string; line: string; soft: string; serif: boolean; dark: boolean };
const PALETTES: Record<string, Palette> = {
  soft: { bg: '#F7F5F2', card: '#FFFFFF', text: '#1C1A19', muted: '#7D7671', line: '#ECE7E2', soft: '#F6F1EC', serif: false, dark: false },
  maison: { bg: '#F7F3EE', card: '#FFFDF9', text: '#2A211C', muted: '#8C7E73', line: '#EADFD3', soft: '#F3ECE3', serif: true, dark: false },
  noir: { bg: '#0A0A0B', card: '#161618', text: '#F5F5F7', muted: '#A1A1AA', line: '#2A2A2E', soft: '#1F1F23', serif: false, dark: true }
};
const DEFAULT_ACCENT: Record<string, string> = { soft: '#C9796B', maison: '#9C7457', noir: '#F4A6B8' };
const lum = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 0.5;
  const n = parseInt(m[1], 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
function look(s: Studio) {
  const p = PALETTES[s.style] || PALETTES.soft;
  let accent = /^#[0-9a-f]{6}$/i.test(s.accent || '') ? s.accent! : DEFAULT_ACCENT[s.style] || DEFAULT_ACCENT.soft;
  // a pale accent can't carry text on a light card: use the text colour for the button there
  if (!p.dark && lum(accent) > 0.6) accent = p.text;
  if (p.dark && lum(accent) < 0.08) accent = '#FFFFFF';
  const onAccent = lum(accent) > 0.45 ? '#111111' : '#FFFFFF';
  return { ...p, accent, onAccent };
}

// ---------- the layout ----------
export type Row = [string, string];
export type Section = { title?: string; html: string; text: string };
export type Layout = {
  preheader: string; eyebrow?: string; title: string; intro?: string;
  rows?: Row[]; sections?: Section[];
  button?: { label: string; url: string }; button2?: { label: string; url: string };
  note?: string; unsub?: string; footer?: string;
};

export function layout(s: Studio, L: Layout): { html: string; text: string } {
  const k = look(s);
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const head = k.serif ? "Georgia,'Times New Roman',serif" : font;
  const btn = (b: { label: string; url: string }, main: boolean) => `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>
      <td class="${main ? '' : 'btn2'}" style="border-radius:999px;background:${main ? k.accent : k.soft};" bgcolor="${main ? k.accent : k.soft}">
        <a href="${esc(b.url)}" style="display:inline-block;padding:15px 30px;font-family:${font};font-size:16px;font-weight:700;line-height:1;color:${main ? k.onAccent : k.text};text-decoration:none;border-radius:999px;" class="${main ? '' : 'tx'}">${esc(b.label)}</a>
      </td></tr></table>`;
  const rows = (L.rows || []).filter(r => r && r[1]).map(([a, b], i) => `
      <tr>
        <td class="mt ln" style="padding:12px 0;${i ? `border-top:1px solid ${k.line};` : ''}font-family:${font};font-size:15px;color:${k.muted};">${esc(a)}</td>
        <td class="tx ln" align="right" style="padding:12px 0;${i ? `border-top:1px solid ${k.line};` : ''}font-family:${font};font-size:15px;font-weight:600;color:${k.text};">${b}</td>
      </tr>`).join('');
  const dark = k.dark ? '' : `
    @media (prefers-color-scheme: dark) {
      .bg { background:#0E0E11 !important; }
      .card { background:#18181B !important; }
      .tx { color:#F4F4F5 !important; }
      .mt { color:#A1A1AA !important; }
      .ln { border-color:#2A2A2E !important; }
      .box { background:#232327 !important; }
      .btn2 { background:#2A2A2E !important; }
    }`;
  const html = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="${k.dark ? 'dark' : 'light dark'}"><meta name="supported-color-schemes" content="${k.dark ? 'dark' : 'light dark'}">
<title>${esc(L.title)}</title>
<style>
  body { margin:0; padding:0; -webkit-text-size-adjust:100%; }
  a { color:${k.accent}; }
  @media (max-width:520px) { .pad { padding:28px 22px !important; } .h1 { font-size:26px !important; } }${dark}
</style></head>
<body class="bg" style="margin:0;padding:0;background:${k.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(L.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="bg" style="background:${k.bg};" bgcolor="${k.bg}">
<tr><td align="center" style="padding:28px 12px 36px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td align="center" style="padding:4px 0 18px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="52" height="52" align="center" valign="middle" style="width:52px;height:52px;border-radius:26px;background:${k.accent};font-family:${head};font-size:19px;font-weight:700;color:${k.onAccent};letter-spacing:.02em;" bgcolor="${k.accent}">${esc(initials(s.name))}</td>
      </tr></table>
      <div class="tx" style="margin-top:10px;font-family:${head};font-size:15px;font-weight:700;color:${k.text};">${esc(s.name)}</div>
    </td></tr>
    <tr><td class="card pad" style="background:${k.card};border-radius:28px;padding:36px 34px;" bgcolor="${k.card}">
      ${L.eyebrow ? `<div class="mt" style="font-family:${font};font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${k.muted};margin-bottom:10px;">${esc(L.eyebrow)}</div>` : ''}
      <h1 class="tx h1" style="margin:0 0 12px;font-family:${head};font-size:30px;line-height:1.15;font-weight:${k.serif ? 500 : 800};letter-spacing:-.01em;color:${k.text};">${esc(L.title)}</h1>
      ${L.intro ? `<p class="tx" style="margin:0 0 22px;font-family:${font};font-size:16px;line-height:1.55;color:${k.text};">${L.intro}</p>` : ''}
      ${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="box" style="background:${k.soft};border-radius:18px;margin:0 0 24px;" bgcolor="${k.soft}"><tr><td style="padding:6px 20px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr></table>` : ''}
      ${(L.sections || []).map(x => `
        ${x.title ? `<div class="tx" style="margin:0 0 8px;font-family:${font};font-size:15px;font-weight:700;color:${k.text};">${esc(x.title)}</div>` : ''}
        <div class="tx" style="margin:0 0 22px;font-family:${font};font-size:15px;line-height:1.55;color:${k.text};">${x.html}</div>`).join('')}
      ${L.button ? `<div style="padding:6px 0 4px;">${btn(L.button, true)}</div>` : ''}
      ${L.button2 ? `<div style="padding:12px 0 0;">${btn(L.button2, false)}</div>` : ''}
      ${L.note ? `<p class="mt" style="margin:24px 0 0;font-family:${font};font-size:13px;line-height:1.5;color:${k.muted};text-align:center;">${L.note}</p>` : ''}
    </td></tr>
    <tr><td align="center" class="mt" style="padding:22px 18px 0;font-family:${font};font-size:12px;line-height:1.6;color:${k.muted};">
      ${esc([s.name, s.address].filter(Boolean).join(' · '))}${s.phone ? `<br>${esc(s.phone)}` : ''}
      ${L.footer ? `<br>${L.footer}` : ''}
      ${L.unsub ? `<br><a href="${esc(L.unsub)}" class="mt" style="color:${k.muted};text-decoration:underline;">Unsubscribe from these emails</a>` : ''}
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    s.name.toUpperCase(),
    '',
    L.title,
    L.intro ? strip(L.intro) : '',
    '',
    ...(L.rows || []).filter(r => r && r[1]).map(([a, b]) => `${a}: ${strip(b)}`),
    ...(L.sections || []).flatMap(x => ['', x.title ? x.title + ':' : '', x.text]),
    '',
    L.button ? `${L.button.label}: ${L.button.url}` : '',
    L.button2 ? `${L.button2.label}: ${L.button2.url}` : '',
    L.note ? '\n' + strip(L.note) : '',
    '',
    '—',
    [s.name, s.address, s.phone].filter(Boolean).join(' · '),
    L.unsub ? `Unsubscribe: ${L.unsub}` : ''
  ].filter((x, i, a) => !(x === '' && a[i - 1] === '')).join('\n').trim();
  return { html, text };
}
const strip = (h: string) => String(h).replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

// ---------- calendar ----------
const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
export function ics(s: Studio, b: Booking, cancel = false): string {
  const manage = studioLink(s.slug, 'manage=' + b.manageToken);
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Satinbook//EN', 'CALSCALE:GREGORIAN', `METHOD:${cancel ? 'CANCEL' : 'PUBLISH'}`,
    'BEGIN:VEVENT',
    `UID:${b.id}@studio-app`,
    `SEQUENCE:${Math.floor(Date.now() / 1000)}`,
    `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(b.start)}`,
    `DTEND:${icsDate(b.end)}`,
    `SUMMARY:${icsText(`${b.service} — ${s.name}`)}`,
    s.address ? `LOCATION:${icsText(s.address)}` : '',
    `DESCRIPTION:${icsText(`Manage or reschedule: ${manage}`)}`,
    `URL:${manage}`,
    `STATUS:${cancel ? 'CANCELLED' : 'CONFIRMED'}`,
    cancel ? '' : 'BEGIN:VALARM\r\nTRIGGER:-PT2H\r\nACTION:DISPLAY\r\nDESCRIPTION:' + icsText(`${b.service} in 2 hours`) + '\r\nEND:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ].filter(Boolean).join('\r\n');
}
export const googleCal = (s: Studio, b: Booking) => 'https://calendar.google.com/calendar/render?' + new URLSearchParams({
  action: 'TEMPLATE', text: `${b.service} — ${s.name}`, dates: `${icsDate(b.start)}/${icsDate(b.end)}`,
  details: `Manage or reschedule: ${studioLink(s.slug, 'manage=' + b.manageToken)}`, location: s.address || ''
}).toString();

// ---------- deposits: the ways to pay ----------
function payWays(s: Studio, amount: number) {
  const p = s.payments || {};
  const out: { label: string; url?: string; text: string }[] = [];
  const amt = amount ? String(amount) : '';
  if (p.cashapp) out.push({ label: `Cash App ${p.cashapp}`, url: `https://cash.app/${encodeURIComponent(p.cashapp.replace(/^\$?/, '$'))}/${amt}`, text: `Cash App ${p.cashapp}` });
  if (p.venmo) out.push({ label: `Venmo ${p.venmo}`, url: `https://venmo.com/${encodeURIComponent(p.venmo.replace(/^@/, ''))}?txn=pay&amount=${amt}`, text: `Venmo ${p.venmo}` });
  if (p.paypal) out.push({ label: `PayPal.me/${p.paypal}`, url: `https://paypal.me/${encodeURIComponent(p.paypal)}/${amt}`, text: `PayPal: paypal.me/${p.paypal}/${amt}` });
  if (p.square) out.push({ label: 'Pay with Square', url: p.square, text: `Square: ${p.square}` });
  if (p.zelle) out.push({ label: `Zelle: ${p.zelle}`, text: `Zelle: ${p.zelle}` });
  return out;
}

// ---------- the emails ----------
const policyNote = (s: Studio) => (s.cancelWindow ? `Free to cancel or move up to ${s.cancelWindow} hours before. Later changes are marked as late.` : 'You can cancel or move it any time from the link above.');

function bookingRows(s: Studio, b: Booking, extra: Row[] = []): Row[] {
  return [
    ['Service', esc(b.service)],
    ...(s.kind === 'team' && b.staffName ? [['With', esc(b.staffName)] as Row] : []),
    ['Date', esc(dayLong(b.start, s.tz))],
    ['Time', esc(clock(b.start, s.tz))],
    ...(s.address ? [['Address', esc(s.address)] as Row] : []),
    ...(b.price != null ? [['Price', esc(money(b.price))] as Row] : []),
    ...extra
  ];
}

export function buildClientEmail(kind: string, s: Studio, b: Booking, data: Record<string, unknown>, unsubUrl?: string): Built {
  const who = whoName(s, b);
  const manage = studioLink(s.slug, 'manage=' + b.manageToken);
  const when = `${dayShort(b.start, s.tz)} at ${clock(b.start, s.tz)}`;
  const hi = b.clientName ? `Hi ${esc(first(b.clientName))}! ` : '';
  const manageBtn = { label: 'Manage booking', url: manage };
  const calBtn = { label: 'Add to calendar', url: googleCal(s, b) };
  switch (kind) {
    case 'confirm': {
      const paid = data.deposit_paid ? [['Deposit', `${esc(money(b.deposit))} received`] as Row] : [];
      const L = layout(s, {
        preheader: `${b.service} · ${when}`, eyebrow: 'Confirmed', title: 'You’re booked ✨',
        intro: `${hi}See you ${esc(dayLong(b.start, s.tz))} at ${esc(clock(b.start, s.tz))}${s.kind === 'team' && b.staffName ? ` with ${esc(first(b.staffName))}` : ''}.`,
        rows: bookingRows(s, b, paid), button: calBtn, button2: manageBtn, note: esc(policyNote(s)) + '<br>The calendar file is attached too.'
      });
      return { subject: `You’re booked: ${b.service} · ${when}`, ...L, ics: ics(s, b), icsName: 'appointment.ics' };
    }
    case 'request': {
      const L = layout(s, {
        preheader: `${who} will confirm soon`, eyebrow: 'Request sent', title: `${who} will confirm soon`,
        intro: `${hi}Your request for ${esc(dayLong(b.start, s.tz))} at ${esc(clock(b.start, s.tz))} is in. You’ll get another email when it’s confirmed.`,
        rows: bookingRows(s, b), button: manageBtn
      });
      return { subject: `Request received: ${b.service} · ${when}`, ...L };
    }
    case 'deposit': {
      const amount = Number(b.deposit) || 0;
      const ways = payWays(s, amount);
      const due = b.depositDue ? `${dayShort(b.depositDue, s.tz)} at ${clock(b.depositDue, s.tz)}` : '';
      const L = layout(s, {
        preheader: `Send ${money(amount)} to hold your spot`, eyebrow: 'Almost there', title: `Send your ${money(amount)} deposit`,
        intro: `${hi}Your time is held for you${due ? ` until <b>${esc(due)}</b>` : ''}. Send the deposit to lock it in — it goes toward your service.`,
        rows: bookingRows(s, b, [['Deposit', esc(money(amount))]]),
        sections: [{
          title: 'How to pay',
          html: ways.length ? ways.map(w => (w.url ? `<a href="${esc(w.url)}" style="font-weight:700;">${esc(w.label)}</a>` : `<b>${esc(w.label)}</b>`)).join('<br>') + '<br><span class="mt">Add your name to the payment note.</span>' : `Ask ${esc(who)} how to send it.`,
          text: ways.map(w => w.text).join('\n') + '\nAdd your name to the payment note.'
        }],
        button: manageBtn, note: due ? `Not received by ${esc(due)} → the time is released for someone else.` : ''
      });
      return { subject: `Almost there — send your ${money(amount)} deposit`, ...L };
    }
    case 'moved': {
      const old = data.old_start_at ? `${dayShort(String(data.old_start_at), s.tz)} at ${clock(String(data.old_start_at), s.tz)}` : '';
      const by = data.by === 'studio' ? `${who} moved your appointment.` : 'Your appointment has a new time.';
      const L = layout(s, {
        preheader: `New time: ${when}`, eyebrow: 'Rescheduled', title: `New time: ${when}`,
        intro: `${hi}${esc(by)}${old ? ` It was <s>${esc(old)}</s>.` : ''}`,
        rows: bookingRows(s, b), button: calBtn, button2: manageBtn, note: 'The updated calendar file is attached.'
      });
      return { subject: `Rescheduled: ${b.service} → ${when}`, ...L, ics: ics(s, b), icsName: 'appointment.ics' };
    }
    case 'cancelled': {
      const byStudio = data.by === 'studio';
      const why = data.deposit_expired ? 'The deposit didn’t arrive in time, so the time was released.'
        : byStudio ? `${esc(who)} had to cancel${data.reason ? `: “${esc(data.reason)}”` : ''}. Sorry for the change.`
        : 'Your appointment is cancelled.';
      const L = layout(s, {
        preheader: `${b.service} · ${when} is cancelled`, eyebrow: 'Cancelled', title: `${b.service} is cancelled`,
        intro: `${hi}${why}`, rows: [['Was', `<s>${esc(dayLong(b.start, s.tz))} · ${esc(clock(b.start, s.tz))}</s>`], ['Service', esc(b.service)]],
        button: { label: 'Book a new time', url: studioLink(s.slug) }
      });
      return { subject: `Cancelled: ${b.service} · ${when}`, ...L, ics: ics(s, b, true), icsName: 'cancelled.ics' };
    }
    case 'reminder_24':
    case 'reminder_2': {
      const soon = kind === 'reminder_2';
      const L = layout(s, {
        preheader: soon ? `In 2 hours: ${b.service}` : `Tomorrow at ${clock(b.start, s.tz)}: ${b.service}`,
        eyebrow: soon ? 'In 2 hours' : 'Tomorrow', title: soon ? `See you at ${clock(b.start, s.tz)}` : `See you tomorrow at ${clock(b.start, s.tz)}`,
        intro: `${hi}A quick reminder about your ${esc(b.service)}${s.kind === 'team' && b.staffName ? ` with ${esc(first(b.staffName))}` : ''}.`,
        rows: bookingRows(s, b), button: manageBtn,
        note: soon ? 'Running late? Reply to this email so we know.' : esc(policyNote(s))
      });
      return { subject: soon ? `In 2 hours: ${b.service} at ${clock(b.start, s.tz)}` : `Tomorrow: ${b.service} at ${clock(b.start, s.tz)}`, ...L };
    }
    case 'review': {
      const L = layout(s, {
        preheader: `A quick review means the world to ${who}`, eyebrow: 'Thank you', title: 'How was your visit?',
        intro: `${hi}Thank you for coming in for your ${esc(b.service)}. A quick review means the world to ${esc(who)} 💕`,
        button: { label: s.reviewLabel || 'Leave a review', url: s.reviewUrl || studioLink(s.slug) }, unsub: unsubUrl
      });
      return { subject: `How was your ${b.service}?`, ...L, unsub: unsubUrl };
    }
    case 'fill': {
      const L = layout(s, {
        preheader: 'Book your fill before the gaps show', eyebrow: 'Fill reminder', title: 'Time for your fill 💕',
        intro: `${hi}It’s been a few weeks since your ${esc(b.service)} — a good moment to book your fill.`,
        button: { label: 'Book my fill', url: studioLink(s.slug, b.serviceId ? 'book=' + b.serviceId : '') }, unsub: unsubUrl
      });
      return { subject: 'Time for your fill 💕', ...L, unsub: unsubUrl };
    }
  }
  throw new Error('unknown kind ' + kind);
}

// ---------- to the masters ----------
export function buildAlert(kind: string, s: Studio, b: Booking, data: Record<string, unknown>): Built {
  const when = `${dayShort(b.start, s.tz)} at ${clock(b.start, s.tz)}`;
  const client = b.clientName || 'Client';
  const open = { label: 'Open in your dashboard', url: studioLink(s.slug, `owner=1&booking=${b.id}`) };
  const rows: Row[] = [['Client', esc(client)], ['Service', esc(b.service)], ...(s.kind === 'team' && b.staffName ? [['Master', esc(b.staffName)] as Row] : []),
    ['When', esc(when)], ...(b.clientPhone ? [['Phone', esc(b.clientPhone)] as Row] : [])];
  const t = {
    alert_new: { title: 'New booking ✨', subject: `New booking: ${client} · ${b.service} · ${when}` },
    alert_cancel: { title: 'Cancelled', subject: `Cancelled: ${client} · ${when}` },
    alert_move: { title: 'Rescheduled', subject: `Rescheduled: ${client} → ${when}` }
  }[kind as 'alert_new'];
  const old = data.old_start_at ? `Was ${dayShort(String(data.old_start_at), s.tz)} at ${clock(String(data.old_start_at), s.tz)}.` : '';
  const L = layout(s, { preheader: t.subject, eyebrow: 'Dashboard', title: t.title, intro: esc(old), rows, button: open,
    note: 'You get these emails because push notifications aren’t on for this account — or you turned email alerts on in Studio → Emails.' });
  return { subject: t.subject, ...L };
}

export function buildDay(s: Studio, list: Booking[], forStaff: string | null, today: string): Built {
  const live = list.filter(b => ['pending', 'confirmed'].includes(b.status));
  const total = live.reduce((x, b) => x + (Number(b.price) || 0), 0);
  const L = layout(s, {
    preheader: `${live.length} client${live.length === 1 ? '' : 's'} today`, eyebrow: today, title: 'Your day',
    intro: `${live.length} client${live.length === 1 ? '' : 's'}${total ? ` · ${esc(money(total))} booked` : ''}${forStaff ? '' : s.kind === 'team' ? ' · whole studio' : ''}.`,
    rows: live.map(b => [clock(b.start, s.tz), `${esc(b.clientName || 'Client')} · ${esc(b.service)}${s.kind === 'team' && !forStaff && b.staffName ? ` <span style="font-weight:400;">· ${esc(first(b.staffName))}</span>` : ''}${b.status === 'pending' ? ' <span style="font-weight:400;">(request)</span>' : ''}`] as Row),
    button: { label: 'Open your dashboard', url: studioLink(s.slug, 'owner=1') },
    note: 'Sent at 8:00 on days with bookings. Turn it off in Studio → Emails.'
  });
  return { subject: `Your day: ${live.length} client${live.length === 1 ? '' : 's'}${total ? ' · ' + money(total) : ''}`, ...L };
}

export function buildInvite(s: Studio, name: string, email: string, password: string): Built {
  const L = layout(s, {
    preheader: `Your sign-in for ${s.name}`, eyebrow: 'Welcome', title: `You’re on the team at ${s.name}`,
    intro: `Hi ${esc(first(name) || 'there')}! Your bookings, clients and hours are in Satinbook.`,
    rows: [['Email', esc(email)], ['Temporary password', `<span style="font-family:Menlo,Consolas,monospace;letter-spacing:.04em;">${esc(password)}</span>`]],
    sections: [{ title: 'Set it up', html: '1. On your iPhone, open the button below in Safari.<br>2. Tap Share → Add to Home Screen, then open the app from there.<br>3. Sign in and choose your own password.<br>4. On Today, turn on notifications.', text: '1. On your iPhone, open the link below in Safari.\n2. Tap Share → Add to Home Screen, then open the app from there.\n3. Sign in and choose your own password.\n4. On Today, turn on notifications.' }],
    button: { label: 'Open your dashboard', url: studioLink(s.slug, 'owner=1') },
    note: 'The temporary password works once — the app asks you to choose your own.'
  });
  return { subject: `You’re on the team at ${s.name}`, ...L };
}

export function buildReset(s: Studio, email: string, password: string): Built {
  const L = layout(s, {
    preheader: 'A new temporary password', eyebrow: 'Studio dashboard', title: 'Your new temporary password',
    intro: 'Sign in with it — the app then asks you to choose your own.',
    rows: [['Email', esc(email)], ['Temporary password', `<span style="font-family:Menlo,Consolas,monospace;letter-spacing:.04em;">${esc(password)}</span>`]],
    button: { label: 'Sign in', url: studioLink(s.slug, 'owner=1') },
    note: 'Didn’t expect this? Reply to this email.'
  });
  return { subject: `Your new temporary password for ${s.name}`, ...L };
}

// sample data for the dashboard's previews and test emails
export function sample(s: Studio, staffName?: string | null): Booking {
  const start = new Date(Date.now() + 2 * 864e5);
  start.setUTCHours(15, 0, 0, 0);
  return {
    id: '00000000-0000-4000-8000-000000000000', service: 'Classic Full Set', serviceId: null, start: start.toISOString(),
    end: new Date(start.getTime() + 2 * 3600e3).toISOString(), price: 150, deposit: 30, depositStatus: 'pending',
    depositDue: new Date(Date.now() + 12 * 3600e3).toISOString(), manageToken: '00000000-0000-4000-8000-000000000000',
    status: 'confirmed', staffName: staffName || null, clientName: 'Jasmine Carter', clientPhone: '(404) 555-0123'
  };
}

// a new lead from satinbook.com → hello@satinbook.com (reply goes straight to her)
export function buildLead(l: { name: string; email: string; instagram?: string; niche?: string; city?: string; ref?: string; created_at?: string }): Built {
  const s: Studio = { id: '', slug: '', name: 'Satinbook', style: 'noir', accent: '#F4A6B8', tz: 'America/New_York', kind: 'solo' };
  const ig = String(l.instagram || '').replace(/^@/, '');
  const L = layout(s, {
    preheader: `${l.name} wants a free trial`, eyebrow: 'New lead', title: `${l.name} wants a free trial`,
    intro: 'From the form on satinbook.com. Reply to this email to write to her.',
    rows: [
      ['Name', esc(l.name)], ['Email', `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>`],
      ...(ig ? [['Instagram', `<a href="https://instagram.com/${esc(encodeURIComponent(ig))}">@${esc(ig)}</a>`] as Row] : []),
      ...(l.niche ? [['Niche', esc(l.niche)] as Row] : []), ...(l.city ? [['City', esc(l.city)] as Row] : []),
      ...(l.ref ? [['Came from', esc(l.ref)] as Row] : [])
    ],
    button: { label: 'Open Admin → Leads', url: 'https://satinbook.com/app.html?admin=1#leads' }
  });
  return { subject: `New lead: ${l.name}${l.niche ? ' · ' + l.niche : ''}${l.city ? ' · ' + l.city : ''}`, ...L };
}

// Satinbook's own notes to hello@ / the owner: a test that sending works, a burst of app errors
const SYS: Studio = { id: '', slug: '', name: 'Satinbook', style: 'noir', accent: '#F4A6B8', tz: 'America/New_York', kind: 'solo' };
export function buildSystemTest(d: { note?: string }): Built {
  const when = new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short' });
  const L = layout(SYS, {
    preheader: 'Email sending works', eyebrow: 'Satinbook', title: 'Email sending works ✓',
    intro: `This test went out through Resend from satinbook.com on ${when} (New York time).${d.note ? ' ' + d.note : ''}`,
    rows: [['Sender', 'Satinbook &lt;hello@satinbook.com&gt;'], ['Service', 'Resend · Supabase Edge Function']]
  });
  return { subject: 'Satinbook · test email', ...L };
}
export function buildErrorsAlert(d: { count: number; top?: { message: string; n: number; slug?: string }[] }): Built {
  const top = (d.top || []).slice(0, 5);
  const L = layout(SYS, {
    preheader: `${d.count} new app errors in the last hour`, eyebrow: 'Satinbook · errors', title: `${d.count} new errors in the last hour`,
    intro: 'More than usual — the most frequent ones are below. Open Admin → Errors for the stacks and which studios they come from.',
    rows: top.map(t => [`${t.n}×${t.slug ? ' · /' + t.slug : ''}`, esc(String(t.message).slice(0, 120))] as Row),
    button: { label: 'Open Admin → Errors', url: 'https://satinbook.com/app.html?admin=1#errors' }
  });
  return { subject: `Satinbook: ${d.count} app errors in the last hour`, ...L };
}
