-- =========================================================
-- Studio App — booking core
-- Masters, services, working hours, time off, clients, bookings.
--
-- Security model
--   • The master (auth.uid() = masters.owner_id) reads and changes only
--     her own rows (RLS).
--   • Anonymous clients never touch bookings / clients directly: they go
--     through the security-definer RPCs below, which check everything.
--   • A booking is managed with its manage_token (a random uuid that only
--     the client has) — no client accounts needed.
-- =========================================================

create extension if not exists btree_gist with schema extensions;

-- Helpers that must not be callable over the API live in "private"
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- A time-of-day range, so working intervals of one day can't overlap
do $$ begin
  create type public.timerange as range (subtype = time);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------
-- Tables
-- ---------------------------------------------------------
create table public.masters (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z0-9][a-z0-9_-]{0,60}$'),
  name                text not null check (length(name) between 1 and 80),
  owner_id            uuid references auth.users (id) on delete set null,
  -- the first sign-in with this email becomes the owner (see claim_my_studios)
  owner_email         text,
  timezone            text not null default 'America/New_York',
  style               text not null default 'noir' check (style in ('soft', 'maison', 'noir')),
  accent              text,
  -- everything else the app shows: photos, gallery, stories, policies, faq…
  -- (same fields as masters/<slug>.json)
  settings            jsonb not null default '{}'::jsonb,
  booking_engine      text not null default 'builtin' check (booking_engine in ('builtin', 'external')),
  auto_confirm        boolean not null default true,
  min_notice_hours    int not null default 2 check (min_notice_hours between 0 and 336),
  max_days_ahead      int not null default 60 check (max_days_ahead between 1 and 365),
  cancel_window_hours int not null default 24 check (cancel_window_hours between 0 and 336),
  slot_step_min       int not null default 30 check (slot_step_min in (10, 15, 20, 30, 45, 60)),
  created_at          timestamptz not null default now()
);

create table public.services (
  id           uuid primary key default gen_random_uuid(),
  master_id    uuid not null references public.masters (id) on delete cascade,
  category     text not null default 'Services',
  name         text not null check (length(name) between 1 and 80),
  description  text not null default '',
  includes     text[] not null default '{}',
  duration_min int not null check (duration_min between 5 and 720),
  buffer_min   int not null default 0 check (buffer_min between 0 and 240),
  price        numeric(10, 2) not null default 0 check (price >= 0),
  deposit      numeric(10, 2) not null default 0 check (deposit >= 0),
  photo        text,
  active       boolean not null default true,
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);
create index services_master_idx on public.services (master_id, sort);

-- Several rows per weekday = intervals with breaks (e.g. 9–13 and 14–19)
create table public.working_hours (
  id         bigint generated always as identity primary key,
  master_id  uuid not null references public.masters (id) on delete cascade,
  weekday    smallint not null check (weekday between 0 and 6), -- 0 = Sunday
  start_time time not null,
  end_time   time not null,
  check (end_time > start_time),
  constraint working_hours_no_overlap
    exclude using gist (master_id with =, weekday with =, public.timerange(start_time, end_time) with &&)
);

create table public.time_off (
  id        uuid primary key default gen_random_uuid(),
  master_id uuid not null references public.masters (id) on delete cascade,
  start_at  timestamptz not null,
  end_at    timestamptz not null,
  reason    text not null default '',
  check (end_at > start_at)
);
create index time_off_master_idx on public.time_off (master_id, start_at);

create table public.clients (
  id         uuid primary key default gen_random_uuid(),
  master_id  uuid not null references public.masters (id) on delete cascade,
  name       text not null,
  phone      text not null, -- normalized, e.g. +14045550199
  email      text,
  notes      text not null default '',
  created_at timestamptz not null default now(),
  unique (master_id, phone)
);

create table public.bookings (
  id            uuid primary key default gen_random_uuid(),
  master_id     uuid not null references public.masters (id) on delete cascade,
  service_id    uuid references public.services (id) on delete set null,
  client_id     uuid references public.clients (id) on delete set null,
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  -- end_at + the service's buffer: the calendar stays blocked until then
  buffer_end_at timestamptz not null,
  status        text not null default 'confirmed'
                check (status in ('pending', 'confirmed', 'cancelled_client', 'cancelled_master', 'completed', 'no_show')),
  price         numeric(10, 2),
  service_name  text not null default '', -- snapshot: the service may be renamed later
  client_note   text not null default '',
  manage_token  uuid not null default gen_random_uuid() unique,
  late_cancel   boolean not null default false,
  created_by    text not null default 'client' check (created_by in ('client', 'master')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancel_reason text,
  check (end_at > start_at),
  check (buffer_end_at >= end_at),
  -- No double booking: two active bookings of one master can never overlap,
  -- even when two clients press "Confirm" in the same millisecond.
  constraint bookings_no_overlap
    exclude using gist (master_id with =, tstzrange(start_at, buffer_end_at, '[)') with &&)
    where (status in ('pending', 'confirmed'))
);
create index bookings_master_start_idx on public.bookings (master_id, start_at);
create index bookings_client_idx on public.bookings (client_id);

-- ---------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------
create or replace function private.check_timezone() returns trigger
language plpgsql as $$
begin
  perform now() at time zone new.timezone; -- raises on an unknown zone
  return new;
end $$;
create trigger masters_timezone before insert or update of timezone on public.masters
  for each row execute function private.check_timezone();

create or replace function private.bookings_touch() returns trigger
language plpgsql as $$
declare
  buf int;
begin
  select coalesce(s.buffer_min, 0) into buf from public.services s where s.id = new.service_id;
  new.buffer_end_at := new.end_at + make_interval(mins => coalesce(buf, 0));
  new.updated_at := now();
  if tg_op = 'UPDATE' and new.status <> old.status and new.status in ('cancelled_client', 'cancelled_master') then
    new.cancelled_at := coalesce(new.cancelled_at, now());
  end if;
  return new;
end $$;
create trigger bookings_touch before insert or update on public.bookings
  for each row execute function private.bookings_touch();

-- ---------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------
create or replace function private.is_my_master(mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.masters m where m.id = mid and m.owner_id = auth.uid());
$$;
revoke all on function private.is_my_master(uuid) from public;
grant execute on function private.is_my_master(uuid) to authenticated;

alter table public.masters       enable row level security;
alter table public.services      enable row level security;
alter table public.working_hours enable row level security;
alter table public.time_off      enable row level security;
alter table public.clients       enable row level security;
alter table public.bookings      enable row level security;

-- (no insert/delete: studios are created by the app's admin, see README)
create policy "owner: read own studio" on public.masters for select to authenticated
  using (owner_id = auth.uid());
create policy "owner: update own studio" on public.masters for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "owner: services" on public.services for all to authenticated
  using (private.is_my_master(master_id)) with check (private.is_my_master(master_id));
create policy "owner: hours" on public.working_hours for all to authenticated
  using (private.is_my_master(master_id)) with check (private.is_my_master(master_id));
create policy "owner: time off" on public.time_off for all to authenticated
  using (private.is_my_master(master_id)) with check (private.is_my_master(master_id));
create policy "owner: clients" on public.clients for all to authenticated
  using (private.is_my_master(master_id)) with check (private.is_my_master(master_id));
create policy "owner: bookings" on public.bookings for all to authenticated
  using (private.is_my_master(master_id)) with check (private.is_my_master(master_id));

-- Anonymous visitors get nothing from the tables themselves
revoke all on public.masters, public.services, public.working_hours, public.time_off,
  public.clients, public.bookings from anon;
grant select, update on public.masters to authenticated;
grant select, insert, update, delete on public.services, public.working_hours,
  public.time_off, public.clients, public.bookings to authenticated;

-- ---------------------------------------------------------
-- Availability
-- ---------------------------------------------------------

-- Start times on a local date for a service. Honors working intervals
-- (breaks), time off, other bookings (+ buffers), minimum notice, how far
-- ahead clients may book, and the master's time zone.
-- p_ignore: a booking to leave out (when that booking is being moved).
create or replace function private.free_slots(p_master uuid, p_service uuid, p_date date, p_ignore uuid default null)
returns setof timestamptz
language sql stable security definer set search_path = '' as $$
  with m as (
    select * from public.masters where id = p_master
  ), s as (
    select * from public.services where id = p_service and master_id = p_master and active
  ), lim as (
    select (now() at time zone m.timezone)::date as today,
           now() + make_interval(hours => m.min_notice_hours) as earliest,
           m.max_days_ahead, m.slot_step_min, m.timezone
      from m
  ), cand as (
    select (lt at time zone lim.timezone) as t
      from lim, s,
           public.working_hours wh,
           generate_series(p_date + wh.start_time,
                           p_date + wh.end_time - make_interval(mins => s.duration_min),
                           make_interval(mins => lim.slot_step_min)) as lt
     where wh.master_id = p_master
       and wh.weekday = extract(dow from p_date)
       and p_date >= lim.today
       and p_date <= lim.today + lim.max_days_ahead
  )
  select distinct c.t
    from cand c, s, lim
   where c.t >= lim.earliest
     and not exists (
       select 1 from public.time_off o
        where o.master_id = p_master
          and tstzrange(o.start_at, o.end_at, '[)') && tstzrange(c.t, c.t + make_interval(mins => s.duration_min), '[)'))
     and not exists (
       select 1 from public.bookings b
        where b.master_id = p_master
          and b.status in ('pending', 'confirmed')
          and b.id is distinct from p_ignore
          and tstzrange(b.start_at, b.buffer_end_at, '[)')
              && tstzrange(c.t, c.t + make_interval(mins => s.duration_min + s.buffer_min), '[)'))
   order by c.t;
$$;
revoke all on function private.free_slots(uuid, uuid, date, uuid) from public;

-- Is [p_start, +duration) free of bookings and time off? (owner-made
-- bookings may sit outside working hours, so hours are not checked here)
create or replace function private.is_free(p_master uuid, p_service uuid, p_start timestamptz, p_ignore uuid default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
           select 1 from public.time_off o, public.services s
            where s.id = p_service and o.master_id = p_master
              and tstzrange(o.start_at, o.end_at, '[)') && tstzrange(p_start, p_start + make_interval(mins => s.duration_min), '[)'))
     and not exists (
           select 1 from public.bookings b, public.services s
            where s.id = p_service and b.master_id = p_master
              and b.status in ('pending', 'confirmed')
              and b.id is distinct from p_ignore
              and tstzrange(b.start_at, b.buffer_end_at, '[)')
                  && tstzrange(p_start, p_start + make_interval(mins => s.duration_min + s.buffer_min), '[)'));
$$;
revoke all on function private.is_free(uuid, uuid, timestamptz, uuid) from public;

-- "+1 (404) 555-0199" → "+14045550199"; null when it can't be a phone number
create or replace function private.norm_phone(p text) returns text
language plpgsql immutable as $$
declare
  d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) = 10 then return '+1' || d; end if;
  if length(d) = 11 and left(d, 1) = '1' then return '+' || d; end if;
  if length(d) between 8 and 15 and left(trim(p), 1) = '+' then return '+' || d; end if;
  return null;
end $$;

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
    'client_name', c.name,
    'client_note', b.client_note,
    'late_cancel', b.late_cancel,
    'cancelled_at', b.cancelled_at,
    'cancel_reason', b.cancel_reason,
    'updated_at', b.updated_at,
    'can_change', b.status in ('pending', 'confirmed') and b.start_at > now(),
    'late_now', b.start_at - now() < make_interval(hours => m.cancel_window_hours),
    'master', jsonb_build_object(
      'slug', m.slug, 'name', m.name, 'timezone', m.timezone,
      'cancel_window_hours', m.cancel_window_hours, 'auto_confirm', m.auto_confirm,
      'phone', m.settings ->> 'phone', 'address', m.settings ->> 'address')
  )
  from public.masters m
  left join public.services s on s.id = b.service_id
  left join public.clients c on c.id = b.client_id
  where m.id = b.master_id;
$$;
revoke all on function private.booking_json(public.bookings) from public;

-- ---------------------------------------------------------
-- Public RPCs (anon)
-- ---------------------------------------------------------

-- Profile, active services, working hours and rules — no client data
create or replace function public.get_public_profile(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'master', jsonb_build_object(
      'id', m.id, 'slug', m.slug, 'name', m.name, 'timezone', m.timezone,
      'style', m.style, 'accent', m.accent, 'settings', m.settings,
      'booking_engine', m.booking_engine, 'auto_confirm', m.auto_confirm,
      'min_notice_hours', m.min_notice_hours, 'max_days_ahead', m.max_days_ahead,
      'cancel_window_hours', m.cancel_window_hours, 'slot_step_min', m.slot_step_min),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'category', s.category, 'name', s.name, 'description', s.description,
               'includes', s.includes, 'duration_min', s.duration_min, 'buffer_min', s.buffer_min,
               'price', s.price, 'deposit', s.deposit, 'photo', s.photo) order by s.sort, s.name)
        from public.services s where s.master_id = m.id and s.active), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object(
               'weekday', w.weekday, 'start', to_char(w.start_time, 'HH24:MI'), 'end', to_char(w.end_time, 'HH24:MI'))
               order by w.weekday, w.start_time)
        from public.working_hours w where w.master_id = m.id), '[]'::jsonb))
  from public.masters m
  where m.slug = lower(p_slug);
$$;

create or replace function public.get_available_slots(p_slug text, p_service_id uuid, p_date date, p_ignore uuid default null)
returns setof timestamptz
language sql stable security definer set search_path = '' as $$
  select t from public.masters m, private.free_slots(m.id, p_service_id, p_date, p_ignore) t
   where m.slug = lower(p_slug) and m.booking_engine = 'builtin';
$$;

-- All openings for p_days days from p_from (the booking sheet asks once
-- for the whole day strip instead of once per day)
create or replace function public.get_openings(p_slug text, p_service_id uuid, p_from date, p_days int default 14, p_ignore uuid default null)
returns setof timestamptz
language sql stable security definer set search_path = '' as $$
  select t
    from public.masters m,
         generate_series(p_from::timestamp, (p_from + least(greatest(p_days, 1), 92) - 1)::timestamp, interval '1 day') as d,
         private.free_slots(m.id, p_service_id, d::date, p_ignore) t
   where m.slug = lower(p_slug) and m.booking_engine = 'builtin'
   order by t;
$$;

create or replace function public.create_booking(
  p_slug text, p_service_id uuid, p_start_at timestamptz,
  p_name text, p_phone text, p_email text default null, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.masters;
  s public.services;
  v_phone text := private.norm_phone(p_phone);
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_client uuid;
  b public.bookings;
begin
  select * into m from public.masters where slug = lower(p_slug);
  if not found or m.booking_engine <> 'builtin' then raise exception 'not_bookable'; end if;
  select * into s from public.services where id = p_service_id and master_id = m.id and active;
  if not found then raise exception 'service_not_found'; end if;
  if length(v_name) not between 1 and 80 then raise exception 'invalid_name'; end if;
  if v_phone is null then raise exception 'invalid_phone'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid_email'; end if;

  -- must be one of the offered start times right now
  if not exists (
    select 1 from private.free_slots(m.id, s.id, (p_start_at at time zone m.timezone)::date) t where t = p_start_at
  ) then
    raise exception 'slot_taken';
  end if;

  insert into public.clients (master_id, name, phone, email)
  values (m.id, v_name, v_phone, v_email)
  on conflict (master_id, phone) do update set email = coalesce(public.clients.email, excluded.email)
  returning id into v_client;

  -- a little spam guard: at most 3 upcoming bookings per phone number
  if (select count(*) from public.bookings
       where client_id = v_client and status in ('pending', 'confirmed') and start_at > now()) >= 3 then
    raise exception 'too_many';
  end if;

  begin
    insert into public.bookings (master_id, service_id, client_id, start_at, end_at, buffer_end_at,
                                 status, price, service_name, client_note, created_by)
    values (m.id, s.id, v_client, p_start_at, p_start_at + make_interval(mins => s.duration_min),
            p_start_at + make_interval(mins => s.duration_min),
            case when m.auto_confirm then 'confirmed' else 'pending' end,
            s.price, s.name, left(coalesce(p_note, ''), 500), 'client')
    returning * into b;
  exception when exclusion_violation then
    raise exception 'slot_taken'; -- someone was faster by a hair
  end;

  return private.booking_json(b);
end $$;

create or replace function public.get_booking(p_token uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select private.booking_json(b) from public.bookings b where b.manage_token = p_token;
$$;

create or replace function public.cancel_booking(p_token uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  m public.masters;
begin
  select * into b from public.bookings where manage_token = p_token for update;
  if not found then raise exception 'not_found'; end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'not_active'; end if;
  if b.start_at <= now() then raise exception 'too_late'; end if;
  select * into m from public.masters where id = b.master_id;
  update public.bookings
     set status = 'cancelled_client',
         cancelled_at = now(),
         cancel_reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 300),
         late_cancel = b.start_at - now() < make_interval(hours => m.cancel_window_hours)
   where id = b.id
   returning * into b;
  return private.booking_json(b);
end $$;

create or replace function public.reschedule_booking(p_token uuid, p_new_start_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  m public.masters;
  s public.services;
begin
  select * into b from public.bookings where manage_token = p_token for update;
  if not found then raise exception 'not_found'; end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'not_active'; end if;
  if b.start_at <= now() then raise exception 'too_late'; end if;
  select * into m from public.masters where id = b.master_id;
  select * into s from public.services where id = b.service_id;
  if not found then raise exception 'service_not_found'; end if;
  if not exists (
    select 1 from private.free_slots(m.id, s.id, (p_new_start_at at time zone m.timezone)::date, b.id) t
     where t = p_new_start_at
  ) then
    raise exception 'slot_taken';
  end if;
  begin
    update public.bookings
       set start_at = p_new_start_at,
           end_at = p_new_start_at + make_interval(mins => s.duration_min),
           status = case when m.auto_confirm then 'confirmed' else 'pending' end,
           -- moving inside the cancellation window counts as a late change
           late_cancel = b.late_cancel or (b.start_at - now() < make_interval(hours => m.cancel_window_hours))
     where id = b.id
     returning * into b;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;
  return private.booking_json(b);
end $$;

-- ---------------------------------------------------------
-- Owner RPCs (signed-in master)
-- ---------------------------------------------------------

-- Studios created with owner_email become yours on your first sign-in
create or replace function public.claim_my_studios() returns setof text
language sql security definer set search_path = '' as $$
  update public.masters
     set owner_id = auth.uid()
   where owner_id is null
     and owner_email is not null
     and lower(owner_email) = lower(auth.jwt() ->> 'email')
     and auth.uid() is not null
  returning slug;
$$;

-- A booking the master makes herself (a client called). Same overlap
-- rules; outside working hours only when p_force is set.
create or replace function public.owner_create_booking(
  p_master_id uuid, p_service_id uuid, p_start_at timestamptz,
  p_name text, p_phone text, p_email text default null, p_note text default null,
  p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.masters;
  s public.services;
  v_phone text := private.norm_phone(p_phone);
  v_name text := btrim(coalesce(p_name, ''));
  v_client uuid;
  b public.bookings;
begin
  if not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
  select * into m from public.masters where id = p_master_id;
  select * into s from public.services where id = p_service_id and master_id = m.id;
  if not found then raise exception 'service_not_found'; end if;
  if length(v_name) not between 1 and 80 then raise exception 'invalid_name'; end if;
  if v_phone is null then raise exception 'invalid_phone'; end if;
  if not private.is_free(m.id, s.id, p_start_at) then raise exception 'slot_taken'; end if;
  if not p_force and not exists (
    select 1 from private.free_slots(m.id, s.id, (p_start_at at time zone m.timezone)::date) t where t = p_start_at
  ) then
    raise exception 'outside_hours';
  end if;

  insert into public.clients (master_id, name, phone, email)
  values (m.id, v_name, v_phone, nullif(lower(btrim(coalesce(p_email, ''))), ''))
  on conflict (master_id, phone) do update set email = coalesce(public.clients.email, excluded.email)
  returning id into v_client;

  begin
    insert into public.bookings (master_id, service_id, client_id, start_at, end_at, buffer_end_at,
                                 status, price, service_name, client_note, created_by)
    values (m.id, s.id, v_client, p_start_at, p_start_at + make_interval(mins => s.duration_min),
            p_start_at + make_interval(mins => s.duration_min),
            'confirmed', s.price, s.name, left(coalesce(p_note, ''), 500), 'master')
    returning * into b;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;
  return private.booking_json(b);
end $$;

create or replace function public.owner_set_status(p_booking_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or not private.is_my_master(b.master_id) then raise exception 'not_found'; end if;
  if p_status not in ('confirmed', 'cancelled_master', 'completed', 'no_show') then raise exception 'bad_status'; end if;
  if p_status = 'confirmed' and b.status <> 'pending' then raise exception 'bad_status'; end if;
  if p_status = 'cancelled_master' and b.status not in ('pending', 'confirmed') then raise exception 'bad_status'; end if;
  update public.bookings
     set status = p_status,
         cancel_reason = case when p_status = 'cancelled_master'
                              then left(nullif(btrim(coalesce(p_reason, '')), ''), 300) else cancel_reason end
   where id = b.id
   returning * into b;
  return private.booking_json(b);
end $$;

create or replace function public.owner_reschedule(p_booking_id uuid, p_new_start_at timestamptz, p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  m public.masters;
  s public.services;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or not private.is_my_master(b.master_id) then raise exception 'not_found'; end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'not_active'; end if;
  select * into m from public.masters where id = b.master_id;
  select * into s from public.services where id = b.service_id;
  if not found then raise exception 'service_not_found'; end if;
  if not private.is_free(m.id, s.id, p_new_start_at, b.id) then raise exception 'slot_taken'; end if;
  if not p_force and not exists (
    select 1 from private.free_slots(m.id, s.id, (p_new_start_at at time zone m.timezone)::date, b.id) t
     where t = p_new_start_at
  ) then
    raise exception 'outside_hours';
  end if;
  begin
    update public.bookings
       set start_at = p_new_start_at,
           end_at = p_new_start_at + make_interval(mins => s.duration_min)
     where id = b.id
     returning * into b;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;
  return private.booking_json(b);
end $$;

-- Owner's start times for a day (same rules as clients see, but the
-- master may be looking at a booking she is moving)
create or replace function public.owner_slots(p_master_id uuid, p_service_id uuid, p_date date, p_ignore uuid default null)
returns setof timestamptz
language sql stable security definer set search_path = '' as $$
  select t from private.free_slots(p_master_id, p_service_id, p_date, p_ignore) t
   where private.is_my_master(p_master_id);
$$;

-- ---------------------------------------------------------
-- Owner dashboard: reads and edits. These run as the signed-in user
-- (security invoker), so the RLS policies above still decide what she
-- can see — a stranger simply gets nothing back.
-- ---------------------------------------------------------
create or replace function public.owner_studios() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'slug', m.slug, 'name', m.name, 'timezone', m.timezone,
           'booking_engine', m.booking_engine, 'auto_confirm', m.auto_confirm,
           'min_notice_hours', m.min_notice_hours, 'max_days_ahead', m.max_days_ahead,
           'cancel_window_hours', m.cancel_window_hours, 'slot_step_min', m.slot_step_min,
           'phone', m.settings ->> 'phone', 'address', m.settings ->> 'address') order by m.created_at), '[]'::jsonb)
    from public.masters m;
$$;

create or replace function private.owner_booking_row(b public.bookings) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'status', b.status, 'start_at', b.start_at, 'end_at', b.end_at,
    'price', b.price, 'service_id', b.service_id, 'service_name', b.service_name,
    'service_photo', s.photo, 'duration_min', s.duration_min,
    'client_id', b.client_id, 'client_name', c.name, 'client_phone', c.phone, 'client_email', c.email,
    'client_note', b.client_note, 'late_cancel', b.late_cancel, 'created_by', b.created_by,
    'created_at', b.created_at, 'updated_at', b.updated_at,
    'cancelled_at', b.cancelled_at, 'cancel_reason', b.cancel_reason)
  from (select 1) x
  left join public.services s on s.id = b.service_id
  left join public.clients c on c.id = b.client_id;
$$;
grant execute on function private.owner_booking_row(public.bookings) to authenticated;

-- Bookings that start in [p_from, p_to); p_status narrows it down (e.g. 'pending')
create or replace function public.owner_bookings(p_master_id uuid, p_from timestamptz, p_to timestamptz, p_status text default null)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(private.owner_booking_row(b) order by b.start_at), '[]'::jsonb)
    from public.bookings b
   where b.master_id = p_master_id
     and b.start_at >= p_from and b.start_at < p_to
     and (p_status is null or b.status = p_status);
$$;

create or replace function public.owner_booking(p_booking_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.owner_booking_row(b) from public.bookings b where b.id = p_booking_id;
$$;

-- Clients with their history in numbers (search by name, phone or email)
create or replace function public.owner_clients(p_master_id uuid, p_q text default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(t.r order by t.r ->> 'name'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'notes', c.notes,
      'visits', count(b.*) filter (where b.status = 'completed'),
      'spent', coalesce(sum(b.price) filter (where b.status = 'completed'), 0),
      'cancels', count(b.*) filter (where b.status = 'cancelled_client'),
      'late_cancels', count(b.*) filter (where b.late_cancel),
      'no_shows', count(b.*) filter (where b.status = 'no_show'),
      'last_visit', max(b.start_at) filter (where b.status = 'completed'),
      'next_visit', min(b.start_at) filter (where b.status in ('pending', 'confirmed') and b.start_at > now())
    ) as r
    from public.clients c
    left join public.bookings b on b.client_id = c.id
   where c.master_id = p_master_id
     and (coalesce(p_q, '') = ''
          or c.name ilike '%' || p_q || '%'
          or c.email ilike '%' || p_q || '%'
          or regexp_replace(c.phone, '\D', '', 'g') like '%' || nullif(regexp_replace(p_q, '\D', '', 'g'), '') || '%')
   group by c.id
  ) t;
$$;

create or replace function public.owner_client(p_client_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'client', jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email,
                                 'notes', c.notes, 'created_at', c.created_at),
    'history', coalesce((select jsonb_agg(private.owner_booking_row(b) order by b.start_at desc)
                           from public.bookings b where b.client_id = c.id), '[]'::jsonb))
  from public.clients c where c.id = p_client_id;
$$;

create or replace function public.owner_set_client_notes(p_client_id uuid, p_notes text) returns jsonb
language sql security invoker set search_path = '' as $$
  update public.clients set notes = left(coalesce(p_notes, ''), 2000) where id = p_client_id
  returning jsonb_build_object('id', id, 'notes', notes);
$$;

-- Working hours, upcoming time off and the booking rules
create or replace function public.owner_schedule(p_master_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', w.weekday,
                         'start', to_char(w.start_time, 'HH24:MI'), 'end', to_char(w.end_time, 'HH24:MI'))
                         order by w.weekday, w.start_time)
                         from public.working_hours w where w.master_id = m.id), '[]'::jsonb),
    'time_off', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'start_at', o.start_at,
                            'end_at', o.end_at, 'reason', o.reason) order by o.start_at)
                            from public.time_off o where o.master_id = m.id and o.end_at > now()), '[]'::jsonb),
    'rules', jsonb_build_object('auto_confirm', m.auto_confirm, 'min_notice_hours', m.min_notice_hours,
                                'max_days_ahead', m.max_days_ahead, 'cancel_window_hours', m.cancel_window_hours,
                                'slot_step_min', m.slot_step_min))
  from public.masters m where m.id = p_master_id;
$$;

-- Replace the whole week at once: [{weekday, start: "09:00", end: "13:00"}, …]
create or replace function public.owner_save_hours(p_master_id uuid, p_hours jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
  delete from public.working_hours where master_id = p_master_id;
  insert into public.working_hours (master_id, weekday, start_time, end_time)
  select p_master_id, (h ->> 'weekday')::smallint, (h ->> 'start')::time, (h ->> 'end')::time
    from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) h;
  return public.owner_schedule(p_master_id);
exception
  when exclusion_violation then raise exception 'hours_overlap';
  when check_violation then raise exception 'hours_invalid';
end $$;

create or replace function public.owner_save_rules(p_master_id uuid, p_rules jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  update public.masters set
    auto_confirm        = coalesce((p_rules ->> 'auto_confirm')::boolean, auto_confirm),
    min_notice_hours    = coalesce((p_rules ->> 'min_notice_hours')::int, min_notice_hours),
    max_days_ahead      = coalesce((p_rules ->> 'max_days_ahead')::int, max_days_ahead),
    cancel_window_hours = coalesce((p_rules ->> 'cancel_window_hours')::int, cancel_window_hours),
    slot_step_min       = coalesce((p_rules ->> 'slot_step_min')::int, slot_step_min)
  where id = p_master_id;
  -- a new statement, so the schedule shows the values just saved
  return public.owner_schedule(p_master_id);
end $$;

create or replace function public.owner_add_time_off(p_master_id uuid, p_start_at timestamptz, p_end_at timestamptz, p_reason text default '')
returns jsonb
language sql security invoker set search_path = '' as $$
  insert into public.time_off (master_id, start_at, end_at, reason)
  values (p_master_id, p_start_at, p_end_at, left(coalesce(p_reason, ''), 120))
  returning jsonb_build_object('id', id, 'start_at', start_at, 'end_at', end_at, 'reason', reason);
$$;

create or replace function public.owner_delete_time_off(p_id uuid) returns boolean
language sql security invoker set search_path = '' as $$
  with d as (delete from public.time_off where id = p_id returning 1) select exists (select 1 from d);
$$;

-- ---------------------------------------------------------
-- Who may call what
-- ---------------------------------------------------------
revoke execute on all functions in schema public from public;
grant execute on function
  public.get_public_profile(text),
  public.get_available_slots(text, uuid, date, uuid),
  public.get_openings(text, uuid, date, int, uuid),
  public.create_booking(text, uuid, timestamptz, text, text, text, text),
  public.get_booking(uuid),
  public.cancel_booking(uuid, text),
  public.reschedule_booking(uuid, timestamptz)
  to anon, authenticated;
revoke execute on function
  public.claim_my_studios(),
  public.owner_create_booking(uuid, uuid, timestamptz, text, text, text, text, boolean),
  public.owner_set_status(uuid, text, text),
  public.owner_reschedule(uuid, timestamptz, boolean),
  public.owner_slots(uuid, uuid, date, uuid),
  public.owner_studios(),
  public.owner_bookings(uuid, timestamptz, timestamptz, text),
  public.owner_booking(uuid),
  public.owner_clients(uuid, text),
  public.owner_client(uuid),
  public.owner_set_client_notes(uuid, text),
  public.owner_schedule(uuid),
  public.owner_save_hours(uuid, jsonb),
  public.owner_save_rules(uuid, jsonb),
  public.owner_add_time_off(uuid, timestamptz, timestamptz, text),
  public.owner_delete_time_off(uuid)
  from anon;
grant execute on function
  public.claim_my_studios(),
  public.owner_create_booking(uuid, uuid, timestamptz, text, text, text, text, boolean),
  public.owner_set_status(uuid, text, text),
  public.owner_reschedule(uuid, timestamptz, boolean),
  public.owner_slots(uuid, uuid, date, uuid),
  public.owner_studios(),
  public.owner_bookings(uuid, timestamptz, timestamptz, text),
  public.owner_booking(uuid),
  public.owner_clients(uuid, text),
  public.owner_client(uuid),
  public.owner_set_client_notes(uuid, text),
  public.owner_schedule(uuid),
  public.owner_save_hours(uuid, jsonb),
  public.owner_save_rules(uuid, jsonb),
  public.owner_add_time_off(uuid, timestamptz, timestamptz, text),
  public.owner_delete_time_off(uuid)
  to authenticated;

-- ---------------------------------------------------------
-- Realtime: the master's dashboard hears new bookings and cancellations
-- ---------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.bookings;
  end if;
end $$;
