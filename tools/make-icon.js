#!/usr/bin/env node
/*
 * Studio App — Home Screen icon generator
 *
 * Builds the app icon from a Fluent 3D emoji (the same one as on the splash)
 * on a dark night-sky background with a soft accent glow and a few tiny stars.
 * Every PNG is fully opaque (iOS fills transparency with black).
 *
 * Setup (once):   cd tools && npm install
 *
 * Usage:
 *   node tools/make-icon.js                      → icons for masters/demo.json into img/
 *   node tools/make-icon.js --master bella-nails → reads masters/bella-nails.json,
 *                                                  writes img/bella-nails/
 *   Options:
 *     --master <slug>   take accent + emoji from masters/<slug>.json (default: demo)
 *     --emoji  <name>   Fluent emoji name, e.g. "Sparkles", "Nail polish", "Gem stone"
 *     --src    <file>   use a local PNG instead of downloading the emoji
 *     --accent <hex>    glow color (default: brandAccent from the JSON)
 *     --out    <dir>    output folder (default: img/ for demo, img/<slug>/ otherwise)
 *
 * Output: apple-touch-icon.png (180), icon-192.png, icon-512.png,
 *         icon-maskable-512.png (artwork in the inner ~50% so Android's
 *         circle / squircle masks never cut it).
 * For a non-demo master add  "iconDir": "img/<slug>/"  to its JSON.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..');

function args() {
  const out = {};
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith('--')) out[a[i].slice(2)] = a[i + 1] && !a[i + 1].startsWith('--') ? a[++i] : true;
  }
  return out;
}

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return resolve(download(res.headers.location));
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

/* "Nail polish" → assets/Nail polish/Default/3D/nail_polish_3d_default.png (skin-tone emoji)
   "Sparkles"    → assets/Sparkles/3D/sparkles_3d.png */
async function fluentEmoji(name) {
  const base = 'https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/';
  const file = name.toLowerCase().replace(/\s+/g, '_');
  const dir = encodeURIComponent(name);
  try {
    return await download(`${base}${dir}/3D/${file}_3d.png`);
  } catch (e) {
    return download(`${base}${dir}/Default/3D/${file}_3d_default.png`);
  }
}

function hexToRgb(hex) {
  const m = String(hex).trim().match(/^#?([0-9a-f]{6})$/i);
  const n = parseInt(m ? m[1] : 'C9796B', 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}

/* 1024×1024 night sky: gradient #14121C → #241E33 (neutral black for "noir"), accent glow, tiny stars */
function backgroundSvg(accent, maskable, bg) {
  const [r, g, b] = hexToRgb(accent);
  const glow = maskable ? 300 : 360;
  // tiny stars kept near the corners so they never sit behind the artwork
  const stars = [
    [190, 205, 5.5], [812, 168, 4], [868, 742, 5], [150, 820, 3.5], [702, 892, 3]
  ].map(([x, y, s]) => `
    <circle cx="${x}" cy="${y}" r="${s * 3.4}" fill="url(#starGlow)"/>
    <circle cx="${x}" cy="${y}" r="${s}" fill="#fff"/>`).join('');
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${bg[0]}"/>
          <stop offset="1" stop-color="${bg[1]}"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="rgb(${r},${g},${b})" stop-opacity=".55"/>
          <stop offset=".55" stop-color="rgb(${r},${g},${b})" stop-opacity=".18"/>
          <stop offset="1" stop-color="rgb(${r},${g},${b})" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="starGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stop-color="#fff" stop-opacity=".45"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1024" height="1024" fill="url(#bg)"/>
      <circle cx="512" cy="500" r="${glow}" fill="url(#glow)"/>
      ${stars}
    </svg>`);
}

async function renderIcon(emojiPng, accent, maskable, bg) {
  const S = 1024;
  const art = Math.round(S * (maskable ? 0.5 : 0.6));
  const emoji = await sharp(emojiPng).resize(art, art, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  // a soft shadow under the artwork
  const shadow = await sharp(emoji)
    .ensureAlpha()
    .modulate({ brightness: 0 })
    .blur(18)
    .linear([0, 0, 0, 0.55], [0, 0, 0, 0])
    .png()
    .toBuffer();
  const left = Math.round((S - art) / 2);
  const top = Math.round((S - art) / 2) - Math.round(S * 0.01);
  return sharp(backgroundSvg(accent, maskable, bg))
    .composite([
      { input: shadow, left, top: top + Math.round(S * 0.03) },
      { input: emoji, left, top }
    ])
    .flatten({ background: bg[0] }) // no transparency anywhere
    .png()
    .toBuffer();
}

async function main() {
  const a = args();
  const slug = a.master || 'demo';
  const jsonPath = path.join(ROOT, 'masters', slug + '.json');
  const master = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : {};
  const accent = a.accent || master.brandAccent || '#C9796B';
  const emojiName = a.emoji || master.splashEmoji || 'Sparkles';
  const bg = master.style === 'noir' ? ['#0A0A0B', '#1D1D20'] : ['#14121C', '#241E33'];
  const outDir = path.resolve(ROOT, a.out || (slug === 'demo' ? 'img' : path.join('img', slug)));
  fs.mkdirSync(outDir, { recursive: true });

  const emojiPng = a.src ? fs.readFileSync(path.resolve(a.src)) : await fluentEmoji(emojiName);
  const regular = await renderIcon(emojiPng, accent, false, bg);
  const maskable = await renderIcon(emojiPng, accent, true, bg);

  const jobs = [
    ['apple-touch-icon.png', regular, 180],
    ['icon-192.png', regular, 192],
    ['icon-512.png', regular, 512],
    ['icon-maskable-512.png', maskable, 512]
  ];
  for (const [file, src, size] of jobs) {
    await sharp(src).resize(size, size, { kernel: 'lanczos3' }).removeAlpha().png({ compressionLevel: 9 }).toFile(path.join(outDir, file));
    console.log('✓', path.relative(ROOT, path.join(outDir, file)), `${size}×${size}`);
  }
  if (slug !== 'demo') console.log(`\nAdd to masters/${slug}.json:  "iconDir": "${path.relative(ROOT, outDir).replace(/\\/g, '/')}/"`);
}

main().catch(e => { console.error('✗', e.message); process.exit(1); });
