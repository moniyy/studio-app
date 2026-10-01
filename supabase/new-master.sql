-- =========================================================
-- A new studio with real online booking.
-- Paste into Supabase → SQL Editor, change the values, Run.
-- Then: the master opens https://moniyy.github.io/studio-app/?m=bella-nails&owner=1,
-- signs in with owner_email and manages hours and bookings herself.
-- (Photos, texts, gallery, policies… can live in masters/bella-nails.json —
--  add "bookingEngine": "builtin" there — or in "settings" below.)
-- =========================================================
with m as (
  insert into public.masters (slug, name, owner_email, timezone, style, accent, settings,
                              booking_engine, auto_confirm, min_notice_hours, max_days_ahead, cancel_window_hours, slot_step_min)
  values (
    'bella-nails',                 -- the link: ?m=bella-nails (a–z, 0–9, - and _)
    'Bella Nails',
    'bella@example.com',           -- she signs in with this email
    'America/Chicago',             -- her time zone (America/New_York, America/Los_Angeles, …)
    'noir',                        -- noir | maison | soft
    '#F4A6B8',
    '{
       "tagline": "Gel, acrylic & nail art in Austin",
       "city": "Austin, TX",
       "address": "123 Congress Ave, Austin, TX 78701",
       "phone": "+1 512 555 0100",
       "instagram": "bella.nails",
       "avatar": "https://…/avatar.jpg",
       "heroPhoto": "https://…/hero.jpg"
     }'::jsonb,
    'builtin',                     -- builtin = bookings here · external = her own booking link (settings.bookingUrl)
    true,                          -- auto-confirm (false = every booking waits for her approval)
    2,                             -- minimum notice, hours
    60,                            -- how far ahead clients can book, days
    24,                            -- free cancellation up to N hours before
    30                             -- start times every N minutes
  )
  returning id
), s as (
  insert into public.services (master_id, category, name, description, duration_min, buffer_min, price, deposit, photo, sort)
  select m.id, x.* from m, (values
    ('Manicure', 'Gel Manicure',       'Long-lasting gel color.', 60, 10, 45, 0, null, 1),
    ('Manicure', 'Nail Art (add-on)',  'Two accent nails.',       15,  0, 15, 0, null, 2),
    ('Extensions', 'Acrylic Full Set', 'Shape and length of your choice.', 90, 15, 75, 20, null, 3)
  ) as x(category, name, description, duration_min, buffer_min, price, deposit, photo, sort)
  returning 1
)
-- Mon–Fri 10–2 and 3–7 (lunch break), Sat 10–4; she can change it all in the dashboard
insert into public.working_hours (master_id, weekday, start_time, end_time)
select m.id, d, t.s, t.e
  from m, generate_series(1, 5) d, (values (time '10:00', time '14:00'), (time '15:00', time '19:00')) t(s, e)
union all
select m.id, 6, time '10:00', time '16:00' from m;
