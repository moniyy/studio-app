#!/usr/bin/env node
/*
 * Builds manifests/<slug>.webmanifest — the install file for one studio.
 * "Add to Home Screen" uses it, so the icon opens THAT studio (start_url
 * ./?m=<slug>), with its name, icons and colors.
 *
 *   node tools/make-manifest.js demo              from masters/demo.json
 *   node tools/make-manifest.js test-studio       a studio in the database (reads config.js)
 *   node tools/make-manifest.js --all             every masters/*.json
 *   node tools/make-manifest.js bella --name "Bella Nails" --style noir
 *
 * Paths inside the file are relative to manifests/, hence the "../".
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'manifests');
const STYLE_BG = { soft: '#F7F5F2', maison: '#F7F3EE', noir: '#F2F2F7' };

function args() {
  const a = process.argv.slice(2);
  const o = { slugs: [] };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--all') o.all = true;
    else if (a[i].startsWith('--')) o[a[i].slice(2)] = a[++i];
    else o.slugs.push(a[i]);
  }
  return o;
}

// a studio kept only in the database: its public profile
async function fromDatabase(slug) {
  const cfgFile = path.join(ROOT, 'config.js');
  if (!fs.existsSync(cfgFile)) return null;
  const cfg = fs.readFileSync(cfgFile, 'utf8');
  const url = (cfg.match(/supabaseUrl:\s*'([^']+)'/) || [])[1];
  const key = (cfg.match(/supabaseAnonKey:\s*'([^']+)'/) || [])[1];
  if (!url || !key) return null;
  const res = await fetch(url + '/rest/v1/rpc/get_public_profile', {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_slug: slug })
  });
  const p = res.ok ? await res.json() : null;
  if (!p || !p.master) return null;
  return Object.assign({}, p.master.settings || {}, { name: p.master.name, style: p.master.style });
}

async function master(slug, o) {
  const file = path.join(ROOT, 'masters', slug + '.json');
  let d = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (!d || d.bookingEngine === 'builtin') d = Object.assign({}, d || {}, (await fromDatabase(slug).catch(() => null)) || {});
  if (o.name) d.name = o.name;
  if (o.style) d.style = o.style;
  if (!d.name) throw new Error(`No data for "${slug}": add masters/${slug}.json, config.js, or --name`);
  return d;
}

function manifest(slug, d) {
  const name = String(d.name).trim();
  const short = name.length > 14 ? name.split(/\s+/).slice(0, 2).join(' ') : name;
  const dir = '../' + String(d.iconDir || 'img/').replace(/^\.?\//, '').replace(/\/?$/, '/');
  const bg = STYLE_BG[d.style] || STYLE_BG.soft;
  return {
    name,
    short_name: short.length > 14 ? short.slice(0, 14) : short,
    description: d.tagline || 'Services, prices, availability and booking.',
    start_url: `../?m=${slug}`,
    scope: '../',
    display: 'standalone',
    orientation: 'portrait',
    background_color: bg,
    theme_color: bg,
    icons: [
      { src: dir + 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: dir + 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: dir + 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}

(async () => {
  const o = args();
  let slugs = o.slugs;
  if (o.all) slugs = slugs.concat(fs.readdirSync(path.join(ROOT, 'masters')).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, '')));
  if (!slugs.length) { console.log('usage: node tools/make-manifest.js <slug> [--name "Studio"] [--style noir] | --all'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  for (const slug of [...new Set(slugs)]) {
    if (!/^[a-z0-9][a-z0-9_-]{0,60}$/.test(slug)) { console.log('✗ bad slug: ' + slug); continue; }
    try {
      const m = manifest(slug, await master(slug, o));
      fs.writeFileSync(path.join(OUT, slug + '.webmanifest'), JSON.stringify(m, null, 2) + '\n');
      console.log(`✓ manifests/${slug}.webmanifest — "${m.name}" opens ./?m=${slug}`);
    } catch (e) { console.log('✗ ' + slug + ': ' + e.message); }
  }
})();
