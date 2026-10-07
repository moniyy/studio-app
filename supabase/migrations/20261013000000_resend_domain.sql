-- satinbook.com: emails through Resend (free plan: 100 a day, 3000 a month) and the move
-- of the app from moniyy.github.io/studio-app/ to https://satinbook.com/.

-- ---------- 1. the sender's limits: Resend Free ----------
-- at most 95 in any 24 hours and 2950 in a calendar month (UTC) — a little room is left
-- for the password-reset emails Supabase Auth sends through the same account
create or replace function public.email_claim(p_limit int default 20) returns setof public.email_log
language plpgsql security definer set search_path = '' as $$
declare
  v_day int;
  v_month int;
  v_room int;
  v_free timestamptz;
begin
  select count(*) into v_day from public.email_log where status = 'sent' and sent_at > now() - interval '24 hours';
  select count(*) into v_month from public.email_log where status = 'sent' and sent_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  v_room := greatest(0, least(95 - v_day, 2950 - v_month));
  if v_room = 0 then
    -- the month is used up → its first day; else when the oldest send of the 24 hours turns a day old
    if v_month >= 2950 then
      v_free := (date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc';
    else
      select min(sent_at) + interval '24 hours' into v_free from public.email_log where status = 'sent' and sent_at > now() - interval '24 hours';
    end if;
    update public.email_log set send_after = v_free where status = 'queued' and send_after <= now();
    return;
  end if;
  return query
    update public.email_log l set status = 'sending', attempts = l.attempts + 1
     where l.id in (select id from public.email_log where status = 'queued' and send_after <= now()
                     order by send_after, created_at limit least(p_limit, v_room) for update skip locked)
    returning l.*;
end $$;
revoke all on function public.email_claim(int) from public, anon, authenticated;
grant execute on function public.email_claim(int) to service_role;

create or replace function public.admin_email_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'sent_24h', (select count(*) from public.email_log where status = 'sent' and sent_at > now() - interval '24 hours'),
    'sent_month', (select count(*) from public.email_log where status = 'sent' and sent_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'),
    'queued', (select count(*) from public.email_log where status = 'queued'),
    'waiting', (select count(*) from public.email_log where status = 'queued' and send_after > now() + interval '1 minute'),
    'failed_24h', (select count(*) from public.email_log where status = 'failed' and created_at > now() - interval '24 hours'),
    'limit_day', 100, 'limit_month', 3000);
end $$;
revoke all on function public.admin_email_stats() from public, anon;
grant execute on function public.admin_email_stats() to authenticated;

-- ---------- 2. push devices remember their web address ----------
-- An app installed from the old address keeps its own subscription after the move. Once a
-- master turns notifications on in the app from satinbook.com, the old one gets nothing
-- more (send-push prefers subscriptions of the current address) — no double notifications.
alter table public.push_subscriptions add column if not exists app_origin text;
drop function if exists public.owner_push_subscribe(uuid, text, text, text, text);
create or replace function public.owner_push_subscribe(p_master_id uuid, p_endpoint text, p_p256dh text, p_auth text,
                                                       p_label text default '', p_origin text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.push_subscriptions;
begin
  if not private.can_view_studio(p_master_id) then raise exception 'forbidden'; end if;
  if p_endpoint !~ '^https://' or length(p_p256dh) < 80 or length(p_auth) < 16 then raise exception 'bad_subscription'; end if;
  insert into public.push_subscriptions (master_id, user_id, endpoint, p256dh, auth, device_label, app_origin)
  values (p_master_id, auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_label, ''), 80),
          case when p_origin ~ '^https?://[^/\s]+$' then lower(p_origin) end)
  on conflict (endpoint) do update
    set master_id = excluded.master_id, user_id = excluded.user_id, p256dh = excluded.p256dh,
        auth = excluded.auth, device_label = excluded.device_label, app_origin = coalesce(excluded.app_origin, public.push_subscriptions.app_origin)
  returning * into r;
  return jsonb_build_object('id', r.id, 'device_label', r.device_label, 'created_at', r.created_at);
end $$;
revoke all on function public.owner_push_subscribe(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.owner_push_subscribe(uuid, text, text, text, text, text) to authenticated;

-- ---------- 3. the dashboard knows how old a studio is (the "We moved" note) ----------
create or replace function public.owner_studios() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'slug', m.slug, 'name', m.name, 'timezone', m.timezone,
           'booking_engine', m.booking_engine, 'auto_confirm', m.auto_confirm,
           'min_notice_hours', m.min_notice_hours, 'max_days_ahead', m.max_days_ahead,
           'cancel_window_hours', m.cancel_window_hours, 'slot_step_min', m.slot_step_min,
           'phone', m.settings ->> 'phone', 'address', m.settings ->> 'address',
           'status', m.status, 'kind', m.kind, 'created_at', m.created_at,
           'mine', m.owner_id = auth.uid() or private.my_staff_id(m.id) is not null,
           'role', case when m.owner_id = auth.uid() then 'owner' when private.my_staff_id(m.id) is not null then 'staff' else 'admin' end,
           'staff_id', private.my_staff_id(m.id)) order by m.created_at), '[]'::jsonb)
    from public.masters m;
$$;
