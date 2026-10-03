/* Studio App — backend config (copy to config.js and fill in).
   config.js is in .gitignore: GitHub Pages gets it from the deploy
   workflow (.github/workflows/pages.yml) using repository secrets.

   Supabase → Project Settings → API:
     supabaseUrl      "Project URL"
     supabaseAnonKey  the "anon" / "publishable" key — safe in a browser,
                      the database is protected by row level security.
   NEVER put the service_role / secret key here: it bypasses all security.

   Without this file the app still works: demo masters (masters/<slug>.json)
   and "external" booking links need no backend at all. */
window.STUDIO_CONFIG = {
  supabaseUrl: 'https://YOUR-PROJECT-REF.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY',
  // where every link points (emails, QR cards, sharing); on Pages the workflow fills it in
  baseUrl: 'https://moniyy.github.io/studio-app/',
  // push notifications for the master: the PUBLIC VAPID key (README → Push)
  vapidPublicKey: 'YOUR-VAPID-PUBLIC-KEY'
};
