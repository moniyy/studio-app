-- Part 5: emails to clients and masters through the studio Gmail (SMTP in the
-- send-email Edge Function). The database decides WHAT to send and WHEN; every
-- email is a row in email_log (the log and the queue at once). The function
-- sends what is due, at most ~480 in 24 hours (Gmail's limit is ~500): the
-- rest waits in the queue until the window frees up.
--
-- What each studio sends: masters.settings.emails = { confirm, changes, reminders,
-- deposit, review, fill, alerts, day } (true / false; missing = the default below).

-- ---------- 1. data ----------
alter table public.clients add column if not exists marketing_opt_out boolean not null default false;
alter table public.clients add column if not exists unsub_token uuid not null default gen_random_uuid();
create unique index if not exists clients_unsub_token on public.clients (unsub_token);

alter table public.bookings add column if not exists reminded_24_at timestamptz;
alter table public.bookings add column if not exists reminded_2_at timestamptz;
alter table public.bookings add column if not exists review_mail_at timestamptz;
alter table public.bookings add column if not exists fill_mail_at timestamptz;

create table if not exists public.email_log (
  id          uuid primary key default gen_random_uuid(),
  master_id   uuid references public.masters (id) on delete cascade,
  -- checked at commit: a new booking queues its email before its own row is in
  booking_id  uuid references public.bookings (id) on delete set null deferrable initially deferred,
  kind        text not null,
  to_email    text not null,
  to_user     uuid,
  subject     text,
  status      text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  error       text,
  attempts    int not null default 0,
  send_after  timestamptz not null default now(),
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists email_log_due on public.email_log (send_after) where status = 'queued';
create index if not exists email_log_sent on public.email_log (sent_at) where status = 'sent';
create index if not exists email_log_master on public.email_log (master_id, created_at desc);
alter table public.email_log enable row level security;
drop policy if exists "owner: email log" on public.email_log;
create policy "owner: email log" on public.email_log for select to authenticated
  using (private.is_my_master(master_id) or private.is_admin());

-- where the database asks for sending: the email function next to the push function
do $$
declare
  v_push text;
begin
  select decrypted_secret into v_push from vault.decrypted_secrets where name = 'push_function_url';
  if v_push is not null and not exists (select 1 from vault.secrets where name = 'email_function_url') then
    perform vault.create_secret(replace(v_push, '/send-push', '/send-email'), 'email_function_url');
  end if;
exception when others then null;
end $$;

-- ---------- 2. which emails a studio sends ----------
create or replace function private.email_on(p_settings jsonb, p_kind text) returns boolean
language sql immutable set search_path = '' as $$
  select case
    when p_kind in ('confirm', 'request') then coalesce((p_settings -> 'emails' ->> 'confirm')::boolean, true)
    when p_kind in ('moved', 'cancelled') then coalesce((p_settings -> 'emails' ->> 'changes')::boolean, true)
    when p_kind in ('reminder_24', 'reminder_2') then coalesce((p_settings -> 'emails' ->> 'reminders')::boolean, true)
    when p_kind = 'deposit' then coalesce((p_settings -> 'emails' ->> 'deposit')::boolean, true)
    when p_kind = 'review' then coalesce((p_settings -> 'emails' ->> 'review')::boolean, true)
    when p_kind = 'fill' then coalesce((p_settings -> 'emails' ->> 'fill')::boolean, true)
    when p_kind = 'day' then coalesce((p_settings -> 'emails' ->> 'day')::boolean, false)
    else true
  end;
$$;

-- the account's email (owner / staff), for the master's own emails
create or replace function private.user_email(p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select email from auth.users where id = p_user;
$$;
revoke all on function private.user_email(uuid) from public;

-- ask the function to send what is due now (same hook secret as the push function)
create or replace function private.kick_email() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'email_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  if v_url is null or v_secret is null then return; end if;
  perform net.http_post(url := v_url, body := jsonb_build_object('process', true),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 30000);
exception when others then null;
end $$;

-- one email into the queue (if the studio sends this kind and there is an address)
create or replace function private.enqueue_email(p_kind text, p_master uuid, p_booking uuid, p_to text,
                                                 p_user uuid default null, p_data jsonb default '{}'::jsonb,
                                                 p_after timestamptz default now(), p_kick boolean default true)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_settings jsonb;
  v_id uuid;
  v_to text := lower(btrim(coalesce(p_to, '')));
begin
  if v_to !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return null; end if;
  -- reserved test domains never deliver (RFC 2606): no bounce, no use of the daily limit
  if v_to ~ '@(example\.(com|org|net)|[^@]+\.(test|invalid|example|localhost))$' then return null; end if;
  select settings into v_settings from public.masters where id = p_master;
  if not private.email_on(coalesce(v_settings, '{}'::jsonb), p_kind) then return null; end if;
  insert into public.email_log (master_id, booking_id, kind, to_email, to_user, data, send_after)
  values (p_master, p_booking, p_kind, v_to, p_user, coalesce(p_data, '{}'::jsonb), coalesce(p_after, now()))
  returning id into v_id;
  if p_kick and coalesce(p_after, now()) <= now() then perform private.kick_email(); end if;
  return v_id;
end $$;

-- ---------- 3. a booking changes → the client's (and maybe the masters') emails ----------
-- alerts to the owner and the booking's master: settings.emails.alerts = true → always;
-- false → never; not set → only to an account without push notifications on this studio
create or replace function private.alert_masters(b public.bookings, p_kind text, p_data jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.masters;
  v_mode text;
  r record;
begin
  select * into m from public.masters where id = b.master_id;
  v_mode := m.settings -> 'emails' ->> 'alerts';
  if v_mode = 'false' then return; end if;
  for r in
    select distinct u from (select m.owner_id as u union select st.user_id from public.staff st where st.id = b.staff_id) x
     where u is not null and u is distinct from auth.uid()
  loop
    if v_mode is null and exists (select 1 from public.push_subscriptions ps where ps.master_id = m.id and ps.user_id = r.u) then continue; end if;
    perform private.enqueue_email(p_kind, m.id, b.id, private.user_email(r.u), r.u, p_data);
  end loop;
end $$;

create or replace function private.email_on_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_by text := case when auth.uid() is null then 'client'
                    when exists (select 1 from public.masters mm where mm.id = new.master_id and mm.owner_id = auth.uid())
                      or exists (select 1 from public.staff st where st.master_id = new.master_id and st.user_id = auth.uid()) then 'studio'
                    else 'client' end;
  m public.masters;
begin
  select email into v_email from public.clients where id = new.client_id;
  select * into m from public.masters where id = new.master_id;
  if tg_op = 'INSERT' then
    if new.status in ('pending', 'confirmed') and new.deposit_status = 'pending' then
      perform private.enqueue_email('deposit', new.master_id, new.id, v_email);
    elsif new.status = 'pending' then
      perform private.enqueue_email('request', new.master_id, new.id, v_email);
    elsif new.status = 'confirmed' then
      perform private.enqueue_email('confirm', new.master_id, new.id, v_email);
    end if;
    if new.created_by = 'client' and new.status in ('pending', 'confirmed') then
      perform private.alert_masters(new, 'alert_new', '{}'::jsonb);
    end if;
    return new;
  end if;

  -- now confirmed: the deposit arrived (an approved booking), or the request was approved (no deposit waiting)
  if (new.status = 'confirmed' and old.deposit_status = 'pending' and new.deposit_status in ('paid', 'waived'))
     or (new.status = 'confirmed' and old.status = 'pending' and new.deposit_status is distinct from 'pending') then
    perform private.enqueue_email('confirm', new.master_id, new.id, v_email, null, jsonb_build_object('deposit_paid', new.deposit_status = 'paid'));
  elsif new.status in ('cancelled_client', 'cancelled_master') and old.status in ('pending', 'confirmed') then
    perform private.enqueue_email('cancelled', new.master_id, new.id, v_email, null,
      jsonb_build_object('by', case when new.status = 'cancelled_client' then 'client' else 'studio' end,
                         'reason', new.cancel_reason, 'deposit_expired', new.deposit_status = 'expired'));
    if new.status = 'cancelled_client' then perform private.alert_masters(new, 'alert_cancel', '{}'::jsonb); end if;
  elsif (new.start_at is distinct from old.start_at or new.staff_id is distinct from old.staff_id)
        and new.status in ('pending', 'confirmed') then
    -- a new time: the reminders go out again for it
    new.reminded_24_at := null;
    new.reminded_2_at := null;
    perform private.enqueue_email('moved', new.master_id, new.id, v_email, null,
      jsonb_build_object('old_start_at', old.start_at, 'by', v_by, 'old_staff_id', old.staff_id));
    if v_by = 'client' then perform private.alert_masters(new, 'alert_move', jsonb_build_object('old_start_at', old.start_at)); end if;
  elsif new.status = 'completed' and old.status is distinct from 'completed' and new.review_mail_at is null
        and coalesce(m.settings ->> 'reviewUrl', '') <> '' then
    -- "How was your visit?" — an hour after the visit (never at night: 9:00–20:00 studio time)
    if not exists (select 1 from public.clients c where c.id = new.client_id and c.marketing_opt_out) then
      new.review_mail_at := now();
      perform private.enqueue_email('review', new.master_id, new.id, v_email, null, '{}'::jsonb,
                                    private.daytime(greatest(now(), new.end_at + interval '1 hour'), m.timezone));
    end if;
  end if;
  return new;
exception when others then
  return new; -- an email never blocks a booking
end $$;

-- the next moment between 9:00 and 20:00 in the studio's time zone
create or replace function private.daytime(p_at timestamptz, p_tz text) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare
  v_local timestamp := p_at at time zone p_tz;
begin
  if v_local::time < time '09:00' then return (v_local::date + time '09:00') at time zone p_tz; end if;
  if v_local::time >= time '20:00' then return (v_local::date + 1 + time '09:00') at time zone p_tz; end if;
  return p_at;
end $$;

-- named to run after the other BEFORE triggers (its master is filled in by then)
drop trigger if exists bookings_zz_email on public.bookings;
create trigger bookings_zz_email
  before insert or update of status, start_at, staff_id, deposit_status on public.bookings
  for each row execute function private.email_on_booking();

-- ---------- 4. every 10 minutes: reminders, fills, "Your day" ----------
create or replace function private.email_cron() returns void
language plpgsql security definer set search_path = '' as $$
declare
  r record;
begin
  -- 24 h before (bookings made at least a day ahead)
  for r in
    select b.id, b.master_id, c.email from public.bookings b join public.clients c on c.id = b.client_id
     where b.status = 'confirmed' and b.reminded_24_at is null
       and b.start_at > now() + interval '3 hours' and b.start_at <= now() + interval '24 hours'
       and b.created_at < b.start_at - interval '24 hours'
     for update of b skip locked
  loop
    update public.bookings set reminded_24_at = now() where id = r.id;
    perform private.enqueue_email('reminder_24', r.master_id, r.id, r.email, null, '{}'::jsonb, now(), false);
  end loop;
  -- 2 h before (bookings made at least 2 hours ahead)
  for r in
    select b.id, b.master_id, c.email from public.bookings b join public.clients c on c.id = b.client_id
     where b.status = 'confirmed' and b.reminded_2_at is null
       and b.start_at > now() and b.start_at <= now() + interval '2 hours'
       and b.created_at < b.start_at - interval '2 hours'
     for update of b skip locked
  loop
    update public.bookings set reminded_2_at = now() where id = r.id;
    perform private.enqueue_email('reminder_2', r.master_id, r.id, r.email, null, '{}'::jsonb, now(), false);
  end loop;
  -- "Time for your fill": the service's fill interval after her last visit, nothing booked since
  for r in
    select b.id, b.master_id, c.email, m.timezone from public.bookings b
      join public.clients c on c.id = b.client_id
      join public.services s on s.id = b.service_id
      join public.masters m on m.id = b.master_id
     where b.status = 'completed' and b.fill_mail_at is null and s.fill_weeks is not null
       and not c.marketing_opt_out
       and b.start_at + make_interval(days => s.fill_weeks * 7) <= now()
       and b.start_at + make_interval(days => s.fill_weeks * 7) > now() - interval '3 days'
       and not exists (select 1 from public.bookings n where n.client_id = b.client_id and n.start_at > b.start_at
                          and n.status in ('pending', 'confirmed', 'completed'))
     for update of b skip locked
  loop
    update public.bookings set fill_mail_at = now() where id = r.id;
    perform private.enqueue_email('fill', r.master_id, r.id, r.email, null, '{}'::jsonb, private.daytime(now(), r.timezone), false);
  end loop;
  -- "Your day" at 8:00 studio time: the owner (whole studio) and each master with a sign-in (her own day)
  for r in
    select m.id as master_id, x.u, x.staff_id from public.masters m
      cross join lateral (
        select m.owner_id as u, null::uuid as staff_id
        union all
        select st.user_id, st.id from public.staff st where st.master_id = m.id and st.active and not st.is_owner and st.user_id is not null
      ) x
     where m.booking_engine = 'builtin' and m.status <> 'paused' and x.u is not null
       and private.email_on(m.settings, 'day')
       and (now() at time zone m.timezone)::time >= time '08:00' and (now() at time zone m.timezone)::time < time '08:30'
       and not exists (select 1 from public.email_log l where l.kind = 'day' and l.to_user = x.u and l.master_id = m.id
                          and l.created_at > now() - interval '20 hours')
       and exists (select 1 from public.bookings b where b.master_id = m.id and b.status in ('pending', 'confirmed')
                     and (x.staff_id is null or b.staff_id = x.staff_id)
                     and (b.start_at at time zone m.timezone)::date = (now() at time zone m.timezone)::date)
  loop
    perform private.enqueue_email('day', r.master_id, null, private.user_email(r.u), r.u,
                                  jsonb_build_object('staff_id', r.staff_id), now(), false);
  end loop;
  -- anything due (incl. what waited for the daily limit): send it
  if exists (select 1 from public.email_log where status = 'queued' and send_after <= now()) then
    perform private.kick_email();
  end if;
  -- stuck "sending" (the function died midway) → back to the queue
  update public.email_log set status = 'queued' where status = 'sending' and sent_at is null
     and created_at < now() - interval '15 minutes' and attempts < 3;
end $$;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'studio-emails';
    perform cron.schedule('studio-emails', '*/10 * * * *', 'select private.email_cron()');
  end if;
end $$;

-- ---------- 5. the sender takes due emails (service role only) — within the Gmail limit ----------
create or replace function public.email_claim(p_limit int default 20) returns setof public.email_log
language plpgsql security definer set search_path = '' as $$
declare
  v_used int;
  v_room int;
  v_free timestamptz;
begin
  select count(*) into v_used from public.email_log where status = 'sent' and sent_at > now() - interval '24 hours';
  v_room := greatest(0, 480 - v_used);
  if v_room = 0 then
    -- the limit: everything due waits until the oldest send of the window is 24 h old
    select min(sent_at) + interval '24 hours' into v_free from public.email_log where status = 'sent' and sent_at > now() - interval '24 hours';
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

-- ---------- 6. unsubscribe (marketing only: "How was your visit?", "Time for your fill") ----------
create or replace function public.email_unsubscribe(p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
begin
  update public.clients c set marketing_opt_out = true where c.unsub_token = p_token
  returning (select m.name from public.masters m where m.id = c.master_id) into v_name;
  if v_name is null then raise exception 'not_found'; end if;
  return jsonb_build_object('studio', v_name);
end $$;
revoke all on function public.email_unsubscribe(uuid) from public;
grant execute on function public.email_unsubscribe(uuid) to anon, authenticated;

-- ---------- 7. numbers: the admin's 24-hour counter, a studio's own log ----------
create or replace function public.admin_email_stats() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'sent_24h', (select count(*) from public.email_log where status = 'sent' and sent_at > now() - interval '24 hours'),
    'queued', (select count(*) from public.email_log where status = 'queued'),
    'waiting', (select count(*) from public.email_log where status = 'queued' and send_after > now() + interval '1 minute'),
    'failed_24h', (select count(*) from public.email_log where status = 'failed' and created_at > now() - interval '24 hours'),
    'limit', 500);
end $$;
revoke all on function public.admin_email_stats() from public, anon;
grant execute on function public.admin_email_stats() to authenticated;

create or replace function public.owner_email_log(p_master_id uuid, p_limit int default 30) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'to', to_email, 'status', status, 'subject', subject,
                                               'created_at', created_at, 'sent_at', sent_at) order by created_at desc), '[]'::jsonb)
    from (select * from public.email_log where master_id = p_master_id order by created_at desc limit least(p_limit, 100)) x;
$$;
revoke execute on function public.owner_email_log(uuid, int) from public, anon;
grant execute on function public.owner_email_log(uuid, int) to authenticated;
