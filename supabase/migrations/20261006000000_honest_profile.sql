-- =========================================================
-- No made-up numbers for real studios
--   • booking_json: + client_visits (her completed visits) — the loyalty
--     card counts real visits, not a number from a template
--   • the test studio keeps only what a master sets herself; the demo
--     numbers, reviews, stories, promo and loyalty progress were copied
--     from the demo JSON and are removed
-- =========================================================

create or replace function private.booking_json(b public.bookings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id,
    'manage_token', b.manage_token,
    'status', b.status,
    'start_at', b.start_at,
    'end_at', b.end_at,
    'price', b.price,
    'service_id', b.service_id,
    'service_name', b.service_name,
    'service_photo', s.photo,
    'duration_min', s.duration_min,
    'fill_weeks', s.fill_weeks,
    'client_name', c.name,
    'client_note', b.client_note,
    'client_visits', (select count(*)::int from public.bookings v where v.client_id = b.client_id and v.status = 'completed'),
    'late_cancel', b.late_cancel,
    'cancelled_at', b.cancelled_at,
    'cancel_reason', b.cancel_reason,
    'updated_at', b.updated_at,
    'completed_at', b.completed_at,
    'deposit', b.deposit,
    'deposit_status', b.deposit_status,
    'deposit_due_at', b.deposit_due_at,
    'can_change', b.status in ('pending', 'confirmed') and b.start_at > now(),
    'late_now', b.start_at - now() < make_interval(hours => m.cancel_window_hours),
    'master', jsonb_build_object(
      'slug', m.slug, 'name', m.name, 'timezone', m.timezone,
      'cancel_window_hours', m.cancel_window_hours, 'auto_confirm', m.auto_confirm,
      'phone', m.settings ->> 'phone', 'address', m.settings ->> 'address',
      'payments', coalesce(m.settings -> 'payments', '{}'::jsonb),
      'review_url', m.settings ->> 'reviewUrl')
  )
  from public.masters m
  left join public.services s on s.id = b.service_id
  left join public.clients c on c.id = b.client_id
  where m.id = b.master_id;
$$;
revoke all on function private.booking_json(public.bookings) from public;

update public.masters
   set settings = settings - array['brandAccent', 'rating', 'reviewCount', 'stats', 'loyalty', 'referral', 'notice',
                                   'notifications', 'stories', 'reviews', 'promo', 'gallery', 'beforeAfter', 'extras', 'ownerDemo']
 where slug = 'test-studio';
