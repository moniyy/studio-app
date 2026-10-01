// Web Push with nothing but WebCrypto (works in Deno / Supabase Edge and Node):
//   payload encryption — RFC 8291 (aes128gcm, RFC 8188)
//   sender identity    — RFC 8292 (VAPID, ES256 JWT)

export type Subscription = { endpoint: string; p256dh: string; auth: string };
export type Vapid = { publicKey: string; privateKey: string; subject: string };

const te = new TextEncoder();

export function b64uEncode(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64uDecode(s: string): Uint8Array {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

/* RFC 8291: one aes128gcm record for the browser's p256dh / auth keys */
export async function encrypt(payload: Uint8Array, p256dh: string, auth: string): Promise<Uint8Array> {
  const uaPublic = b64uDecode(p256dh);
  const authSecret = b64uDecode(auth);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, local.privateKey, 256));

  const ikm = await hkdf(authSecret, shared, concat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // single record: payload + 0x02 delimiter, no padding
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, sealed);
}

/* RFC 8292: "vapid t=<ES256 JWT>, k=<public key>" for the push service */
export async function vapidHeader(endpoint: string, vapid: Vapid, ttlSeconds = 12 * 3600): Promise<string> {
  const pub = b64uDecode(vapid.publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)), d: vapid.privateKey, ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = b64uEncode(te.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64uEncode(te.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    sub: vapid.subject
  })));
  // WebCrypto ECDSA returns r || s (64 bytes) — exactly what ES256 wants
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te.encode(`${head}.${body}`));
  return `vapid t=${head}.${body}.${b64uEncode(sig)}, k=${vapid.publicKey}`;
}

export type PushResult = { ok: boolean; status: number; gone: boolean; text?: string };

export async function sendPush(sub: Subscription, message: unknown, vapid: Vapid): Promise<PushResult> {
  const body = await encrypt(te.encode(JSON.stringify(message)), sub.p256dh, sub.auth);
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'high'
    },
    body
  });
  const text = res.ok ? undefined : (await res.text().catch(() => '')).slice(0, 200);
  // 404 / 410: the subscription is gone (app removed, permission revoked…)
  return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410, text };
}
