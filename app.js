/* =========================================================
   Studio App — one template, many masters.
   ?m=slug  →  masters/slug.json   (no param → demo.json)
   All master content comes from JSON; nothing is hardcoded here.
   Motion: GSAP springs (back.out / elastic.out), iOS sheet curve
   cubic-bezier(.32,.72,0,1); honours prefers-reduced-motion.
   ========================================================= */
(function () {
  'use strict';

  /* ---------------------------------------------------------
     0. BOOT — runs synchronously in <head>, before first paint,
        so saved theme / accent / text size never flash.
     --------------------------------------------------------- */
  const params = new URLSearchParams(location.search);
  const rawSlug = (params.get('m') || 'demo').trim().toLowerCase();
  const SLUG = /^[a-z0-9][a-z0-9_-]{0,60}$/.test(rawSlug) ? rawSlug : 'demo';
  const KEY = 'studio-app:' + SLUG;

  /* Visual style: "soft" (original), "maison" (serif, champagne) or "noir"
     (App Store-like). Order: ?style= in the address → the client's own pick
     (More → Appearance) → the master's JSON. The last one used is cached so
     the right palette is applied before the first paint. */
  const STYLES = ['soft', 'maison', 'noir'];
  const STYLE_PARAM = STYLES.includes(params.get('style')) ? params.get('style') : null;
  const readStyle = k => { try { const v = JSON.parse(localStorage.getItem(KEY + ':' + k)); return STYLES.includes(v) ? v : null; } catch (e) { return null; } };
  let STYLE = STYLE_PARAM || readStyle('styleUser') || readStyle('style') || 'soft';

  const ACCENTS_SOFT = [
    { id: 'studio',   name: 'Studio',   color: null },
    { id: 'rose',     name: 'Rose',     color: '#E8739A' },
    { id: 'lavender', name: 'Lavender', color: '#9B87F5' },
    { id: 'sage',     name: 'Sage',     color: '#7FB69A' },
    { id: 'ocean',    name: 'Ocean',    color: '#4A90D9' },
    { id: 'gold',     name: 'Gold',     color: '#C9A24A' }
  ];
  // Maison: every accent has a shade for the dark and for the light theme
  const ACCENTS_MAISON = [
    { id: 'champagne', name: 'Champagne', color: { dark: '#C9A27E', light: '#9C7457' } },
    { id: 'mocha',     name: 'Mocha',     color: { dark: '#B08A6E', light: '#6F5140' } },
    { id: 'rose',      name: 'Rosé',      color: { dark: '#D8A7A1', light: '#A86F69' } },
    { id: 'sage',      name: 'Sage',      color: { dark: '#A9BBA1', light: '#66795F' } },
    { id: 'onyx',      name: 'Onyx',      color: { dark: '#EAE2D8', light: '#2A211C' } }
  ];
  // Noir: clean accents; the light theme gets a deeper shade so it reads on white
  const ACCENTS_NOIR = [
    { id: 'blush',     name: 'Blush',     color: { dark: '#F4A6B8', light: '#C2416C' } },
    { id: 'pearl',     name: 'Pearl',     color: { dark: '#FFFFFF', light: '#0A0A0B' } },
    { id: 'rosegold',  name: 'Rose Gold', color: { dark: '#E8B4A0', light: '#9E5A42' } },
    { id: 'lilac',     name: 'Lilac',     color: { dark: '#C9B6F2', light: '#7A58CF' } },
    { id: 'sky',       name: 'Sky',       color: { dark: '#9CC9F5', light: '#236FBF' } },
    { id: 'champagne', name: 'Champagne', color: { dark: '#EBD9B4', light: '#8A6D33' } }
  ];
  const accentList = () => (STYLE === 'maison' ? ACCENTS_MAISON : STYLE === 'noir' ? ACCENTS_NOIR : ACCENTS_SOFT);
  const THEMES = ['light', 'dark', 'system'];
  const TEXT_SIZES = { small: 1, default: 1.1, large: 1.2 };
  const DEFAULTS = { theme: 'system', accent: null, textSize: 'default', reminders: false }; // accent null → first of the style's list
  const FALLBACK_ACCENT = '#C9796B';
  const THEME_BG_SOFT = { light: '#F7F5F2', dark: '#0E0E11' };
  const THEME_BG_MAISON = { light: '#F7F3EE', dark: '#0F0D0C' };
  const THEME_BG_NOIR = { light: '#F2F2F7', dark: '#0A0A0B' };
  const themeBg = () => (STYLE === 'maison' ? THEME_BG_MAISON : STYLE === 'noir' ? THEME_BG_NOIR : THEME_BG_SOFT);
  const THEME_BG = THEME_BG_SOFT;

  const root = document.documentElement;
  const darkMQ = window.matchMedia('(prefers-color-scheme: dark)');

  const store = {
    get(k, fallback) {
      try {
        const v = localStorage.getItem(KEY + ':' + k);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(k, v) { try { localStorage.setItem(KEY + ':' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    remove(k) { try { localStorage.removeItem(KEY + ':' + k); } catch (e) { /* private mode */ } }
  };

  /* ?splash=clean|photo overrides splashStyle from JSON.
     &reset=1 forgets that the Welcome was seen (handy for demos), then drops
     itself from the address so a reload doesn't reset again. */
  const SPLASH_PARAM = ['clean', 'photo'].includes(params.get('splash')) ? params.get('splash') : null;
  const LOOK_PARAM = params.get('look') || null; // ?look=<id> opens that look right away
  if (params.get('reset') === '1') {
    store.remove('onboarded');
    try { sessionStorage.removeItem(KEY + ':intro'); } catch (e) { /* private mode */ }
    params.delete('reset');
    try {
      const q = params.toString();
      history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash);
    } catch (e) { /* file:// */ }
  }
  // ?style=noir counts as the client's pick; the param then leaves the address
  if (STYLE_PARAM) {
    store.set('styleUser', STYLE_PARAM);
    params.delete('style');
    try {
      const q = params.toString();
      history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash);
    } catch (e) { /* file:// */ }
  }

  function sanitizeSettings(s) {
    s = Object.assign({}, DEFAULTS, s && typeof s === 'object' ? s : {});
    if (!THEMES.includes(s.theme)) s.theme = DEFAULTS.theme;
    if (!accentList().some(a => a.id === s.accent)) s.accent = accentList()[0].id;
    s.accentBy = s.accentBy && typeof s.accentBy === 'object' ? s.accentBy : {}; // accent remembered per style
    if (!(s.textSize in TEXT_SIZES)) s.textSize = DEFAULTS.textSize;
    s.reminders = !!s.reminders;
    return s;
  }

  let settings = sanitizeSettings(store.get('settings'));

  /* Switch the style variables (accent is remembered per style) */
  function adoptStyle(next) {
    if (!STYLES.includes(next) || next === STYLE) return;
    const by = Object.assign({}, settings.accentBy, { [STYLE]: settings.accent });
    STYLE = next;
    settings = sanitizeSettings(Object.assign({}, settings, { accentBy: by, accent: by[next] || null }));
    store.set('settings', settings);
    store.set('style', STYLE);
    applyMotion();
  }
  let brandAccent = validHex(store.get('brand')) || FALLBACK_ACCENT;
  let splashActive = true;

  function validHex(v) {
    if (typeof v !== 'string') return null;
    const m = v.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return '#' + h.toUpperCase();
  }

  /* Text on an accent background: white when it reaches 3:1 contrast
     (WCAG for large / bold UI text), otherwise near-black. */
  function onAccentColor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    // noir: whichever of white / near-black reads better
    if (STYLE === 'noir') return 1.05 / (L + 0.05) >= (L + 0.05) / 0.0530 ? '#FFFFFF' : '#0A0A0B';
    // maison asks a little more of white text (champagne gets dark text)
    return 1.05 / (L + 0.05) >= (STYLE === 'maison' ? 4 : 3) ? '#FFFFFF' : (STYLE === 'maison' ? '#1A1512' : '#16161A');
  }

  function resolvedTheme() {
    return settings.theme === 'system' ? (darkMQ.matches ? 'dark' : 'light') : settings.theme;
  }

  const accentFor = (a, theme) => (!a || !a.color ? brandAccent : typeof a.color === 'string' ? a.color : a.color[theme || resolvedTheme()]);
  function accentHex() {
    return accentFor(accentList().find(x => x.id === settings.accent) || accentList()[0]);
  }

  function applySettings() {
    const theme = resolvedTheme();
    const accent = accentHex();
    root.dataset.theme = theme;
    root.dataset.style = STYLE;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--on-accent', onAccentColor(accent));
    root.style.setProperty('--text-scale', TEXT_SIZES[settings.textSize]);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = splashActive && SPLASH_PARAM === 'photo' ? '#000000' : themeBg()[theme];
    // accent swatches follow the theme (maison shades differ per theme)
    if (typeof document !== 'undefined') document.querySelectorAll('.swatch[data-accent]').forEach(el => {
      const c = accentFor(accentList().find(a => a.id === el.dataset.accent));
      el.style.setProperty('--c', c);
      el.style.setProperty('--on', onAccentColor(c));
    });
  }

  applySettings();
  darkMQ.addEventListener && darkMQ.addEventListener('change', () => {
    if (settings.theme === 'system') { applySettings(); syncSettingsUI(); }
  });

  /* ---------------------------------------------------------
     1. Helpers
     --------------------------------------------------------- */
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  const reducedMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  /* GSAP instance, or null when it's unavailable or the user prefers reduced motion */
  const G = () => (window.gsap && !reducedMQ.matches ? window.gsap : null);
  const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // springy in "soft", calm ease-out in "maison", iOS-like (tiny overshoot) in "noir"
  let SPRING = 'back.out(1.4)';
  let ELASTIC = 'elastic.out(1,0.8)';
  function applyMotion() {
    SPRING = { maison: 'power3.out', noir: 'back.out(1.15)' }[STYLE] || 'back.out(1.4)';
    ELASTIC = { maison: 'power2.out', noir: 'back.out(1.35)' }[STYLE] || 'elastic.out(1,0.8)';
  }
  applyMotion();

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function safeUrl(u) {
    u = String(u || '').trim();
    return /^(https?:|tel:|mailto:|sms:|\.{0,2}\/|[\w-]+\/|#)/i.test(u) ? u : '#';
  }

  /* Smaller Pexels renditions for thumbnails */
  function sized(url, w) {
    return /images\.pexels\.com/.test(url) ? String(url).replace(/([?&]w=)\d+/, '$1' + w) : url;
  }

  function price(p) {
    if (typeof p === 'number') return '$' + (Number.isInteger(p) ? p : p.toFixed(2));
    return String(p || '');
  }

  /* 3D icons: Microsoft Fluent Emoji via jsDelivr */
  const FLUENT = 'https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@main/assets/';
  const ICONS = {
    'eye': 'Eye/3D/eye_3d.png',
    'calendar': 'Calendar/3D/calendar_3d.png',
    'speech-balloon': 'Speech%20balloon/3D/speech_balloon_3d.png',
    'sparkles': 'Sparkles/3D/sparkles_3d.png',
    'nail-polish': 'Nail%20polish/Default/3D/nail_polish_3d_default.png',
    'lipstick': 'Lipstick/3D/lipstick_3d.png',
    'gem-stone': 'Gem%20stone/3D/gem_stone_3d.png',
    'bell': 'Bell/3D/bell_3d.png',
    'heart': 'Red%20heart/3D/red_heart_3d.png'
  };
  function icon3d(name) {
    const v = String(name || '').trim();
    if (/^(https?:|\.{0,2}\/|img\/)/i.test(v)) return v;
    const key = v.toLowerCase().replace(/[\s_]+/g, '-');
    const alias = { speech: 'speech-balloon', nail: 'nail-polish', gem: 'gem-stone', nails: 'nail-polish' };
    return FLUENT + (ICONS[key] || ICONS[alias[key]] || ICONS.sparkles);
  }

  /* Thin line art (Lucide-style, stroke 1.5) used instead of 3D emoji in "maison" */
  const LINE_ART = {
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    sparkles: '<path d="M9.9 14.1 8.5 19l-1.4-4.9L2 12.5l5.1-1.6L8.5 6l1.4 4.9 5.1 1.6z"/><path d="M18 3v4M16 5h4M19 15v3M17.5 16.5h3"/>',
    'gem-stone': '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M11 3 8 9l4 12 4-12-3-6M2 9h20"/>',
    'speech-balloon': '<path d="M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5z"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    lipstick: '<path d="m14 4 6 6M4 20l5.5-1.5L20 8l-4-4L5.5 14.5z"/>',
    'nail-polish': '<path d="M9 9h6v11a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zM10 9V3h4v6"/>'
  };
  /* An illustration slot: 3D emoji in "soft", thin line art in "maison" / "noir" */
  function art(name, cls, imgAttrs) {
    if (STYLE === 'soft') return `<img${cls ? ` class="${cls}"` : ''} src="${esc(icon3d(name))}" alt=""${imgAttrs || ''}>`;
    const key = String(name || '').toLowerCase().replace(/[\s_]+/g, '-').replace(/^gem$/, 'gem-stone').replace(/^speech$/, 'speech-balloon');
    return `<span class="line-art${cls ? ' ' + cls : ''}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${LINE_ART[key] || LINE_ART.sparkles}</svg></span>`;
  }

  /* Line icons */
  const svg = (d, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + d + '</svg>';
  const I = {
    bell: svg('<path d="M6 9.5a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4s2-1.5 2-6.5z"/><path d="M10 19.5a2 2 0 0 0 4 0"/>'),
    share: svg('<path d="M12 14.5V3.5M8 7.5l4-4 4 4"/><path d="M8.5 10.5H7A2.5 2.5 0 0 0 4.5 13v5A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-5a2.5 2.5 0 0 0-2.5-2.5h-1.5"/>'),
    search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
    clock: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>'),
    chevR: svg('<path d="m9 6 6 6-6 6"/>'),
    chevL: svg('<path d="m15 5-7 7 7 7"/>', ' stroke-width="2.2"'),
    chevD: svg('<path d="m6 9 6 6 6-6"/>'),
    arrowUp: svg('<path d="M12 19V5m-6 6 6-6 6 6"/>', ' stroke-width="2.2"'),
    arrowR: svg('<path d="M5 12h14m-6-6 6 6-6 6"/>'),
    pin: svg('<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>'),
    ig: svg('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".8" fill="currentColor" stroke="none"/>'),
    phone: svg('<path d="M5.5 3.5h3l1.8 4.6-2.2 1.4a11 11 0 0 0 6.4 6.4l1.4-2.2 4.6 1.8v3A2 2 0 0 1 18.5 20.5 15.5 15.5 0 0 1 3.5 5.5a2 2 0 0 1 2-2z"/>'),
    shield: svg('<path d="M12 3 5 6v5.5c0 4.3 2.9 7.9 7 9.5 4.1-1.6 7-5.2 7-9.5V6z"/><path d="m9 12 2 2 4-4"/>'),
    drop: svg('<path d="M12 3.5s6 6 6 10.5a6 6 0 0 1-12 0c0-4.5 6-10.5 6-10.5z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>'),
    contrast: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none"/>'),
    palette: svg('<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 1.9-.9 1.9-1.8 0-1.4-1.1-1.9-.2-2.9.6-.6 1.5-.5 2.8-.5a4 4 0 0 0 4-4c0-4.4-3.8-7.8-8.5-7.8z"/><circle cx="7.8" cy="11" r="1" fill="currentColor" stroke="none"/><circle cx="10.5" cy="7.5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="8" r="1" fill="currentColor" stroke="none"/>'),
    type: svg('<path d="M3.5 7V5h11v2M9 5v14m-2 0h4"/><path d="M14.5 12.5V11h6v1.5M17.5 11v8m-1.3 0h2.6"/>'),
    check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', ' stroke-width="2.6"'),
    x: svg('<path d="M6 6l12 12M18 6 6 18"/>', ' stroke-width="2.2"'),
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.8l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 16.6l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg>'
  };
  const stars = n => '<span class="stars" aria-label="' + n + ' out of 5">' +
    [1, 2, 3, 4, 5].map(i => I.star.replace('<svg', `<svg class="${i <= Math.round(n) ? '' : 'off'}"`)).join('') + '</span>';

  /* ---------------------------------------------------------
     2. State & data
     --------------------------------------------------------- */
  let data = null;
  let app, tabbar, sub, views = {};
  const state = { tab: null, category: 'All', query: '', lookFilter: 'All' };
  const visited = new Set(['home']);
  const firstName = () => (data.firstName || String(data.name || '').split(/\s+/)[0] || 'the artist');

  function normalizeData(d) {
    d = d && typeof d === 'object' ? d : {};
    const arr = v => (Array.isArray(v) ? v : []);
    d.name = d.name || 'Studio';
    d.brandAccent = validHex(d.brandAccent) || FALLBACK_ACCENT;
    d.services = arr(d.services).map((s, i) => Object.assign({ id: 'svc-' + i, category: 'Services' }, s, {
      includes: arr(s && s.includes).filter(Boolean),
      minutes: durationMinutes(s && s.duration)
    }));
    // gallery = looks: [{id, photo, tag, title, serviceId, before, isNew, popular}]
    // (plain URL strings and {photo, tag} from older JSON are accepted too)
    const slug = t => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const ids = new Set();
    d.gallery = arr(d.gallery).map((g, i) => {
      if (typeof g === 'string') g = { photo: g };
      if (!g || !g.photo) return null;
      const title = String(g.title || '').trim() || 'Look ' + (i + 1);
      let id = slug(g.id) || slug(g.title) || 'look-' + (i + 1);
      while (ids.has(id)) id += '-' + (i + 1);
      ids.add(id);
      return {
        id, title,
        photo: g.photo,
        tag: String(g.tag || ''),
        serviceId: String(g.serviceId || ''),
        before: g.before || '',
        isNew: !!g.isNew,
        popular: !!g.popular
      };
    }).filter(Boolean);
    d.beforeAfter = d.beforeAfter && d.beforeAfter.before && d.beforeAfter.after ? d.beforeAfter : null;
    d.deposit = +d.deposit || 0;
    // how "Continue to booking" hands off: the artist's booking link, an Instagram
    // DM, a text message — or "demo" (no hand-off, straight to the confirmation)
    d.bookingMode = ['link', 'instagram', 'sms', 'demo'].includes(d.bookingMode) ? d.bookingMode
      : d.bookingUrl ? 'link' : d.instagram ? 'instagram' : d.phone ? 'sms' : 'demo';
    d.heroVideo = typeof d.heroVideo === 'string' ? d.heroVideo.trim() : '';
    d.splashStyle = d.splashStyle === 'photo' ? 'photo' : 'clean';
    d.style = STYLES.includes(d.style) ? d.style : 'soft';
    d.splashEmoji = typeof d.splashEmoji === 'string' ? d.splashEmoji.trim() : '';
    d.prep = arr(d.prep).map(String).filter(Boolean);
    d.address = typeof d.address === 'string' ? d.address.trim() : '';
    d.parking = typeof d.parking === 'string' ? d.parking.trim() : '';
    d.referral = d.referral && (d.referral.title || d.referral.text) ? d.referral : null;
    d.ownerDemo = d.ownerDemo && typeof d.ownerDemo === 'object' ? d.ownerDemo : null;
    d.stats = arr(d.stats).filter(s => s && isFinite(+s.value)).slice(0, 3);
    d.notifications = arr(d.notifications).filter(n => n && n.title);
    d.loyalty = d.loyalty && +d.loyalty.total > 0
      ? Object.assign({}, d.loyalty, { total: Math.min(12, Math.round(+d.loyalty.total)), filled: Math.max(0, Math.round(+d.loyalty.filled || 0)) })
      : null;
    d.policies = arr(d.policies);
    d.aftercare = arr(d.aftercare);
    d.faq = arr(d.faq);
    d.slots = arr(d.slots).map(String).filter(Boolean);
    d.reviews = arr(d.reviews).filter(r => r && r.text);
    // stories[].slides: [{photo, caption}] — plain URL strings are accepted too
    d.stories = arr(d.stories).map(s => {
      const slides = arr(s && s.slides)
        .map(x => (typeof x === 'string' ? { photo: x, caption: '' } : x && x.photo ? { photo: x.photo, caption: String(x.caption || '') } : null))
        .filter(Boolean);
      return slides.length ? Object.assign({}, s, { slides, cover: s.cover || slides[0].photo }) : null;
    }).filter(Boolean);
    d.hours = d.hours && typeof d.hours === 'object' ? d.hours : {};
    d.instagram = igHandle(d.instagram);
    if (!d.nextAvailable && d.slots.length) d.nextAvailable = d.slots[0];
    if (!d.rating && d.reviews.length) {
      d.rating = d.reviews.reduce((s, r) => s + (+r.rating || 5), 0) / d.reviews.length;
    }
    return d;
  }

  /* "2h 15m" → 135, "50 min" → 50 */
  function durationMinutes(v) {
    const s = String(v || '');
    const h = s.match(/(\d+(?:\.\d+)?)\s*h/i);
    const m = s.match(/(\d+)\s*m/i);
    const total = (h ? Math.round(+h[1] * 60) : 0) + (m ? +m[1] : 0);
    return total || 60;
  }

  function igHandle(v) {
    return String(v || '').trim()
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, '')
      .replace(/^@/, '')
      .replace(/[/?#].*$/, '');
  }
  const igUrl = () => 'https://instagram.com/' + encodeURIComponent(data.instagram);
  const igDmUrl = () => 'https://ig.me/m/' + encodeURIComponent(data.instagram);
  const telUrl = () => 'tel:' + String(data.phone || '').replace(/[^\d+]/g, '');
  const bookUrl = () => safeUrl(data.bookingUrl);
  const ext = 'target="_blank" rel="noopener"';
  /* "AL" for "Aria Lash Studio" (or data.monogram) */
  const initials = () => String(data.monogram || String(data.name).split(/\s+/).slice(0, 2).map(w => w.charAt(0)).join('')).toUpperCase();
  const ratingText = () => (data.rating ? Number(data.rating).toFixed(1) : '');

  /* ---------------------------------------------------------
     3. Hours & open status (in the studio's timezone if given)
     --------------------------------------------------------- */
  const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function parseRange(v) {
    if (!v || /closed|off/i.test(v)) return null;
    const m = String(v).match(/^\s*(\d{1,2})(?::(\d{2}))?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*$/);
    if (!m) return null;
    return { open: +m[1] * 60 + (+m[2] || 0), close: +m[3] * 60 + (+m[4] || 0) };
  }

  function fmtTime(min) {
    let h = Math.floor(min / 60) % 24;
    const m = min % 60;
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return m ? h + ':' + String(m).padStart(2, '0') + ' ' + ap : h + ' ' + ap;
  }

  function fmtRange(r) { return r ? fmtTime(r.open) + ' – ' + fmtTime(r.close) : 'Closed'; }

  function studioNow() {
    const d = new Date();
    if (data && data.timezone) {
      try {
        const parts = new Intl.DateTimeFormat('en-US', {
          timeZone: data.timezone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23'
        }).formatToParts(d);
        const get = t => (parts.find(p => p.type === t) || {}).value;
        const day = DAY_SHORT.indexOf(get('weekday'));
        if (day > -1) return { day, minutes: (+get('hour') % 24) * 60 + +get('minute') };
      } catch (e) { /* bad timezone → device time */ }
    }
    return { day: d.getDay(), minutes: d.getHours() * 60 + d.getMinutes() };
  }

  function openStatus() {
    const now = studioNow();
    const today = parseRange(data.hours[DAY_KEYS[now.day]]);
    if (today && now.minutes >= today.open && now.minutes < today.close) {
      return { open: true, text: 'Open today until ' + fmtTime(today.close) };
    }
    if (today && now.minutes < today.open) {
      return { open: false, text: 'Opens today at ' + fmtTime(today.open) };
    }
    for (let i = 1; i <= 7; i++) {
      const day = (now.day + i) % 7;
      const r = parseRange(data.hours[DAY_KEYS[day]]);
      if (r) return { open: false, text: 'Opens ' + (i === 1 ? 'tomorrow' : DAY_NAMES[day]) + ' at ' + fmtTime(r.open) };
    }
    return { open: false, text: 'Open by appointment' };
  }

  /* "Mon–Fri 9 AM – 7 PM · Sat 10 AM – 5 PM · Sun closed" */
  function hoursSummary() {
    const order = [1, 2, 3, 4, 5, 6, 0];
    const groups = [];
    order.forEach(d => {
      const label = fmtRange(parseRange(data.hours[DAY_KEYS[d]]));
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.to = d; else groups.push({ from: d, to: d, label });
    });
    return groups.map(g => DAY_SHORT[g.from] + (g.to !== g.from ? '–' + DAY_SHORT[g.to] : '') + ' ' +
      (g.label === 'Closed' ? 'closed' : g.label)).join('\n');
  }

  function refreshStatus() {
    if (!data) return;
    const s = openStatus();
    $$('[data-status]').forEach(el => { el.textContent = s.text; });
    $$('[data-status-short]').forEach(el => { el.textContent = s.open ? 'Open now' : 'Closed now'; });
    const pill = statusShort();
    $$('[data-status-pill]').forEach(el => {
      el.classList.toggle('is-open', pill.open);
      $('span', el).textContent = pill.text;
    });
  }

  /* ---------------------------------------------------------
     4. Motion helpers (GSAP springs)
     --------------------------------------------------------- */
  /*
   * Content is ALWAYS visible in CSS. Elements are hidden only by the
   * "from" state of a running GSAP tween. GSAP advances on
   * requestAnimationFrame, which some environments throttle or pause
   * (preview panes, background tabs, power saving). ensure() jumps the
   * tween to its end on a plain timer, so nothing can stay hidden.
   */
  function ensure(tween, extraMs, stallCheck) {
    if (!tween) return tween;
    const finish = () => { if (tween.progress() < 1) tween.progress(1); };
    const ms = (tween.delay() + tween.totalDuration()) * 1000 + (extraMs == null ? 250 : extraMs);
    setTimeout(finish, ms);
    // No frames at all in 200ms → the ticker is stalled: show the end state right away
    if (stallCheck !== false && window.gsap) {
      const frame0 = window.gsap.ticker.frame;
      setTimeout(() => { if (window.gsap.ticker.frame === frame0) finish(); }, 200);
    }
    return tween;
  }

  /* Remove any leftover animation styles: the element falls back to its (visible) CSS */
  function showNow(els) {
    els = Array.from(els || []).filter(Boolean);
    if (!els.length) return;
    if (window.gsap) {
      window.gsap.killTweensOf(els);
      window.gsap.set(els, { clearProps: 'opacity,transform,translate,rotate,scale' });
    }
    els.forEach(el => { el.style.removeProperty('opacity'); el.style.removeProperty('transform'); });
  }

  /* Cascade items up from below with a spring. Only on-screen items animate. */
  function springIn(els, o) {
    o = o || {};
    const g = G();
    els = Array.from(els || []).filter(Boolean);
    if (!els.length) return null;
    if (!g) { showNow(els); return null; }
    const box = app.getBoundingClientRect();
    const onScreen = [];
    const offScreen = [];
    els.forEach(el => {
      const r = el.getBoundingClientRect();
      const visible = (r.top < box.bottom + 40 && r.bottom > box.top - 40) || (!r.width && !r.height);
      (visible ? onScreen : offScreen).push(el);
    });
    showNow(offScreen);
    if (!onScreen.length) return null;
    g.killTweensOf(onScreen);
    // maison: fade + 12px, slow; noir: 18px, a short spring with a hint of overshoot
    const yMax = { maison: 12, noir: 18 }[STYLE];
    const y = o.y == null ? (yMax || 30) : (yMax ? Math.min(yMax, o.y) : o.y);
    return ensure(g.fromTo(onScreen,
      { opacity: 0, y, scale: STYLE === 'soft' ? (o.scale == null ? 0.98 : o.scale) : 1 },
      {
        opacity: 1, y: 0, scale: 1,
        duration: STYLE === 'maison' ? Math.max(0.6, o.duration || 0.6) : STYLE === 'noir' ? Math.min(0.7, o.duration || 0.6) : (o.duration || 0.8),
        ease: STYLE === 'maison' ? 'power2.out' : STYLE === 'noir' ? 'back.out(1.1)' : (o.ease || SPRING),
        stagger: o.stagger == null ? 0.05 : o.stagger, delay: o.delay || 0,
        clearProps: 'opacity,transform'
      }));
  }

  function popIn(el, o) {
    const g = G();
    if (!g || !el) return;
    o = o || {};
    ensure(g.fromTo(el, { scale: o.from == null ? 0.7 : o.from }, { scale: 1, duration: o.duration || 0.7, ease: ELASTIC, clearProps: 'transform' }));
  }

  /* Safety net: whatever is still hidden after the reveal gets shown */
  const REVEAL_TARGETS = '[data-stagger], .hero__content > *, .hero__top > *, .navbar--home .nav-btn, .v-content';
  const failsafeTimers = new Map();
  function scheduleFailsafe(scope, ms) {
    clearTimeout(failsafeTimers.get(scope));
    failsafeTimers.set(scope, setTimeout(() => {
      const hidden = [scope].concat($$(REVEAL_TARGETS, scope)).filter(el =>
        el && (el.style.opacity !== '' || el.style.transform !== ''));
      if (hidden.length) {
        if (window.gsap) window.gsap.set(hidden, { opacity: 1, transform: 'none' });
        showNow(hidden); // then drop the inline styles so CSS press effects keep working
        console.warn('[Studio App] failsafe revealed', hidden.length, 'element(s)');
      }
    }, ms == null ? 1500 : ms));
  }

  /* When a set of tweens should be done, +300ms; never earlier than 1.5s */
  const endMs = (...tweens) => Math.max(1500, ...tweens.filter(Boolean).map(t => (t.delay() + t.totalDuration()) * 1000 + 300));

  /* Home cascade: runs after the splash and on every visit to the Home tab */
  /* opts.intro: coming from the splash — the photo fades in with a slow
     zoom-out and the avatar is left alone (it flies in from the splash) */
  function revealHome(opts) {
    opts = opts || {};
    console.log('home reveal');
    const view = views.home;
    const g = G();
    if (!g) { showNow($$(REVEAL_TARGETS, view)); return; }
    syncBookAgain();
    const heroImg = $('.hero__img', view);
    // noZoom: the splash photo has just landed exactly where the hero photo is
    if (heroImg && !opts.noZoom) ensure(g.fromTo(heroImg, { scale: 1.06 }, { scale: 1, duration: 1, ease: 'power2.out', clearProps: 'transform' }));
    const heroParts = $$('.hero__avatar, .hero__greet, .hero__eyebrow, .hero__name, .hero__meta, .hero__status, .hero__next', view);
    const tweens = [
      springIn(heroParts, { delay: opts.intro ? 0.4 : 0.12, stagger: 0.08, y: 24 }),
      springIn($$('.navbar--home .nav-btn', view), { delay: 0.25, y: -10, scale: 0.6, ease: ELASTIC, duration: 1 }),
      revealRest(opts.intro ? 0.6 : 0.25)
    ];
    scheduleFailsafe(view, endMs(...tweens));
  }

  /* Home sections: the ones on screen cascade in now, the rest as they scroll into view */
  function revealRest(delay) {
    const view = views.home;
    const items = $$('.home-rest > [data-stagger]', view);
    const sc = scrollerOf(view);
    const bottom = sc.getBoundingClientRect().bottom;
    const on = [];
    const off = [];
    items.forEach(el => (el.getBoundingClientRect().top < bottom - 20 ? on : off).push(el));
    showNow(off);
    observeReveal(off);
    return springIn(on, { delay: delay || 0 });
  }

  /* ---------------------------------------------------------
     5. View scaffolding: glass nav bar + iOS Large Title
     --------------------------------------------------------- */
  function navShell(opts) {
    return `
      <header class="navbar${opts.navClass ? ' ' + opts.navClass : ''}">
        <div class="navbar__glass"></div>
        <div class="navbar__side">${opts.left || ''}</div>
        ${opts.navTitle ? `<div class="navbar__title">${esc(opts.navTitle)}</div>` : ''}
        <div class="navbar__side navbar__side--r">${opts.right || ''}</div>
      </header>
      ${opts.title ? `<h1 class="large-title">${esc(opts.title)}</h1>` : ''}`;
  }

  function pageShell(opts) {
    return navShell(opts) + `
      <div class="scroller v-content">
        ${opts.title ? '<div class="lt-spacer"></div>' : ''}
        <div class="body">${opts.body}</div>
      </div>`;
  }

  const scrollerOf = view => view && $('.scroller, .chat', view);
  const SMALL_TITLE = 17 / 34;
  const MORPH = 44; // px of scroll over which the large title collapses

  /* Large title → small centered title (and glass bar fades in) */
  function updateNav(view) {
    if (!view || view.hidden) return;
    const sc = scrollerOf(view);
    const nav = $('.navbar', view);
    if (!sc || !nav) return;
    const s = sc.scrollTop;
    if (view.dataset.view === 'home') { updateHero(view, s); return; }

    const lt = $('.large-title', view);
    if (lt) {
      const navH = nav.offsetHeight;
      const W = view.clientWidth;
      const w = lt.offsetWidth;
      const h = lt.offsetHeight;
      const p = clamp(s / MORPH, 0, 1);
      let k = lerp(1, SMALL_TITLE, p);
      let x = lerp(20, (W - w * k) / 2, p);
      let y = lerp(navH + 2, navH - 44 + (44 - h * k) / 2, p);
      if (s < 0) { // rubber band: the title follows and grows a touch, like iOS
        k = 1 + Math.min(-s / 900, 0.08);
        x = 20;
        y = navH + 2 - s;
      }
      lt.style.transform = `translate3d(${x.toFixed(2)}px,${y.toFixed(2)}px,0) scale(${k.toFixed(4)})`;
    }
    nav.style.setProperty('--nav-p', clamp((s - MORPH * 0.55) / (MORPH * 0.6), 0, 1).toFixed(3));
  }

  /* ---------- Home hero: stretchy header + parallax ---------- */
  let homePull = 0;

  function updateHero(view, s) {
    const hero = $('.hero', view);
    const nav = $('.navbar', view);
    if (!hero) return;
    const H = hero.offsetHeight;
    const media = $('.hero__media', hero);
    const img = $('.hero__img', hero);
    const dim = $('.hero__dim', hero);
    const content = $('.hero__content', hero);
    const rest = $('.home-rest', view);

    const nativePull = Math.max(0, -s);
    const pull = Math.max(nativePull, homePull);
    updatePtr(view, pull);

    if (pull > 0) {
      // Stretch: pin the photo to the top and grow it to fill the gap
      media.style.transform = `translate3d(0,${nativePull ? -nativePull : 0}px,0) scale(${((H + pull) / H).toFixed(4)})`;
      if (img) img.style.transform = '';
      dim.style.opacity = 0;
      content.style.opacity = 1;
      content.style.transform = homePull && !nativePull ? `translate3d(0,${homePull}px,0)` : '';
      rest.style.transform = homePull && !nativePull ? `translate3d(0,${homePull}px,0)` : '';
    } else {
      // Scroll up: photo moves at half speed and darkens
      media.style.transform = '';
      if (img) img.style.transform = s > 0 ? `translate3d(0,${(s * 0.5).toFixed(1)}px,0)` : '';
      dim.style.opacity = (clamp(s / H, 0, 1) * 0.6).toFixed(3);
      content.style.opacity = (1 - clamp(s / (H * 0.55), 0, 1)).toFixed(3);
      content.style.transform = s > 0 ? `translate3d(0,${(s * 0.25).toFixed(1)}px,0)` : '';
      rest.style.transform = '';
    }

    const navH = nav.offsetHeight;
    const p = clamp((s - (H - navH - 70)) / 40, 0, 1);
    nav.style.setProperty('--nav-p', p.toFixed(3));
    nav.classList.toggle('is-solid', p > 0.5);
    app.classList.toggle('on-hero', p <= 0.5 && state.tab === 'home');
    // floating Book button once the hero is scrolled away
    const fab = $('.fab', view);
    if (fab) fab.classList.toggle('is-shown', s > H - 90);
  }

  /* ---------- Pull to refresh (Home) ---------- */
  const PTR_T = 84; // px of pull that arms the refresh
  let refreshing = false;

  /* iOS-style activity indicator: ticks appear as you pull, spin while loading */
  function updatePtr(view, pull) {
    const ptr = $('.ptr', view);
    if (!ptr || refreshing) return;
    const k = clamp(pull / PTR_T, 0, 1);
    ptr.style.opacity = k > 0.05 ? Math.min(1, k * 1.4).toFixed(3) : '0';
    ptr.style.transform = `translate3d(-50%,${lerp(-14, 0, k).toFixed(1)}px,0) scale(${lerp(0.6, 1, k).toFixed(3)})`;
    $$('i', ptr).forEach((t, i) => { t.style.opacity = i < Math.round(k * 12) ? '' : '0'; });
    ptr.classList.toggle('is-armed', k >= 1);
  }

  async function refreshHome() {
    if (refreshing) return;
    refreshing = true;
    const ptr = $('.ptr', views.home);
    ptr.classList.add('is-spinning');
    ptr.style.opacity = '1';
    ptr.style.transform = 'translate3d(-50%,0,0) scale(1)';
    $$('i', ptr).forEach(t => { t.style.opacity = ''; });
    const t0 = performance.now();
    try {
      const res = await fetch('./masters/' + SLUG + '.json', { cache: 'no-cache' });
      if (res.ok) {
        data = normalizeData(await res.json());
        brandAccent = data.brandAccent;
        store.set('brand', brandAccent);
        applySettings();
      }
    } catch (e) { /* offline: keep what we have */ }
    const left = 900 - (performance.now() - t0);
    if (left > 0) await wait(left);
    // light refresh of the content under the hero
    $('.home-rest', views.home).innerHTML = homeRestHTML();
    rerule();
    const reel = $('.reel', views.home);
    if (reel) bindReel(reel);
    refreshStatus();
    observeStats();
    revealRest(0.1);
    ptr.classList.remove('is-spinning');
    refreshing = false;
    updateHero(views.home, scrollerOf(views.home).scrollTop);
    toast('Updated just now', 'ok');
  }

  /* Android / desktop touch: emulate the iOS rubber-band pull on the hero */
  function bindHomePull(sc) {
    // iOS: native rubber band — refresh when released far enough
    sc.addEventListener('touchend', () => { if (IS_IOS && -sc.scrollTop >= PTR_T) refreshHome(); }, { passive: true });
    if (IS_IOS) return;
    sc.style.overscrollBehaviorY = 'none';
    let startY = null;
    const apply = () => updateHero(views.home, sc.scrollTop);
    sc.addEventListener('touchstart', e => {
      startY = sc.scrollTop <= 0 ? e.touches[0].clientY : null;
    }, { passive: true });
    sc.addEventListener('touchmove', e => {
      if (startY == null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0 && sc.scrollTop <= 0) {
        homePull = 150 * (1 - Math.exp(-dy / 260));
        apply();
      } else if (homePull) {
        homePull = 0;
        apply();
      }
    }, { passive: true });
    const springTo = v => {
      const g = G();
      if (!g) { homePull = v; apply(); return; }
      const o = { v: homePull };
      ensure(g.to(o, { v, duration: v ? 0.5 : 0.9, ease: v ? SPRING : ELASTIC, overwrite: true, onUpdate: () => { homePull = o.v; apply(); } }));
    };
    const release = () => {
      startY = null;
      if (!homePull) return;
      if (homePull >= PTR_T && !refreshing) {
        springTo(58); // hold the header open while loading
        refreshHome().then(() => springTo(0));
      } else {
        springTo(0);
      }
    };
    sc.addEventListener('touchend', release, { passive: true });
    sc.addEventListener('touchcancel', release, { passive: true });
  }

  /* ---------- Tab bar: pill, shrink on scroll ---------- */
  /* Slide a highlight pill under a button. Only transform is animated:
     the new width is applied at once and scaled from the old one. */
  function slidePill(pill, x, w, animate) {
    const g = window.gsap;
    if (!g) { pill.style.transform = `translateX(${x}px)`; pill.style.width = w + 'px'; return; }
    const oldW = parseFloat(pill.style.width) || 0;
    g.killTweensOf(pill);
    if (animate && oldW && !reducedMQ.matches) {
      g.set(pill, { width: w, scaleX: oldW / w, transformOrigin: '0% 50%' });
      ensure(g.to(pill, { x, scaleX: 1, duration: 0.75, ease: ELASTIC }));
    } else {
      g.set(pill, { x, width: w, scaleX: 1, transformOrigin: '0% 50%' });
    }
  }

  function movePill(tab, animate) {
    const btn = $(`.tab[data-tab="${tab}"]`, tabbar);
    const pill = $('.tabbar__pill', tabbar);
    if (!btn || !pill) return;
    slidePill(pill, btn.offsetLeft, btn.offsetWidth, animate);
  }

  let tabSmall = false;
  function setTabSmall(v) {
    if (v === tabSmall) return;
    tabSmall = v;
    tabbar.classList.toggle('is-small', v);
  }

  const lastScroll = new WeakMap();
  const pending = new Set();
  let rafId = 0;
  function onScroll(e) {
    const sc = e.currentTarget;
    const view = sc.closest('.view');
    const s = sc.scrollTop;
    const last = lastScroll.get(sc) || 0;
    const d = s - last;
    lastScroll.set(sc, s);
    if (view && view.dataset.view !== 'ask') {
      if (s > 80 && d > 4) setTabSmall(true);
      else if (d < -4 || s < 40) setTabSmall(false);
    }
    pending.add(view);
    if (!rafId) rafId = requestAnimationFrame(() => {
      rafId = 0;
      pending.forEach(updateNav);
      pending.clear();
    });
  }

  /* Recent work: the card nearest the centre grows a little */
  function bindReel(reel) {
    let raf = 0;
    const update = () => {
      raf = 0;
      const box = reel.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      $$('.reel__item', reel).forEach(el => {
        const r = el.getBoundingClientRect();
        const dist = Math.abs(r.left + r.width / 2 - cx);
        el.style.setProperty('--s', (1 + 0.04 * (1 - clamp(dist / (r.width + 12), 0, 1))).toFixed(4));
      });
    };
    reel.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(update); }, { passive: true });
    requestAnimationFrame(update);
  }

  /* ---------------------------------------------------------
     6. Rendering
     --------------------------------------------------------- */
  function renderHome() {
    const rating = ratingText();
    const st = statusShort();
    // hero media: muted looping video if the master has one, otherwise the photo
    const media = data.heroVideo
      ? `<video class="hero__img" src="${esc(safeUrl(data.heroVideo))}" ${data.heroPhoto ? `poster="${esc(safeUrl(data.heroPhoto))}"` : ''} autoplay muted loop playsinline preload="metadata"></video>`
      : data.heroPhoto ? `<img class="hero__img" src="${esc(safeUrl(data.heroPhoto))}" alt="">` : '';

    const maison = STYLE !== 'soft'; // maison and noir share the photo hero + monogram
    const firstSlot = data.slots[0] || data.nextAvailable || '';
    const eyebrow = data.eyebrow || `${isNails() ? 'Nail' : 'Lash'} artistry · ${String(data.city || '').split(',')[0]}`;
    views.home.innerHTML = navShell({
      navClass: 'navbar--home',
      navTitle: data.name,
      left: maison ? `<span class="mono" data-owner-hold role="img" aria-label="${esc(data.name)}">${esc(initials())}<svg class="hold-ring" viewBox="0 0 68 68" aria-hidden="true"><circle cx="34" cy="34" r="32" pathLength="100"/></svg></span>` : '',
      right: `
        <button class="nav-btn" id="share" aria-label="Share">${I.share}</button>
        <button class="nav-btn" id="bell" aria-label="Notifications">${I.bell}${hasUnread() ? '<i class="badge-dot"></i>' : ''}</button>`
    }) + `
      <div class="scroller v-content">
        <section class="hero">
          <div class="hero__media">
            <div class="hero__tilt"><div class="hero__kb">${media}</div></div>
            <div class="hero__dim"></div>
          </div>
          ${maison ? `
          <div class="hero__content hero__content--maison">
            <span class="hero__eyebrow">${esc(eyebrow)}</span>
            <h1 class="hero__name">${esc(data.name)}</h1>
            <div class="hero__meta">${rating ? `<span><b class="star">★</b>&nbsp;<b class="num">${rating}</b>&nbsp;·&nbsp;<span class="num">${esc(data.reviewCount || data.reviews.length)}</span>&nbsp;reviews</span>` : ''}${data.city ? `<span>${esc(data.city)}</span>` : ''}</div>
            ${firstSlot ? `<button class="hero__next" data-book data-slot="${esc(firstSlot)}">Next: ${esc(firstSlot)} ${I.arrowR}</button>` : ''}
          </div>` : `
          <div class="hero__content">
            <div class="hero__top">
              ${data.avatar ? `<span class="hero__avatar-wrap" data-owner-hold>
                <img class="hero__avatar" src="${esc(safeUrl(data.avatar))}" alt="" draggable="false">
                <svg class="hold-ring" viewBox="0 0 68 68" aria-hidden="true"><circle cx="34" cy="34" r="32" pathLength="100"/></svg>
              </span>` : ''}
              <span class="hero__status${st.open ? ' is-open' : ''}" data-status-pill><i></i><span>${esc(st.text)}</span></span>
            </div>
            <p class="hero__greet">${greeting()}</p>
            <h1 class="hero__name">${esc(data.name)}</h1>
            <div class="hero__meta">
              ${data.city ? `<span>${I.pin}${esc(data.city)}</span>` : ''}
              ${rating ? `<span><b class="star">★</b><b class="num">${rating}</b></span>` : ''}
            </div>
          </div>`}
        </section>

        <div class="body home-rest">${homeRestHTML()}</div>
      </div>
      <div class="ptr" aria-hidden="true"><span class="ptr__spinner">${Array.from({ length: 12 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</span></div>
      <button class="fab btn btn--primary" data-book aria-label="Book an appointment">${svg('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>')}<span>Book</span></button>`;

    const reel = $('.reel', views.home);
    if (reel) bindReel(reel);
    observeStats();
    rerule();
  }

  /* Maison: a thin gold rule between Home sections (only between visible ones) */
  function rerule() {
    const box = $('.home-rest', views.home);
    if (!box) return;
    $$('.rule', box).forEach(r => r.remove());
    if (STYLE !== 'maison') return;
    const kids = Array.from(box.children).filter(c => !c.hidden);
    kids.slice(1).forEach(c => c.insertAdjacentHTML('beforebegin', '<i class="rule" aria-hidden="true"></i>'));
  }

  /* Everything below the hero (re-rendered on pull-to-refresh) */
  function homeRestHTML() {
    const p = data.promo;
    const x = data.extras;
    const rating = ratingText();
    const first = data.slots[0] || '';
    const promoArt = p && p.image
      ? (/fluentui-emoji|\.png(\?|$)|\.svg(\?|$)|\.webp(\?|$)/i.test(p.image)
        ? `<img class="promo__art" src="${esc(safeUrl(p.image))}" alt="">`
        : `<img class="promo__art promo__art--photo" src="${esc(sized(safeUrl(p.image), 400))}" alt="">`)
      : '';
    return `
          ${data.stories.length ? `
          <div class="stories-row" data-stagger>
            ${data.stories.map((s, i) => `
              <button class="story${storySeen(s) ? ' is-seen' : ''}" data-story="${i}">
                <span class="story__ring"><img src="${esc(sized(safeUrl(s.cover), 300))}" alt=""></span>
                <span class="story__title">${esc(s.title)}</span>
              </button>`).join('')}
          </div>` : ''}

          ${data.stats.length ? `
          <div class="stats" data-stagger>
            ${data.stats.map(s => `
              <div class="stat" data-value="${+s.value}" data-decimals="${+s.decimals || 0}">
                <b><span class="stat__num num">${fmtStat(+s.value, +s.decimals || 0)}</span>${esc(s.suffix || '')}</b>
                <small>${esc(s.label || '')}</small>
              </div>`).join('')}
          </div>` : ''}

          <div class="again-slot" id="book-again" data-stagger hidden></div>

          <section class="next glass" data-stagger>
            <div class="next__top">
              <span class="live"><i></i>NEXT AVAILABLE</span>
              ${art('calendar', 'next__icon')}
            </div>
            <div class="next__time">${esc(data.nextAvailable || 'Book online')}</div>
            <div class="next__status">${I.clock}<span data-status></span></div>
            ${data.slots.length ? `
            <div class="slots">
              ${data.slots.slice(0, 6).map((s, i) => `<button class="slot${i === 0 ? ' is-first' : ''}" data-book data-slot="${esc(s)}">${esc(s)}</button>`).join('')}
            </div>` : ''}
            <div class="next__actions">
              <button class="btn btn--primary" data-book${first ? ` data-slot="${esc(first)}"` : ''}>Book</button>
              <button class="btn btn--soft" data-go="ask">Ask</button>
            </div>
          </section>

          ${loyaltyHTML()}

          ${p ? `
          <button class="promo press" data-stagger data-book>
            <i class="promo__shine"></i>
            <div class="promo__body">
              ${p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ''}
              ${p.title ? `<h3>${esc(p.title)}</h3>` : ''}
              ${p.text ? `<p>${esc(p.text)}</p>` : ''}
              <span class="btn btn--primary btn--sm">Book now ${I.arrowR}</span>
            </div>
            ${promoArt}
          </button>` : ''}

          ${data.gallery.length ? `
          <div class="section" data-stagger>
            <div class="section-head"><h2>Recent work</h2><button class="link-btn" data-go="gallery">See all</button></div>
            <div class="rail reel">
              ${data.gallery.slice(0, 8).map((g, i) => `
                <button class="reel__item" data-reel="${i}" aria-label="Open photo ${i + 1}">
                  <img src="${esc(sized(safeUrl(g.photo), 400))}" alt="" loading="lazy">
                </button>`).join('')}
            </div>
          </div>` : ''}

          ${data.services.length ? `
          <div class="section" data-stagger>
            <div class="section-head"><h2>Services</h2><button class="link-btn" data-go="services">See all</button></div>
            <div class="rail">
              ${data.services.map(s => `
                <div class="svc-card" role="button" tabindex="0" data-open-service="${esc(s.id)}">
                  <span class="svc-card__photo">
                    <img src="${esc(sized(safeUrl(s.photo), 400))}" alt="" loading="lazy">
                    ${STYLE !== 'soft' ? '' : `<span class="svc-card__icon"><img src="${esc(icon3d(s.icon))}" alt="" loading="lazy"></span>`}
                    ${favButton('svc:' + s.id, 'fav--photo')}
                  </span>
                  <span class="svc-card__body">
                    <span class="svc-card__title">${esc(s.title)}</span>
                    <span class="svc-card__row">
                      <span class="svc-card__price">${esc(price(s.price))}</span>
                      ${s.duration ? `<span class="svc-card__dur">${esc(s.duration)}</span>` : ''}
                    </span>
                  </span>
                </div>`).join('')}
            </div>
          </div>` : ''}

          ${data.reviews.length ? `
          <div class="section" data-stagger>
            <div class="section-head"><h2>Loved by clients</h2></div>
            <div class="rating">
              <span class="rating__big">${rating}</span>
              <span class="rating__sub">
                ${stars(data.rating || 5)}
                <span>from <b class="num">${esc(data.reviewCount || data.reviews.length)}</b> reviews</span>
              </span>
            </div>
            <div class="rail reviews">
              ${data.reviews.map(r => `
                <article class="card review">
                  ${stars(+r.rating || 5)}
                  <p>${esc(r.text)}</p>
                  <div class="review__who">
                    <span class="review__initial">${esc(String(r.name || '?').trim().charAt(0).toUpperCase())}</span>
                    <span><b>${esc(r.name)}</b>${r.service ? `<small>${esc(r.service)}</small>` : ''}</span>
                  </div>
                </article>`).join('')}
            </div>
          </div>` : ''}

          ${x && x.courseTitle ? `
          <a class="card course press" data-stagger href="${esc(safeUrl(x.courseUrl))}" ${ext}>
            <span class="course__icon">${art('gem-stone')}</span>
            <span class="course__body">
              <span class="eyebrow">For future artists</span>
              <h3>${esc(x.courseTitle)}</h3>
              ${x.courseText ? `<p>${esc(x.courseText)}</p>` : ''}
            </span>
            <span class="course__go">${I.arrowR}</span>
          </a>` : ''}`;
  }

  /* ---------- Services tab ---------- */
  function categories() {
    const seen = [];
    data.services.forEach(s => { if (s.category && !seen.includes(s.category)) seen.push(s.category); });
    return ['All'].concat(seen);
  }

  function renderServices() {
    views.services.innerHTML = pageShell({
      title: 'Services',
      body: `
        <label class="search search--glass" data-stagger>
          ${I.search}
          <input id="svc-search" type="search" placeholder="Search services…" autocomplete="off" enterkeyhint="search" aria-label="Search services">
          <button type="button" class="search__clear" id="svc-clear" aria-label="Clear search" hidden>${I.x}</button>
        </label>
        <div class="chipbar" id="svc-chips" role="tablist" data-stagger>
          ${categories().map(c => `<button class="chipbar__chip" role="tab" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}
        </div>
        <div class="svc-list${{ maison: ' svc-list--menu', noir: ' svc-list--grouped' }[STYLE] || ''}" id="svc-list">
          ${STYLE === 'maison' ? menuHTML() : STYLE === 'noir' ? groupedHTML() : data.services.map(s => `
            <div class="card svc2" role="button" tabindex="0" data-stagger data-svc="${esc(s.id)}" data-open-service="${esc(s.id)}">
              <span class="svc2__media">
                <img class="svc2__photo" src="${esc(sized(safeUrl(s.photo), 300))}" alt="" loading="lazy">
                ${favButton('svc:' + s.id, 'fav--photo fav--sm')}
              </span>
              <span class="svc2__info">
                <span class="svc2__cat">${esc(s.category)}</span>
                <span class="svc2__title">${esc(s.title)}</span>
                ${s.duration ? `<span class="svc2__meta">${I.clock}${esc(s.duration)}</span>` : ''}
              </span>
              <span class="svc2__side">
                <span class="svc2__price">${esc(price(s.price))}</span>
                <span class="svc2__chev">${I.chevR}</span>
              </span>
            </div>`).join('')}
          <div class="empty" id="svc-empty" hidden>
            ${art('sparkles')}
            <strong>No services found</strong>
            <span>Try another word — or ask ${esc(firstName())}’s assistant.</span>
          </div>
        </div>`
    });
    syncChips(false);
  }

  /* Maison: the price list reads like a restaurant menu —
     "01 — Lashes", serif names, dotted leaders to the price */
  function menuHTML() {
    return categories().slice(1).map((c, i) => `
      <section class="menu-sec" data-menu-sec>
        <h3 class="menu-sec__h"><span class="num">${String(i + 1).padStart(2, '0')}</span> — ${esc(c)}</h3>
        ${data.services.filter(s => s.category === c).map(s => `
          <div class="svc2 menu-row" role="button" tabindex="0" data-stagger data-svc="${esc(s.id)}" data-open-service="${esc(s.id)}">
            <span class="menu-row__line">
              <span class="menu-row__title">${esc(s.title)}</span>
              <i class="menu-row__dots" aria-hidden="true"></i>
              <span class="menu-row__price num">${esc(price(s.price))}</span>
            </span>
            ${s.duration ? `<span class="menu-row__meta">${esc(s.duration)}${s.includes[0] ? ' · ' + esc(s.includes[0]) : ''}</span>` : ''}
          </div>`).join('')}
      </section>`).join('');
  }

  /* Noir: iOS "inset grouped" — a rounded group per category, thumbnail,
     name + duration, price and a chevron; tap → the details sheet */
  function groupedHTML() {
    return categories().slice(1).map(c => `
      <section class="ngroup" data-menu-sec data-stagger>
        <h3 class="group-label">${esc(c)}</h3>
        <div class="list">
          ${data.services.filter(s => s.category === c).map(s => `
            <div class="svc2 nrow" role="button" tabindex="0" data-svc="${esc(s.id)}" data-open-service="${esc(s.id)}">
              <img class="nrow__thumb" src="${esc(sized(safeUrl(s.photo), 160))}" alt="" loading="lazy">
              <span class="nrow__text"><b>${esc(s.title)}</b>${s.duration ? `<small>${esc(s.duration)}</small>` : ''}</span>
              <span class="nrow__price num">${esc(price(s.price))}</span>
              <span class="row__chev">${I.chevR}</span>
            </div>`).join('')}
        </div>
      </section>`).join('');
  }

  function serviceMatches(s) {
    const q = state.query.trim().toLowerCase();
    return !!s && (state.category === 'All' || s.category === state.category) &&
      (!q || [s.title, s.category, s.description].concat(s.includes).join(' ').toLowerCase().includes(q));
  }

  /* Floating pill under the active category chip */
  function syncChips(animate) {
    const bar = $('#svc-chips');
    if (!bar) return;
    let active = null;
    $$('.chipbar__chip', bar).forEach(b => {
      const on = b.dataset.cat === state.category;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on);
      if (on) active = b;
    });
    // (no sliding pill: on iOS Safari an absolute pill inside a scroll
    // container paints over the chip's text — the chip paints itself)
  }

  /* Filter the list; surviving cards glide to their new place (FLIP) */
  let filterToken = 0;
  function applyServiceFilter(animate) {
    const list = $('#svc-list');
    if (!list) return;
    const cards = $$('.svc2', list);
    const want = c => serviceMatches(data.services.find(s => s.id === c.dataset.svc));
    const token = ++filterToken;
    const g = animate ? G() : null;
    const syncEmpty = () => {
      $('#svc-empty').hidden = cards.some(c => !c.hidden);
      // menu sections disappear when none of their rows match
      $$('[data-menu-sec]', list).forEach(sec => { sec.hidden = !$$('.svc2', sec).some(c => !c.hidden); });
    };
    if (!g) { cards.forEach(c => { c.hidden = !want(c); }); syncEmpty(); return; }

    // a filter tap during the tab's entrance finishes that entrance at once
    const staged = cards.concat($('[data-stagger]', views.services));
    g.killTweensOf(staged);
    g.set(staged, { clearProps: 'opacity,transform' });
    clearTimeout(failsafeTimers.get(views.services)); // nothing left hidden for it to rescue
    const first = new Map();
    cards.forEach(c => { if (!c.hidden) first.set(c, c.getBoundingClientRect()); });
    const leaving = cards.filter(c => !c.hidden && !want(c));

    const flip = () => {
      if (token !== filterToken) return;
      if (leaving.length) g.set(leaving, { clearProps: 'opacity,transform' });
      cards.forEach(c => { c.hidden = !want(c); });
      syncEmpty();
      const entering = [];
      cards.forEach(c => {
        if (c.hidden) return;
        const a = first.get(c);
        if (!a) { entering.push(c); return; }
        const b = c.getBoundingClientRect();
        const dx = a.left - b.left;
        const dy = a.top - b.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          ensure(g.fromTo(c, { x: dx, y: dy }, { x: 0, y: 0, duration: 0.65, ease: SPRING, clearProps: 'transform' }));
        }
      });
      if (entering.length) {
        ensure(g.fromTo(entering, { opacity: 0, scale: 0.9, y: 16 },
          { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: SPRING, stagger: 0.04, delay: 0.05, clearProps: 'opacity,transform' }));
      }
    };
    if (leaving.length) ensure(g.to(leaving, { opacity: 0, scale: 0.94, duration: 0.18, ease: 'power2.in', onComplete: flip }));
    else flip();
  }

  function renderAsk() {
    views.ask.innerHTML = navShell({ title: 'Ask' }) + `
      <div class="chat v-content" id="chat" role="log" aria-live="polite">
        <div class="lt-spacer"></div>
        <div class="card assistant" data-stagger>
          <span class="assistant__avatar"><img src="${esc(safeUrl(data.avatar))}" alt=""></span>
          <span class="assistant__text">
            <strong>${esc(firstName())}’s assistant</strong>
            <span class="eyebrow">Replies instantly · 24/7</span>
          </span>
          ${art('speech-balloon', 'assistant__art')}
        </div>
        <div class="chat__day" data-stagger>Today</div>
      </div>
      <div class="chips suggest v-content" id="suggest">
        ${SUGGEST.start.map(t => `<button class="chip" data-ask="${esc(t)}">${esc(t)}</button>`).join('')}
      </div>
      <form class="composer v-content" id="composer" autocomplete="off">
        <div class="composer__field">
          <input id="chat-input" type="text" placeholder="Message" enterkeyhint="send" aria-label="Your question" maxlength="300">
          <button class="send" type="submit" aria-label="Send" disabled>${I.arrowUp}</button>
        </div>
      </form>`;

    const greet = bubble('bot', `Hi! I'm ${firstName()}'s assistant 💬 Ask me about prices, availability, deposits or aftercare`);
    greet.setAttribute('data-stagger', '');
    regroup();
  }

  /* ---------- Looks tab — "Choose your look" ----------
     Every gallery item is a look tied to a service: tap → full-screen
     viewer with details → "Book this look" (2 taps to the booking sheet). */
  const LOOK_AR = [3 / 4, 2 / 3, 4 / 5, 3 / 4, 5 / 6, 2 / 3, 4 / 5, 1]; // width / height, cycled
  const lookById = id => data.gallery.find(l => l.id === id) || null;
  const lookSvc = l => (l && data.services.find(s => s.id === l.serviceId)) || null;
  const lookAR = l => LOOK_AR[Math.max(0, data.gallery.indexOf(l)) % LOOK_AR.length];
  const savedLooks = () => favs().filter(k => k.startsWith('look:')).map(k => lookById(k.slice(5))).filter(Boolean);

  function lookTags() {
    const seen = [];
    data.gallery.forEach(l => { if (l.tag && !seen.includes(l.tag)) seen.push(l.tag); });
    return seen;
  }
  function lookItems(key) {
    key = key || state.lookFilter;
    if (key === 'All') return data.gallery.slice();
    if (key === 'Saved') {
      const saved = new Set(savedLooks().map(l => l.id));
      return data.gallery.filter(l => saved.has(l.id));
    }
    return data.gallery.filter(l => l.tag === key);
  }
  function lookFilters() {
    return [{ key: 'All', label: 'All' }]
      .concat(lookTags().map(t => ({ key: t, label: t })))
      .concat([{ key: 'Saved', label: '♥ Saved' }])
      .map(f => Object.assign(f, { n: lookItems(f.key).length }));
  }

  /* Owner demo numbers per look (from ownerDemo.looks, else a stable made-up value) */
  function lookStats(l) {
    const o = data.ownerDemo && data.ownerDemo.looks && data.ownerDemo.looks[l.id];
    if (o) return { views: +o.views || 0, bookings: +o.bookings || 0 };
    let h = 0;
    for (const ch of l.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return { views: 60 + (h % 180), bookings: 2 + (h % 14) };
  }
  const topLook = () => data.gallery.slice().sort((a, b) => lookStats(b).bookings - lookStats(a).bookings)[0] || null;

  function renderGallery() {
    views.gallery.innerHTML = pageShell({
      title: 'Looks',
      body: `
        <p class="looks-sub" data-stagger>Tap a look you love — book it in two taps.</p>
        <div id="owner-looks" hidden></div>
        <div class="chipbar chipbar--looks" id="look-chips" role="tablist" data-stagger>
        </div>
        <div class="masonry" id="masonry"></div>`
    });
    renderLookChips();
    renderLooks(false);
    renderOwnerLooks();
  }

  function renderLookChips() {
    const bar = $('#look-chips');
    if (!bar) return;
    $$('.chipbar__chip', bar).forEach(c => c.remove());
    bar.insertAdjacentHTML('beforeend', lookFilters().map(f => `
      <button class="chipbar__chip" role="tab" data-look-filter="${esc(f.key)}">${esc(f.label)}<span class="chip-n num">${f.n}</span></button>`).join(''));
    syncLookChips(false);
  }

  /* Floating accent pill under the active filter */
  function syncLookChips(animate) {
    const bar = $('#look-chips');
    if (!bar) return;
    let active = null;
    $$('.chipbar__chip', bar).forEach(b => {
      const on = b.dataset.lookFilter === state.lookFilter;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on);
      if (on) active = b;
    });
  }

  function updateLookCounts() {
    const f = lookFilters();
    $$('#look-chips .chipbar__chip').forEach(b => {
      const x = f.find(y => y.key === b.dataset.lookFilter);
      if (x) $('.chip-n', b).textContent = x.n;
    });
  }

  function lookCardHTML(l) {
    const s = lookSvc(l);
    const st = ownerMode ? lookStats(l) : null;
    return `
      <div class="look" role="button" tabindex="0" data-stagger data-look="${esc(l.id)}" aria-label="${esc(l.title)}${s ? ', ' + esc(price(s.price)) : ''}">
        <div class="look__media" style="aspect-ratio:${lookAR(l).toFixed(4)}">
          <img class="look__lqip" src="${esc(sized(safeUrl(l.photo), 40))}" alt="" aria-hidden="true">
          <img class="look__img" src="${esc(sized(safeUrl(l.photo), 500))}" alt="" loading="lazy" decoding="async">
          ${l.isNew || l.popular ? `<span class="look__badges">${l.isNew ? '<b class="lbadge lbadge--new">New</b>' : ''}${l.popular ? `<b class="lbadge lbadge--hot">${STYLE === 'soft' ? '🔥 ' : ''}Most booked</b>` : ''}</span>` : ''}
          ${favButton('look:' + l.id, 'fav--photo fav--sm')}
          ${st ? `<span class="look__stats num">👁 ${st.views} · 📅 ${st.bookings} bookings</span>` : ''}
          <span class="look__plaque"><b>${esc(l.title)}</b>${s ? `<span class="num">&nbsp;· ${esc(price(s.price))}</span>` : ''}</span>
        </div>
      </div>`;
  }

  function emptyLooksHTML() {
    const saved = state.lookFilter === 'Saved';
    return `
      <div class="looks-empty" data-stagger>
        ${art(saved ? 'heart' : 'sparkles')}
        <strong>${saved ? 'No saved looks yet' : 'No looks here yet'}</strong>
        <span>${saved ? 'Tap ♥ on a look you love — it’ll wait for you here.' : 'New work is on its way ✨'}</span>
        <button class="btn btn--soft btn--sm" data-look-filter="All">Browse all looks</button>
      </div>`;
  }

  /* Pinterest-style masonry: each card goes to the shorter column */
  function renderLooks(animate) {
    const box = $('#masonry');
    if (!box) return;
    const items = lookItems();
    box.classList.toggle('is-empty', !items.length);
    if (!items.length) {
      box.innerHTML = emptyLooksHTML();
      if (animate) springIn(box.children);
      return;
    }
    const cols = [[], []];
    const h = [0, 0];
    items.forEach(l => {
      const c = h[0] <= h[1] ? 0 : 1;
      cols[c].push(l);
      h[c] += 1 / lookAR(l);
    });
    box.innerHTML = cols.map(col => `<div class="masonry__col">${col.map(lookCardHTML).join('')}</div>`).join('');
    $$('.look__img', box).forEach(lookImgIn);
    if (animate) {
      const order = new Map(items.map((l, i) => [l.id, i]));
      springIn($$('.look', box).sort((a, b) => order.get(a.dataset.look) - order.get(b.dataset.look)), { stagger: 0.04, y: 24 });
    }
  }

  /* Blur-up: a tiny blurred preview first, the real photo fades in sharp.
     Cached photos show instantly (never stuck blurred). */
  function lookImgIn(img) {
    const done = instant => {
      if (instant) img.classList.add('is-instant');
      img.classList.add('is-in');
    };
    if (img.complete && img.naturalWidth > 0) { done(true); return; }
    img.addEventListener('load', () => done(false), { once: true });
    img.addEventListener('error', () => done(true), { once: true });
  }

  /* Change the filter; cards that stay glide to their new spot (FLIP) */
  let lookToken = 0;
  function setLookFilter(key, force) {
    if (key === state.lookFilter && !force) return;
    state.lookFilter = key;
    syncLookChips(true);
    const box = $('#masonry');
    const g = G();
    const token = ++lookToken;
    if (!g || !box) { renderLooks(false); return; }
    const cards = $$('.look', box);
    g.killTweensOf(cards);
    const first = new Map();
    cards.forEach(c => first.set(c.dataset.look, c.getBoundingClientRect()));
    const want = new Set(lookItems().map(l => l.id));
    const leaving = cards.filter(c => !want.has(c.dataset.look));
    const swap = () => {
      if (token !== lookToken) return;
      renderLooks(false);
      const entering = [];
      $$('.look', box).forEach(c => {
        const a = first.get(c.dataset.look);
        if (!a) { entering.push(c); return; }
        const b = c.getBoundingClientRect();
        const dx = a.left - b.left;
        const dy = a.top - b.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          ensure(g.fromTo(c, { x: dx, y: dy }, { x: 0, y: 0, duration: 0.65, ease: SPRING, clearProps: 'transform' }));
        }
      });
      if (entering.length) {
        ensure(g.fromTo(entering, { opacity: 0, scale: 0.9, y: 16 },
          { opacity: 1, scale: 1, y: 0, duration: 0.6, ease: SPRING, stagger: 0.04, delay: 0.05, clearProps: 'opacity,transform' }));
      }
      const empty = $('.looks-empty', box);
      if (empty) springIn([empty]);
    };
    if (leaving.length) ensure(g.to(leaving, { opacity: 0, scale: 0.92, duration: 0.16, ease: 'power2.in', onComplete: swap }));
    else swap();
  }

  /* A look was (un)saved: counts, the Saved filter and More stay in sync */
  function onLookFavChange() {
    updateLookCounts();
    if (state.lookFilter === 'Saved') setLookFilter('Saved', true);
  }

  /* Owner demo: "Your top look this month" above the grid */
  function renderOwnerLooks() {
    const box = $('#owner-looks');
    if (!box) return;
    const t = ownerMode ? topLook() : null;
    box.hidden = !t;
    if (!t) { box.innerHTML = ''; return; }
    const st = lookStats(t);
    box.innerHTML = `
      <div class="owner-top card" role="button" tabindex="0" data-look="${esc(t.id)}">
        <img src="${esc(sized(safeUrl(t.photo), 200))}" alt="">
        <span class="owner-top__text">
          <span class="eyebrow">Your top look this month</span>
          <b>${esc(t.title)} — <span class="num">${st.bookings}</span> bookings</b>
          <small><span class="num">${st.views}</span> views · <span class="demo-tag">Demo data</span></small>
        </span>
      </div>`;
  }

  const galleryTile = l => $(`#masonry .look[data-look="${CSS.escape(l.id)}"] .look__media`);

  /* Before / After comparison markup (used in the look viewer) */
  function baHTML(before, after) {
    return `
      <div class="ba card" style="--pos:50%">
        <img class="ba__img" src="${esc(sized(safeUrl(after), 900))}" alt="After" draggable="false">
        <div class="ba__before"><img class="ba__img" src="${esc(sized(safeUrl(before), 900))}" alt="Before" draggable="false"></div>
        <span class="ba__label ba__label--l">Before</span>
        <span class="ba__label ba__label--r">After</span>
        <div class="ba__handle" role="slider" tabindex="0" aria-label="Before and after" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50">
          <i></i><b>${svg('<path d="m9 7-5 5 5 5M15 7l5 5-5 5"/>', ' stroke-width="2.2"')}</b>
        </div>
      </div>`;
  }

  /* Before / After comparison: drag the handle (or use ← →) */
  function bindBeforeAfter(el) {
    const handle = $('.ba__handle', el);
    const setPos = p => {
      p = clamp(p, 2, 98);
      el.style.setProperty('--pos', p + '%');
      handle.setAttribute('aria-valuenow', Math.round(p));
    };
    let dragging = false;
    const fromEvent = e => {
      const r = el.getBoundingClientRect();
      setPos(((e.clientX - r.left) / r.width) * 100);
    };
    el.addEventListener('pointerdown', e => {
      dragging = true;
      el.setPointerCapture(e.pointerId);
      el.classList.add('is-dragging');
      if (window.gsap) window.gsap.killTweensOf(el);
      if (el._hint) { el._hint.kill(); el._hint = null; } // the finger wins over the hint wiggle
      fromEvent(e);
    });
    el.addEventListener('pointermove', e => { if (dragging) fromEvent(e); });
    const stop = () => { dragging = false; el.classList.remove('is-dragging'); };
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointercancel', stop);
    handle.addEventListener('keydown', e => {
      const cur = parseFloat(el.style.getPropertyValue('--pos')) || 50;
      if (e.key === 'ArrowLeft') { setPos(cur - 5); e.preventDefault(); }
      if (e.key === 'ArrowRight') { setPos(cur + 5); e.preventDefault(); }
    });
  }

  /* A little wiggle so people notice the handle */
  function hintBeforeAfter(el) {
    const g = G();
    if (!el || !g) return;
    const o = { p: 50 };
    const set = () => el.style.setProperty('--pos', o.p + '%');
    const tl = g.timeline({ delay: 0.6, onUpdate: set, onComplete: set });
    tl.to(o, { p: 68, duration: 0.5, ease: 'power2.out', onUpdate: set })
      .to(o, { p: 36, duration: 0.6, ease: 'power2.inOut', onUpdate: set })
      .to(o, { p: 50, duration: 0.9, ease: ELASTIC, onUpdate: set });
    el._hint = tl;
    ensure(tl);
  }

  function segmented(key, options, labels) {
    return `<div class="segmented" role="radiogroup" data-seg="${key}" style="--n:${options.length}">
      <i class="segmented__thumb"></i>
      ${options.map((o, i) => `<button role="radio" data-value="${o}" aria-checked="false">${labels[i]}</button>`).join('')}
    </div>`;
  }

  /* iOS Settings palette: every row gets its own icon color */
  const IOS = { blue: '#007AFF', teal: '#30B0C7', orange: '#FF9500', indigo: '#5856D6', pink: '#FF2D55', green: '#34C759', red: '#FF3B30' };

  function renderMore() {
    const row = (subName, ic, color, label, value) => `
      <button class="row row--link" data-sub="${subName}">
        <span class="row__icon" style="--ic:${color}">${ic}</span>
        <span class="row__label">${label}</span>
        ${value ? `<span class="row__value">${value}</span>` : ''}
        <span class="row__chev">${I.chevR}</span>
      </button>`;
    const rating = ratingText();
    const bg = data.heroPhoto || data.avatar;

    views.more.innerHTML = pageShell({
      title: 'More',
      body: `
        <section class="profile" data-stagger>
          <div class="profile__bg" aria-hidden="true">${bg ? `<img src="${esc(sized(safeUrl(bg), 500))}" alt="">` : ''}</div>
          <div class="profile__body">
            <img class="profile__avatar" src="${esc(safeUrl(data.avatar))}" alt="">
            <h2>${esc(data.name)}</h2>
            <div class="profile__city">
              ${data.city ? `<span>${I.pin}${esc(data.city)}</span>` : ''}
              ${rating ? `<span><b class="star">★</b><b class="num">${rating}</b></span>` : ''}
            </div>
            ${data.tagline ? `<p class="profile__tagline">${esc(data.tagline)}</p>` : ''}
            <div class="profile__actions">
              ${data.instagram ? `<a class="pbtn" href="${esc(igUrl())}" ${ext}>${I.ig}<span>Instagram</span></a>` : ''}
              ${data.phone ? `<a class="pbtn" href="${esc(telUrl())}">${I.phone}<span>Call</span></a>` : ''}
              <button class="pbtn" data-share>${I.share}<span>Share</span></button>
            </div>
          </div>
        </section>

        ${data.address ? `
        <div class="group-label" data-stagger>Visit</div>
        <div class="card" data-stagger>${placeHTML()}</div>` : ''}

        ${inviteHTML()}

        <div class="group-label" data-stagger>Saved</div>
        <div class="list" id="saved-box" data-stagger></div>

        <div class="group-label" data-stagger>Studio</div>
        <div class="list" data-stagger>
          ${data.policies.length ? row('policies', I.shield, IOS.blue, 'Policies', data.policies.length) : ''}
          ${data.aftercare.length ? row('aftercare', I.drop, IOS.teal, 'Aftercare', data.aftercare.length + ' steps') : ''}
          ${row('hours', I.clock, IOS.orange, 'Hours', '<span data-status-short></span>')}
        </div>

        <div class="group-label" data-stagger>Settings</div>
        <div class="list" data-stagger>
          <div class="row row--stack">
            <div class="row__head"><span class="row__icon" style="--ic:${IOS.indigo}">${I.contrast}</span><span class="row__label">Appearance</span></div>
            ${segmented('theme', THEMES, ['Light', 'Dark', 'System'])}
            <div class="style-pick">
              <span class="style-pick__label">Style</span>
              ${segmented('style', STYLES, STYLES.map(st => `<i class="sdot sdot--${st}" aria-hidden="true"></i>${st.charAt(0).toUpperCase() + st.slice(1)}`))}
            </div>
          </div>
          <div class="row row--stack">
            <div class="row__head"><span class="row__icon" style="--ic:${IOS.pink}">${I.palette}</span><span class="row__label">Accent color</span><span class="row__value" id="accent-name"></span></div>
            <div class="swatches" role="radiogroup" aria-label="Accent color">
              ${accentList().map(a => `<button class="swatch" role="radio" data-accent="${a.id}" aria-label="${a.name}" aria-checked="false" style="--c:${accentFor(a)};--on:${onAccentColor(accentFor(a))}">${I.check}</button>`).join('')}
            </div>
          </div>
          <div class="row row--stack">
            <div class="row__head"><span class="row__icon" style="--ic:${IOS.green}">${I.type}</span><span class="row__label">Text size</span></div>
            ${segmented('textSize', Object.keys(TEXT_SIZES), ['Small', 'Default', 'Large'])}
            <div class="preview" aria-hidden="true">
              <strong>Classic Full Set</strong>
              <span>This is how text looks across the app.</span>
            </div>
          </div>
          <div class="row">
            <span class="row__icon" style="--ic:${IOS.red}">${I.bell}</span>
            <span class="row__label">Remind me before my appointment<span class="row__sub">We'll add alerts 24h and 2h before to your calendar</span></span>
            <button class="switch" role="switch" id="reminders" aria-checked="false" aria-label="Remind me before my appointment"></button>
          </div>
        </div>

        <div class="list" data-stagger>
          <button class="row row--link row--danger" id="reset">Reset settings</button>
        </div>
        <a class="foot-note" data-stagger href="https://instagram.com/maksim.builds" ${ext}>Made with <b>Studio App</b></a>`
    });

    views.more.style.setProperty('--brand', brandAccent);
    syncSettingsUI();
    renderSaved();
  }

  function syncSettingsUI() {
    if (!views.more || !views.more.firstChild) return;
    $$('.segmented', views.more).forEach(seg => {
      const val = { theme: settings.theme, style: STYLE }[seg.dataset.seg] || settings.textSize;
      $$('button', seg).forEach((b, i) => {
        const on = b.dataset.value === val;
        b.setAttribute('aria-checked', on);
        if (on) seg.style.setProperty('--idx', i);
      });
    });
    $$('.swatch', views.more).forEach(s => s.setAttribute('aria-checked', s.dataset.accent === settings.accent));
    const a = accentList().find(x => x.id === settings.accent);
    const name = $('#accent-name');
    if (name) name.textContent = a ? a.name : '';
    const sw = $('#reminders');
    if (sw) sw.setAttribute('aria-checked', settings.reminders);
  }

  /* Pushed screens inside More */
  function renderSub(name) {
    const back = `<button class="back-btn" data-back aria-label="Back">${I.chevL}<span>More</span></button>`;
    let title = '';
    let body = '';

    if (name === 'policies') {
      title = 'Policies';
      body = `
        <p class="sub-intro" data-stagger>A few things that keep every appointment calm and on time.</p>
        ${data.policies.map((p, i) => `
          <article class="card policy" data-stagger>
            <span class="policy__num">${String(i + 1).padStart(2, '0')}</span>
            <div><h3>${esc(p.title)}</h3><p>${esc(p.text)}</p></div>
          </article>`).join('')}
        <button class="btn btn--primary btn--block" data-stagger data-book>Book now</button>`;
    } else if (name === 'aftercare') {
      title = 'Aftercare';
      body = `
        <p class="sub-intro" data-stagger>A little care at home keeps your results fresh for weeks.</p>
        <div class="card steps" data-stagger>
          ${data.aftercare.map((s, i) => `
            <div class="step">
              <span class="step__num">${i + 1}</span>
              <div><h3>${esc(s.step)}</h3><p>${esc(s.text)}</p></div>
            </div>`).join('')}
        </div>
        <button class="btn btn--soft btn--block" data-stagger data-go="ask">Still have a question? Ask</button>`;
    } else if (name === 'hours') {
      const s = openStatus();
      const today = studioNow().day;
      title = 'Hours';
      body = `
        <section class="next glass" data-stagger>
          <div class="next__top">
            <span class="live${s.open ? '' : ' is-off'}"><i></i>${s.open ? 'OPEN NOW' : 'CLOSED NOW'}</span>
            ${art('calendar', 'next__icon')}
          </div>
          ${data.nextAvailable ? `<div class="next__label">Next available</div>
          <div class="next__time next__time--sm">${esc(data.nextAvailable)}</div>` : ''}
          <div class="next__status">${I.clock}<span data-status>${esc(s.text)}</span></div>
        </section>
        <div class="card" data-stagger>
          ${[1, 2, 3, 4, 5, 6, 0].map(d => {
            const r = parseRange(data.hours[DAY_KEYS[d]]);
            return `<div class="hours-row${d === today ? ' is-today' : ''}${r ? '' : ' is-closed'}">
              <span>${DAY_NAMES[d]}${d === today ? '<span class="today-pill">Today</span>' : ''}</span>
              <span>${fmtRange(r)}</span>
            </div>`;
          }).join('')}
        </div>
        ${data.city ? `<p class="sub-intro" data-stagger>Times shown in ${esc(data.city)} local time.</p>` : ''}
        <button class="btn btn--primary btn--block" data-stagger data-book>Book next opening</button>`;
    }
    sub.innerHTML = '<div class="mesh" aria-hidden="true"><i></i><i></i><i></i></div>' +
      pageShell({ title, left: back, body });
    const sc = scrollerOf(sub);
    sc.addEventListener('scroll', onScroll, { passive: true });
  }

  /* ---------- Skeletons (first visit of a tab) ---------- */
  const SKELETONS = {
    services: () => `
      <div class="sk" style="height:50px"></div>
      <div class="sk" style="height:46px;border-radius:999px"></div>
      ${'<div class="sk" style="height:124px;border-radius:24px"></div>'.repeat(4)}`,
    ask: () => `
      <div class="sk" style="height:74px;border-radius:24px"></div>
      <div class="sk" style="height:66px;width:78%;border-radius:22px"></div>
      <div class="sk" style="height:44px;width:52%;border-radius:22px;align-self:flex-end"></div>`,
    gallery: () => `
      <div class="sk" style="height:14px;width:62%;border-radius:7px"></div>
      <div class="sk" style="height:46px;border-radius:999px"></div>
      <div class="sk-row">
        <div style="flex:1;display:flex;flex-direction:column;gap:8px"><div class="sk" style="height:200px"></div><div class="sk" style="height:150px"></div></div>
        <div style="flex:1;display:flex;flex-direction:column;gap:8px"><div class="sk" style="height:150px"></div><div class="sk" style="height:220px"></div></div>
      </div>`,
    more: () => `
      <div class="sk" style="height:300px;border-radius:24px"></div>
      <div class="sk" style="height:12px;width:70px;border-radius:6px"></div>
      <div class="sk" style="height:180px;border-radius:24px"></div>`
  };

  function enterView(view, withSkeleton) {
    const g = G();
    const items = () => $$('[data-stagger]', view);
    if (view === views.home) { revealHome(); return; }
    // Reduced motion (or no GSAP): no skeleton, no animation — content is simply there
    if (!g) { showNow([view].concat($$(REVEAL_TARGETS, view))); return; }

    if (withSkeleton && SKELETONS[view.dataset.view]) {
      const sk = document.createElement('div');
      sk.className = 'skeleton';
      sk.setAttribute('aria-hidden', 'true');
      sk.innerHTML = SKELETONS[view.dataset.view]();
      view.appendChild(sk);
      const content = $$('.v-content', view);
      content.forEach(el => { el.style.opacity = '0'; });
      setTimeout(() => {
        content.forEach(el => { el.style.removeProperty('opacity'); });
        ensure(g.to(sk, { opacity: 0, duration: 0.25, ease: 'power2.out', onComplete: () => sk.remove() }));
        if (view.dataset.view === 'ask') scrollChat(false);
        scheduleFailsafe(view, endMs(springIn(items())));
      }, 300);
      scheduleFailsafe(view, 2000); // replaced above once the cascade has started
      return;
    }
    scheduleFailsafe(view, endMs(springIn(items())));
  }

  /* iOS-style tab switch: the old tab shrinks a touch and fades,
     the new one slides in from the side it lives on (280ms) */
  const TAB_ORDER = ['home', 'services', 'ask', 'gallery', 'more'];
  const scrollMem = {};
  function switchViews(prevView, view, dir) {
    const g = G();
    if (!prevView || prevView === view) return;
    if (!g) { prevView.hidden = true; return; }
    g.killTweensOf([prevView, view]);
    prevView.style.zIndex = '0';
    view.style.zIndex = '1';
    ensure(g.to(prevView, {
      scale: 0.96, opacity: 0, duration: 0.28, ease: 'power2.out',
      onComplete: () => {
        if (views[state.tab] !== prevView) prevView.hidden = true;
        g.set(prevView, { clearProps: 'transform,opacity,zIndex' });
      }
    }));
    ensure(g.fromTo(view, { x: 34 * dir, opacity: 0 }, { x: 0, opacity: 1, duration: 0.28, ease: 'power3.out', clearProps: 'transform,opacity,zIndex' }));
  }

  /* ---------------------------------------------------------
     7. Navigation, overlays & back button
     --------------------------------------------------------- */
  const overlays = [];
  function pushOverlay(close) {
    overlays.push(close);
    history.pushState({ ov: overlays.length }, '');
  }
  function popOverlay() { if (overlays.length) history.back(); }
  function closeOverlays() { if (overlays.length) history.go(-overlays.length); }
  window.addEventListener('popstate', e => {
    const depth = (e.state && e.state.ov) || 0;
    while (overlays.length > depth) overlays.pop()();
  });

  function go(tab, opts) {
    opts = opts || {};
    closeOverlays();
    closeNotice();
    const view = views[tab];
    if (!view) return;
    if (tab === state.tab && !opts.force) {
      const sc = scrollerOf(view);
      if (sc) sc.scrollTo({ top: tab === 'ask' ? sc.scrollHeight : 0, behavior: 'smooth' });
      return;
    }
    const prev = state.tab;
    const prevView = prev ? views[prev] : null;
    // remember where each tab was scrolled to
    if (prevView) {
      const psc = scrollerOf(prevView);
      if (psc) scrollMem[prev] = psc.scrollTop;
    }
    state.tab = tab;
    Object.keys(views).forEach(k => { if (k !== tab && k !== prev) views[k].hidden = true; });
    view.hidden = false;
    const sc = scrollerOf(view);
    if (sc && tab !== 'ask' && scrollMem[tab] != null) sc.scrollTop = scrollMem[tab];
    if (prevView && !opts.silent) {
      switchViews(prevView, view, TAB_ORDER.indexOf(tab) >= TAB_ORDER.indexOf(prev) ? 1 : -1);
    } else if (prevView) {
      prevView.hidden = true;
    }
    if (prev) haptic();

    $$('.tab', tabbar).forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on);
    });
    movePill(tab, !!prev);
    popIn($(`.tab[data-tab="${tab}"] .tab__icon`, tabbar), { from: 0.72 });
    setTabSmall(false);

    if (tab !== 'home') app.classList.remove('on-hero');
    updateNav(view);

    const first = !visited.has(tab);
    visited.add(tab);
    if (tab === 'services') syncChips(false);
    if (!opts.silent) enterView(view, first);
    if (tab === 'ask') scrollChat(false);
    if (tab === 'gallery') syncLookChips(false);
  }

  let subTimer;
  function openSub(name) {
    clearTimeout(subTimer);
    renderSub(name);
    sub.hidden = false;
    void sub.offsetWidth;
    updateNav(sub);
    app.classList.add('has-sub');
    scheduleFailsafe(sub, endMs(springIn($$('[data-stagger]', sub), { delay: 0.12 })));
    pushOverlay(() => {
      app.classList.remove('has-sub');
      subTimer = setTimeout(() => { sub.hidden = true; }, 520);
    });
  }

  /* ---------------------------------------------------------
     8. Notice popover, share, toast
     --------------------------------------------------------- */
  const noticeText = () => (data && data.notice) || 'New: fall availability is open ✨';

  function openNotice() {
    const n = $('#notice');
    const bell = $('#bell');
    const card = $('.notice__card', n);
    card.innerHTML = `
      ${art('bell')}
      <div>
        <strong>What’s new</strong>
        <p>${esc(noticeText())}</p>
        <time>${esc(data.name)}</time>
      </div>`;
    n.hidden = false;
    const g = G();
    if (g) ensure(g.fromTo(card, { opacity: 0, scale: 0.6, y: -12 }, { opacity: 1, scale: 1, y: 0, duration: 0.8, ease: ELASTIC, clearProps: 'transform,opacity' }));
    if (bell) {
      bell.classList.remove('is-ringing'); void bell.offsetWidth; bell.classList.add('is-ringing');
      const dot = $('.badge-dot', bell);
      if (dot) dot.remove();
    }
    store.set('noticeSeen', noticeText());
  }
  function closeNotice() {
    const n = $('#notice');
    if (!n || n.hidden || n.dataset.closing) return;
    const card = $('.notice__card', n);
    const g = G();
    const done = () => { n.hidden = true; delete n.dataset.closing; };
    n.dataset.closing = '1';
    if (g) ensure(g.to(card, { opacity: 0, scale: 0.85, y: -6, duration: 0.22, ease: 'power2.in', onComplete: () => { done(); g.set(card, { clearProps: 'all' }); } }));
    else done();
  }

  async function share() {
    const url = location.href;
    if (navigator.share) {
      try { await navigator.share({ title: data.name, text: data.tagline || data.name, url }); } catch (e) { /* cancelled */ }
      return;
    }
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (e) {
      const t = document.createElement('textarea');
      t.value = url;
      t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t);
      t.select();
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      t.remove();
    }
    toast(ok ? 'Link copied' : url, 'link');
  }

  /* Toast = Dynamic Island: a black glass capsule grows out of the notch,
     stays for 2s and shrinks back into it. */
  const TOAST_ICONS = {
    ok: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>', ' stroke-width="2.6"'),
    link: svg('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2"/>'),
    heart: I.heart,
    bell: I.bell,
    sparkle: svg('<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/>')
  };
  let toastTimer = 0;
  function toast(text, icon) {
    const t = $('#toast');
    const g = G();
    clearTimeout(toastTimer);
    t.innerHTML = `<span class="toast__icon toast__icon--${icon || 'ok'}">${TOAST_ICONS[icon] || TOAST_ICONS.ok}</span><span class="toast__text"></span>`;
    $('.toast__text', t).textContent = text;
    t.classList.add('is-visible');
    if (g) {
      g.killTweensOf([t, t.children]);
      // start at the size of the island, then spring open
      const sx = Math.min(1, 118 / Math.max(1, t.offsetWidth));
      ensure(g.fromTo(t, { scaleX: sx, scaleY: 0.85, opacity: 0.9 }, { scaleX: 1, scaleY: 1, opacity: 1, duration: 0.7, ease: ELASTIC }));
      ensure(g.fromTo(t.children, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.45, ease: SPRING, delay: 0.12, stagger: 0.04 }));
    }
    toastTimer = setTimeout(() => {
      const hide = () => { t.classList.remove('is-visible'); if (window.gsap) window.gsap.set([t, t.children], { clearProps: 'all' }); };
      const g2 = G();
      if (!g2) { hide(); return; }
      const sx = Math.min(1, 118 / Math.max(1, t.offsetWidth));
      ensure(g2.to(t.children, { opacity: 0, duration: 0.15, ease: 'power2.in' }));
      ensure(g2.to(t, { scaleX: sx, scaleY: 0.85, opacity: 0, duration: 0.4, ease: 'power3.in', delay: 0.08, onComplete: hide }));
    }, 2000);
  }

  /* Theme switch: the new look spreads in a circle from the tap point */
  function setThemeAnimated(value, x, y) {
    const before = resolvedTheme();
    const after = value === 'system' ? (darkMQ.matches ? 'dark' : 'light') : value;
    if (before === after || !document.startViewTransition || reducedMQ.matches) { setSetting('theme', value); return; }
    root.classList.add('vt-theme');
    let vt;
    try {
      vt = document.startViewTransition(() => { setSetting('theme', value); });
    } catch (e) {
      root.classList.remove('vt-theme');
      setSetting('theme', value);
      return;
    }
    vt.ready.then(() => {
      const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
        { duration: 650, easing: 'cubic-bezier(.32,.72,0,1)', pseudoElement: '::view-transition-new(root)' }
      );
    }).catch(() => {});
    const done = () => root.classList.remove('vt-theme');
    vt.finished.then(done, done);
  }


  /* Style switch (More → Appearance): crossfade, then every tab is
     re-rendered in the new style; tab, scroll and filters stay put */
  function setStyle(next, opts) {
    if (!STYLES.includes(next) || next === STYLE) return;
    if (!opts || opts.remember !== false) store.set('styleUser', next);
    const run = () => {
      adoptStyle(next);
      applySettings();
      rerenderForStyle();
    };
    haptic();
    if (document.startViewTransition && !reducedMQ.matches) {
      root.classList.add('vt-style');
      try {
        const vt = document.startViewTransition(run);
        const done = () => root.classList.remove('vt-style');
        vt.finished.then(done, done);
        return;
      } catch (e) { root.classList.remove('vt-style'); }
    }
    const g = G();
    if (!g) { run(); return; }
    // no View Transitions: fade out, swap, fade back in
    ensure(g.to($('#views'), {
      opacity: 0, duration: 0.16, ease: 'power1.in',
      onComplete: () => { run(); ensure(g.to($('#views'), { opacity: 1, duration: 0.3, ease: 'power1.out', clearProps: 'opacity' })); }
    }));
  }

  function rerenderForStyle() {
    const tabs = ['home', 'services', 'gallery', 'more'];
    const tops = {};
    tabs.forEach(k => { const sc = scrollerOf(views[k]); tops[k] = sc ? sc.scrollTop : 0; });
    renderHome();
    renderServices();
    renderGallery();
    renderMore();
    // Ask keeps its conversation: only the header illustration changes
    const askArt = $('.assistant__art', views.ask);
    if (askArt) askArt.outerHTML = art('speech-balloon', 'assistant__art');
    const input = $('#svc-search');
    if (input && state.query) { input.value = state.query; $('#svc-clear').hidden = false; }
    applyServiceFilter(false);
    tabs.forEach(k => {
      const sc = scrollerOf(views[k]);
      if (!sc) return;
      sc.addEventListener('scroll', onScroll, { passive: true });
      sc.scrollTop = tops[k];
    });
    bindHomePull(scrollerOf(views.home));
    bindOwnerPress();
    syncBookAgain();
    refreshStatus();
    Object.values(views).forEach(v => updateNav(v));
  }

  /* ---------------------------------------------------------
     9. Bottom sheets (iOS style)
     One universal component: two detents (60% / 92%), drag with
     finger or mouse, flick down to close with inertia. The app
     behind dims and shrinks (scale .94, 12px corners).
     --------------------------------------------------------- */
  const Sheet = (() => {
    const LARGE = 0.92;
    const MEDIUM = 0.6;
    let el, content, shell, scrim;
    let isOpen = false;
    let detent = 'large';
    let offset = 0;
    let closeV = 0;
    let closeTimer = 0;
    let drag = null;
    let suppressClick = false;

    const H = () => app.clientHeight;
    const offFor = d => (d === 'large' ? 0 : Math.round(H() * (LARGE - MEDIUM)));
    const closedOff = () => Math.round(H() * LARGE) + 40;

    /* Position the sheet (px below the large detent) and sync the backdrop.
       Everything here is transform / opacity only, so it stays on the compositor. */
    function apply(off, ms) {
      offset = off;
      const curve = 'cubic-bezier(.32,.72,0,1)';
      const tr = ms ? `transform ${ms}ms ${curve}` : 'none';
      el.style.transition = tr;
      el.style.transform = `translate3d(0,${off.toFixed(1)}px,0)`;
      // keep the pinned footer on the visible bottom edge
      const foot = $('.sheet__foot', el);
      if (foot) {
        foot.style.transition = tr;
        foot.style.transform = `translate3d(0,${(-clamp(off, 0, offFor('medium'))).toFixed(1)}px,0)`;
      }
      // the app behind: dims and shrinks as the sheet comes up
      const med = offFor('medium');
      const c = closedOff();
      const p = clamp((c - off) / (c - med), 0, 1);
      shell.style.transition = tr;
      shell.style.transform = p > 0 ? `scale(${(1 - 0.06 * p).toFixed(4)})` : '';
      scrim.style.transition = ms ? `opacity ${ms}ms ${curve}` : 'none';
      scrim.style.opacity = p.toFixed(3);
      el.classList.toggle('is-medium', off > 2);
    }

    function open(render, opts) {
      opts = opts || {};
      const target = opts.detent || 'large';
      clearTimeout(closeTimer);
      closeNotice();
      if (isOpen) { // already open: swap the content in place
        render(content);
        detent = target;
        apply(offFor(target), 500);
        const g = G();
        if (g) ensure(g.fromTo(content, { opacity: 0, x: 44 }, { opacity: 1, x: 0, duration: 0.6, ease: SPRING, clearProps: 'opacity,transform' }));
        return;
      }
      isOpen = true;
      detent = target;
      render(content);
      el.hidden = false;
      app.classList.add('has-sheet');
      if (opts.instant || reducedMQ.matches) {
        apply(offFor(target), 0);
      } else {
        apply(closedOff(), 0);
        void el.offsetWidth; // commit the start position so the slide-in animates
        apply(offFor(target), 500);
      }
      pushOverlay(closeUI);
    }

    /* Runs from the history stack (back button, drag, ×, scrim) */
    function closeUI() {
      isOpen = false;
      const v = closeV;
      closeV = 0;
      const dist = Math.max(0, closedOff() - offset);
      const ms = reducedMQ.matches ? 0 : v > 0.25 ? clamp(Math.round(dist / v), 160, 420) : 480;
      apply(closedOff(), ms);
      closeTimer = setTimeout(() => {
        el.hidden = true;
        content.innerHTML = '';
        app.classList.remove('has-sheet');
      }, ms + 40);
    }

    function close(velocity) {
      if (!isOpen) return;
      closeV = velocity || 0;
      popOverlay();
    }

    function setDetent(d) {
      detent = d;
      apply(offFor(d), 450);
    }

    /* ---------- dragging ---------- */
    function start(pt, target) {
      if (!isOpen || target.closest('input, textarea')) return;
      drag = {
        x0: pt.clientX, y0: pt.clientY, off0: offset, started: false,
        sc: target.closest('[data-sheet-scroll]'),
        samples: [[pt.clientY, performance.now()]]
      };
    }

    function move(pt, e) {
      if (!drag) return;
      const dy = pt.clientY - drag.y0;
      const dx = pt.clientX - drag.x0;
      if (!drag.started) {
        if (Math.abs(dy) < 7 && Math.abs(dx) < 7) return;
        if (Math.abs(dx) > Math.abs(dy)) { drag = null; return; }          // horizontal: rails, day strip
        if (drag.sc && offset <= 1 && (drag.sc.scrollTop > 0 || dy < 0)) { drag = null; return; } // let content scroll
        drag.started = true;
        drag.y0 = pt.clientY;
        drag.off0 = offset;
      }
      if (e && e.cancelable) e.preventDefault();
      let off = drag.off0 + (pt.clientY - drag.y0);
      if (off < 0) off *= 0.22; // resist above the top detent
      apply(off, 0);
      const now = performance.now();
      drag.samples.push([pt.clientY, now]);
      while (drag.samples.length > 2 && now - drag.samples[0][1] > 100) drag.samples.shift();
    }

    function end() {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.started) return;
      suppressClick = true;
      setTimeout(() => { suppressClick = false; }, 60);
      const a = d.samples[0];
      const b = d.samples[d.samples.length - 1];
      const v = (b[0] - a[0]) / Math.max(1, b[1] - a[1]); // px/ms, + = down
      const med = offFor('medium');
      const c = closedOff();
      const projected = offset + v * 220;
      if (projected > med + (c - med) * 0.45 || (v > 1.2 && offset > med * 0.6)) { close(v); return; }
      setDetent(Math.abs(projected) < Math.abs(projected - med) ? 'large' : 'medium');
    }

    function init() {
      el = $('#sheet');
      content = $('.sheet__content', el);
      shell = $('#shell');
      scrim = $('#scrim');
      el.addEventListener('touchstart', e => { if (e.touches.length === 1) start(e.touches[0], e.target); }, { passive: true });
      el.addEventListener('touchmove', e => { if (e.touches.length === 1) move(e.touches[0], e); }, { passive: false });
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
      el.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        start(e, e.target);
        const mm = ev => move(ev, ev);
        const up = () => {
          end();
          window.removeEventListener('pointermove', mm);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', mm);
        window.addEventListener('pointerup', up);
      });
      // A drag must not turn into a click on whatever is under the finger
      el.addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); } }, true);
      // Tapping the grabber toggles between the two heights
      $('.sheet__grab', el).addEventListener('click', () => setDetent(detent === 'large' ? 'medium' : 'large'));
      window.addEventListener('resize', () => { if (isOpen) apply(offFor(detent), 0); });
    }

    return { init, open, close, isOpen: () => isOpen, el: () => el, content: () => content };
  })();

  /* ---------- Service details ---------- */
  function goodToKnow() {
    return data.policies.slice(0, 3).map(p => ({ title: p.title, text: firstSentence(p.text) }));
  }

  function serviceDetailHTML(s) {
    const notes = goodToKnow();
    return `
      <div class="sheet__scroll" data-sheet-scroll>
        <div class="sd-photo">
          <img src="${esc(sized(safeUrl(s.photo), 900))}" alt="">
          <button class="sheet__x sheet__x--float" data-sheet-close aria-label="Close">${I.x}</button>
          ${favButton('svc:' + s.id, 'fav--photo fav--lg')}
        </div>
        <div class="sd-body">
          <span class="svc2__cat">${esc(s.category)}</span>
          <h2 class="sd-title">${esc(s.title)}</h2>
          <div class="sd-meta">
            <span class="sd-price">${esc(price(s.price))}</span>
            ${s.duration ? `<span class="sd-chip">${I.clock}${esc(s.duration)}</span>` : ''}
          </div>
          ${s.description ? `<p class="sd-desc">${esc(s.description)}</p>` : ''}
          ${s.includes.length ? `
          <h3 class="sd-h">What’s included</h3>
          <ul class="sd-list">
            ${s.includes.map(x => `<li><span class="sd-check">${I.check}</span>${esc(x)}</li>`).join('')}
          </ul>` : ''}
          ${notes.length ? `
          <h3 class="sd-h">Good to know</h3>
          <div class="card sd-notes">
            ${notes.map(n => `<div class="sd-note"><span class="row__icon">${I.shield}</span><span><b>${esc(n.title)}</b>${esc(n.text)}</span></div>`).join('')}
          </div>` : ''}
        </div>
      </div>
      <footer class="sheet__foot">
        <div class="sheet__summary">
          <b class="num">${esc(price(s.price))}</b>
          <span>${esc([s.duration, data.deposit ? price(data.deposit) + ' deposit' : ''].filter(Boolean).join(' · '))}</span>
        </div>
        <button class="btn btn--primary" data-book data-book-service="${esc(s.id)}">Book this service</button>
      </footer>`;
  }

  const deskMQ = window.matchMedia('(min-width: 760px)');

  /* The photo flies from the tapped card into the sheet (View Transitions API),
     or fades + scales in where that API isn't available. */
  function openServiceDetail(id, srcImg) {
    const s = data.services.find(x => x.id === id);
    if (!s) return;
    const render = el => { el.innerHTML = serviceDetailHTML(s); };
    const sheetEl = Sheet.el();
    const shell = $('#shell');
    // On desktop the app lives inside a phone frame, and view-transition
    // snapshots aren't clipped by it — so use the fallback there.
    const useVT = !!document.startViewTransition && srcImg && !reducedMQ.matches && !deskMQ.matches && !Sheet.isOpen();

    if (useVT) {
      srcImg.style.viewTransitionName = 'svc-hero';
      shell.style.viewTransitionName = 'shell';
      let vt;
      try {
        vt = document.startViewTransition(() => {
          srcImg.style.viewTransitionName = '';
          Sheet.open(render, { detent: 'large', instant: true });
          sheetEl.style.viewTransitionName = 'sheet';
          const ph = $('.sd-photo img', sheetEl);
          if (ph) ph.style.viewTransitionName = 'svc-hero';
        });
      } catch (e) { vt = null; }
      const cleanup = () => {
        srcImg.style.viewTransitionName = '';
        shell.style.viewTransitionName = '';
        sheetEl.style.viewTransitionName = '';
        const ph = $('.sd-photo img', sheetEl);
        if (ph) ph.style.viewTransitionName = '';
      };
      if (vt) { vt.finished.then(cleanup, cleanup); return; }
      cleanup();
    }

    Sheet.open(render, { detent: 'large' });
    const g = G();
    const ph = $('.sd-photo img', sheetEl);
    if (g && ph) ensure(g.fromTo(ph, { opacity: 0, scale: 0.9 }, { opacity: 1, scale: 1, duration: 0.7, ease: SPRING, delay: 0.12, clearProps: 'opacity,transform' }));
    springIn($$('.sd-body > *', sheetEl), { delay: 0.18, stagger: 0.04, y: 18 });
  }

  /* ---------- Booking: service → day & time → review ----------
     Nothing is saved here: the last step hands the client over to
     the master's own booking link (Acuity, GlossGenius, Booksy…). */
  const bk = { step: 0, service: null, off: null, min: null, look: null };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WEEKDAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

  /* Calendar date `offset` days from today in the studio's timezone */
  function studioDate(offset) {
    const now = new Date();
    let y = now.getFullYear();
    let m = now.getMonth() + 1;
    let d = now.getDate();
    if (data.timezone) {
      try {
        const p = new Intl.DateTimeFormat('en-US', { timeZone: data.timezone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(now);
        const get = t => +(p.find(x => x.type === t) || {}).value;
        y = get('year'); m = get('month'); d = get('day');
      } catch (e) { /* device date */ }
    }
    const dt = new Date(Date.UTC(y, m - 1, d + offset));
    return { off: offset, dow: dt.getUTCDay(), day: dt.getUTCDate(), month: dt.getUTCMonth(), year: dt.getUTCFullYear() };
  }

  /* "Today 3:30 PM", "Tomorrow 11 AM", "Fri 10:00 AM" → { off, min } */
  function parseSlot(str) {
    const m = String(str).trim().match(/^(today|tomorrow|sun|mon|tue|wed|thu|fri|sat)[a-z]*,?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
    if (!m) return null;
    const w = m[1].toLowerCase();
    const off = w === 'today' ? 0 : w === 'tomorrow' ? 1 : (WEEKDAY[w] - studioNow().day + 7) % 7;
    let h = +m[2] % 12;
    if (/pm/i.test(m[4])) h += 12;
    return { off, min: h * 60 + (+m[3] || 0) };
  }

  /* Openings for a day: from JSON `slots` if given, otherwise generated from
     `hours` with the service's duration as the step. */
  function openingsFor(off, svcId) {
    const svc = data.services.find(s => s.id === (svcId === undefined ? bk.service : svcId));
    // JSON slots describe the coming week; further out the calendar is open (generated from hours)
    if (data.slots.length && off < 7) {
      return data.slots.map(parseSlot).filter(s => s && s.off === off).map(s => s.min).sort((a, b) => a - b);
    }
    const r = parseRange(data.hours[DAY_KEYS[studioDate(off).dow]]);
    if (!r) return [];
    const dur = svc ? svc.minutes : 60;
    const step = Math.max(30, dur);
    const earliest = off === 0 ? studioNow().minutes + 60 : -1;
    const out = [];
    for (let t = r.open; t + dur <= r.close; t += step) if (t > earliest) out.push(t);
    return out;
  }

  const bkService = () => data.services.find(s => s.id === bk.service);
  const dayLabel = (off, long) => {
    const d = studioDate(off);
    const name = long ? DAY_NAMES[d.dow] : DAY_SHORT[d.dow];
    return `${off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : name}, ${MONTHS[d.month]} ${d.day}`;
  };

  const BK_DAYS = 14;

  function openBooking(opts) {
    opts = opts || {};
    bk.service = opts.service || null;
    bk.off = null;
    bk.min = null;
    if (opts.slot) {
      const p = parseSlot(opts.slot);
      if (p) { bk.off = p.off; bk.min = p.min; }
    }
    if (bk.off == null) {
      for (let i = 0; i < BK_DAYS; i++) if (openingsFor(i).length) { bk.off = i; break; }
      if (bk.off == null) bk.off = 0;
    }
    bk.look = opts.look || null;
    bk.step = bk.service ? 1 : 0;
    if (bk.service) rememberService(bk.service);
    haptic();
    Sheet.open(renderBooking, { detent: 'large' });
    showStep(bk.step);
    springIn($$(`#bk-p${bk.step} > *`, Sheet.el()), { delay: 0.15, stagger: 0.04, y: 18 });
  }

  /* Only the current step is in the layout (the others are display:none),
     so nothing depends on widths measured mid-animation. */
  function renderBooking(el) {
    el.innerHTML = `
      <header class="bk-head">
        <button class="bk-back" data-bk-back aria-label="Back">${I.chevL}</button>
        <div class="bk-steps" id="bk-steps" role="tablist">
          <i class="bk-steps__pill" aria-hidden="true"></i>
          <button role="tab" data-bk-step="0">Service</button>
          <button role="tab" data-bk-step="1">Time</button>
          <button role="tab" data-bk-step="2">Review</button>
        </div>
        <button class="sheet__x" data-sheet-close aria-label="Close">${I.x}</button>
      </header>
      <div class="bk-viewport">
        <section class="bk-pane" id="bk-p0" data-sheet-scroll hidden></section>
        <section class="bk-pane" id="bk-p1" data-sheet-scroll hidden></section>
        <section class="bk-pane" id="bk-p2" data-sheet-scroll hidden></section>
      </div>
      <footer class="sheet__foot" id="bk-foot"></footer>`;
    renderBkService();
  }

  function renderBkService() {
    $('#bk-p0').innerHTML = `
      <h2 class="bk-title">Choose a service</h2>
      <p class="bk-sub">Everything ${esc(firstName())} offers, with prices up front.</p>
      <div class="pick-list">
        ${data.services.map(s => `
          <button class="pick${s.id === bk.service ? ' is-selected' : ''}" data-bk-svc="${esc(s.id)}">
            <img src="${esc(sized(safeUrl(s.photo), 200))}" alt="" loading="lazy">
            <span class="pick__text"><b>${esc(s.title)}</b><small>${esc(s.duration || '')}</small></span>
            <span class="pick__price">${esc(price(s.price))}</span>
            <span class="pick__check">${I.check}</span>
          </button>`).join('')}
      </div>`;
  }

  function renderBkTime() {
    const s = bkService();
    const days = Array.from({ length: BK_DAYS }, (_, i) => ({ d: studioDate(i), n: openingsFor(i).length }));
    $('#bk-p1').innerHTML = `
      <h2 class="bk-title">Pick a day & time</h2>
      ${s ? `
      <button class="bk-chosen" data-bk-step="0">
        <img src="${esc(sized(safeUrl(s.photo), 200))}" alt="">
        <span><b>${esc(s.title)}</b><small>${esc([s.duration, price(s.price)].filter(Boolean).join(' · '))}</small></span>
        <em>Change</em>
      </button>` : ''}
      <div class="days" id="bk-days" role="listbox" aria-label="Day">
        ${days.map(({ d, n }) => `
          <button class="day${d.off === bk.off ? ' is-selected' : ''}${n ? '' : ' is-empty'}" data-bk-day="${d.off}" role="option" aria-selected="${d.off === bk.off}">
            <small>${d.off === 0 ? 'Today' : DAY_SHORT[d.dow]}</small>
            <b class="num">${d.day}</b>
            <i></i>
          </button>`).join('')}
      </div>
      <div class="bk-label" id="bk-daylabel">${esc(dayLabel(bk.off, true))}</div>
      <div class="times" id="bk-times"></div>`;
    renderBkTimes(false);
    bindDayStrip($('#bk-days'));
  }

  /* Center the chosen day inside the strip — only the strip scrolls */
  function centerDay(smooth) {
    const strip = $('#bk-days');
    const sel = strip && $('.day.is-selected', strip);
    if (!strip || !sel) return;
    const left = sel.offsetLeft - (strip.clientWidth - sel.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: smooth && !reducedMQ.matches ? 'smooth' : 'auto' });
  }

  /* Desktop: the (vertical) mouse wheel scrolls the strip sideways, and it
     can be dragged with the mouse. Snapping pauses while the wheel spins —
     otherwise small wheel steps get snapped straight back to the same day. */
  function bindDayStrip(strip) {
    if (!strip || strip.dataset.bound) return;
    strip.dataset.bound = '1';
    let wheelTimer = 0;
    strip.addEventListener('wheel', e => {
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? strip.clientWidth : 1;
      const d = (Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX) * unit;
      if (!d) return;
      e.preventDefault();
      strip.classList.add('is-wheeling');
      strip.scrollLeft += d;
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => strip.classList.remove('is-wheeling'), 180);
    }, { passive: false });

    let drag = null;
    strip.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, left: strip.scrollLeft, moved: false };
    });
    strip.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) > 4) {
        drag.moved = true;
        strip.setPointerCapture(drag.id);
        strip.classList.add('is-grabbing');
      }
      if (drag.moved) strip.scrollLeft = drag.left - dx;
    });
    const end = () => {
      if (!drag) return;
      const moved = drag.moved;
      drag = null;
      strip.classList.remove('is-grabbing');
      if (moved) { // a drag is not a tap on a day
        const stop = ev => { ev.stopPropagation(); ev.preventDefault(); };
        strip.addEventListener('click', stop, { capture: true, once: true });
        setTimeout(() => strip.removeEventListener('click', stop, { capture: true }), 50);
      }
    };
    strip.addEventListener('pointerup', end);
    strip.addEventListener('pointercancel', end);
  }

  function renderBkTimes(animate) {
    const box = $('#bk-times');
    if (!box) return;
    const list = openingsFor(bk.off);
    if (bk.min != null && !list.includes(bk.min)) bk.min = null;
    box.innerHTML = list.length
      ? list.map(t => `<button class="time${t === bk.min ? ' is-selected' : ''}" data-bk-time="${t}">${fmtClock(t)}</button>`).join('')
      : `<div class="times__empty">${bk.off === 0 ? 'No more openings today.' : 'No openings this day.'} Try another day ✨</div>`;
    $('#bk-daylabel').textContent = dayLabel(bk.off, true);
    if (animate) springIn($$('.time', box), { stagger: 0.02, y: 12, duration: 0.6 });
  }

  const fmtClock = min => {
    let h = Math.floor(min / 60) % 24;
    const m = min % 60;
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return `${h}:${String(m).padStart(2, '0')} ${ap}`;
  };

  function renderBkReview() {
    const s = bkService();
    const pane = $('#bk-p2');
    if (!s || bk.min == null) { pane.innerHTML = ''; return; }
    const numeric = typeof s.price === 'number';
    const dep = data.deposit || 0;
    pane.innerHTML = `
      <h2 class="bk-title">Review</h2>
      <p class="bk-sub">Check the details, then ${{ instagram: `message ${esc(firstName())} on Instagram`, sms: `text ${esc(firstName())}` }[data.bookingMode] || `finish on ${esc(firstName())}’s booking page`}.</p>
      ${lookRefHTML()}
      <div class="card bk-sum">
        <div class="bk-sum__svc">
          <img src="${esc(sized(safeUrl(s.photo), 200))}" alt="">
          <span><b>${esc(s.title)}</b><small>${esc(s.category)}</small></span>
        </div>
        <div class="bk-row"><span>Date</span><b>${esc(dayLabel(bk.off, true))}</b></div>
        <div class="bk-row"><span>Time</span><b class="num">${fmtClock(bk.min)}</b></div>
        ${s.duration ? `<div class="bk-row"><span>Duration</span><b>${esc(s.duration)}</b></div>` : ''}
        <div class="bk-row"><span>Price</span><b class="num">${esc(price(s.price))}</b></div>
        ${dep ? `
        <div class="bk-row bk-row--accent"><span>Deposit today</span><b class="num">${price(dep)}</b></div>
        ${numeric ? `<div class="bk-row"><span>Due at appointment</span><b class="num">${price(Math.max(0, s.price - dep))}</b></div>` : ''}` : ''}
      </div>
      <div class="sheet__note">${I.shield}<span>${bookingNote()}</span></div>
      ${prepHTML()}`;
  }

  /* Review step: the look she picked + a nudge to share her saved looks */
  function lookRefHTML() {
    const l = bk.look ? lookById(bk.look) : null;
    const saved = savedLooks();
    return `${l ? `
      <div class="bk-ref card">
        <img src="${esc(sized(safeUrl(l.photo), 300))}" alt="">
        <span class="bk-ref__text"><small>Your reference look</small><b>${esc(l.title)}</b></span>
        <span class="bk-ref__pin" aria-hidden="true">📌</span>
      </div>` : ''}
      ${saved.length ? `
      <button class="bk-saved" data-share-saved>
        <span class="bk-saved__thumbs">${saved.slice(0, 3).map(x => `<img src="${esc(sized(safeUrl(x.photo), 120))}" alt="">`).join('')}</span>
        <span class="bk-saved__text">Show ${esc(firstName())} your saved looks (${saved.length})</span>
        ${I.chevR}
      </button>` : ''}`;
  }

  function renderBkFoot() {
    const s = bkService();
    const foot = $('#bk-foot');
    if (!foot) return;
    let summary;
    let action;
    if (bk.step === 0) {
      summary = `<b>${s ? esc(s.title) : 'Choose a service'}</b><span>Step 1 of 3</span>`;
      action = `<button class="btn btn--primary" data-bk-next${s ? '' : ' disabled'}>Next ${I.arrowR}</button>`;
    } else if (bk.step === 1) {
      summary = `<b>${s ? esc(s.title) : ''}</b><span class="num">${bk.min != null ? esc(dayLabel(bk.off, false)) + ' · ' + fmtClock(bk.min) : 'Pick a time'}</span>`;
      action = `<button class="btn btn--primary" data-bk-next${bk.min != null ? '' : ' disabled'}>Review ${I.arrowR}</button>`;
    } else {
      summary = `<b class="num">${s ? esc(price(s.price)) : ''}</b><span>${data.deposit ? price(data.deposit) + ' today' : 'Pay at the studio'}</span>`;
      action = `<button class="btn btn--primary" data-bk-continue>${esc(BOOK_CTA[data.bookingMode] || 'Continue to booking')} ${I.arrowR}</button>`;
    }
    foot.innerHTML = `<div class="sheet__summary">${summary}</div>${action}`;
  }

  /* ---------- Hand-off: link / Instagram DM / text / demo ---------- */
  const BOOK_CTA = { link: 'Continue to booking', instagram: 'Message on Instagram', sms: 'Send a text', demo: 'Continue to booking' };
  const shortDay = off => (off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : `${DAY_SHORT[studioDate(off).dow]}, ${MONTHS[studioDate(off).month]} ${studioDate(off).day}`);
  function bookingMessage() {
    const s = bkService();
    return `Hi! I'd like to book ${s ? s.title : 'an appointment'} — ${shortDay(bk.off)} ${fmtClock(bk.min)}`;
  }
  function bookingNote() {
    const when = `<b>${esc(dayLabel(bk.off, false))}, ${fmtClock(bk.min)}</b>`;
    switch (data.bookingMode) {
      case 'instagram': return `We'll copy a ready message for ${when} — just paste it in ${esc(firstName())}'s DMs.`;
      case 'sms': return `We'll open a text to ${esc(firstName())} asking for ${when}.`;
      case 'demo': return `Demo — in your app this opens your booking for ${when}.`;
      default: return `Not reserved yet — pick ${when} on the next page.`;
    }
  }

  function continueBooking() {
    const mode = data.bookingMode;
    const text = bookingMessage();
    haptic(10);
    if (mode === 'link') {
      window.open(bookUrl(), '_blank', 'noopener');
    } else if (mode === 'instagram') {
      // start the copy first, then open the DM in the same tap (no popup blocker)
      const copy = navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('no clipboard'));
      window.open(igDmUrl(), '_blank', 'noopener');
      copy.then(() => toast('Message copied — just paste it', 'ok'), () => toast(text, 'link'));
    } else if (mode === 'sms') {
      location.href = `sms:${String(data.phone || '').replace(/[^\d+]/g, '')}?&body=${encodeURIComponent(text)}`;
    }
    setTimeout(showBookingDone, mode === 'demo' ? 0 : 450);
  }

  const directionsUrl = () => {
    const q = encodeURIComponent(data.address || data.city || data.name);
    return IS_IOS ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
  };

  /* "Request sent ✓": summary, calendar, directions, a little confetti */
  function showBookingDone() {
    if (!Sheet.isOpen()) return;
    const s = bkService();
    const l = bk.look ? lookById(bk.look) : null;
    const sub = {
      link: `Finish on ${esc(firstName())}'s booking page to lock it in.`,
      instagram: `Paste the message in ${esc(firstName())}'s DMs — ${esc(firstName())} will confirm your spot.`,
      sms: `${esc(firstName())} will confirm by text.`,
      demo: 'Demo — in your app this opens your booking.'
    }[data.bookingMode];
    const content = Sheet.content();
    content.innerHTML = `
      <div class="bk-done" data-sheet-scroll>
        <canvas class="confetti" aria-hidden="true"></canvas>
        <div class="bk-done__head">
          <span class="bk-done__check">${I.check}</span>
          <h2>Request sent</h2>
          <p>${sub}</p>
        </div>
        <div class="card bk-sum">
          <div class="bk-sum__svc">
            <img src="${esc(sized(safeUrl((l && l.photo) || (s && s.photo)), 200))}" alt="">
            <span><b>${esc(s ? s.title : '')}</b><small>${esc(l ? l.title : (s ? s.category : ''))}</small></span>
          </div>
          <div class="bk-row"><span>Date</span><b>${esc(dayLabel(bk.off, true))}</b></div>
          <div class="bk-row"><span>Time</span><b class="num">${fmtClock(bk.min)}</b></div>
          ${s ? `<div class="bk-row"><span>Price</span><b class="num">${esc(price(s.price))}</b></div>` : ''}
          ${data.address ? `<div class="bk-row bk-row--addr"><span>Address</span><b>${esc(data.address)}</b></div>` : ''}
        </div>
        <div class="bk-done__actions">
          <button class="btn btn--soft" data-ics>${svg('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>')}Add to calendar</button>
          <a class="btn btn--soft" href="${esc(directionsUrl())}" ${ext}>${I.pin}Get directions</a>
        </div>
        <button class="btn btn--primary btn--block bk-done__ok" data-sheet-close>Done</button>
      </div>`;
    const g = G();
    if (g) {
      ensure(g.fromTo($('.bk-done__check', content), { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.6, ease: SPRING, clearProps: 'transform,opacity' }));
      springIn($$('.bk-done > :not(canvas)', content), { delay: 0.1, stagger: 0.06, y: 14 });
    }
    confetti($('.confetti', content));
  }

  /* A light confetti burst in the accent color (skipped with reduced motion) */
  function confetti(canvas) {
    if (!canvas || reducedMQ.matches) return;
    const host = canvas.parentElement;
    const W = host.clientWidth;
    const H = Math.min(host.clientHeight, 420);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    const accent = getComputedStyle(root).getPropertyValue('--accent').trim() || '#C9A27E';
    const colors = [accent, accent, '#FFFFFF', '#E9D5B8', 'rgba(255,255,255,.7)'];
    const parts = Array.from({ length: 70 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * 60,
      y: 70,
      vx: (Math.random() - 0.5) * 7,
      vy: -Math.random() * 7 - 3,
      r: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      w: 4 + Math.random() * 5,
      h: 6 + Math.random() * 6,
      c: colors[Math.floor(Math.random() * colors.length)]
    }));
    const t0 = performance.now();
    const frame = now => {
      const t = now - t0;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 900) / 700);
      parts.forEach(p => {
        p.vy += 0.22;
        p.vx *= 0.99;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
        ctx.restore();
      });
      if (t < 1600 && canvas.isConnected) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, W, H);
    };
    requestAnimationFrame(frame);
  }

  function maxStep() {
    if (!bk.service) return 0;
    return bk.min == null ? 1 : 2;
  }

  /* Render a step's content, show only that pane, sync header + footer */
  function showStep(n) {
    bk.step = n;
    if (n === 0) renderBkService();
    if (n === 1) renderBkTime();
    if (n === 2) renderBkReview();
    $$('.bk-pane', Sheet.el()).forEach((p, i) => { p.hidden = i !== n; });
    const pane = $(`#bk-p${n}`);
    pane.scrollTop = 0;

    const steps = $('#bk-steps');
    const btn = $(`[data-bk-step="${n}"]`, steps);
    $$('button', steps).forEach((b, i) => {
      b.classList.toggle('is-active', i === n);
      b.classList.toggle('is-done', i < n);
      b.disabled = i > maxStep();
    });
    const pill = $('.bk-steps__pill', steps);
    if (btn.offsetWidth) slidePill(pill, btn.offsetLeft, btn.offsetWidth, !!$('.bk-steps__pill', steps).style.width);
    $('.bk-back', Sheet.el()).classList.toggle('is-visible', n > 0);
    renderBkFoot();
    if (n === 1) centerDay(false);
    return pane;
  }

  /* Old step slides out (x → ∓40, fade, 200ms), then the new one springs in
     (x ±40 → 0, 300ms). Back = mirrored. */
  let stepBusy = false;
  function goStep(n, animate) {
    n = clamp(n, 0, maxStep());
    if (n === bk.step && animate) return;
    const g = animate ? G() : null;
    const dir = n > bk.step ? 1 : -1;
    const from = $(`#bk-p${bk.step}`);
    if (!g || !from || from.hidden || stepBusy) { showStep(n); return; }
    stepBusy = true;
    haptic();
    const clear = el => g.set(el, { clearProps: 'transform,opacity' });
    ensure(g.to(from, {
      x: -40 * dir, opacity: 0, duration: 0.2, ease: 'power2.in',
      onComplete: () => {
        clear(from);
        const to = showStep(n);
        ensure(g.fromTo(to, { x: 40 * dir, opacity: 0 }, {
          x: 0, opacity: 1, duration: 0.3, ease: 'back.out(1.3)',
          onComplete: () => { clear(to); stepBusy = false; }
        }));
        springIn($$(`#bk-p${n} > *`, Sheet.el()), { delay: 0.05, stagger: 0.03, y: 10, duration: 0.5 });
      }
    }));
  }

  /* ---------------------------------------------------------
     10. Stories viewer
     --------------------------------------------------------- */
  const STORY_MS = 4000;
  const ST = { i: 0, k: 0, t: 0, raf: 0, last: 0, paused: false, held: false, down: null, open: false, after: null };
  let storiesEl, storyStage, storyImg;

  const seenStories = () => store.get('storiesSeen', []);
  const storySeen = s => seenStories().includes(s.title);
  function markSeen(s) {
    const list = seenStories();
    if (!list.includes(s.title)) { list.push(s.title); store.set('storiesSeen', list); }
  }

  function openStories(i) {
    ST.i = i;
    ST.k = 0;
    ST.open = true;
    ST.paused = false;
    storiesEl.hidden = false;
    storiesEl.classList.remove('is-paused');
    app.classList.add('is-dark-overlay');
    showStory();
    const g = G();
    if (g) {
      const ring = $(`.story[data-story="${i}"]`, views.home);
      const r = ring ? ring.getBoundingClientRect() : null;
      const box = app.getBoundingClientRect();
      const ox = r ? ((r.left + r.width / 2 - box.left) / box.width) * 100 : 50;
      const oy = r ? ((r.top + r.height / 2 - box.top) / box.height) * 100 : 20;
      ensure(g.fromTo(storiesEl, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out', clearProps: 'opacity' }));
      ensure(g.fromTo(storyStage, { scale: 0.2, borderRadius: 200, transformOrigin: `${ox}% ${oy}%` },
        { scale: 1, borderRadius: 0, duration: 0.7, ease: SPRING, clearProps: 'transform,borderRadius' }));
    }
    ST.last = performance.now();
    cancelAnimationFrame(ST.raf);
    ST.raf = requestAnimationFrame(storyTick);
    pushOverlay(closeStoriesUI);
  }

  function showStory() {
    const s = data.stories[ST.i];
    markSeen(s);
    $('.stories__bars', storiesEl).innerHTML = s.slides.map(() => '<i><b></b></i>').join('');
    $('.stories__avatar', storiesEl).src = sized(safeUrl(data.avatar), 200);
    $('.stories__title', storiesEl).textContent = s.title;
    showSlide();
  }

  function showSlide() {
    const s = data.stories[ST.i];
    const slide = s.slides[ST.k];
    ST.t = 0;
    const src = safeUrl(slide.photo);
    if (storyImg.getAttribute('src') !== src) {
      // Show the (already cached) cover underneath while the full photo loads
      storyStage.style.backgroundImage = `url("${sized(safeUrl(ST.k === 0 ? s.cover : s.slides[ST.k - 1].photo), 300)}")`;
      storyImg.classList.add('is-loading');
      storyImg.onload = () => storyImg.classList.remove('is-loading');
      storyImg.src = src;
    }
    [(s.slides[ST.k + 1] || {}).photo, (data.stories[ST.i + 1] || {}).cover].forEach(u => { if (u) new Image().src = safeUrl(u); });
    $$('.stories__bars b', storiesEl).forEach((b, j) => { b.style.transform = `scaleX(${j < ST.k ? 1 : 0})`; });
    $('.stories__count', storiesEl).textContent = s.slides.length > 1 ? `${ST.k + 1}/${s.slides.length}` : '';

    // Caption on a dark gradient + "Book this look" on the last slide of each story
    const last = ST.k === s.slides.length - 1;
    const foot = $('.stories__foot', storiesEl);
    foot.innerHTML = `
      ${slide.caption ? `<p class="stories__caption">${esc(slide.caption)}</p>` : ''}
      ${last ? `<button class="stories__cta" data-story-book>Book this look ${I.arrowR}</button>` : ''}`;
    foot.classList.toggle('is-empty', !slide.caption && !last);
    springIn($$('.stories__foot > *', storiesEl), { y: 14, stagger: 0.06, duration: 0.6 });
  }

  /* Close the viewer, then open the booking sheet */
  function bookFromStory() {
    ST.after = () => openBooking({});
    popOverlay();
  }

  /* The progress bar is a timer, so it fills at a constant rate (like Instagram) */
  function storyTick(now) {
    if (!ST.open) return;
    const dt = Math.min(100, now - ST.last);
    ST.last = now;
    if (!ST.paused && storyImg.complete) ST.t += dt;
    const bar = $$('.stories__bars b', storiesEl)[ST.k];
    if (bar) bar.style.transform = `scaleX(${clamp(ST.t / STORY_MS, 0, 1)})`;
    if (ST.t >= STORY_MS) storyNext();
    ST.raf = requestAnimationFrame(storyTick);
  }

  function switchStory(dir) {
    showStory();
    const g = G();
    if (g) ensure(g.fromTo(storyStage, { xPercent: dir * 30, opacity: 0.4, scale: 0.94 }, { xPercent: 0, opacity: 1, scale: 1, duration: 0.6, ease: SPRING, clearProps: 'transform,opacity' }));
  }

  function storyNext() {
    const s = data.stories[ST.i];
    if (ST.k < s.slides.length - 1) { ST.k++; showSlide(); }
    else if (ST.i < data.stories.length - 1) { ST.i++; ST.k = 0; switchStory(1); }
    else { ST.t = 0; popOverlay(); }
  }

  function storyPrev() {
    if (ST.k > 0) { ST.k--; showSlide(); }
    else if (ST.i > 0) { ST.i--; ST.k = 0; switchStory(-1); }
    else { ST.t = 0; }
  }

  function closeStoriesUI() {
    ST.open = false;
    cancelAnimationFrame(ST.raf);
    app.classList.remove('is-dark-overlay');
    const g = G();
    const finish = () => {
      storiesEl.hidden = true;
      storyStage.style.transform = '';
      storiesEl.style.opacity = '';
      if (g) g.set([storiesEl, storyStage], { clearProps: 'all' });
    };
    if (g) {
      g.killTweensOf([storiesEl, storyStage]);
      ensure(g.to(storyStage, { y: '+=120', scale: 0.85, borderRadius: 40, duration: 0.35, ease: 'power2.in' }));
      ensure(g.to(storiesEl, { opacity: 0, duration: 0.35, ease: 'power2.in', onComplete: finish }));
    } else finish();
    $$('.story', views.home).forEach(el => {
      const s = data.stories[+el.dataset.story];
      el.classList.toggle('is-seen', !!s && storySeen(s));
    });
    if (ST.after) {
      const next = ST.after;
      ST.after = null;
      setTimeout(next, 120);
    }
  }

  function bindStories() {
    storiesEl = $('#stories');
    storyStage = $('.stories__stage', storiesEl);
    storyImg = $('.stories__img', storiesEl);
    let holdTimer = 0;

    storiesEl.addEventListener('pointerdown', e => {
      if (e.target.closest('.stories__close, .stories__cta')) return;
      ST.down = { x: e.clientX, y: e.clientY, t: performance.now(), drag: false };
      ST.held = false;
      storiesEl.setPointerCapture(e.pointerId);
      holdTimer = setTimeout(() => { ST.paused = true; ST.held = true; storiesEl.classList.add('is-paused'); }, 220);
    });
    storiesEl.addEventListener('pointermove', e => {
      if (!ST.down) return;
      const dy = e.clientY - ST.down.y;
      if (!ST.down.drag && dy > 12 && Math.abs(dy) > Math.abs(e.clientX - ST.down.x)) {
        ST.down.drag = true;
        clearTimeout(holdTimer);
        ST.paused = true;
      }
      if (ST.down.drag) {
        const d = Math.max(0, dy);
        storyStage.style.transform = `translate3d(0,${d}px,0) scale(${1 - Math.min(d / 1400, 0.2)})`;
        storyStage.style.borderRadius = Math.min(d / 3, 40) + 'px';
      }
    });
    const end = e => {
      if (!ST.down) return;
      clearTimeout(holdTimer);
      const down = ST.down;
      ST.down = null;
      if (down.drag) {
        const dy = e.clientY - down.y;
        const v = dy / Math.max(1, performance.now() - down.t);
        if (dy > 110 || v > 0.6) { popOverlay(); return; }
        const g = G();
        if (g) ensure(g.to(storyStage, { y: 0, scale: 1, borderRadius: 0, duration: 0.6, ease: SPRING, onComplete: () => g.set(storyStage, { clearProps: 'transform,borderRadius' }) }));
        else { storyStage.style.transform = ''; storyStage.style.borderRadius = ''; }
        ST.paused = false;
        return;
      }
      if (ST.held) {
        ST.paused = false;
        ST.held = false;
        storiesEl.classList.remove('is-paused');
        return;
      }
      const w = storiesEl.clientWidth;
      const x = e.clientX - storiesEl.getBoundingClientRect().left;
      if (x < w * 0.3) storyPrev(); else storyNext();
    };
    storiesEl.addEventListener('pointerup', end);
    storiesEl.addEventListener('pointercancel', end);
    $('.stories__close', storiesEl).addEventListener('click', popOverlay);
    storiesEl.addEventListener('click', e => { if (e.target.closest('[data-story-book]')) bookFromStory(); });
    document.addEventListener('keydown', e => {
      if (storiesEl.hidden || !ST.open) return;
      if (e.key === 'Escape') popOverlay();
      if (e.key === 'ArrowRight') storyNext();
      if (e.key === 'ArrowLeft') storyPrev();
    });
  }

  /* ---------------------------------------------------------
     11. Ask — chat assistant (iMessage style)
     --------------------------------------------------------- */
  const STOP = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'with', 'my', 'your', 'you', 'i', 'is', 'are', 'do', 'does', 'it', 'me', 'we', 'can', 'what', 'how', 'set', 'full']);

  function stem(w) {
    if (w.length > 4 && /(sh|ch|x|ss)es$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && /s$/.test(w) && !/ss$/.test(w)) return w.slice(0, -1);
    return w;
  }
  function firstSentence(t) {
    const m = String(t || '').match(/^[\s\S]*?[.!?](?=\s|$)/);
    return m ? m[0] : String(t || '');
  }
  /* First n sentences, capped so answers stay 2–3 lines */
  function shortText(t, n, max) {
    const parts = String(t || '').match(/[^.!?]+[.!?]+(\s|$)/g) || [String(t || '')];
    let out = parts.slice(0, n || 2).join('').trim();
    if (out.length > (max || 170)) out = out.slice(0, (max || 170) - 1).replace(/\s+\S*$/, '') + '…';
    return out;
  }
  function tokens(s) {
    return String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9$]+/g, ' ').trim().split(/\s+/).filter(Boolean).map(stem);
  }

  const SUGGEST = {
    start: ['How much is a full set?', 'Do you take deposits?', 'Aftercare tips', 'When are you free?'],
    service: ['When are you free?', 'Do you take deposits?', 'How long do lashes last?'],
    day: ['Are you open tomorrow?', 'What about the weekend?', 'Where are you located?'],
    hours: ['Are you open Saturday?', 'When are you free?', 'Where are you located?'],
    slots: ['Are you open Saturday?', 'How much is a full set?', 'Do you take deposits?'],
    aftercare: ['Can I shower?', 'Can I wear mascara?', 'How long do lashes last?'],
    policy: ['What is your cancellation policy?', 'How can I pay?', 'When are you free?'],
    review: ['How much is a full set?', 'When are you free?', 'Where are you located?'],
    faq: ['How much is a full set?', 'When are you free?', 'Aftercare tips'],
    contact: ['When are you free?', 'How much is a full set?', 'Do you take deposits?'],
    fallback: ['How much is a full set?', 'When are you free?', 'Aftercare tips']
  };

  const slotLabel = (off, min) => `${off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : DAY_SHORT[studioDate(off).dow]} ${fmtClock(min)}`;

  /* Openings over the next week, as bookable chips */
  function nextSlots(max) {
    const out = [];
    for (let off = 0; off < 7 && out.length < max; off++) {
      openingsFor(off, null).forEach(min => { if (out.length < max) out.push({ off, min }); });
    }
    return out;
  }

  /* Everything we know about one day, for day-specific answers */
  function dayInfo(off) {
    const d = studioDate(off);
    return { off, dow: d.dow, r: parseRange(data.hours[DAY_KEYS[d.dow]]), slots: openingsFor(off, null) };
  }

  /* "saturday", "sat", "today", "tomorrow", "weekend" → day offsets */
  function daysAsked(q) {
    const has = w => q.includes(' ' + w + ' ');
    if (has('weekend')) return [6, 0].map(dow => (dow - studioNow().day + 7) % 7);
    if (has('today') || has('tonight')) return [0];
    if (has('tomorrow') || has('tmrw')) return [1];
    const names = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    for (let dow = 0; dow < 7; dow++) {
      const short = names[dow].slice(0, 3);
      if (has(stem(names[dow])) || has(names[dow]) || (short !== 'sat' && short !== 'sun' ? has(short) : false)) {
        return [(dow - studioNow().day + 7) % 7];
      }
    }
    return null;
  }

  /**
   * getAnswer(question) → { text, action, card, suggest }
   *   text:    short reply (2–3 lines max)
   *   action:  'book' | 'instagram' | 'course' | null   (a button under the reply)
   *   card:    optional rich card — { type: 'service' | 'services' | 'day' | 'week' |
   *            'slots' | 'steps' | 'review', ... }
   *   suggest: quick-reply chips to show next
   *
   * Rule-based for now: searches FAQ keywords, services, policies, aftercare,
   * hours, slots and reviews from the master's JSON. To plug in a real AI
   * later, replace the body of this function — it may also return a Promise.
   */
  function getAnswer(question) {
    const qt = tokens(question);
    const q = ' ' + qt.join(' ') + ' ';
    const has = (...terms) => terms.some(t => {
      const n = tokens(t).join(' ');
      return n && q.includes(' ' + n + ' ');
    });
    const name = firstName();
    const candidates = [];
    const add = (score, make) => { if (score > 0) candidates.push({ score, make }); };

    if (!qt.length) return { text: 'Ask me anything about prices, availability, deposits or aftercare 💕', suggest: SUGGEST.start };

    // FAQ — curated keywords win most ties
    data.faq.forEach(f => {
      const score = (f.keywords || []).filter(k => has(k)).reduce((s, k) => s + 3 + tokens(k).length, 0);
      add(score, () => ({ text: shortText(f.a, 2), suggest: SUGGEST.faq }));
    });

    // Services & prices
    const priceIntent = has('how much', 'price', 'pricing', 'cost', 'rate', 'charge', 'menu', '$', 'expensive', 'cheap');
    const durIntent = has('how long', 'duration', 'take', 'minutes', 'time does');
    const scored = data.services.map(s => {
      // "Lash" in "Lash Lift" is the category, not what makes the service unique
      const catWords = new Set(tokens(s.category));
      const words = tokens(s.title).filter(w => !STOP.has(w) && !catWords.has(w));
      let score = words.filter(w => has(w)).length * 2;
      if (/full set/i.test(s.title) && has('full set')) score += 3;
      if (s.category && has(s.category)) score += 1;
      return { s, score };
    });
    const best = Math.max(0, ...scored.map(x => x.score));
    const matched = best > 0 ? scored.filter(x => x.score === best).map(x => x.s) : [];
    const svcScore = (priceIntent ? 3 : 0) + (durIntent && best >= 2 ? 3 : 0) + best;
    add(svcScore, () => {
      const list = matched.length ? matched : data.services.slice(0, 4);
      if (list.length === 1) {
        const s = list[0];
        const text = durIntent && !priceIntent ? `${s.title} takes about ${s.duration} ⏱` : `${s.title} is ${price(s.price)} ✨`;
        return { text, card: { type: 'service', id: s.id }, suggest: SUGGEST.service };
      }
      const lead = matched.length && list.every(s => /full set/i.test(s.title)) ? 'Our full sets 💕'
        : matched.length ? `Here are our ${list[0].category.toLowerCase()} ✨` : 'Here are the favorites ✨';
      return { text: lead, card: { type: 'services', ids: list.slice(0, 4).map(s => s.id) }, action: 'book', suggest: SUGGEST.service };
    });

    // A specific day: only that day's hours + its openings
    const days = daysAsked(q);
    const dayIntent = has('open', 'close', 'closed', 'hour', 'free', 'available', 'availability', 'slot', 'opening', 'come', 'book', 'appointment', 'work', 'working', 'about') || qt.length <= 2;
    add(days && !priceIntent ? (dayIntent ? 9 : 3.5) : 0, () => {
      const info = days.map(dayInfo);
      const plural = i => DAY_NAMES[i.dow] + 's';
      const now = studioNow();
      let text;
      if (info.length > 1) { // weekend
        text = info.map(i => (i.r ? `${plural(i)} ${fmtRange(i.r)}` : `${plural(i)} we rest`)).join(', ') + ' 💕';
      } else {
        const i = info[0];
        if (!i.r) {
          text = `Sorry, we're closed ${i.off === 0 ? 'today' : i.off === 1 ? 'tomorrow' : 'on ' + plural(i)} 🙏`;
        } else if (i.off === 0) {
          text = now.minutes >= i.r.close ? `We're done for today 🙏 ${openStatus().text}.`
            : now.minutes < i.r.open ? `Yes! Today ${fmtRange(i.r)} 💕` : `Yes! Open today until ${fmtTime(i.r.close)} 💕`;
        } else if (i.off === 1) {
          text = `Yes! Tomorrow ${fmtRange(i.r)} 💕`;
        } else {
          text = `Yes! ${plural(i)} ${fmtRange(i.r)} 💕`;
        }
      }
      // show the asked day(s); if nothing's open there, the next day that is
      let show = info.filter(i => i.r);
      if (!show.some(i => i.slots.length)) {
        for (let off = info[info.length - 1].off + 1; off < info[0].off + 8; off++) {
          const n = dayInfo(off);
          if (n.slots.length) { show = [n]; break; }
        }
      }
      return { text, card: show.length ? { type: 'day', days: show.map(i => i.off) } : null, action: show.length ? null : 'book', suggest: SUGGEST.day };
    });

    // Availability & booking (no specific day)
    const availability = has('free', 'available', 'availability', 'opening', 'next', 'slot', 'soonest', 'when can', 'when are you', 'this week', 'squeeze', 'earliest');
    const booking = has('book', 'booking', 'appointment', 'schedule', 'reserve', 'spot');
    add(availability ? 5 : booking ? 4 : 0, () => {
      const slots = nextSlots(6);
      return {
        text: slots.length ? `Next opening: ${slotLabel(slots[0].off, slots[0].min)} ✨ Tap a time to grab it.` : 'Booking takes less than a minute 💕',
        card: slots.length ? { type: 'slots' } : null,
        action: slots.length ? null : 'book',
        suggest: SUGGEST.slots
      };
    });

    // Hours (general)
    add(has('hour', 'open', 'close', 'closed', 'weekday') ? 6 : 0, () => ({
      text: `${openStatus().text} 🕐`,
      card: { type: 'week' },
      suggest: SUGGEST.hours
    }));

    // Policies
    const POLICY_SYNONYMS = [
      [/deposit/i, ['deposit', 'down payment', 'prepay', 'upfront', 'non refundable']],
      [/late/i, ['late', 'running late', 'traffic', 'grace period']],
      [/cancel/i, ['cancel', 'cancellation', 'reschedule', 'no show', 'refund']],
      [/fill/i, ['fill policy', '40%', 'another artist']]
    ];
    data.policies.forEach(p => {
      const words = tokens(p.title).filter(w => !STOP.has(w));
      let score = words.filter(w => has(w)).length * 4;
      POLICY_SYNONYMS.forEach(([re, syn]) => { if (re.test(p.title) && has(...syn)) score += 3; });
      add(score, () => ({
        text: shortText(p.text, 2, 150) + ' 💕',
        action: /deposit|cancel/i.test(p.title) ? 'book' : null,
        suggest: SUGGEST.policy
      }));
    });
    add(has('policy', 'policies', 'rules') && data.policies.length ? 5 : 0, () => ({
      text: data.policies.slice(0, 3).map(p => `• ${p.title}: ${shortText(p.text, 1, 70)}`).join('\n'),
      suggest: SUGGEST.policy
    }));

    // Aftercare
    const careStrong = has('aftercare', 'after care', 'care tips', 'take care', 'tips');
    const careWeak = has('care', 'wash', 'clean', 'cleanse', 'wet', 'water', 'sleep', 'brush', 'oil', 'rub', 'maintain', 'maintenance');
    add(data.aftercare.length && (careStrong ? 8 : careWeak ? 4 : 0), () => ({
      text: 'Aftercare in a nutshell ✨',
      card: { type: 'steps' },
      suggest: SUGGEST.aftercare
    }));

    // Reviews
    add(data.reviews.length && has('review', 'reviews', 'rating', 'recommend', 'worth it', 'feedback', 'clients say', 'people say', 'any good', 'legit', 'testimonial') ? 6 : 0, () => ({
      text: `Clients love ${name} 💕`,
      card: { type: 'review' },
      suggest: SUGGEST.review
    }));

    // Course
    const x = data.extras;
    add(x && x.courseTitle && has('course', 'class', 'training', 'learn', 'teach', 'student', 'certification', 'certified') ? 5 : 0, () => ({
      text: `${x.courseTitle} 🎓\n${shortText(x.courseText, 1, 120)}`.trim(),
      action: x.courseUrl ? 'course' : null,
      suggest: SUGGEST.faq
    }));

    // Location & contact
    add(data.city && has('where', 'located', 'location', 'address', 'city', 'area') ? 3 : 0, () => ({
      text: data.address ? `Here's how to find us 📍` : `We're in ${data.city} 📍 The exact address comes with your booking confirmation.`,
      action: 'book',
      suggest: SUGGEST.contact
    }));
    add(has('phone', 'call', 'text', 'number', 'contact', 'instagram', 'ig', 'dm', 'reach') ? 3 : 0, () => ({
      text: `You can reach ${name} ${data.phone ? `at ${data.phone}` : ''}${data.phone && data.instagram ? ' or ' : ''}${data.instagram ? `on Instagram @${data.instagram}` : ''} 💕`,
      action: data.instagram ? 'instagram' : null,
      suggest: SUGGEST.contact
    }));

    // Small talk
    add(has('hi', 'hello', 'hey', 'hola', 'good morning', 'good afternoon', 'good evening') ? 1 : 0, () => ({
      text: 'Hi there! 👋 Ask me about prices, availability, deposits or aftercare.', suggest: SUGGEST.start
    }));
    add(has('thank', 'thx', 'ty', 'appreciate', 'perfect', 'awesome', 'great') ? 1.5 : 0, () => ({
      text: "You're so welcome! 💕 Anything else I can help with?", suggest: SUGGEST.fallback
    }));

    candidates.sort((a, b) => b.score - a.score);
    if (!candidates.length) {
      return {
        text: `Great question! ${name} will reply personally 💕`,
        action: data.instagram ? 'instagram' : null,
        suggest: SUGGEST.fallback
      };
    }
    const answer = candidates[0].make();
    if (!answer.card && data.address && has('where', 'located', 'location', 'address', 'parking', 'park', 'directions', 'map', 'find you', 'get there')) {
      answer.card = { type: 'map' };
      if (answer.action === 'book') answer.action = null;
    }
    if (!answer.action && !answer.card && (priceIntent || booking)) answer.action = 'book';
    return answer;
  }

  const ACTIONS = {
    book: () => ({ label: 'Book now', book: true }),
    instagram: () => ({ label: 'Message on Instagram', url: igDmUrl(), soft: true, icon: I.ig }),
    course: () => ({ label: 'Learn more', url: safeUrl(data.extras && data.extras.courseUrl), soft: true })
  };

  /* ---------- rendering ---------- */
  const chatEl = () => $('#chat');

  function scrollChat(smooth) {
    const c = chatEl();
    if (c) requestAnimationFrame(() => c.scrollTo({ top: c.scrollHeight, behavior: smooth && !reducedMQ.matches ? 'smooth' : 'auto' }));
  }

  function bubble(who, text) {
    const el = document.createElement('div');
    el.className = 'msg msg--' + who;
    el.textContent = text;
    chatEl().appendChild(el);
    return el;
  }

  /* iMessage grouping: consecutive bubbles from the same side share
     straighter inner corners; only the last one gets the tail */
  function regroup() {
    const kids = Array.from(chatEl().children);
    const side = el => (el && el.classList.contains('msg') ? (el.classList.contains('msg--me') ? 'me' : 'bot') : null);
    kids.forEach((el, i) => {
      const s = side(el);
      if (!s) return;
      const prev = side(kids[i - 1]) === s;
      const next = side(kids[i + 1]) === s;
      el.classList.remove('g-single', 'g-first', 'g-mid', 'g-last');
      el.classList.add(prev && next ? 'g-mid' : prev ? 'g-last' : next ? 'g-first' : 'g-single');
    });
  }

  /* New messages spring up from below, from their own side */
  function popMessages(nodes) {
    const g = G();
    nodes = nodes.filter(Boolean);
    if (!g || !nodes.length) return;
    nodes.forEach(n => { n.style.transformOrigin = n.classList.contains('msg--me') ? '100% 100%' : '0% 100%'; });
    ensure(g.fromTo(nodes, { opacity: 0, y: 26, scale: 0.9 },
      { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.6)', stagger: 0.09, clearProps: 'opacity,transform' }));
  }

  function chatCard(card) {
    const el = document.createElement('div');
    el.className = 'chat-card';
    const svcRow = s => `
      <button class="cc-row" data-open-service="${esc(s.id)}">
        <img class="cc-photo" src="${esc(sized(safeUrl(s.photo), 200))}" alt="">
        <span class="cc-row__text"><b>${esc(s.title)}</b><small>${esc(s.duration || '')}</small></span>
        <span class="cc-price">${esc(price(s.price))}</span>
      </button>`;
    const chips = list => `<div class="cc-slots">${list.map(x => `<button class="cc-slot" data-book data-slot="${esc(slotLabel(x.off, x.min))}">${esc(x.off > 1 ? slotLabel(x.off, x.min) : fmtClock(x.min))}</button>`).join('')}</div>`;

    if (card.type === 'service') {
      const s = data.services.find(x => x.id === card.id);
      el.classList.add('chat-card--svc');
      el.innerHTML = `
        <div class="cc-svc" data-open-service="${esc(s.id)}">
          <img class="cc-photo cc-photo--lg" src="${esc(sized(safeUrl(s.photo), 500))}" alt="">
          <div class="cc-svc__body">
            <span class="svc2__cat">${esc(s.category)}</span>
            <b>${esc(s.title)}</b>
            <span class="cc-meta">${I.clock}${esc(s.duration || '')}</span>
          </div>
        </div>
        <div class="cc-foot">
          <span class="cc-price cc-price--lg">${esc(price(s.price))}</span>
          <button class="btn btn--primary btn--sm" data-book data-book-service="${esc(s.id)}">Book</button>
        </div>`;
    } else if (card.type === 'services') {
      el.innerHTML = card.ids.map(id => svcRow(data.services.find(s => s.id === id))).join('');
    } else if (card.type === 'day') {
      el.classList.add('chat-card--hours');
      el.innerHTML = card.days.map(off => {
        const i = dayInfo(off);
        return `
          <div class="cc-day">
            <div class="cc-day__head"><b>${esc(dayLabel(off, true))}</b><span>${esc(fmtRange(i.r))}</span></div>
            ${i.slots.length ? chips(i.slots.slice(0, 6).map(min => ({ off, min })))
              : `<p class="cc-empty">${i.r ? 'Fully booked — try another day 💕' : 'Closed'}</p>`}
          </div>`;
      }).join('');
    } else if (card.type === 'week') {
      const s = openStatus();
      const today = studioNow().day;
      el.classList.add('chat-card--hours');
      el.innerHTML = `
        <div class="cc-day__head"><span class="live${s.open ? '' : ' is-off'}"><i></i>${s.open ? 'OPEN NOW' : 'CLOSED NOW'}</span></div>
        <div class="cc-week">
          ${[1, 2, 3, 4, 5, 6, 0].map(d => `<span class="${d === today ? 'is-today' : ''}"><b>${DAY_SHORT[d]}</b>${esc(fmtRange(parseRange(data.hours[DAY_KEYS[d]])))}</span>`).join('')}
        </div>
        ${nextSlots(4).length ? `<div class="cc-label">Next openings</div>${chips(nextSlots(4))}` : ''}`;
    } else if (card.type === 'slots') {
      el.classList.add('chat-card--hours');
      el.innerHTML = `<div class="cc-label">Next openings</div>${chips(nextSlots(6))}`;
    } else if (card.type === 'steps') {
      el.innerHTML = `
        <ol class="cc-steps">
          ${data.aftercare.slice(0, 5).map((s, i) => `<li><span class="cc-num">${i + 1}</span><span><b>${esc(s.step)}</b><small>${esc(shortText(s.text, 1, 80))}</small></span></li>`).join('')}
        </ol>`;
    } else if (card.type === 'map') {
      el.classList.add('chat-card--place');
      el.innerHTML = placeHTML();
    } else if (card.type === 'review') {
      const r = data.reviews.slice().sort((a, b) => (+b.rating || 5) - (+a.rating || 5))[0];
      el.classList.add('chat-card--review');
      el.innerHTML = `
        <div class="cc-rating"><span class="cc-rating__big">${ratingText() || '5.0'}</span><span>${stars(data.rating || 5)}<small>from ${esc(data.reviewCount || data.reviews.length)} reviews</small></span></div>
        <p class="cc-quote">“${esc(shortText(r.text, 2, 140))}”</p>
        <div class="review__who"><span class="review__initial">${esc(String(r.name || '?').charAt(0))}</span><span><b>${esc(r.name)}</b>${r.service ? `<small>${esc(r.service)}</small>` : ''}</span></div>`;
    }
    chatEl().appendChild(el);
    return el;
  }

  function actionButton(action) {
    const a = action && ACTIONS[action] && ACTIONS[action]();
    if (!a) return null;
    const btn = document.createElement(a.book ? 'button' : 'a');
    btn.className = a.book ? 'btn btn--primary btn--sm msg-book' : 'msg-action' + (a.soft ? ' msg-action--soft' : '');
    if (a.book) btn.setAttribute('data-book', '');
    else { btn.href = a.url; btn.target = '_blank'; btn.rel = 'noopener'; }
    btn.innerHTML = (a.icon || '') + '<span></span>' + (a.soft ? '' : I.arrowR);
    btn.querySelector('span').textContent = a.label;
    chatEl().appendChild(btn);
    return btn;
  }

  /* Quick replies follow the conversation */
  function setSuggestions(list, asked) {
    const box = $('#suggest');
    if (!box) return;
    const used = String(asked || '').trim().toLowerCase();
    const items = (list || SUGGEST.start).filter(t => t.toLowerCase() !== used).slice(0, 4);
    box.innerHTML = items.map(t => `<button class="chip" data-ask="${esc(t)}">${esc(t)}</button>`).join('');
    box.scrollLeft = 0;
    springIn($$('.chip', box), { y: 12, stagger: 0.05, duration: 0.55, scale: 0.9 });
  }

  /* The send button springs in only when there's something to send */
  function setComposer(hasText) {
    const form = $('#composer');
    if (!form || form.classList.contains('has-text') === hasText) return;
    form.classList.toggle('has-text', hasText);
    $('.send', form).disabled = !hasText;
  }

  /* Typing time grows with the answer: 0.6–1.4s */
  const typingMs = a => clamp(600 + String(a.text || '').length * 7 + (a.card ? 300 : 0), 600, 1400);

  let chatBusy = false;
  async function ask(question) {
    question = String(question || '').trim();
    if (!question || chatBusy) return;
    chatBusy = true;
    regroup();
    popMessages([bubble('me', question)]);
    regroup();
    scrollChat(true);

    await wait(220);
    const typing = document.createElement('div');
    typing.className = 'msg msg--bot typing';
    typing.setAttribute('aria-label', 'Typing');
    typing.innerHTML = '<i></i><i></i><i></i>';
    chatEl().appendChild(typing);
    regroup();
    popMessages([typing]);
    scrollChat(true);

    const t0 = performance.now();
    let answer;
    try { answer = await Promise.resolve(getAnswer(question)); } catch (e) { answer = null; }
    if (!answer || typeof answer !== 'object') {
      answer = { text: `Great question! ${firstName()} will reply personally 💕`, action: data.instagram ? 'instagram' : null };
    }
    const left = typingMs(answer) - (performance.now() - t0);
    if (left > 0) await wait(left);
    typing.remove();

    const nodes = [];
    if (answer.text) nodes.push(bubble('bot', answer.text));
    if (answer.card) nodes.push(chatCard(answer.card));
    if (answer.action) nodes.push(actionButton(answer.action));
    regroup();
    popMessages(nodes);
    scrollChat(true);
    setSuggestions(answer.suggest, question);
    chatBusy = false;
  }

  /* ---------------------------------------------------------
     Look viewer — the photo opens from its card (shared element),
     swipe ← → for the next look, ↓ to close, pinch / double-tap to zoom.
     A details panel below: service, price, a review, before/after,
     "Book this look" and "Share".
     --------------------------------------------------------- */
  const lv = { list: [], i: 0, tileFor: null, hidden: null, busy: false, after: null, off: 0, collapsed: 0, cardH: 0, expanded: false };
  const zoom = { s: 1, x: 0, y: 0 };
  let lvEl = null;

  const lvSlides = () => $$('.lv__slide', lvEl);
  const lvZoomEl = i => $('.lv__zoom', lvSlides()[i == null ? lv.i : i]);
  const lvImg = i => $('img', lvSlides()[i == null ? lv.i : i]);
  const curLook = () => lv.list[lv.i];

  function buildViewer() {
    if (lvEl) return;
    lvEl = document.createElement('div');
    lvEl.className = 'lv';
    lvEl.hidden = true;
    lvEl.setAttribute('role', 'dialog');
    lvEl.setAttribute('aria-label', 'Look');
    lvEl.innerHTML = `
      <div class="lv__bg"></div>
      <div class="lv__stage"><div class="lv__track"></div></div>
      <div class="lv__top">
        <span class="lv__count num"></span>
        <button class="lv__close" data-lv-close aria-label="Close">${I.x}</button>
      </div>
      <section class="lv__panel" aria-label="Look details">
        <div class="lv__card">
          <div class="lv__grab" aria-hidden="true"><i></i></div>
          <div class="lv__content"></div>
        </div>
      </section>`;
    app.appendChild(lvEl);
    bindViewer();
  }

  function lookPanelHTML(l) {
    const s = lookSvc(l);
    const r = s && data.reviews.find(x => x.service === s.title);
    const extra = r || l.before;
    return `
      <header class="lv__head">
        <div class="lv__titles">
          <span class="svc2__cat">${esc(l.tag || (s && s.category) || '')}</span>
          <h2>${esc(l.title)}</h2>
          ${s ? `<p class="lv__meta">${esc(s.title)}${s.duration ? ` · ${I.clock}<span class="num">${esc(s.duration)}</span>` : ''}</p>` : ''}
        </div>
        <div class="lv__side">
          ${s ? `<span class="lv__price num">${esc(price(s.price))}</span>` : ''}
          ${favButton('look:' + l.id, 'fav--panel')}
        </div>
      </header>
      <div class="lv__body" data-lv-scroll>
        ${r ? `
        <figure class="lv__review">
          ${stars(+r.rating || 5)}
          <blockquote>“${esc(shortText(r.text, 2, 150))}”</blockquote>
          <figcaption><span class="review__initial">${esc(String(r.name || '?').charAt(0))}</span>${esc(r.name)}${r.service ? ` · ${esc(r.service)}` : ''}</figcaption>
        </figure>` : ''}
        ${l.before ? `<div class="lv__label">Before / After</div>${baHTML(l.before, l.photo)}` : ''}
        ${!extra && s && s.description ? `<p class="lv__desc">${esc(firstSentence(s.description))}</p>` : ''}
      </div>
      <footer class="lv__foot">
        <button class="btn btn--primary lv__book" data-lv-book>Book this look ${I.arrowR}</button>
        <button class="btn btn--soft lv__share" data-lv-share aria-label="Share this look">${I.share}<span>Share</span></button>
      </footer>`;
  }

  /* ---------- panel: collapsed (peek) ⇄ expanded ---------- */
  function setPanel(off, ms) {
    lv.off = off;
    const card = $('.lv__card', lvEl);
    const foot = $('.lv__foot', lvEl);
    const tr = ms ? `transform ${ms}ms cubic-bezier(.32,.72,0,1)` : 'none';
    card.style.transition = tr;
    card.style.transform = `translate3d(0,${off.toFixed(1)}px,0)`;
    // the footer (Book / Share) stays glued to the bottom edge
    if (foot) {
      foot.style.transition = tr;
      foot.style.transform = `translate3d(0,${(-clamp(off, 0, lv.collapsed)).toFixed(1)}px,0)`;
    }
    // the body fades in as the panel opens (it sits behind the footer when collapsed)
    const body = $('.lv__body', lvEl);
    if (body) {
      body.style.transition = ms ? `opacity ${ms}ms ease` : 'none';
      body.style.opacity = lv.collapsed ? clamp(1 - off / lv.collapsed, 0, 1).toFixed(3) : '1';
    }
    lv.expanded = off < 2 && lv.collapsed > 2;
    lvEl.classList.toggle('is-expanded', lv.expanded);
  }

  function measurePanel() {
    const card = $('.lv__card', lvEl);
    const grab = $('.lv__grab', lvEl);
    const head = $('.lv__head', lvEl);
    const body = $('.lv__body', lvEl);
    const foot = $('.lv__foot', lvEl);
    const H = lvEl.clientHeight;
    const peek = grab.offsetHeight + head.offsetHeight + foot.offsetHeight;
    const full = peek + (body.scrollHeight || 0);
    lv.cardH = Math.round(Math.min(H * 0.82, full));
    card.style.height = lv.cardH + 'px';
    lv.collapsed = Math.max(0, lv.cardH - peek);
    lvEl.style.setProperty('--lv-peek', peek + 'px');
    setPanel(lv.collapsed, 0);
  }

  function renderLookPanel(animate) {
    const content = $('.lv__content', lvEl);
    content.innerHTML = lookPanelHTML(curLook());
    const ba = $('.ba', content);
    if (ba) bindBeforeAfter(ba);
    measurePanel();
    if (animate) springIn($$('.lv__head > *, .lv__foot > *', content), { y: 10, stagger: 0.04, duration: 0.5 });
  }

  function expandPanel(on) {
    if (!lv.collapsed) return;
    setPanel(on ? 0 : lv.collapsed, 450);
    if (on) {
      const ba = $('.lv__body .ba', lvEl);
      if (ba && !ba.dataset.hinted) { ba.dataset.hinted = '1'; hintBeforeAfter(ba); }
    }
  }

  /* ---------- photos ---------- */
  function lvLoad(i) {
    [i - 1, i, i + 1].forEach(k => {
      const img = lvImg(k >= 0 && k < lv.list.length ? k : -1);
      if (img && !img.getAttribute('src')) img.src = img.dataset.src;
    });
  }

  function lvRender(animate) {
    const track = $('.lv__track', lvEl);
    track.style.transition = animate ? 'transform .55s var(--spring)' : 'none';
    track.style.transform = `translate3d(${-lv.i * 100}%,0,0)`;
    $('.lv__count', lvEl).textContent = `${lv.i + 1} / ${lv.list.length}`;
    lvLoad(lv.i);
  }

  function setZoom(s, x, y, animate) {
    const el = lvZoomEl();
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    zoom.s = s;
    zoom.x = s > 1 ? clamp(x, w - w * s, 0) : 0;
    zoom.y = s > 1 ? clamp(y, h - h * s, 0) : 0;
    el.style.transition = animate ? 'transform .45s var(--ease-ios)' : 'none';
    el.style.transform = s > 1 ? `translate3d(${zoom.x}px,${zoom.y}px,0) scale(${s})` : '';
    lvEl.classList.toggle('is-zoomed', s > 1.01);
  }
  const resetZoom = animate => { if (zoom.s !== 1 || zoom.x || zoom.y) setZoom(1, 0, 0, animate); };

  /* Where the current photo sits when fully open (contain inside its box) */
  function lookTarget(ar) {
    const el = lvZoomEl();
    const r = el.getBoundingClientRect();
    let w = r.width;
    let h = w / ar;
    if (h > r.height) { h = r.height; w = h * ar; }
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
  }

  function goLook(i) {
    i = clamp(i, 0, lv.list.length - 1);
    resetZoom(false);
    if (i === lv.i) { lvRender(true); return; }
    lv.i = i;
    lvRender(true);
    renderLookPanel(true);
    haptic();
  }

  function openLook(list, i, tileFor) {
    if (!list.length || lv.busy || i < 0) return;
    buildViewer();
    lv.list = list;
    lv.i = clamp(i, 0, list.length - 1);
    lv.tileFor = tileFor;
    lv.after = null;
    zoom.s = 1; zoom.x = 0; zoom.y = 0;
    $('.lv__track', lvEl).innerHTML = list.map(l => `
      <div class="lv__slide"><div class="lv__zoom"><img data-src="${esc(sized(safeUrl(l.photo), 1200))}" alt="${esc(l.title)}" draggable="false"></div></div>`).join('');
    lvEl.hidden = false;
    lvEl.classList.remove('is-expanded', 'is-zoomed', 'is-dragging');
    lvEl.classList.add('is-open');
    app.classList.add('is-dark-overlay');
    renderLookPanel(false);
    lvRender(false);
    haptic(10);
    pushOverlay(closeLookUI);

    const g = G();
    const bg = $('.lv__bg', lvEl);
    const panel = $('.lv__panel', lvEl);
    if (g) ensure(g.fromTo(panel, { yPercent: 100 }, { yPercent: 0, duration: 0.6, delay: 0.12, ease: 'power3.out', clearProps: 'transform' }));
    const tile = tileFor && tileFor(curLook());
    // the sharp photo, never the tiny blur-up preview
    const timg = tile && (tile.tagName === 'IMG' ? tile : $('.look__img', tile) || $('img:not(.look__lqip)', tile));
    if (!g || !timg || !timg.naturalWidth) {
      bg.style.opacity = 1;
      if (g) ensure(g.fromTo(lvEl, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out', clearProps: 'opacity' }));
      return;
    }
    lv.busy = true;
    lvEl.classList.add('is-flying');
    const from = tile.getBoundingClientRect();
    const to = lookTarget(timg.naturalWidth / timg.naturalHeight);
    tile.style.visibility = 'hidden';
    lv.hidden = tile;
    ensure(g.fromTo(bg, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out' }));
    fly(to, from, timg.currentSrc || timg.src, { dir: 'in', r: radiusOf(tile), duration: 0.6, ease: 'back.out(1.1)' }).then(f => {
      const full = lvImg();
      let shown = false;
      const reveal = () => {
        if (shown) return;
        shown = true;
        lvEl.classList.remove('is-flying');
        lv.busy = false;
        setTimeout(() => f.remove(), 80);
      };
      if (full.complete && full.naturalWidth) reveal();
      else {
        full.addEventListener('load', reveal, { once: true });
        full.addEventListener('error', reveal, { once: true });
        setTimeout(reveal, 1500);
      }
    });
  }

  function closeLookUI() {
    app.classList.remove('is-dark-overlay');
    const g = G();
    const img = lvImg();
    const l = curLook();
    const tile = lv.tileFor && l ? lv.tileFor(l) : null;
    const bg = $('.lv__bg', lvEl);
    const panel = $('.lv__panel', lvEl);
    const after = lv.after;
    lv.after = null;
    const finish = () => {
      lvEl.hidden = true;
      lvEl.classList.remove('is-open', 'is-flying', 'is-dragging', 'is-zoomed', 'is-expanded');
      bg.style.opacity = '';
      $('.lv__track', lvEl).style.transform = '';
      if (lv.hidden) lv.hidden.style.visibility = '';
      if (tile) tile.style.visibility = '';
      lv.hidden = null;
      lv.busy = false;
      $$('.lb-fly').forEach(f => f.remove());
      if (window.gsap) window.gsap.set([lvEl, panel], { clearProps: 'all' });
      if (after) setTimeout(after, 60);
    };
    if (g) ensure(g.to(panel, { yPercent: 100, duration: 0.35, ease: 'power2.in' }));
    if (!g || !img || !img.naturalWidth) {
      if (g) ensure(g.to(lvEl, { opacity: 0, duration: 0.25, ease: 'power2.out', onComplete: finish }));
      else finish();
      return;
    }
    lv.busy = true;
    const from = img.getBoundingClientRect();
    const box = app.getBoundingClientRect();
    const tr = tile && tile.offsetParent ? tile.getBoundingClientRect() : null;
    const tileVisible = tr && tr.width > 0 && tr.bottom > box.top + 40 && tr.top < box.bottom - 40;
    if (lv.hidden && lv.hidden !== tile) lv.hidden.style.visibility = '';
    lvEl.classList.add('is-flying');
    ensure(g.to(bg, { opacity: 0, duration: 0.4, ease: 'power2.out' }));
    const src = img.currentSrc || img.src;
    if (tileVisible) {
      tile.style.visibility = 'hidden';
      lv.hidden = tile;
      fly(from, tr, src, { dir: 'out', r: radiusOf(tile), duration: 0.5, ease: 'power3.out' }).then(finish);
    } else {
      const k = 0.7;
      const to = { left: from.left + from.width * (1 - k) / 2, top: from.top + from.height * (1 - k) / 2, width: from.width * k, height: from.height * k };
      fly(from, to, src, { dir: 'out', r: 24, duration: 0.35, ease: 'power2.out', fade: true }).then(finish);
    }
  }

  /* Close the viewer, then open booking on the Time step with this look */
  function bookLook() {
    const l = curLook();
    if (!l) return;
    haptic(10);
    lv.after = () => openBooking({ service: l.serviceId || null, look: l.id });
    popOverlay();
  }

  /* ---------- gestures ---------- */
  function bindViewer() {
    const stage = $('.lv__stage', lvEl);
    const track = $('.lv__track', lvEl);
    const bg = $('.lv__bg', lvEl);
    const ptrs = new Map();
    let gest = null;
    let lastTap = null;

    const base = () => { // the zoom box's untransformed rect
      const el = lvZoomEl();
      const s = el.parentElement.getBoundingClientRect();
      return { left: s.left + el.offsetLeft, top: s.top + el.offsetTop, w: el.offsetWidth, h: el.offsetHeight };
    };
    const two = () => {
      const [a, b] = Array.from(ptrs.values());
      return { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    };

    stage.addEventListener('pointerdown', e => {
      if (lv.busy) return;
      stage.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2 && !lv.expanded) {
        const t = two();
        const b = base();
        gest = { type: 'pinch', d0: t.d, s0: zoom.s, x0: zoom.x, y0: zoom.y, mx: t.mx - b.left, my: t.my - b.top };
      } else if (ptrs.size === 1) {
        gest = { type: null, x: e.clientX, y: e.clientY, t: performance.now(), zx: zoom.x, zy: zoom.y, dx: 0, dy: 0 };
      }
    });

    stage.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId) || !gest) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (gest.type === 'pinch') {
        if (ptrs.size < 2) return;
        const t = two();
        const b = base();
        const s = clamp(gest.s0 * (t.d / gest.d0), 0.9, 4);
        const mx = t.mx - b.left;
        const my = t.my - b.top;
        const el = lvZoomEl();
        zoom.s = s;
        zoom.x = mx - (gest.mx - gest.x0) * (s / gest.s0);
        zoom.y = my - (gest.my - gest.y0) * (s / gest.s0);
        el.style.transition = 'none';
        el.style.transform = `translate3d(${zoom.x}px,${zoom.y}px,0) scale(${s})`;
        lvEl.classList.add('is-zoomed');
        return;
      }
      gest.dx = e.clientX - gest.x;
      gest.dy = e.clientY - gest.y;
      if (!gest.type && Math.hypot(gest.dx, gest.dy) > 8) {
        if (lv.expanded) gest.type = 'none';
        else if (zoom.s > 1.01) gest.type = 'pan';
        else gest.type = Math.abs(gest.dx) > Math.abs(gest.dy) ? 'x' : gest.dy > 0 ? 'y' : 'none';
        if (gest.type === 'x' || gest.type === 'y') lvEl.classList.add('is-dragging');
      }
      if (gest.type === 'x') {
        const edge = (lv.i === 0 && gest.dx > 0) || (lv.i === lv.list.length - 1 && gest.dx < 0);
        track.style.transition = 'none';
        track.style.transform = `translate3d(calc(${-lv.i * 100}% + ${edge ? gest.dx * 0.35 : gest.dx}px),0,0)`;
      } else if (gest.type === 'y') {
        const dy = Math.max(0, gest.dy);
        const el = lvZoomEl();
        el.style.transition = 'none';
        el.style.transform = `translate3d(0,${dy}px,0) scale(${1 - Math.min(dy / 1400, 0.25)})`;
        bg.style.transition = 'none';
        bg.style.opacity = String(1 - Math.min(dy / 420, 0.85));
        $('.lv__panel', lvEl).style.transform = `translate3d(0,${dy * 1.4}px,0)`;
      } else if (gest.type === 'pan') {
        setZoom(zoom.s, gest.zx + gest.dx, gest.zy + gest.dy, false);
      }
    });

    const end = e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (!gest) return;
      if (gest.type === 'pinch') {
        if (ptrs.size) return; // wait for the last finger
        if (zoom.s < 1.08) resetZoom(true);
        else setZoom(zoom.s, zoom.x, zoom.y, true);
        gest = null;
        return;
      }
      const g = gest;
      gest = null;
      lvEl.classList.remove('is-dragging');
      const dt = Math.max(1, performance.now() - g.t);
      if (g.type === 'x') {
        const fast = Math.abs(g.dx) / dt > 0.45;
        if ((Math.abs(g.dx) > lvEl.clientWidth * 0.18 || fast) && Math.abs(g.dx) > 20) goLook(lv.i + (g.dx < 0 ? 1 : -1));
        else lvRender(true);
      } else if (g.type === 'y') {
        if (g.dy > 110 || (g.dy > 30 && g.dy / dt > 0.5)) popOverlay(); // shrinks back into its card
        else {
          const el = lvZoomEl();
          el.style.transition = 'transform .45s var(--spring)';
          el.style.transform = '';
          bg.style.transition = 'opacity .35s var(--ease)';
          bg.style.opacity = 1;
          const panel = $('.lv__panel', lvEl);
          panel.style.transition = 'transform .45s var(--ease-ios)';
          panel.style.transform = '';
          setTimeout(() => { panel.style.transition = ''; }, 460);
        }
      } else if (!g.type && e.type === 'pointerup') {
        // a tap: collapse the panel, or two quick taps = zoom in / out
        if (lv.expanded) { expandPanel(false); return; }
        const now = performance.now();
        if (lastTap && now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 40) {
          lastTap = null;
          if (zoom.s > 1.01) resetZoom(true);
          else {
            const b = base();
            const px = e.clientX - b.left;
            const py = e.clientY - b.top;
            setZoom(2.5, px - px * 2.5, py - py * 2.5, true);
          }
          haptic();
        } else {
          lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
      }
    };
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', end);

    // desktop: the wheel zooms around the pointer
    stage.addEventListener('wheel', e => {
      if (lv.busy || lv.expanded) return;
      e.preventDefault();
      const b = base();
      const px = e.clientX - b.left;
      const py = e.clientY - b.top;
      const s = clamp(zoom.s * Math.exp(-e.deltaY * 0.0025), 1, 4);
      setZoom(s, px - (px - zoom.x) * (s / zoom.s), py - (py - zoom.y) * (s / zoom.s), false);
    }, { passive: false });

    // panel: drag the grabber / header between peek and expanded; far down closes
    const card = $('.lv__card', lvEl);
    let pd = null;
    card.addEventListener('pointerdown', e => {
      if (!e.target.closest('.lv__grab, .lv__head') || e.target.closest('button, a, .ba')) return;
      pd = { y: e.clientY, off: lv.off, t: performance.now(), moved: false };
      try { card.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
    });
    card.addEventListener('pointermove', e => {
      if (!pd) return;
      const dy = e.clientY - pd.y;
      if (Math.abs(dy) > 5) pd.moved = true;
      let off = pd.off + dy;
      if (off < 0) off *= 0.25;
      if (pd.moved) setPanel(off, 0);
    });
    const pEnd = e => {
      if (!pd) return;
      const d = pd;
      pd = null;
      if (!d.moved) { if (e.type === 'pointerup' && e.target.closest('.lv__grab, .lv__head')) expandPanel(!lv.expanded); return; }
      const v = (lv.off - d.off) / Math.max(1, performance.now() - d.t);
      if (lv.off > lv.collapsed + 90 || (v > 1 && lv.off > lv.collapsed * 0.6 + 40)) { popOverlay(); return; }
      const toExpanded = v < -0.3 || (v <= 0.3 && lv.off < lv.collapsed / 2);
      expandPanel(toExpanded);
      if (!toExpanded) setPanel(lv.collapsed, 450);
    };
    card.addEventListener('pointerup', pEnd);
    card.addEventListener('pointercancel', pEnd);

    lvEl.addEventListener('click', e => {
      if (e.target.closest('[data-lv-close]')) popOverlay();
      else if (e.target.closest('[data-lv-book]')) bookLook();
      else if (e.target.closest('[data-lv-share]')) shareLook(curLook());
    });

    document.addEventListener('keydown', e => {
      if (!lvEl || lvEl.hidden || lv.busy) return;
      if (e.key === 'Escape') popOverlay();
      if (e.key === 'ArrowRight') goLook(lv.i + 1);
      if (e.key === 'ArrowLeft') goLook(lv.i - 1);
    });
    window.addEventListener('resize', () => { if (lvEl && !lvEl.hidden) { resetZoom(false); measurePanel(); lvRender(false); } });
  }

  /* ---------- sharing & links ---------- */
  function lookLink(l) {
    const u = new URL('./', location.href);
    u.searchParams.set('m', SLUG);
    u.searchParams.set('look', l.id);
    return u.href;
  }
  async function shareLook(l) {
    if (!l) return;
    const s = lookSvc(l);
    const text = `${l.title}${s ? ` · ${s.title} ${price(s.price)}` : ''} — ${data.name}`;
    haptic();
    if (navigator.share) {
      try { await navigator.share({ title: l.title, text, url: lookLink(l) }); } catch (e) { /* cancelled */ }
      return;
    }
    try { await navigator.clipboard.writeText(lookLink(l)); toast('Link copied', 'link'); } catch (e) { toast(lookLink(l), 'link'); }
  }

  /* On the Review step: send the master all saved looks as links */
  async function shareSavedLooks() {
    const list = savedLooks();
    if (!list.length) return;
    const text = `My saved looks from ${data.name}:\n` + list.map(l => `• ${l.title} — ${lookLink(l)}`).join('\n');
    haptic();
    if (navigator.share) {
      try { await navigator.share({ title: 'My saved looks', text }); } catch (e) { /* cancelled */ }
      return;
    }
    try { await navigator.clipboard.writeText(text); toast('Looks copied — paste them in your booking notes', 'link'); } catch (e) { toast('Could not copy', 'link'); }
  }

  /* ?look=<id> — open straight onto that look (then drop it from the address) */
  function openLookFromLink() {
    const l = lookById(LOOK_PARAM);
    try {
      params.delete('look');
      const q = params.toString();
      history.replaceState(history.state, '', location.pathname + (q ? '?' + q : '') + location.hash);
    } catch (e) { /* file:// */ }
    if (!l) return;
    state.lookFilter = 'All';
    renderLookChips();
    renderLooks(false);
    go('gallery');
    setTimeout(() => openLook(data.gallery, data.gallery.indexOf(l), galleryTile), 420);
  }

  /* ---------------------------------------------------------
     Owner demo mode — stats on the Looks, a banner to get back
     --------------------------------------------------------- */
  let ownerMode = false;
  try { ownerMode = sessionStorage.getItem(KEY + ':owner') === '1'; } catch (e) { /* private mode */ }
  let ownerAfter = null;

  function setOwnerMode(on) {
    ownerMode = on;
    try { if (on) sessionStorage.setItem(KEY + ':owner', '1'); else sessionStorage.removeItem(KEY + ':owner'); } catch (e) { /* private mode */ }
    app.classList.toggle('is-owner-mode', on);
    if ($('#masonry')) { renderLooks(false); renderOwnerLooks(); }
    syncOwnerBanner();
  }

  function syncOwnerBanner() {
    let b = $('#owner-banner');
    const show = ownerMode && !ownerEl && !splashActive;
    if (!show) { if (b) b.remove(); return; }
    if (b) return;
    b = document.createElement('div');
    b.id = 'owner-banner';
    b.className = 'owner-banner';
    b.innerHTML = `
      <span class="owner__badge">${svg('<path d="M12 3 5 6v5.5c0 4.3 2.9 7.9 7 9.5 4.1-1.6 7-5.2 7-9.5V6z"/>')}Owner view</span>
      <span class="demo-tag">Demo data</span>
      <button class="owner-banner__btn" data-owner-open>Your week</button>
      <button class="owner-banner__btn owner-banner__btn--x" data-owner-mode-exit aria-label="Exit owner view">${I.x}</button>`;
    app.appendChild(b);
    springIn([b], { y: 20, scale: 0.9 });
  }

  /* ---------------------------------------------------------
     12. Photo viewer
     Opens from the tapped tile (shared element), swipe ← → to browse,
     swipe ↓ to shrink back into the grid, double-tap for a heart.
     --------------------------------------------------------- */
  const lb = { list: [], index: 0, tileFor: null, hiddenTile: null, x: 0, y: 0, t: 0, dx: 0, dy: 0, axis: null, down: false, lastTap: null, busy: false };
  let lbEl, lbTrack, lbBg;

  // photos share the favorites list with services ("photo:<url>")
  const isLiked = u => isFav('photo:' + u);

  const slideImg = i => $$('.lightbox__slide img', lbTrack)[i];
  const radiusOf = el => parseFloat(getComputedStyle(el).borderTopLeftRadius) || 16;

  function lbLoad(i) {
    [i - 1, i, i + 1].forEach(k => {
      const img = slideImg(k);
      if (img && !img.src) img.src = img.dataset.src;
    });
  }

  function lbRender(animate) {
    lbTrack.style.transition = animate ? 'transform .55s var(--spring)' : 'none';
    lbTrack.style.transform = `translate3d(${-lb.index * 100}%,0,0)`;
    $('.lightbox__count', lbEl).textContent = `${lb.index + 1} / ${lb.list.length}`;
    const like = $('.lightbox__like', lbEl);
    const on = isLiked(lb.list[lb.index]);
    like.classList.toggle('is-on', on);
    like.setAttribute('aria-pressed', on);
    lbLoad(lb.index);
  }

  /* Where the photo sits when fully open (object-fit: contain inside the slide) */
  function targetRect(i, ar) {
    const slide = $$('.lightbox__slide', lbTrack)[i];
    const cs = getComputedStyle(slide);
    const box = lbEl.getBoundingClientRect();
    const pt = parseFloat(cs.paddingTop);
    const pb = parseFloat(cs.paddingBottom);
    const aw = box.width;
    const ah = box.height - pt - pb;
    let w = aw;
    let h = aw / ar;
    if (h > ah) { h = ah; w = h * ar; }
    return { left: box.left + (aw - w) / 2, top: box.top + pt + (ah - h) / 2, width: w, height: h };
  }

  /*
   * The "shared element": a temporary copy of the photo that flies between
   * its tile and the full-screen position. It is laid out once at the big
   * size; the tile state is expressed with transform (translate + scale) and
   * a clip-path that crops it to the tile — so only transform/clip animate,
   * never layout.  dir 'in' = tile → big, 'out' = big → tile.
   */
  function fly(big, tile, src, o) {
    const box = app.getBoundingClientRect();
    const f = document.createElement('div');
    f.className = 'lb-fly';
    f.innerHTML = `<img src="${esc(src)}" alt="">`;
    f.style.cssText = `left:${big.left - box.left}px;top:${big.top - box.top}px;width:${big.width}px;height:${big.height}px`;
    app.appendChild(f);
    // the copy is always removed, even if the animation is interrupted
    setTimeout(() => f.remove(), (o.duration || 0.6) * 1000 + 1500);
    const s = Math.max(tile.width / big.width, tile.height / big.height);
    const ix = Math.max(0, (big.width - tile.width / s) / 2);
    const iy = Math.max(0, (big.height - tile.height / s) / 2);
    const r = (o.r || 0) / s;
    const tileState = {
      x: tile.left + tile.width / 2 - (big.left + (big.width * s) / 2),
      y: tile.top + tile.height / 2 - (big.top + (big.height * s) / 2),
      scale: s,
      clipPath: `inset(${iy}px ${ix}px ${iy}px ${ix}px round ${r}px)`
    };
    const bigState = { x: 0, y: 0, scale: 1, clipPath: 'inset(0px 0px 0px 0px round 0px)' };
    const [a, b] = o.dir === 'in' ? [tileState, bigState] : [bigState, tileState];
    const g = G();
    return new Promise(resolve => {
      if (!g) { resolve(f); return; }
      ensure(g.fromTo(f,
        Object.assign({ transformOrigin: '0 0', opacity: 1 }, a),
        Object.assign({ opacity: o.fade ? 0 : 1, duration: o.duration, ease: o.ease, onComplete: () => resolve(f) }, b)));
    });
  }

  function openLightbox(list, index, tileFor) {
    if (!list.length || lb.busy) return;
    lb.list = list;
    lb.index = index;
    lb.tileFor = tileFor;
    lbTrack.innerHTML = list.map(u => `<div class="lightbox__slide"><img data-src="${esc(sized(safeUrl(u), 1200))}" alt="" draggable="false"></div>`).join('');
    lbEl.hidden = false;
    lbEl.classList.add('is-open');
    app.classList.add('is-dark-overlay');
    lbRender(false);
    pushOverlay(closeLightboxUI);

    const g = G();
    const tile = tileFor && tileFor(index);
    const timg = tile && $('img', tile);
    if (!g || !timg || !timg.naturalWidth) {
      lbBg.style.opacity = 1;
      if (g) ensure(g.fromTo(lbEl, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: 'power2.out', clearProps: 'opacity' }));
      return;
    }

    lb.busy = true;
    lbEl.classList.add('is-flying');
    const from = tile.getBoundingClientRect();
    const to = targetRect(index, timg.naturalWidth / timg.naturalHeight);
    tile.style.visibility = 'hidden';
    lb.hiddenTile = tile;
    ensure(g.fromTo(lbBg, { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out' }));
    fly(to, from, timg.currentSrc || timg.src, { dir: 'in', r: radiusOf(tile), duration: 0.6, ease: 'back.out(1.1)' }).then(f => {
      const full = slideImg(index);
      let shown = false;
      const reveal = () => {
        if (shown) return;
        shown = true;
        lbEl.classList.remove('is-flying');
        lb.busy = false;
        setTimeout(() => f.remove(), 80);
      };
      if (full.complete && full.naturalWidth) reveal();
      else {
        full.addEventListener('load', reveal, { once: true });
        full.addEventListener('error', reveal, { once: true });
        setTimeout(reveal, 1500);
      }
    });
  }

  function closeLightboxUI() {
    app.classList.remove('is-dark-overlay');
    const g = G();
    const img = slideImg(lb.index);
    const tile = lb.tileFor && lb.tileFor(lb.index);
    const finish = () => {
      lbEl.hidden = true;
      lbEl.classList.remove('is-open', 'is-flying', 'is-dragging');
      lbTrack.style.transition = 'none';
      lbTrack.style.transform = '';
      lbBg.style.opacity = '';
      if (lb.hiddenTile) lb.hiddenTile.style.visibility = '';
      if (tile) tile.style.visibility = '';
      lb.hiddenTile = null;
      lb.busy = false;
      $$('.lb-fly').forEach(f => f.remove());
    };
    if (!g || !img || !img.naturalWidth) {
      if (g) ensure(g.to(lbEl, { opacity: 0, duration: 0.25, ease: 'power2.out', onComplete: () => { finish(); g.set(lbEl, { clearProps: 'opacity' }); } }));
      else finish();
      return;
    }
    lb.busy = true;
    const from = img.getBoundingClientRect();
    const box = app.getBoundingClientRect();
    const tr = tile && tile.offsetParent ? tile.getBoundingClientRect() : null;
    const tileVisible = tr && tr.width > 0 && tr.bottom > box.top + 40 && tr.top < box.bottom - 40;
    if (lb.hiddenTile && lb.hiddenTile !== tile) lb.hiddenTile.style.visibility = '';
    lbEl.classList.add('is-flying');
    ensure(g.to(lbBg, { opacity: 0, duration: 0.4, ease: 'power2.out' }));
    const src = img.currentSrc || img.src;
    if (tileVisible) {
      tile.style.visibility = 'hidden';
      lb.hiddenTile = tile;
      fly(from, tr, src, { dir: 'out', r: radiusOf(tile), duration: 0.5, ease: 'power3.out' }).then(finish);
    } else {
      const k = 0.7;
      const to = { left: from.left + from.width * (1 - k) / 2, top: from.top + from.height * (1 - k) / 2, width: from.width * k, height: from.height * k };
      fly(from, to, src, { dir: 'out', r: 24, duration: 0.35, ease: 'power2.out', fade: true }).then(finish);
    }
  }

  /* Double-tap: a heart pops with a burst of particles */
  function heartBurst(x, y) {
    const box = lbEl.getBoundingClientRect();
    const wrap = document.createElement('div');
    wrap.className = 'burst';
    wrap.style.left = (x - box.left) + 'px';
    wrap.style.top = (y - box.top) + 'px';
    const colors = ['var(--accent)', '#FF4D6D', '#FFD15C', '#FFFFFF'];
    wrap.innerHTML = `<span class="burst__heart">${I.heart}</span>` +
      Array.from({ length: 14 }, (_, i) => `<i class="${i % 3 === 0 ? 'is-heart' : ''}" style="--c:${colors[i % colors.length]}">${i % 3 === 0 ? I.heart : ''}</i>`).join('');
    lbEl.appendChild(wrap);
    setTimeout(() => wrap.remove(), 1500);
    const g = G();
    const heart = $('.burst__heart', wrap);
    if (!g) { $$('i', wrap).forEach(p => p.remove()); return; }
    const tl = g.timeline();
    tl.fromTo(heart, { scale: 0, rotate: -18 }, { scale: 1, rotate: 0, duration: 0.7, ease: ELASTIC })
      .to(heart, { y: -70, scale: 0.6, opacity: 0, duration: 0.45, ease: 'power2.in' }, '+=0.2');
    ensure(tl);
    $$('i', wrap).forEach((p, i) => {
      const ang = (i / 14) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const dist = 70 + Math.random() * 70;
      ensure(g.fromTo(p, { x: 0, y: 0, scale: 0.4 + Math.random() * 0.8, opacity: 1 },
        { x: Math.cos(ang) * dist, y: Math.sin(ang) * dist, scale: 0, opacity: 0, duration: 0.7 + Math.random() * 0.3, ease: 'power3.out', delay: 0.05 }));
    });
  }

  function likeCurrent(on) {
    const u = lb.list[lb.index];
    const was = isLiked(u);
    setFav('photo:' + u, on);
    lbRender(false);
    if (on !== was) {
      const like = $('.lightbox__like', lbEl);
      like.classList.remove('is-pop');
      void like.offsetWidth;
      if (on) like.classList.add('is-pop');
      popIn(like, { from: 0.55 });
    }
  }

  function bindLightbox() {
    lbEl = $('#lightbox');
    lbTrack = $('.lightbox__track', lbEl);
    lbBg = $('.lightbox__bg', lbEl);
    const W = () => lbEl.clientWidth;

    lbEl.addEventListener('pointerdown', e => {
      if (lb.busy || e.target.closest('.lightbox__close, .lightbox__like')) return;
      lb.down = true; lb.axis = null; lb.dx = lb.dy = 0;
      lb.x = e.clientX; lb.y = e.clientY; lb.t = performance.now();
      lbEl.setPointerCapture(e.pointerId);
    });

    lbEl.addEventListener('pointermove', e => {
      if (!lb.down) return;
      lb.dx = e.clientX - lb.x;
      lb.dy = e.clientY - lb.y;
      if (!lb.axis && Math.hypot(lb.dx, lb.dy) > 8) {
        lb.axis = Math.abs(lb.dx) > Math.abs(lb.dy) ? 'x' : 'y';
        lbEl.classList.add('is-dragging');
      }
      lbTrack.style.transition = 'none';
      if (lb.axis === 'x') {
        const edge = (lb.index === 0 && lb.dx > 0) || (lb.index === lb.list.length - 1 && lb.dx < 0);
        const dx = edge ? lb.dx * 0.35 : lb.dx;
        lbTrack.style.transform = `translate3d(calc(${-lb.index * 100}% + ${dx}px),0,0)`;
      } else if (lb.axis === 'y') {
        const dy = Math.max(0, lb.dy);
        const scale = 1 - Math.min(dy / 1400, 0.25);
        lbTrack.style.transform = `translate3d(${-lb.index * 100}%,${dy}px,0) scale(${scale})`;
        lbBg.style.transition = 'none';
        lbBg.style.opacity = String(1 - Math.min(dy / 420, 0.85));
      }
    });

    const end = e => {
      if (!lb.down) return;
      lb.down = false;
      lbEl.classList.remove('is-dragging');
      const dt = Math.max(1, performance.now() - lb.t);
      if (lb.axis === 'x') {
        const fast = Math.abs(lb.dx) / dt > 0.45;
        if ((Math.abs(lb.dx) > W() * 0.18 || fast) && Math.abs(lb.dx) > 20) {
          lb.index = clamp(lb.index + (lb.dx < 0 ? 1 : -1), 0, lb.list.length - 1);
        }
        lbRender(true);
      } else if (lb.axis === 'y') {
        if (lb.dy > 110 || (lb.dy > 30 && lb.dy / dt > 0.5)) popOverlay(); // shrinks back into its tile
        else {
          lbBg.style.transition = 'opacity .35s var(--ease)';
          lbBg.style.opacity = 1;
          lbRender(true);
        }
      } else if (e && e.type === 'pointerup') {
        // a tap: two quick taps = like
        const now = performance.now();
        const last = lb.lastTap;
        if (last && now - last.t < 320 && Math.hypot(e.clientX - last.x, e.clientY - last.y) < 36) {
          lb.lastTap = null;
          likeCurrent(true);
          heartBurst(e.clientX, e.clientY);
        } else {
          lb.lastTap = { t: now, x: e.clientX, y: e.clientY };
        }
      }
      lb.axis = null;
    };
    lbEl.addEventListener('pointerup', end);
    lbEl.addEventListener('pointercancel', end);

    $('.lightbox__close', lbEl).addEventListener('click', popOverlay);
    $('.lightbox__like', lbEl).addEventListener('click', () => likeCurrent(!isLiked(lb.list[lb.index])));

    document.addEventListener('keydown', e => {
      if (lbEl.hidden) return;
      if (e.key === 'Escape') popOverlay();
      if (e.key === 'ArrowRight' && lb.index < lb.list.length - 1) { lb.index++; lbRender(true); }
      if (e.key === 'ArrowLeft' && lb.index > 0) { lb.index--; lbRender(true); }
    });
  }

  /* ---------------------------------------------------------
     13. Settings
     --------------------------------------------------------- */
  function setSetting(key, value) {
    settings[key] = value;
    settings = sanitizeSettings(settings);
    store.set('settings', settings);
    applySettings();
    syncSettingsUI();
    if (key === 'textSize') requestAnimationFrame(() => updateNav(views[state.tab]));
  }

  /* ---------------------------------------------------------
     14. Events
     --------------------------------------------------------- */
  function bindEvents() {
    // iOS needs a touch listener for :active press states
    document.addEventListener('touchstart', () => {}, { passive: true });

    // Broken images fade out instead of showing an icon
    document.addEventListener('error', e => {
      if (e.target && e.target.tagName === 'IMG') e.target.classList.add('is-broken');
    }, true);

    tabbar.addEventListener('click', e => {
      const b = e.target.closest('.tab');
      if (b) go(b.dataset.tab);
    });

    app.addEventListener('click', e => {
      const t = e.target;
      let el;

      if (!$('#notice').hidden && !t.closest('.notice__card') && !t.closest('#bell')) closeNotice();

      if ((el = t.closest('#bell'))) { openNotifications(); return; }
      if ((el = t.closest('#share, [data-share]'))) { share(); return; }
      if ((el = t.closest('[data-story]'))) { openStories(+el.dataset.story); return; }
      if ((el = t.closest('[data-sheet-close], #scrim'))) { Sheet.close(); return; }

      // Booking sheet
      if ((el = t.closest('[data-bk-svc]'))) {
        bk.service = el.dataset.bkSvc;
        rememberService(bk.service);
        $$('[data-bk-svc]', Sheet.el()).forEach(b => b.classList.toggle('is-selected', b === el));
        popIn($('.pick__check', el), { from: 0.4 });
        renderBkFoot();
        setTimeout(() => { if (Sheet.isOpen() && bk.step === 0) goStep(1, true); }, 260);
        return;
      }
      if ((el = t.closest('[data-bk-day]'))) {
        bk.off = +el.dataset.bkDay;
        $$('.day', Sheet.el()).forEach(b => {
          b.classList.toggle('is-selected', b === el);
          b.setAttribute('aria-selected', b === el);
        });
        popIn(el, { from: 0.85 });
        haptic();
        centerDay(true);
        renderBkTimes(true);
        renderBkFoot();
        return;
      }
      if ((el = t.closest('[data-bk-time]'))) {
        bk.min = +el.dataset.bkTime;
        $$('.time', Sheet.el()).forEach(b => b.classList.toggle('is-selected', b === el));
        popIn(el, { from: 0.8 });
        haptic();
        renderBkFoot();
        return;
      }
      if ((el = t.closest('[data-bk-step]'))) { if (!el.disabled) goStep(+el.dataset.bkStep, true); return; }
      if ((el = t.closest('[data-bk-back]'))) { goStep(bk.step - 1, true); return; }
      if ((el = t.closest('[data-bk-next]'))) { if (!el.disabled) goStep(bk.step + 1, true); return; }

      if ((el = t.closest('[data-ics]'))) { downloadIcs(); return; }
      if ((el = t.closest('[data-bk-continue]'))) { continueBooking(); return; }
      if ((el = t.closest('[data-invite]'))) { shareInvite(); return; }
      if ((el = t.closest('[data-owner-exit]'))) { setOwnerMode(false); popOverlay(); return; }
      if ((el = t.closest('[data-owner-mode-exit]'))) { setOwnerMode(false); toast('Owner view off', 'ok'); return; }
      if ((el = t.closest('[data-owner-open]'))) { openOwner(); return; }
      if ((el = t.closest('[data-owner-looks]'))) { ownerAfter = () => go('gallery'); popOverlay(); return; }
      if ((el = t.closest('[data-fav]'))) {
        e.stopPropagation();
        setFav(el.dataset.fav, el.getAttribute('aria-pressed') !== 'true');
        return;
      }
      if ((el = t.closest('[data-loyalty]'))) { flipLoyalty(el); return; }
      if ((el = t.closest('[data-saved-photo]'))) {
        openLightbox(savedPhotos(), +el.dataset.savedPhoto, i => $(`[data-saved-photo="${i}"]`, views.more));
        return;
      }
      if ((el = t.closest('[data-book]'))) {
        e.preventDefault();
        openBooking({ slot: el.dataset.slot, service: el.dataset.bookService });
        return;
      }
      if ((el = t.closest('[data-open-service]'))) {
        openServiceDetail(el.dataset.openService, $('.svc2__photo, .svc-card__photo img, .cc-photo', el));
        return;
      }
      if ((el = t.closest('[data-go]'))) { go(el.dataset.go); return; }
      if ((el = t.closest('[data-sub]'))) { openSub(el.dataset.sub); return; }
      if ((el = t.closest('[data-back]'))) { popOverlay(); return; }
      if ((el = t.closest('[data-reel]'))) {
        openLook(data.gallery, +el.dataset.reel, l => $(`.reel__item[data-reel="${data.gallery.indexOf(l)}"]`, views.home));
        return;
      }
      if ((el = t.closest('[data-look-filter]'))) {
        setLookFilter(el.dataset.lookFilter);
        haptic();
        const bar = $('#look-chips');
        const chip = bar && $(`[data-look-filter="${CSS.escape(state.lookFilter)}"]`, bar);
        if (chip) bar.scrollTo({ left: Math.max(0, chip.offsetLeft - (bar.clientWidth - chip.offsetWidth) / 2), behavior: reducedMQ.matches ? 'auto' : 'smooth' });
        return;
      }
      if ((el = t.closest('[data-look]'))) {
        const l = lookById(el.dataset.look);
        if (!l) return;
        const list = lookItems().includes(l) ? lookItems() : data.gallery;
        openLook(list, list.indexOf(l), galleryTile);
        return;
      }
      if ((el = t.closest('[data-saved-look]'))) {
        const list = savedLooks();
        openLook(list, list.findIndex(l => l.id === el.dataset.savedLook), l => $(`[data-saved-look="${CSS.escape(l.id)}"]`, views.more));
        return;
      }
      if ((el = t.closest('[data-share-saved]'))) { shareSavedLooks(); return; }
      if ((el = t.closest('[data-ask]'))) { ask(el.dataset.ask); return; }

      if ((el = t.closest('[data-cat]'))) {
        if (state.category === el.dataset.cat) return;
        state.category = el.dataset.cat;
        syncChips(true);
        applyServiceFilter(true);
        const bar = el.parentElement;
        bar.scrollTo({ left: Math.max(0, el.offsetLeft - (bar.clientWidth - el.offsetWidth) / 2), behavior: reducedMQ.matches ? 'auto' : 'smooth' });
        return;
      }

      if (t.closest('#svc-clear')) {
        const input = $('#svc-search');
        input.value = '';
        state.query = '';
        $('#svc-clear').hidden = true;
        applyServiceFilter(true);
        input.focus();
        return;
      }

      if ((el = t.closest('.segmented[data-seg="style"] button'))) { setStyle(el.dataset.value); return; }
      if ((el = t.closest('.segmented[data-seg="theme"] button'))) { setThemeAnimated(el.dataset.value, e.clientX || innerWidth / 2, e.clientY || innerHeight / 2); return; }
      if ((el = t.closest('.segmented button'))) { setSetting(el.parentElement.dataset.seg, el.dataset.value); return; }
      if ((el = t.closest('[data-accent]'))) { setSetting('accent', el.dataset.accent); popIn(el, { from: 0.8 }); return; }
      if ((el = t.closest('#reminders'))) {
        setSetting('reminders', !settings.reminders);
        haptic();
        return;
      }
      if ((el = t.closest('#reset'))) {
        // the style goes back to the master's own too
        store.remove('styleUser');
        if (data.style !== STYLE) setStyle(data.style, { remember: false });
        settings = sanitizeSettings({});
        store.remove('settings');
        applySettings();
        syncSettingsUI();
        requestAnimationFrame(() => updateNav(views[state.tab]));
        toast('Settings reset', 'sparkle');
      }
    });

    app.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.id === 'svc-search') e.target.blur();
      // cards that act as buttons (they contain a ♥ button, so they can't be <button>s)
      if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[role="button"][data-open-service], [role="button"][data-look]')) {
        e.preventDefault();
        e.target.click();
      }
      if (e.key === 'Escape' && Sheet.isOpen()) Sheet.close();
    });

    app.addEventListener('input', e => {
      if (e.target.id === 'svc-search') {
        state.query = e.target.value;
        $('#svc-clear').hidden = !e.target.value;
        applyServiceFilter(true);
      } else if (e.target.id === 'chat-input') {
        setComposer(!!e.target.value.trim());
      }
    });

    app.addEventListener('submit', e => {
      if (e.target.id !== 'composer') return;
      e.preventDefault();
      if (chatBusy) return;
      const input = $('#chat-input');
      const v = input.value;
      input.value = '';
      setComposer(false);
      ask(v);
    });

    // Keep the keyboard open when tapping send / suggestions
    app.addEventListener('pointerdown', e => {
      if (document.activeElement && document.activeElement.id === 'chat-input' &&
          (e.target.closest('.send') || e.target.closest('[data-ask]'))) e.preventDefault();
    });

    // On-screen keyboard: hide the tab bar while typing
    const coarse = window.matchMedia('(pointer: coarse)');
    app.addEventListener('focusin', e => {
      if (coarse.matches && e.target.tagName === 'INPUT') app.classList.add('kb-open');
    });
    app.addEventListener('focusout', () => {
      setTimeout(() => {
        if (!document.activeElement || document.activeElement.tagName !== 'INPUT') app.classList.remove('kb-open');
      }, 50);
    });
    if (window.visualViewport) {
      const vv = window.visualViewport;
      const desk = window.matchMedia('(min-width: 760px)');
      const fit = () => {
        if (desk.matches) { root.style.removeProperty('--vvh'); return; }
        root.style.setProperty('--vvh', vv.height + 'px');
        if (vv.offsetTop) window.scrollTo(0, 0);
        if (state.tab === 'ask') scrollChat(false);
      };
      vv.addEventListener('resize', fit);
      vv.addEventListener('scroll', fit);
    }

    window.addEventListener('resize', () => {
      if (state.tab) movePill(state.tab, false);
      syncChips(false);
      syncLookChips(false);
      updateNav(views[state.tab]);
      if (!sub.hidden) updateNav(sub);
    });

    bindLightbox();
    bindStories();
    Sheet.init();

    setInterval(() => { refreshStatus(); tickClock(); }, 30000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshStatus(); });
  }

  function bindScrollers() {
    Object.values(views).forEach(v => {
      const sc = scrollerOf(v);
      if (sc) sc.addEventListener('scroll', onScroll, { passive: true });
    });
    bindHomePull(scrollerOf(views.home));
  }

  /* ---------------------------------------------------------
     Features: favorites, notifications, loyalty, hero motion,
     stats, scroll reveal, image fade-in
     --------------------------------------------------------- */

  /* ---------- Favorites (services + photos, per master) ---------- */
  function favs() {
    const saved = store.get('saved', null);
    if (Array.isArray(saved)) return saved;
    const legacy = store.get('likes', []).map(u => 'photo:' + u); // older builds stored liked photos here
    store.set('saved', legacy);
    return legacy;
  }
  const isFav = key => favs().includes(key);

  function favButton(key, cls) {
    const on = isFav(key);
    return `<button class="fav${cls ? ' ' + cls : ''}" data-fav="${esc(key)}" aria-pressed="${on}" aria-label="${on ? 'Remove from favorites' : 'Save to favorites'}">${I.heart}</button>`;
  }

  function setFav(key, on, quiet) {
    const was = isFav(key);
    if (was === on) return;
    const list = favs().filter(k => k !== key);
    if (on) list.push(key);
    store.set('saved', list);
    $$('[data-fav]').forEach(b => {
      if (b.dataset.fav !== key) return;
      b.setAttribute('aria-pressed', on);
      b.setAttribute('aria-label', on ? 'Remove from favorites' : 'Save to favorites');
      if (on) {
        b.classList.remove('is-pop');
        void b.offsetWidth;
        b.classList.add('is-pop');
        popIn(b, { from: 0.55 });
      }
    });
    haptic(key.startsWith('look:') ? 10 : 8);
    if (!quiet) toast(on ? 'Saved to favorites' : 'Removed from favorites', 'heart');
    renderSaved();
    if (key.startsWith('look:')) onLookFavChange();
  }

  /* "Saved" group in More */
  function renderSaved() {
    const box = $('#saved-box');
    if (!box) return;
    const keys = favs();
    const svcs = keys.filter(k => k.startsWith('svc:')).map(k => data.services.find(s => s.id === k.slice(4))).filter(Boolean);
    const photos = keys.filter(k => k.startsWith('photo:')).map(k => k.slice(6));
    const looks = savedLooks();
    if (!svcs.length && !photos.length && !looks.length) {
      box.innerHTML = `
        <div class="row">
          <span class="row__icon" style="--ic:#FF2D55">${I.heart}</span>
          <span class="row__label">Nothing saved yet<span class="row__sub">Tap ♥ on a service or a look to keep it here</span></span>
        </div>`;
      return;
    }
    box.innerHTML = svcs.map(s => `
        <div class="row row--link" role="button" tabindex="0" data-open-service="${esc(s.id)}">
          <img class="row__thumb" src="${esc(sized(safeUrl(s.photo), 200))}" alt="">
          <span class="row__label">${esc(s.title)}<span class="row__sub">${esc(s.duration || '')}</span></span>
          <span class="row__value">${esc(price(s.price))}</span>
          <span class="row__chev">${I.chevR}</span>
        </div>`).join('') +
      (looks.length ? `
        <div class="row row--stack">
          <div class="row__head"><span class="row__icon" style="--ic:#FF2D55">${I.heart}</span><span class="row__label">Looks</span><span class="row__value">${looks.length}</span></div>
          <div class="saved-grid">
            ${looks.map(l => `<button class="saved-grid__item" data-saved-look="${esc(l.id)}" aria-label="${esc(l.title)}"><img src="${esc(sized(safeUrl(l.photo), 300))}" alt=""></button>`).join('')}
          </div>
        </div>` : '') +
      (photos.length ? `
        <div class="row row--stack">
          <div class="row__head"><span class="row__icon" style="--ic:#FF2D55">${I.heart}</span><span class="row__label">Photos</span><span class="row__value">${photos.length}</span></div>
          <div class="saved-grid">
            ${photos.map((u, i) => `<button class="saved-grid__item" data-saved-photo="${i}" aria-label="Open saved photo ${i + 1}"><img src="${esc(sized(safeUrl(u), 300))}" alt=""></button>`).join('')}
          </div>
        </div>` : '');
  }
  const savedPhotos = () => favs().filter(k => k.startsWith('photo:')).map(k => k.slice(6));

  /* ---------- Notification center ---------- */
  const notifKey = n => String(n.id || n.title);
  function notifications() {
    if (data.notifications.length) return data.notifications;
    return data.notice ? [{ id: 'notice', title: 'What’s new', text: data.notice, time: 'Now', icon: 'bell' }] : [];
  }
  const hasUnread = () => {
    const read = store.get('notifRead', []);
    return notifications().some(n => !read.includes(notifKey(n)));
  };

  function openNotifications() {
    const read = store.get('notifRead', []);
    const list = notifications();
    haptic();
    Sheet.open(el => {
      el.innerHTML = `
        <header class="sheet-head">
          <div><span class="eyebrow">${esc(data.name)}</span><h2>Notifications</h2></div>
          <button class="sheet__x" data-sheet-close aria-label="Close">${I.x}</button>
        </header>
        <div class="sheet__scroll" data-sheet-scroll>
          <div class="notif-list">
            ${list.length ? list.map(n => `
              <div class="notif${read.includes(notifKey(n)) ? '' : ' is-unread'}">
                <span class="notif__icon">${art(n.icon || 'bell')}</span>
                <span class="notif__body">
                  <b>${esc(n.title)}</b>
                  ${n.text ? `<p>${esc(n.text)}</p>` : ''}
                  ${n.time ? `<time>${esc(n.time)}</time>` : ''}
                </span>
                <i class="notif__dot" aria-label="Unread"></i>
              </div>`).join('') : `<p class="empty">You’re all caught up ✨</p>`}
          </div>
        </div>`;
    }, { detent: 'medium' });
    springIn($$('.notif', Sheet.el()), { delay: 0.15, stagger: 0.06, y: 18 });
    store.set('notifRead', list.map(notifKey));
    const dot = $('#bell .badge-dot');
    const g = G();
    if (dot && g) ensure(g.to(dot, { scale: 0, duration: 0.3, ease: 'back.in(2)', onComplete: () => dot.remove() }));
    else if (dot) dot.remove();
  }

  /* ---------- Loyalty card ---------- */
  const LASH = svg('<path d="M3.5 12.5c2.4 2.9 5.3 4.3 8.5 4.3s6.1-1.4 8.5-4.3"/><path d="M6.3 15.1 4.8 17.4M9.3 16.4l-.7 2.6M12 16.8v2.7M14.7 16.4l.7 2.6M17.7 15.1l1.5 2.3"/>');
  const GIFT = svg('<rect x="4" y="9" width="16" height="11" rx="2"/><path d="M12 9v11M4 13h16M12 9s-1.5-5-4.5-4c-2 .7-1 4 4.5 4zM12 9s1.5-5 4.5-4c2 .7 1 4-4.5 4z"/>');

  /* A deterministic, QR-looking placeholder (not a real code) */
  function fakeQr(seed) {
    const n = 21;
    let h = 0;
    for (const ch of String(seed)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
    const finder = (x, y) => (x < 7 && y < 7) || (x >= n - 7 && y < 7) || (x < 7 && y >= n - 7);
    let d = '';
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (finder(x, y)) continue;
        if (rnd() > 0.52) d += `M${x} ${y}h1v1h-1z`;
      }
    }
    const eye = (x, y) => `M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5zM${x + 2} ${y + 2}h3v3h-3z`;
    return `<svg viewBox="-1 -1 23 23" aria-hidden="true"><path fill-rule="evenodd" d="${eye(0, 0)}${eye(n - 7, 0)}${eye(0, n - 7)}${d}"/></svg>`;
  }

  function loyaltyHTML() {
    const l = data.loyalty;
    if (!l) return '';
    const total = l.total;
    const filled = clamp(l.filled, 0, total);
    return `
      <div class="loyalty" data-stagger>
        <button class="loyalty__card" data-loyalty aria-pressed="false" aria-label="Loyalty card: ${filled} of ${total} stamps. Tap to flip.">
          <span class="loyalty__face loyalty__front">
            <span class="loyalty__head">
              <span><b>Loyalty card</b><small class="num">${filled} of ${total} visits</small></span>
              <span class="loyalty__mark">${esc(STYLE !== 'soft' ? initials() : String(data.name).charAt(0))}</span>
            </span>
            <span class="loyalty__stamps">
              ${Array.from({ length: total }, (_, i) => `<i class="stamp${i < filled ? ' is-on' : ''}${i === total - 1 ? ' is-reward' : ''}" style="--i:${i}">${i < filled ? LASH : i === total - 1 ? GIFT : ''}</i>`).join('')}
            </span>
            <span class="loyalty__foot"><span>${GIFT}${esc(l.reward || '')}</span><em>Tap to flip</em></span>
          </span>
          <span class="loyalty__face loyalty__back">
            <span class="loyalty__qr">${fakeQr(SLUG + ':' + filled)}</span>
            <span class="loyalty__terms">
              <b>Show at your visit</b>
              <small>${esc(l.terms || `Get a stamp at every visit. Your ${total}th visit: ${l.reward || 'a reward'}.`)}</small>
              <em>Tap to flip back</em>
            </span>
          </span>
        </button>
      </div>`;
  }

  /* Loyalty card flip: squash to the edge, swap faces, open again */
  function flipLoyalty(el) {
    const flipped = !el.classList.contains('is-flipped');
    const swap = () => {
      el.classList.toggle('is-flipped', flipped);
      el.setAttribute('aria-pressed', flipped);
    };
    haptic();
    const g = G();
    if (!g) { swap(); return; }
    g.killTweensOf(el);
    const tl = g.timeline();
    tl.to(el, { scaleX: 0.02, scaleY: 0.97, duration: 0.2, ease: 'power2.in', onComplete: swap })
      .to(el, { scaleX: 1, scaleY: 1, duration: 0.34, ease: 'power2.out', clearProps: 'transform' });
    ensure(tl);
  }

  /* ---------- Haptics (Android) ---------- */
  function haptic(ms) {
    try { if (navigator.vibrate && window.matchMedia('(pointer: coarse)').matches) navigator.vibrate(ms || 8); } catch (e) { /* not supported */ }
  }

  /* ---------- Hero: greeting, status pill, tilt parallax ---------- */
  function greeting() {
    const h = new Date().getHours();
    return h >= 5 && h < 12 ? 'Good morning ☀️' : h >= 12 && h < 17 ? 'Good afternoon' : 'Good evening ✨';
  }

  function statusShort() {
    const now = studioNow();
    const today = parseRange(data.hours[DAY_KEYS[now.day]]);
    if (today && now.minutes >= today.open && now.minutes < today.close) return { open: true, text: `Open now · until ${fmtTime(today.close)}` };
    if (today && now.minutes < today.open) return { open: false, text: `Closed · opens ${fmtTime(today.open)}` };
    for (let i = 1; i <= 7; i++) {
      const day = (now.day + i) % 7;
      const r = parseRange(data.hours[DAY_KEYS[day]]);
      if (r) return { open: false, text: `Closed · opens ${i === 1 ? '' : DAY_SHORT[day] + ' '}${fmtTime(r.open)}` };
    }
    return { open: false, text: 'By appointment' };
  }

  /* ±8px parallax: device tilt on phones, the mouse on desktop */
  function bindHeroTilt() {
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let raf = 0;
    const loop = () => {
      raf = 0;
      cx += (tx - cx) * 0.1;
      cy += (ty - cy) * 0.1;
      const el = $('.hero__tilt', views.home);
      if (el) el.style.transform = `translate3d(${cx.toFixed(2)}px,${cy.toFixed(2)}px,0) scale(1.05)`;
      if (Math.abs(tx - cx) > 0.05 || Math.abs(ty - cy) > 0.05) raf = requestAnimationFrame(loop);
    };
    const set = (x, y) => {
      if (reducedMQ.matches || state.tab !== 'home') return;
      tx = clamp(x, -1, 1) * 8;
      ty = clamp(y, -1, 1) * 8;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    if (window.matchMedia('(pointer: fine)').matches) {
      views.home.addEventListener('mousemove', e => {
        const r = views.home.getBoundingClientRect();
        set(-((e.clientX - r.left) / r.width - 0.5) * 2, -((e.clientY - r.top) / r.height - 0.5) * 2);
      });
      views.home.addEventListener('mouseleave', () => set(0, 0));
    }
    const onOrient = e => { if (e.gamma != null) set(-e.gamma / 25, -(e.beta - 45) / 25); };
    if ('DeviceOrientationEvent' in window) {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        // iOS asks for motion access; request it on the first tap on the hero
        views.home.addEventListener('touchend', e => {
          if (!e.target.closest('.hero')) return;
          DeviceOrientationEvent.requestPermission()
            .then(p => { if (p === 'granted') window.addEventListener('deviceorientation', onOrient); })
            .catch(() => {});
        }, { once: true });
      } else {
        window.addEventListener('deviceorientation', onOrient);
      }
    }
  }

  /* Maison loyalty card: a light sheen glides across the metal with the
     mouse (desktop) or the phone's tilt */
  function bindLoyaltySheen() {
    let target = 0.3;
    let raf = 0;
    const apply = () => {
      raf = 0;
      const card = STYLE !== 'soft' && $('.loyalty__card', views.home);
      if (card) card.style.setProperty('--sheen', target.toFixed(3));
    };
    const set = v => { target = clamp(v, 0, 1); if (!raf) raf = requestAnimationFrame(apply); };
    if (window.matchMedia('(pointer: fine)').matches) {
      views.home.addEventListener('pointermove', e => {
        const card = $('.loyalty__card', views.home);
        if (!card) return;
        const r = card.getBoundingClientRect();
        set((e.clientX - r.left) / r.width);
      }, { passive: true });
    }
    window.addEventListener('deviceorientation', e => { if (e.gamma != null) set(0.5 + e.gamma / 60); }, { passive: true });
  }

  /* ---------- Stats: count up from 0 when they appear ---------- */
  const fmtStat = (v, dec) => Number(v).toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });

  function countUp(el) {
    const to = +el.dataset.value;
    const dec = +el.dataset.decimals || 0;
    const num = $('.stat__num', el);
    if (reducedMQ.matches || !isFinite(to)) return;
    const t0 = performance.now();
    const D = 1200;
    const tick = now => {
      const p = clamp((now - t0) / D, 0, 1);
      const e = 1 - Math.pow(1 - p, 3); // ease-out
      num.textContent = fmtStat(to * e, dec);
      if (p < 1) requestAnimationFrame(tick);
      else num.textContent = fmtStat(to, dec);
    };
    num.textContent = fmtStat(0, dec);
    requestAnimationFrame(tick);
    setTimeout(() => { num.textContent = fmtStat(to, dec); }, D + 400); // never stuck mid-way
  }

  /* ---------- Scroll reveal on Home (IntersectionObserver) ---------- */
  let revealIO = null;
  function animateSection(el) {
    const g = G();
    if (!g) return;
    const head = $('.section-head', el);
    const rail = $('.rail, .stats', el);
    if (head || rail) {
      if (head) ensure(g.fromTo(head, { x: -28, opacity: 0 }, { x: 0, opacity: 1, duration: 0.6, ease: SPRING, clearProps: 'transform,opacity' }));
      const cards = rail ? Array.from(rail.children).slice(0, 5) : [];
      const other = Array.from(el.children).filter(c => c !== head && c !== rail);
      springIn(other, { delay: 0.05 });
      if (cards.length) ensure(g.fromTo(cards, { y: 36, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.7, ease: SPRING, stagger: 0.07, delay: 0.1, clearProps: 'transform,opacity' }));
    } else {
      springIn([el]);
    }
  }
  function observeReveal(els) {
    if (!('IntersectionObserver' in window) || !G()) return;
    if (!revealIO) {
      revealIO = new IntersectionObserver(entries => {
        entries.forEach(en => {
          if (!en.isIntersecting) return;
          revealIO.unobserve(en.target);
          animateSection(en.target);
        });
      }, { root: scrollerOf(views.home), rootMargin: '0px 0px -6% 0px', threshold: 0 });
    }
    els.forEach(el => revealIO.observe(el));
  }

  let statsIO = null;
  function observeStats() {
    const items = $$('.stat', views.home);
    if (!items.length) return;
    if (!('IntersectionObserver' in window)) return;
    if (statsIO) statsIO.disconnect();
    statsIO = new IntersectionObserver(entries => {
      entries.forEach(en => {
        if (!en.isIntersecting) return;
        statsIO.unobserve(en.target);
        countUp(en.target);
      });
    }, { root: scrollerOf(views.home), threshold: 0.6 });
    items.forEach(el => statsIO.observe(el));
  }

  /* ---------- Images: shimmer while loading, then blur → sharp ---------- */
  function imgFx(img) {
    if (img.dataset.fx) return;
    img.dataset.fx = '1';
    img.draggable = false; // no iOS drag ghost / long-press preview on any picture
    if (img.closest('.lb-fly, .splash, .lightbox, .stories, .onb, .welcome, .look, .lv, .owner-top') || /fluentui-emoji|\.svg(\?|$)/i.test(img.getAttribute('src') || '')) return;
    const ready = () => img.complete && img.naturalWidth > 0;
    // Cached images are ready right away: show them as they are, never blurred
    if (ready()) return;
    img.classList.add('fx-loading');
    let settled = false;
    const done = animate => {
      if (settled) return;
      settled = true;
      img.classList.remove('fx-loading');
      if (animate && !reducedMQ.matches) {
        img.classList.add('fx-in');
        const clear = () => img.classList.remove('fx-in');
        img.addEventListener('animationend', clear, { once: true });
        setTimeout(clear, 900);
      }
    };
    img.addEventListener('load', () => done(true), { once: true });
    img.addEventListener('error', () => done(false), { once: true });
    // a cache hit can finish before we see its load event — re-check shortly
    requestAnimationFrame(() => { if (ready()) done(false); });
    setTimeout(() => { if (ready()) done(false); }, 250);
    if (img.loading !== 'lazy') setTimeout(() => done(false), 8000);
  }

  /* Safety sweep: nothing may stay shimmering/blurred once its pixels are in */
  function settleImages(scope) {
    $$('img.fx-loading, img.fx-in', scope || app).forEach(img => {
      if (img.complete && img.naturalWidth > 0) img.classList.remove('fx-loading', 'fx-in');
    });
  }
  function watchImages() {
    $$('img', app).forEach(imgFx);
    new MutationObserver(muts => {
      muts.forEach(m => m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.tagName === 'IMG') imgFx(n);
        else if (n.querySelectorAll) n.querySelectorAll('img').forEach(imgFx);
      }));
    }).observe(app, { childList: true, subtree: true });
  }

  /* ---------------------------------------------------------
     Client conveniences: book again, prep + calendar, directions, invite
     --------------------------------------------------------- */

  /* "Book again" — only when the client picked a service before */
  function rememberService(id) {
    if (id && data.services.some(s => s.id === id)) store.set('lastService', id);
  }
  function bookAgainHTML() {
    const s = data.services.find(x => x.id === store.get('lastService'));
    if (!s) return '';
    return `
      <div class="again card">
        <img class="again__photo" src="${esc(sized(safeUrl(s.photo), 200))}" alt="">
        <span class="again__text"><span class="eyebrow">Book again</span><b>${esc(s.title)} · <span class="num">${esc(price(s.price))}</span></b></span>
        <button class="btn btn--primary btn--sm" data-book data-book-service="${esc(s.id)}">Book</button>
      </div>`;
  }
  function syncBookAgain() {
    const el = $('#book-again', views.home);
    if (!el) return;
    const html = bookAgainHTML();
    el.innerHTML = html;
    el.hidden = !html;
    rerule();
  }

  /* "Before your visit" + Add to calendar (.ics) on the Review step */
  function prepHTML() {
    const prep = data.prep.slice(0, 3);
    return `
      ${prep.length ? `
      <div class="card prep">
        <b class="prep__title">Before your visit</b>
        <ul>${prep.map(x => `<li><span class="sd-check">${I.check}</span>${esc(x)}</li>`).join('')}</ul>
      </div>` : ''}
      <button class="btn btn--soft btn--block" data-ics>${svg('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M12 13v5M9.5 15.5h5"/>')}Add to calendar</button>`;
  }

  function icsText(v) {
    return String(v || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  }
  function downloadIcs() {
    const s = bkService();
    if (!s || bk.min == null) return;
    const d = studioDate(bk.off);
    const pad = n => String(n).padStart(2, '0');
    const start = new Date(Date.UTC(d.year, d.month, d.day, 0, bk.min));
    const end = new Date(start.getTime() + s.minutes * 60000);
    const local = dt => `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00`;
    const now = new Date();
    const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
    const tz = data.timezone ? `;TZID=${data.timezone}` : '';
    const notes = [
      `${s.title} with ${data.name}.`,
      data.deposit ? `Deposit: ${price(data.deposit)}.` : '',
      'Confirm your time on the booking page.',
      data.prep.length ? 'Before your visit: ' + data.prep.join('; ') : ''
    ].filter(Boolean).join('\n');
    const ics = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Studio App//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${SLUG}-${local(start)}-${s.id}@studio-app`,
      `DTSTAMP:${stamp}`,
      `DTSTART${tz}:${local(start)}`,
      `DTEND${tz}:${local(end)}`,
      `SUMMARY:${icsText(s.title + ' — ' + data.name)}`,
      data.address ? `LOCATION:${icsText(data.address)}` : '',
      `DESCRIPTION:${icsText(notes)}`,
      data.bookingUrl ? `URL:${safeUrl(data.bookingUrl)}` : '',
      // Reminders setting on → alerts 24h and 2h before; off → no alerts
      ...(settings.reminders ? [
        'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(s.title + ' tomorrow at ' + fmtClock(bk.min))}`, 'END:VALARM',
        'BEGIN:VALARM', 'TRIGGER:-PT2H', 'ACTION:DISPLAY', `DESCRIPTION:${icsText(s.title + ' in 2 hours')}`, 'END:VALARM'
      ] : []),
      'END:VEVENT', 'END:VCALENDAR'
    ].filter(Boolean).join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${SLUG}-${local(start).slice(0, 8)}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    haptic();
    toast('Added to your calendar', 'ok');
  }

  /* "Find the studio": address, parking, Apple / Google Maps */
  function placeHTML(extraClass) {
    if (!data.address) return '';
    const q = encodeURIComponent(data.address);
    return `
      <div class="place${extraClass ? ' ' + extraClass : ''}">
        <div class="place__head">
          <span class="place__pin">${I.pin}</span>
          <span><b>Find the studio</b><small>${esc(data.address)}</small></span>
        </div>
        ${data.parking ? `<p class="place__note">${svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M10 16V8h3a2.5 2.5 0 0 1 0 5h-3"/>')}<span>${esc(data.parking)}</span></p>` : ''}
        <div class="place__actions">
          <a class="btn btn--soft btn--sm" href="https://maps.apple.com/?q=${q}" ${ext}>Apple Maps</a>
          <a class="btn btn--soft btn--sm" href="https://www.google.com/maps/search/?api=1&query=${q}" ${ext}>Google Maps</a>
        </div>
      </div>`;
  }

  /* "Invite a friend" */
  const appLink = () => new URL(params.has('m') ? './?m=' + encodeURIComponent(SLUG) : './', location.href).href;
  function inviteHTML() {
    const r = data.referral;
    if (!r) return '';
    return `
      <section class="invite" data-stagger>
        ${art('gem-stone', 'invite__art')}
        <div class="invite__text">
          <span class="eyebrow">Invite a friend</span>
          <b>${esc(r.title || 'Give $10, get $10')}</b>
          ${r.text ? `<p>${esc(r.text)}</p>` : ''}
        </div>
        <button class="btn btn--primary btn--sm" data-invite>${I.share}<span>Share</span></button>
      </section>`;
  }
  async function shareInvite() {
    const r = data.referral || {};
    const text = r.shareText || `${r.title || ''} — ${data.name}`.trim();
    haptic();
    if (navigator.share) {
      try { await navigator.share({ title: data.name, text, url: appLink() }); } catch (e) { /* cancelled */ }
      return;
    }
    try { await navigator.clipboard.writeText(`${text} ${appLink()}`); toast('Invite link copied', 'link'); } catch (e) { toast(appLink(), 'link'); }
  }

  /* ---------------------------------------------------------
     Owner demo view — what the master sees when selling the app
     (every number here is demo data from JSON and is labelled so)
     --------------------------------------------------------- */
  let ownerEl = null;
  function openOwner(opts) {
    const o = data.ownerDemo;
    if (!o || ownerEl) return;
    closeNotice();
    ownerMode = true;
    setOwnerMode(true);
    const tl = topLook();
    const tls = tl ? lookStats(tl) : null;
    if (!(opts && opts.quiet)) haptic(); // the long-press already buzzed
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const DEMO_DAYS = [38, 45, 52, 41, 60, 49, 27];
    const daily = DEMO_DAYS.map((d, i) => (o.daily && o.daily[i] != null ? +o.daily[i] || 0 : d));
    const maxDay = Math.max(1, ...daily);
    const top = (o.topServices || []).map(t => ({ s: data.services.find(x => x.id === t.id), views: +t.views || 0 })).filter(t => t.s).slice(0, 3);
    const maxViews = Math.max(1, ...top.map(t => t.views));
    const metric = (icon, value, label, opts) => `
      <div class="metric stat" data-value="${+value}" data-decimals="${(opts && opts.decimals) || 0}">
        ${art(icon)}
        <b>${(opts && opts.prefix) || ''}<span class="stat__num num">${fmtStat(+value, (opts && opts.decimals) || 0)}</span>${(opts && opts.suffix) || ''}</b>
        <small>${label}</small>
      </div>`;
    // Mon…Sun columns; today (studio time) in the accent
    const todayIdx = (studioNow().day + 6) % 7;
    const chart = days.map((d, i) => {
      const v = daily[i] || 0;
      return `
        <div class="ochart__col${i === todayIdx ? ' is-today' : ''}">
          <span class="ochart__v num">${v}</span>
          <i class="ochart__bar" style="--h:${(v / maxDay).toFixed(3)}"></i>
          <span class="ochart__d">${i === todayIdx ? 'Today' : d}</span>
        </div>`;
    }).join('');

    ownerEl = document.createElement('div');
    ownerEl.className = 'owner';
    ownerEl.setAttribute('role', 'dialog');
    ownerEl.setAttribute('aria-label', 'Owner view, demo data');
    ownerEl.innerHTML = `
      <div class="mesh" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="owner__bar">
        <span class="owner__badge">${svg('<path d="M12 3 5 6v5.5c0 4.3 2.9 7.9 7 9.5 4.1-1.6 7-5.2 7-9.5V6z"/>')}Owner view</span>
        <span class="demo-tag">Demo data</span>
        <button class="owner__exit" data-owner-exit>Exit</button>
      </div>
      <div class="owner__scroll">
        <header class="owner__head" data-stagger>
          <span class="eyebrow">This week · Demo data</span>
          <h1>Your week</h1>
          <p>What ${esc(data.name)} did for you while your hands were busy.</p>
        </header>
        <div class="owner__grid">
          ${metric('eye', o.opens, 'App opens')}
          ${metric('speech-balloon', o.questions, 'Questions answered by assistant')}
          ${metric('calendar', o.bookTaps, 'Book taps')}
          ${metric('gem-stone', o.hoursSaved, 'Time saved', { prefix: '~', suffix: ' h', decimals: 1 })}
        </div>
        <section class="card owner__card" data-stagger>
          <div class="owner__h"><b>App opens by day</b><span class="demo-tag">Demo data</span></div>
          <div class="ochart" role="img" aria-label="App opens by day of the week, demo data">${chart}</div>
        </section>
        <section class="card owner__card" data-stagger>
          <div class="owner__h"><b>Top questions clients asked</b><span class="demo-tag">Demo data</span></div>
          <ol class="owner__qs">
            ${(o.topQuestions || []).slice(0, 5).map((q, i) => `<li><span class="owner__rank">${i + 1}</span><span class="owner__q">${esc(q.q)}</span><span class="owner__count num">${esc(q.count)}</span></li>`).join('')}
          </ol>
        </section>
        <section class="card owner__card" data-stagger>
          <div class="owner__h"><b>Most viewed services</b><span class="demo-tag">Demo data</span></div>
          ${top.map(t => `
            <div class="owner__svc">
              <img src="${esc(sized(safeUrl(t.s.photo), 200))}" alt="">
              <div class="owner__svc-body">
                <div class="owner__svc-top"><b>${esc(t.s.title)}</b><span class="num">${t.views} views</span></div>
                <div class="owner__track"><i style="--p:${(t.views / maxViews).toFixed(3)}"></i></div>
              </div>
            </div>`).join('')}
        </section>
        ${tl ? `
        <section class="card owner__card" data-stagger>
          <div class="owner__h"><b>Your top look this month</b><span class="demo-tag">Demo data</span></div>
          <div class="owner__toplook">
            <img src="${esc(sized(safeUrl(tl.photo), 300))}" alt="">
            <span><b>${esc(tl.title)}</b><span class="num">${tls.bookings} bookings · ${tls.views} views</span><small>Your Looks tab brings in bookings 📈</small></span>
          </div>
          <button class="btn btn--soft btn--block" data-owner-looks>See all looks with stats ${I.arrowR}</button>
        </section>` : ''}
        <section class="owner__cta" data-stagger>
          <p>While you were working, your assistant replied to <b class="num">${esc(o.questions)}</b> clients 💬</p>
          <a class="btn btn--dark btn--block" href="https://instagram.com/maksim.builds" ${ext}>Get this app for my studio ${I.arrowR}</a>
          <small>All numbers on this screen are demo data.</small>
        </section>
      </div>`;
    app.appendChild(ownerEl);

    const g = G();
    if (g) ensure(g.fromTo(ownerEl, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.55, ease: SPRING, clearProps: 'opacity,transform' }));
    springIn($$('[data-stagger], .metric', ownerEl), { delay: 0.12, stagger: 0.06 });
    setTimeout(() => {
      $$('.metric', ownerEl).forEach(countUp);
      if (g) {
        // bars grow from the bottom, the numbers ride up with them
        ensure(g.fromTo($$('.ochart__bar', ownerEl), { scaleY: 0 }, { scaleY: 1, transformOrigin: '50% 100%', duration: 0.8, ease: SPRING, stagger: 0.06, clearProps: 'transform' }));
        ensure(g.fromTo($$('.ochart__v', ownerEl), { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.06, delay: 0.25, ease: SPRING, clearProps: 'opacity,transform' }));
      }
      $$('.owner__track i', ownerEl).forEach(i => i.classList.add('is-in'));
    }, 350);
    pushOverlay(closeOwnerUI);
    syncOwnerBanner();
  }

  function closeOwnerUI() {
    const el = ownerEl;
    ownerEl = null;
    if (!el) return;
    syncOwnerBanner();
    if (ownerAfter) { const next = ownerAfter; ownerAfter = null; setTimeout(next, 120); }
    const g = G();
    if (g) ensure(g.to(el, { opacity: 0, y: 24, duration: 0.3, ease: 'power2.in', onComplete: () => el.remove() }));
    else el.remove();
  }

  /* Long-press (1s) on the hero avatar opens the owner view */
  /* Long-press (500ms, own timer) on the hero avatar opens the owner view.
     iOS would otherwise show its image preview / drag "ghost": the avatar
     cancels touchstart + contextmenu, and images can't be dragged at all. */
  const HOLD_MS = 500;
  function bindOwnerPress() {
    const wrap = $('[data-owner-hold]', views.home);
    if (!wrap) return;
    let timer = 0;
    let start = null;
    const cancel = () => {
      clearTimeout(timer);
      start = null;
      wrap.classList.remove('is-holding');
    };
    wrap.addEventListener('touchstart', e => { if (data.ownerDemo) e.preventDefault(); }, { passive: false });
    wrap.addEventListener('contextmenu', e => e.preventDefault());
    wrap.addEventListener('dragstart', e => e.preventDefault());
    wrap.addEventListener('pointerdown', e => {
      if (!data.ownerDemo || (e.pointerType === 'mouse' && e.button !== 0)) return;
      start = { x: e.clientX, y: e.clientY };
      void wrap.offsetWidth; // restart the progress ring
      wrap.classList.add('is-holding');
      timer = setTimeout(() => {
        cancel();
        try { if (navigator.vibrate) navigator.vibrate(15); } catch (err) { /* not supported */ }
        openOwner({ quiet: true });
      }, HOLD_MS);
    });
    wrap.addEventListener('pointermove', e => {
      if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => wrap.addEventListener(t, cancel));
    document.addEventListener('visibilitychange', cancel);
  }

  /* ---------------------------------------------------------
     Offline
     --------------------------------------------------------- */
  function cacheForOffline() {
    store.set('offline', {
      name: data.name,
      city: data.city,
      phone: data.phone,
      services: data.services.map(s => ({ title: s.title, price: s.price, duration: s.duration, category: s.category })),
      savedAt: Date.now()
    });
  }

  function showOffline() {
    const c = store.get('offline', null);
    splashActive = false;
    applySettings();
    app.classList.remove('is-splash');
    const splash = $('#splash');
    if (splash) splash.remove();
    tabbar.hidden = true;
    const box = document.createElement('div');
    box.className = 'offline';
    const saved = c && c.savedAt ? new Date(c.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
    box.innerHTML = `
      <div class="mesh" aria-hidden="true"><i></i><i></i><i></i></div>
      <div class="offline__inner">
        <span class="offline__icon">${svg('<path d="M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r=".9" fill="currentColor"/><path d="m3 3 18 18"/>')}</span>
        <h1>You’re offline</h1>
        <p>${c ? `Here’s what we saved${saved ? ' on ' + esc(saved) : ''} — prices may have changed.` : 'Connect to the internet to see the studio.'}</p>
        ${c && c.services && c.services.length ? `
        <div class="card offline__list">
          <div class="offline__name"><b>${esc(c.name)}</b>${c.city ? `<small>${esc(c.city)}</small>` : ''}</div>
          ${c.services.map(s => `<div class="offline__row"><span>${esc(s.title)}<small>${esc(s.duration || '')}</small></span><b class="num">${esc(price(s.price))}</b></div>`).join('')}
        </div>` : ''}
        <button class="btn btn--primary btn--block" data-retry>Try again</button>
        ${c && c.phone ? `<a class="btn btn--soft btn--block" href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ''))}">Call ${esc(c.phone)}</a>` : ''}
      </div>`;
    app.appendChild(box);
    $('[data-retry]', box).addEventListener('click', () => location.reload());
    springIn($$('.offline__inner > *', box), { stagger: 0.06 });
  }

  /* A slim banner while the app is running without a connection */
  function syncOnline() {
    let bar = $('#offline-bar');
    if (navigator.onLine) {
      if (bar) {
        bar.classList.remove('is-shown');
        setTimeout(() => { if (navigator.onLine && bar.parentNode) bar.remove(); }, 400);
        toast('Back online', 'ok');
      }
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'offline-bar';
      bar.className = 'offline-bar';
      bar.innerHTML = `${svg('<path d="M2.5 9a15 15 0 0 1 19 0M5.5 12.5a10 10 0 0 1 13 0M8.5 16a5 5 0 0 1 7 0"/><path d="m3 3 18 18"/>')}<span>You’re offline · showing saved info</span>`;
      app.appendChild(bar);
    }
    requestAnimationFrame(() => bar.classList.add('is-shown'));
  }

  /* ---------------------------------------------------------
     Onboarding — 3 slides on the very first launch (per master)
     --------------------------------------------------------- */
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  /* A tiny animated phone showing Share → Add to Home Screen */
  function a2hsMock() {
    const shareIcon = svg('<path d="M12 14.5V3.5M8 7.5l4-4 4 4"/><path d="M8.5 10.5H7A2.5 2.5 0 0 0 4.5 13v5A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-5a2.5 2.5 0 0 0-2.5-2.5h-1.5"/>');
    return `
      <div class="a2hs" aria-hidden="true">
        <div class="a2hs__screen">
          <div class="a2hs__page">
            <i class="a2hs__hero"></i><i class="a2hs__line"></i><i class="a2hs__line a2hs__line--short"></i>
            <i class="a2hs__card"></i>
          </div>
          <div class="a2hs__bar">
            <i></i>
            <span class="a2hs__share">${shareIcon}<b class="a2hs__tap"></b></span>
            <i></i>
          </div>
          <div class="a2hs__sheet">
            <div class="a2hs__row">Copy<span>${svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>')}</span></div>
            <div class="a2hs__row">Add to Favorites<span>${svg('<path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>')}</span></div>
            <div class="a2hs__row a2hs__row--hi"><b class="a2hs__glow"></b>Add to Home Screen<span>${svg('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/>')}</span></div>
          </div>
        </div>
      </div>`;
  }

  /* The two slides after the Welcome screen ("Get started") */
  function showOnboarding(onDone) {
    const name = firstName();
    const svc = data.services[1] || data.services[0];
    const slides = [
      {
        art: `
          <div class="onb__art">
            <i class="onb__glow"></i>
            ${art('speech-balloon', 'onb__icon')}
            <span class="onb__bubble onb__bubble--me">How much is a full set?</span>
            <span class="onb__bubble">${svc ? `${esc(svc.title)} is ${esc(price(svc.price))} ✨` : 'Here are our prices ✨'}</span>
          </div>`,
        title: 'Ask anything, anytime',
        text: `${name}’s assistant answers prices, availability and aftercare instantly — 24/7.`
      },
      {
        art: a2hsMock(),
        title: 'Add to Home Screen',
        text: isStandalone() ? `You’re all set — ${data.name} lives on your Home Screen.`
          : 'Tap Share, then “Add to Home Screen” to keep the studio one tap away.'
      }
    ];

    const el = document.createElement('div');
    el.className = 'onb';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Welcome');
    el.innerHTML = `
      <div class="mesh" aria-hidden="true"><i></i><i></i><i></i></div>
      <button class="onb__skip">Skip</button>
      <div class="onb__viewport">
        <div class="onb__track">
          ${slides.map((s, i) => `
            <section class="onb__slide" aria-hidden="${i !== 0}">
              ${s.art}
              <h1 class="onb__title">${esc(s.title)}</h1>
              <p class="onb__text">${esc(s.text)}</p>
            </section>`).join('')}
        </div>
      </div>
      <div class="onb__dots">${slides.map((_, i) => `<i class="${i === 0 ? 'is-active' : ''}"></i>`).join('')}</div>
      <button class="btn btn--primary btn--block onb__next">Next</button>`;
    app.appendChild(el);
    app.classList.add('has-onb');

    const track = $('.onb__track', el);
    const viewport = $('.onb__viewport', el);
    const next = $('.onb__next', el);
    let index = 0;
    let closed = false;

    const show = (k, animate) => {
      index = clamp(k, 0, slides.length - 1);
      const g = G();
      if (g && animate) ensure(g.to(track, { xPercent: -100 * index, x: 0, duration: 0.65, ease: 'back.out(1.1)', overwrite: true }));
      else if (g) g.set(track, { xPercent: -100 * index, x: 0 });
      else track.style.transform = `translateX(${-100 * index}%)`;
      $$('.onb__dots i', el).forEach((d, i) => d.classList.toggle('is-active', i === index));
      $$('.onb__slide', el).forEach((s, i) => s.setAttribute('aria-hidden', i !== index));
      const last = index === slides.length - 1;
      const canInstall = installPrompt && !isStandalone();
      next.textContent = last ? (canInstall ? 'Install app' : 'Get started') : 'Next';
      if (last && canInstall) $$('.onb__text', el)[index].textContent = `Install ${data.name} to keep it one tap away — no App Store needed.`;
      if (animate) springIn($$('.onb__slide', el)[index].children, { y: 26, stagger: 0.07, delay: 0.1 });
    };

    const close = () => {
      if (closed) return;
      closed = true;
      store.set('onboarded', true);
      app.classList.remove('has-onb');
      document.removeEventListener('keydown', onKey);
      const g = G();
      const remove = () => { el.remove(); };
      if (g) ensure(g.to(el, { opacity: 0, scale: 1.04, duration: 0.45, ease: 'power2.out', onComplete: remove }));
      else remove();
      if (onDone) onDone();
    };

    next.addEventListener('click', () => {
      if (index < slides.length - 1) { show(index + 1, true); return; }
      if (installPrompt && !isStandalone()) {
        installPrompt.prompt();
        installPrompt = null;
      }
      close();
    });
    $('.onb__skip', el).addEventListener('click', close);

    // Swipe between slides (touch or mouse)
    let drag = null;
    viewport.addEventListener('pointerdown', e => {
      drag = { x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, axis: null };
      viewport.setPointerCapture(e.pointerId);
    });
    viewport.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.axis && Math.hypot(dx, dy) > 8) drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.axis !== 'x') return;
      const edge = (index === 0 && dx > 0) || (index === slides.length - 1 && dx < 0);
      drag.dx = edge ? dx * 0.3 : dx;
      if (window.gsap) window.gsap.set(track, { xPercent: -100 * index, x: drag.dx });
      else track.style.transform = `translateX(calc(${-100 * index}% + ${drag.dx}px))`;
    });
    const end = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.axis !== 'x') return;
      const v = d.dx / Math.max(1, performance.now() - d.t);
      if (d.dx < -60 || v < -0.4) show(index + 1, true);
      else if (d.dx > 60 || v > 0.4) show(index - 1, true);
      else show(index, true);
    };
    viewport.addEventListener('pointerup', end);
    viewport.addEventListener('pointercancel', end);

    const onKey = e => {
      if (e.key === 'ArrowRight') show(index + 1, true);
      if (e.key === 'ArrowLeft') show(index - 1, true);
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);

    show(0, false);
    springIn($$('.onb__slide', el)[0].children, { y: 30, stagger: 0.08, delay: 0.35 });
    springIn([$('.onb__dots', el), next, $('.onb__skip', el)], { y: 16, stagger: 0.05, delay: 0.55 });
    return el;
  }

  /* ---------------------------------------------------------
     Cosmos — a quiet night-sky layer behind the splash and Welcome.
     One <canvas> (stars, shooting stars, constellation) + 3 CSS light rays.
     ≤ 100 objects, DPR-aware, stops and removes itself as soon as its
     host leaves the page (so Home never runs it).
     opts.tone: 'auto' (theme) | 'onAccent' (on a colored card)
     --------------------------------------------------------- */
  function parseColor(str) {
    const s = String(str || '').trim();
    let m = s.match(/^#([0-9a-f]{6})$/i);
    if (m) { const n = parseInt(m[1], 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
    m = s.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (m) return [+m[1], +m[2], +m[3]].map(Math.round);
    m = s.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i);
    if (m) return [+m[1], +m[2], +m[3]].map(v => Math.round(v * 255));
    return [201, 121, 107];
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  /* A soft glow with a 4-point flare, rendered once and reused as a sprite */
  function flareSprite(color, size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const h = size / 2;
    const glow = g.createRadialGradient(h, h, 0, h, h, h);
    glow.addColorStop(0, rgba(color, 0.9));
    glow.addColorStop(0.12, rgba(color, 0.45));
    glow.addColorStop(0.4, rgba(color, 0.08));
    glow.addColorStop(1, rgba(color, 0));
    g.fillStyle = glow;
    g.fillRect(0, 0, size, size);
    const ray = (x0, y0, x1, y1) => {
      const lg = g.createLinearGradient(x0, y0, x1, y1);
      lg.addColorStop(0, rgba(color, 0));
      lg.addColorStop(0.5, rgba(color, 0.85));
      lg.addColorStop(1, rgba(color, 0));
      g.strokeStyle = lg;
      g.lineWidth = size * 0.022;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    };
    ray(h, size * 0.06, h, size * 0.94);
    ray(size * 0.06, h, size * 0.94, h);
    return c;
  }

  /* A simple figure in the top third (normalized coordinates) */
  const CONSTELLATION = {
    pts: [[0.12, 0.13], [0.24, 0.07], [0.37, 0.12], [0.5, 0.08], [0.63, 0.15], [0.74, 0.1], [0.66, 0.24]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [4, 6]]
  };

  function createCosmos(host, opts) {
    opts = opts || {};
    const reduced = reducedMQ.matches;
    const wrap = document.createElement('div');
    wrap.className = 'cosmos' + (opts.tone === 'onAccent' ? ' cosmos--on-accent' : '');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML = '<div class="cosmos__rays"><i></i><i></i><i></i></div><canvas class="cosmos__canvas"></canvas>';
    host.insertBefore(wrap, host.firstChild);
    const canvas = $('canvas', wrap);
    const ctx = canvas.getContext('2d');

    const dark = root.dataset.theme === 'dark';
    const onAccent = opts.tone === 'onAccent';
    const accent = parseColor(getComputedStyle(root).getPropertyValue('--accent'));
    const gold = [201, 162, 74];
    const white = [255, 255, 255];
    const ice = [214, 226, 255];
    // light theme: accent + gold stars (white would vanish); dark / colored card: white + icy blue
    const palette = dark ? [white, ice] : onAccent ? [white, [255, 236, 200]] : [accent, gold];
    const peak = dark ? 1 : onAccent ? 0.85 : 0.6; // max star alpha
    const floor = dark ? 0.3 : onAccent ? 0.25 : 0.35;
    const tailMid = dark || onAccent ? accent : gold;
    const tailHead = dark || onAccent ? white : accent;
    const sprites = palette.map(c => flareSprite(c, 64));

    // ----- objects (normalized positions, so resizing never re-seeds) -----
    const rnd = (a, b) => a + Math.random() * (b - a);
    const N = 80;
    const stars = Array.from({ length: N }, (_, i) => {
      const big = i < 6;
      return {
        x: rnd(0.02, 0.98),
        y: big ? rnd(0.04, 0.62) : rnd(0, 1),
        r: big ? rnd(1.5, 2) : rnd(0.6, 1.4),
        big,
        c: Math.random() < 0.7 ? 0 : 1,
        near: big || Math.random() < 0.35, // parallax layer
        ph: rnd(0, Math.PI * 2),
        sp: rnd(0.5, 1.6) // twinkle speed
      };
    });
    const shooters = [];
    const t0 = performance.now();
    let nextShot = t0 + (opts.quick ? 150 : 550);

    // ----- size (DPR capped at 2 to keep phones at 60fps) -----
    let W = 0;
    let H = 0;
    let dpr = 1;
    const resize = () => {
      const r = host.getBoundingClientRect();
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = W + 'px';
      canvas.style.height = H + 'px';
      if (reduced) draw(t0 + 5000);
    };

    // ----- parallax: mouse on desktop, tilt on phones -----
    const par = { tx: 0, ty: 0, x: 0, y: 0 };
    const onMove = e => {
      par.tx = (e.clientX / innerWidth - 0.5) * 2;
      par.ty = (e.clientY / innerHeight - 0.5) * 2;
    };
    const onTilt = e => {
      if (e.gamma == null) return;
      par.tx = clamp(e.gamma / 25, -1, 1);
      par.ty = clamp((e.beta - 45) / 25, -1, 1);
    };

    // ----- drawing -----
    function drawStars(t, layerNear, ox, oy) {
      stars.forEach(s => {
        if (s.near !== layerNear) return;
        const tw = reduced ? 0.8 : 0.5 + 0.5 * Math.sin(t * 0.001 * s.sp * 2 + s.ph);
        const a = peak * (floor + (1 - floor) * tw);
        const x = s.x * W + ox;
        const y = s.y * H + oy;
        if (s.big) {
          const size = (dark ? 30 : 24) + tw * 8;
          ctx.globalAlpha = a;
          ctx.drawImage(sprites[s.c], x - size / 2, y - size / 2, size, size);
        }
        ctx.globalAlpha = a;
        ctx.fillStyle = rgba(palette[s.c], 1);
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    function drawConstellation(t, ox, oy) {
      const P = CONSTELLATION.pts.map(p => [p[0] * W + ox, p[1] * H + oy]);
      const since = (t - t0) / 1000;
      const pulse = reduced ? 1 : 0.75 + 0.25 * Math.sin(t * 0.0021);
      ctx.lineWidth = 1;
      ctx.lineCap = 'round';
      CONSTELLATION.edges.forEach((e, i) => {
        // lines light up one after another, then gently pulse
        const k = reduced || opts.quick ? 1 : clamp((since - 0.2 - i * 0.16) / 0.35, 0, 1);
        if (k <= 0) return;
        const a = P[e[0]];
        const b = P[e[1]];
        ctx.strokeStyle = rgba(palette[0], (dark || onAccent ? 0.15 : 0.22) * pulse);
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k);
        ctx.stroke();
      });
      P.forEach((p, i) => {
        const k = reduced || opts.quick ? 1 : clamp((since - 0.1 - i * 0.14) / 0.3, 0, 1);
        if (k <= 0) return;
        ctx.globalAlpha = peak * k * (0.7 + 0.3 * pulse);
        ctx.fillStyle = rgba(palette[0], 1);
        ctx.beginPath();
        ctx.arc(p[0], p[1], 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = peak * 0.35 * k;
        ctx.drawImage(sprites[0], p[0] - 9, p[1] - 9, 18, 18);
      });
      ctx.globalAlpha = 1;
    }

    function spawnShooter(now) {
      const ang = rnd(25, 35) * Math.PI / 180;
      const speed = rnd(520, 760); // px/s
      shooters.push({
        x: rnd(0.35, 1.05) * W,
        y: rnd(-0.02, 0.3) * H,
        vx: -Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        len: rnd(80, 140),
        born: now,
        life: rnd(600, 900)
      });
    }

    function drawShooters(now) {
      for (let i = shooters.length - 1; i >= 0; i--) {
        const s = shooters[i];
        const age = now - s.born;
        if (age > s.life) { shooters.splice(i, 1); continue; }
        const p = age / s.life;
        const fade = Math.sin(Math.PI * Math.min(1, p * 1.1)); // in, then out
        const hx = s.x + s.vx * age / 1000;
        const hy = s.y + s.vy * age / 1000;
        const v = Math.hypot(s.vx, s.vy);
        const tx = hx - (s.vx / v) * s.len;
        const ty = hy - (s.vy / v) * s.len;
        const g = ctx.createLinearGradient(hx, hy, tx, ty);
        const a = (dark || onAccent ? 1 : 0.7) * fade;
        g.addColorStop(0, rgba(tailHead, a));
        g.addColorStop(0.35, rgba(tailMid, a * 0.55));
        g.addColorStop(1, rgba(tailMid, 0));
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(hx, hy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.globalAlpha = a;
        ctx.drawImage(sprites[0], hx - 8, hy - 8, 16, 16);
        ctx.globalAlpha = 1;
      }
    }

    function draw(now) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      par.x += (par.tx - par.x) * 0.06;
      par.y += (par.ty - par.y) * 0.06;
      const fx = -par.x * 4;
      const fy = -par.y * 4;
      drawStars(now, false, fx, fy);                  // far layer ±4px
      if (opts.constellation !== false) drawConstellation(now, fx, fy);
      drawStars(now, true, -par.x * 10, -par.y * 10); // near layer ±10px
      if (!reduced) drawShooters(now);
    }

    // ----- loop -----
    let raf = 0;
    let stopped = false;
    const frame = now => {
      if (stopped) return;
      if (!wrap.isConnected) { stop(); return; } // host left the page → clean up
      if (now >= nextShot && shooters.length < 2) {
        spawnShooter(now);
        nextShot = now + rnd(1200, 2500);
      }
      draw(now);
      raf = requestAnimationFrame(frame);
    };
    const ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    function stop() {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('deviceorientation', onTilt);
      wrap.remove();
    }

    resize();
    if (ro) ro.observe(host);
    if (reduced) {
      draw(t0 + 5000); // static sky: no twinkle, no shooting stars
      // no loop to stop — just drop the node once the host is gone
      const mo = new MutationObserver(() => { if (!wrap.isConnected) { mo.disconnect(); stop(); } });
      mo.observe(app, { childList: true, subtree: true });
    } else {
      if (window.matchMedia('(pointer: fine)').matches) window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('deviceorientation', onTilt, { passive: true });
      raf = requestAnimationFrame(frame);
    }
    return { stop, el: wrap };
  }

  /* ---------------------------------------------------------
     Welcome — first launch only (before the onboarding slides)
     --------------------------------------------------------- */
  const isNails = () => /nail|mani|pedi|gel/i.test(data.services.map(s => s.category + ' ' + s.title).join(' '));

  function showWelcome(onDone) {
    const rating = ratingText();
    const next = data.slots[0] || data.nextAvailable || '';
    const words = String(data.name).trim().split(/\s+/);
    const text = data.welcomeText || `Book, ask and get your ${isNails() ? 'nail' : 'lash'} look — all in one place.`;
    const el = document.createElement('div');
    el.className = 'welcome';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Welcome');
    el.innerHTML = `
      <div class="welcome__top">
        ${data.heroPhoto ? `<div class="welcome__photo"><img src="${esc(sized(safeUrl(data.heroPhoto), 900))}" alt=""></div>` : art(splashEmoji(), 'welcome__emoji')}
        ${rating ? `<span class="wchip wchip--a"><b class="star">★</b> <b class="num">${rating}</b> · ${esc(data.reviewCount || data.reviews.length)} reviews</span>` : ''}
        ${next ? `<span class="wchip wchip--b"><i></i>Next: ${esc(next)}</span>` : ''}
      </div>
      <div class="welcome__bottom">
        <h1 class="welcome__title">Welcome to<br><span>${esc(words.join(' '))}</span></h1>
        <p class="welcome__text">${esc(text)}</p>
        <button class="btn btn--primary btn--block welcome__go" data-welcome-go>Get started</button>
        <button class="welcome__guest" data-welcome-guest>Browse as guest</button>
      </div>`;
    app.appendChild(el);
    app.classList.add('has-onb');
    createCosmos($('.welcome__top', el), { tone: root.dataset.theme === 'dark' ? 'auto' : 'onAccent' });

    let closed = false;
    const leave = then => {
      if (closed) return;
      closed = true;
      const g = G();
      const done = () => { el.remove(); then(); };
      if (g) ensure(g.to(el, { opacity: 0, y: -16, duration: 0.3, ease: 'power2.in', onComplete: done }));
      else done();
    };
    $('[data-welcome-go]', el).addEventListener('click', () => {
      haptic();
      // the onboarding slides are laid out underneath, then the welcome fades off them
      showOnboarding(onDone);
      leave(() => {});
    });
    $('[data-welcome-guest]', el).addEventListener('click', () => {
      store.set('onboarded', true);
      leave(() => { app.classList.remove('has-onb'); if (onDone) onDone(); });
    });

    const g = G();
    if (g) {
      ensure(g.fromTo($('.welcome__top', el), { yPercent: -100 }, { yPercent: 0, duration: 0.9, ease: 'back.out(1.1)', clearProps: 'transform' }));
      const photo = $('.welcome__photo, .welcome__emoji', el);
      if (photo) ensure(g.fromTo(photo, { y: 40, opacity: 0, rotate: 4 }, { y: 0, opacity: 1, rotate: -3, duration: 0.9, delay: 0.25, ease: SPRING, clearProps: 'transform,opacity' }));
      springIn($$('.wchip', el), { delay: 0.55, stagger: 0.12, y: 16, scale: 0.8, ease: ELASTIC, duration: 1 });
      springIn($$('.welcome__bottom > *', el), { delay: 0.35, stagger: 0.07, y: 28 });
    }
    return el;
  }

  /* ---------------------------------------------------------
     15. Splash — calm and clean ("clean") or full-bleed photo ("photo")
     splashStyle in JSON, or ?splash=clean|photo in the address (wins)
     --------------------------------------------------------- */
  function splashEmoji() {
    if (data.splashEmoji) return data.splashEmoji;
    return isNails() ? 'Nail polish' : 'Sparkles';
  }
  const splashStyle = () => {
    const s = SPLASH_PARAM || data.splashStyle;
    return s === 'photo' && data.heroPhoto ? 'photo' : 'clean';
  };

  /* Two-tone logo: first word in the text color, the rest in the accent */
  function logoHTML(cls) {
    const words = String(data.name).trim().split(/\s+/);
    const first = words.shift();
    return `<div class="${cls}">${esc(first)}${words.length ? ` <span>${esc(words.join(' '))}</span>` : ''}</div>`;
  }

  /* Hand over from the splash to the app */
  function afterSplash(short) {
    splashActive = false;
    applySettings();
    app.classList.remove('is-splash', 'is-splash-photo');
    go('home', { force: true, silent: true });
    const first = !short && !store.get('onboarded') && !LOOK_PARAM; // a shared look link skips the Welcome
    if (params.get('owner') === '1') setTimeout(openOwner, first ? 200 : 900);
    else if (ownerMode) setOwnerMode(true);
    if (LOOK_PARAM) setTimeout(openLookFromLink, 650);
    return first;
  }

  function splashClean(splash, short) {
    splash.classList.add('splash--clean');
    $('.splash__inner', splash).innerHTML = `
      <div class="splash__stack">
        <div class="splash__art">
          <div class="splash__float"><img class="splash__emoji" src="${esc(icon3d(splashEmoji()))}" alt=""></div>
          <i class="splash__shadow"></i>
        </div>
        ${logoHTML('splash__logo')}
        ${data.tagline ? `<div class="splash__tag">${esc(data.tagline)}</div>` : ''}
      </div>
      <div class="splash__dots" aria-hidden="true"><i></i><i></i><i></i></div>`;
    createCosmos(splash, { quick: short });
    const img = $('.splash__emoji', splash);
    return Promise.race([img.decode ? img.decode().catch(() => {}) : null, wait(500)]).then(() => new Promise(resolve => {
      const g = G();
      const shell = $('#shell');
      const finish = () => {
        const first = afterSplash(short);
        const leaveTo = first ? showWelcome(() => revealHome()) : shell;
        if (!first) revealHome();
        if (!g) { splash.remove(); resolve(); return; }
        // the composition floats up and dissolves, the app rises from below
        const tl = g.timeline({ onComplete: () => { splash.remove(); resolve(); } });
        tl.to($('.splash__stack', splash), { y: -20, opacity: 0, duration: 0.3, ease: 'power2.in' }, 0)
          .to($('.splash__dots', splash), { opacity: 0, duration: 0.2 }, 0)
          .to(splash, { opacity: 0, duration: 0.35, ease: 'power2.out' }, 0.15);
        if (leaveTo === shell) tl.fromTo(shell, { y: 30 }, { y: 0, duration: 0.55, ease: 'power3.out', clearProps: 'transform' }, 0.15);
        ensure(tl, 300, false);
      };
      if (!g) { setTimeout(finish, short ? 600 : 1600); return; }
      const tl = g.timeline({ onComplete: finish });
      const art = $('.splash__art', splash);
      if (short) {
        tl.fromTo(art, { y: 14, scale: 0.9, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.35, ease: SPRING }, 0)
          .fromTo($$('.splash__logo, .splash__tag', splash), { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.05, ease: 'power2.out' }, 0.08)
          .set({}, {}, 0.6);
      } else {
        tl.fromTo(art, { y: 30, scale: 0.8, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.8, ease: 'back.out(1.7)' }, 0)
          .fromTo($('.splash__logo', splash), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.6, ease: SPRING }, 0.25);
        if ($('.splash__tag', splash)) tl.fromTo($('.splash__tag', splash), { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.6, ease: SPRING }, 0.45);
        tl.fromTo($('.splash__dots', splash), { opacity: 0 }, { opacity: 1, duration: 0.4, ease: 'power2.out' }, 0.5)
          .set({}, {}, 1.6);
      }
      ensure(tl, 400, false);
      splash.addEventListener('pointerdown', () => tl.progress(1), { once: true });
    }));
  }

  function splashPhoto(splash, short) {
    splash.classList.add('splash--photo');
    app.classList.add('is-splash-photo');
    $('.splash__inner', splash).innerHTML = `
      <div class="splash__photo"><div class="splash__zoom"><img class="splash__img" src="${esc(safeUrl(data.heroPhoto))}" alt=""></div></div>
      <div class="splash__caption">
        ${logoHTML('splash__logo splash__logo--white')}
        ${data.tagline ? `<div class="splash__tag">${esc(data.tagline)}</div>` : ''}
        <div class="splash__bar"><i></i></div>
      </div>`;
    const img = $('.splash__img', splash);
    return Promise.race([img.decode ? img.decode().catch(() => {}) : null, wait(1500)]).then(() => new Promise(resolve => {
      const g = G();
      const layout = placeSplashPhoto(splash);
      const finish = () => {
        const first = afterSplash(short);
        if (first) {
          // first launch: the Welcome screen takes over from the photo
          showWelcome(() => revealHome());
          if (!g) { splash.remove(); resolve(); return; }
          ensure(g.to(splash, { opacity: 0, duration: 0.35, ease: 'power2.out', onComplete: () => { splash.remove(); resolve(); } }));
          return;
        }
        flyToHero(splash, layout, g).then(resolve);
      };
      if (!g) { setTimeout(finish, short ? 600 : 1600); return; }
      const tl = g.timeline({ onComplete: finish });
      if (short) {
        tl.fromTo($('.splash__zoom', splash), { opacity: 0 }, { opacity: 1, duration: 0.25, ease: 'power2.out' }, 0)
          .fromTo($('.splash__caption', splash), { opacity: 0 }, { opacity: 1, duration: 0.25 }, 0.1)
          .set($('.splash__bar i', splash), { scaleX: 1 }, 0)
          .set({}, {}, 0.6);
      } else {
        tl.fromTo($('.splash__zoom', splash), { scale: 1.08 }, { scale: 1, duration: 1.6, ease: 'power2.out' }, 0)
          .fromTo($$('.splash__logo, .splash__tag', splash), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.7, stagger: 0.12, ease: SPRING }, 0.25)
          .fromTo($('.splash__bar', splash), { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0.2)
          .fromTo($('.splash__bar i', splash), { scaleX: 0 }, { scaleX: 1, duration: 1.4, ease: 'power1.inOut' }, 0.2)
          .set({}, {}, 1.6);
      }
      ensure(tl, 400, false);
      splash.addEventListener('pointerdown', () => tl.progress(1), { once: true });
    }));
  }

  /* Lay the photo out exactly (no object-fit) so it can be FLIP-ed onto the hero */
  function placeSplashPhoto(splash) {
    const img = $('.splash__img', splash);
    const box = app.getBoundingClientRect();
    const W = box.width;
    const H = box.height;
    const nw = img.naturalWidth || 3;
    const nh = img.naturalHeight || 4;
    const s = Math.max(W / nw, H / nh);
    const L = { w: nw * s, h: nh * s };
    L.x = (W - L.w) * 0.5;
    L.y = (H - L.h) * 0.35;
    img.style.cssText = `width:${L.w}px;height:${L.h}px;left:${L.x}px;top:${L.y}px`;
    return Object.assign(L, { nw, nh, W, H });
  }

  /* The photo shrinks and settles into the hero (transform + clip-path only) */
  function flyToHero(splash, L, g) {
    return new Promise(resolve => {
      const done = () => { splash.remove(); resolve(); };
      const heroMedia = $('.hero__media', views.home);
      if (!g || !heroMedia) { done(); return; }
      const box = app.getBoundingClientRect();
      const hr = heroMedia.getBoundingClientRect();
      const hx = hr.left - box.left;
      const hy = hr.top - box.top;
      // where the hero draws the same photo: object-fit cover at 50% 35%, inside a 1.05 tilt layer
      const s2 = Math.max(hr.width / L.nw, hr.height / L.nh);
      const w2 = L.nw * s2;
      const h2 = L.nh * s2;
      const k = 1.05;
      const cx = hx + hr.width / 2;
      const cy = hy + hr.height / 2;
      const left2 = cx + ((hr.width - w2) * 0.5 - hr.width / 2) * k;
      const top2 = cy + ((hr.height - h2) * 0.35 - hr.height / 2) * k;
      const scale = (w2 * k) / L.w;
      const img = $('.splash__img', splash);
      const photo = $('.splash__photo', splash);
      const radius = parseFloat(getComputedStyle(heroMedia).borderBottomLeftRadius) || 34;
      heroMedia.style.visibility = 'hidden';
      splash.classList.add('is-landing');
      const tl = g.timeline({
        onComplete: () => {
          heroMedia.style.visibility = '';
          ensure(g.to(splash, { opacity: 0, duration: 0.2, ease: 'power1.out', onComplete: done }));
        }
      });
      tl.to($('.splash__caption', splash), { opacity: 0, y: 10, duration: 0.25, ease: 'power2.in' }, 0)
        .to(img, { x: left2 - L.x, y: top2 - L.y, scale, transformOrigin: '0 0', duration: 0.75, ease: 'power3.inOut' }, 0.05)
        .fromTo(photo, { clipPath: 'inset(0px 0px 0px 0px round 0px 0px 0px 0px)' },
          { clipPath: `inset(${hy}px ${L.W - hx - hr.width}px ${L.H - hy - hr.height}px ${hx}px round 0px 0px ${radius}px ${radius}px)`, duration: 0.75, ease: 'power3.inOut' }, 0.05)
        .to($('.splash__shade', splash) || {}, { opacity: 0, duration: 0.5 }, 0.05);
      // the rest of Home cascades in while the photo lands
      tl.call(() => revealHome({ intro: true, noZoom: true }), [], 0.45);
      ensure(tl, 300, false);
    });
  }

  async function runSplash() {
    const splash = $('#splash');
    let short = false;
    try {
      short = sessionStorage.getItem(KEY + ':intro') === '1';
      sessionStorage.setItem(KEY + ':intro', '1');
    } catch (e) { /* private mode */ }
    splash.classList.toggle('is-short', short);
    await Promise.race([document.fonts && document.fonts.ready, wait(600)]);
    if (splashStyle() === 'photo') await splashPhoto(splash, short);
    else await splashClean(splash, short);
  }

  function showError() {
    splashActive = false;
    applySettings();
    app.classList.remove('is-splash');
    const splash = $('#splash');
    if (splash) splash.remove();
    tabbar.hidden = true;
    const box = document.createElement('div');
    box.className = 'error-state';
    box.innerHTML = `
      ${art('sparkles')}
      <h1>This studio page isn’t available</h1>
      <p>Check the link and try again.</p>`;
    app.appendChild(box);
  }

  /* ---------------------------------------------------------
     16. PWA — per-master manifest, icons & service worker
     --------------------------------------------------------- */
  async function setupPWA() {
    const abs = u => new URL(u, location.href).href;
    const startUrl = abs(params.has('m') ? './?m=' + encodeURIComponent(SLUG) : './');
    // Icons are real PNG files made by tools/make-icon.js (opaque, iOS-safe).
    // A master can have their own set: "iconDir": "img/<slug>/" in their JSON.
    const dir = String(data.iconDir || './img/').replace(/\/?$/, '/');
    const icons = [
      { src: abs(dir + 'icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: abs(dir + 'icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: abs(dir + 'icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ];
    const touchIcon = abs(dir + 'apple-touch-icon.png');

    const manifest = {
      id: startUrl,
      name: data.name,
      short_name: data.name.length > 14 ? data.name.split(/\s+/).slice(0, 2).join(' ') : data.name,
      description: data.tagline || '',
      start_url: startUrl,
      scope: abs('./'),
      display: 'standalone',
      orientation: 'portrait',
      background_color: THEME_BG.light,
      theme_color: data.brandAccent,
      icons
    };

    const link = $('link[rel="manifest"]');
    if (link) link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));

    const touch = $('link[rel="apple-touch-icon"]');
    if (touch) touch.href = touchIcon;
    const title = $('meta[name="apple-mobile-web-app-title"]');
    if (title) title.content = manifest.short_name;
  }

  function registerSW() {
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register('./sw.js').catch(() => { /* offline support is optional */ });
    }
  }

  /* ---------------------------------------------------------
     17. Desktop: QR code next to the phone frame
     --------------------------------------------------------- */
  function setupDesktop() {
    const mq = window.matchMedia('(min-width: 760px)');
    let done = false;
    const make = () => {
      if (done || !mq.matches) return;
      done = true;
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      s.onload = () => {
        const box = $('#qr');
        box.innerHTML = '';
        /* global QRCode */
        new QRCode(box, {
          text: location.href, width: 160, height: 160,
          colorDark: '#16161A', colorLight: '#FFFFFF', correctLevel: QRCode.CorrectLevel.M
        });
        box.removeAttribute('title');
      };
      document.head.appendChild(s);
    };
    make();
    mq.addEventListener && mq.addEventListener('change', make);
    tickClock();
  }

  function tickClock() {
    const el = $('#sb-time');
    if (!el) return;
    const d = new Date();
    el.textContent = (d.getHours() % 12 || 12) + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /* ---------------------------------------------------------
     18. Init
     --------------------------------------------------------- */
  async function init() {
    app = $('#app');
    tabbar = $('#tabbar');
    sub = $('#subview');
    $$('#views > .view').forEach(v => { views[v.dataset.view] = v; });
    history.replaceState({ ov: 0 }, '');

    bindEvents();
    setupDesktop();
    registerSW();

    try {
      const res = await fetch('./masters/' + SLUG + '.json', { cache: 'no-cache' });
      if (!res.ok) throw Object.assign(new Error('HTTP ' + res.status), { http: true });
      data = normalizeData(await res.json());
    } catch (e) {
      console.error('[Studio App] Could not load master "' + SLUG + '":', e);
      // no network (and nothing in the service-worker cache) → offline screen
      if (!e.http && (!navigator.onLine || e instanceof TypeError)) showOffline();
      else showError();
      return;
    }
    cacheForOffline();

    brandAccent = data.brandAccent;
    store.set('brand', brandAccent);
    adoptStyle(readStyle('styleUser') || data.style);
    store.set('style', STYLE);
    applyMotion();
    applySettings();
    document.title = data.name;

    watchImages();
    renderHome();
    renderServices();
    renderAsk();
    renderGallery();
    renderMore();
    refreshStatus();
    bindScrollers();
    bindHeroTilt();
    bindOwnerPress();
    bindLoyaltySheen();
    window.addEventListener('offline', syncOnline);
    window.addEventListener('online', syncOnline);
    if (!navigator.onLine) syncOnline();
    setInterval(() => settleImages(), 3000);

    setupPWA();
    await runSplash();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Exposed so it can be swapped for a real AI later (or tested from the console)
  window.StudioApp = { getAnswer: q => getAnswer(q), get data() { return data; } };
})();
