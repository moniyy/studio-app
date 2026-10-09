// manifest — the web app manifest of one studio, made from the database, so a new
// studio needs no file in the repo.
//
// GET ?m=<slug>&o=<where the app lives, e.g. https://satinbook.com/>
// "Add to Home Screen" then installs that studio: its name, its icon and
// start_url = <o><slug> — the pretty address (id stays <o>?m=<slug>, as installed before).
import { cors, serviceClient } from '../_shared/admin.ts';

const BG: Record<string, string> = { noir: '#F2F2F7', maison: '#F7F3EE', soft: '#F7F5F2' };

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const u = new URL(req.url);
  const slug = (u.searchParams.get('m') || '').trim().toLowerCase();
  let base = (u.searchParams.get('o') || '').trim();
  if (!/^[a-z0-9][a-z0-9_-]{0,60}$/.test(slug)) return new Response('bad slug', { status: 400, headers: cors });
  // only a real web address (https, or a local test server)
  if (!/^https:\/\/[^\s?#]+$|^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[^\s?#]*$/.test(base)) return new Response('bad origin', { status: 400, headers: cors });
  if (!base.endsWith('/')) base += '/';

  const { data: m } = await serviceClient().from('masters').select('name, style, settings').eq('slug', slug).maybeSingle();
  if (!m) return new Response('not found', { status: 404, headers: cors });
  const st = (m.settings || {}) as Record<string, unknown>;
  const icons = (st.icons || {}) as Record<string, string>;
  const name = String(m.name);
  const start = `${base}${encodeURIComponent(slug)}`;
  const id = `${base}?m=${encodeURIComponent(slug)}`;
  const bg = BG[m.style as string] || BG.noir;
  const manifest = {
    id,
    name,
    // her own short name (Profile → Name under the app icon), else the first two words of a long name
    short_name: st.shortName ? String(st.shortName).slice(0, 16) : name.length > 14 ? name.split(/\s+/).slice(0, 2).join(' ').slice(0, 14) : name,
    description: String(st.tagline || ''),
    start_url: start,
    scope: base,
    display: 'standalone',
    orientation: 'portrait',
    background_color: bg,
    theme_color: bg,
    icons: icons.i512 ? [
      { src: icons.i192 || icons.i512, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: icons.i512, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: icons.i512, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ] : [
      { src: `${base}img/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}img/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}img/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
  return new Response(JSON.stringify(manifest), {
    headers: { ...cors, 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
  });
});
