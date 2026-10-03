-- =========================================================
-- Part 4 — the platform owner's admin (?admin=1)
--   • admins: who may open the admin page (checked in every function,
--     not only in the interface); add yourself with
--       insert into public.admins (user_id) select id from auth.users where email = '<you>';
--   • studios get a status (trial / active / paused), trial end, billing
--     fields and private notes; a paused studio takes no bookings
--   • owner_accounts: a studio made by the admin starts with a temporary
--     password that must be changed at the first sign-in
--   • admins can read every studio (the dashboard "as the master", read only)
-- Creating a studio, resetting a password and deleting a studio need the
-- service role → Edge Functions admin-create-master / admin-master-action.
-- =========================================================

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security; -- no policies: read through the functions below
revoke all on public.admins from anon, authenticated;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;

create or replace function public.am_i_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_admin();
$$;
revoke execute on function public.am_i_admin() from public, anon;
grant execute on function public.am_i_admin() to authenticated;

-- ---------- studio status, trial, billing ----------
alter table public.masters
  add column if not exists status text not null default 'active' check (status in ('trial', 'active', 'paused')),
  add column if not exists trial_ends_at timestamptz,
  add column if not exists next_payment_at date,
  add column if not exists monthly_price numeric(10, 2) check (monthly_price >= 0),
  add column if not exists admin_notes text not null default '' check (length(admin_notes) <= 4000),
  add column if not exists app_installed_at timestamptz;

-- ---------- the master's account: temporary password ----------
create table if not exists public.owner_accounts (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  must_change_password boolean not null default false,
  temp_password_at     timestamptz
);
alter table public.owner_accounts enable row level security;
revoke all on public.owner_accounts from anon, authenticated;

create or replace function public.my_account() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('must_change_password', coalesce((select a.must_change_password from public.owner_accounts a where a.user_id = auth.uid()), false));
$$;
create or replace function public.owner_password_changed() returns boolean
language sql security definer set search_path = '' as $$
  update public.owner_accounts set must_change_password = false where user_id = auth.uid();
  select true;
$$;
-- the dashboard saw itself running from the Home Screen (setup checklist)
create or replace function public.owner_mark_installed(p_master_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
  update public.masters set app_installed_at = coalesce(app_installed_at, now()) where id = p_master_id;
  return true;
end $$;
revoke execute on function public.my_account(), public.owner_password_changed(), public.owner_mark_installed(uuid) from public, anon;
grant execute on function public.my_account(), public.owner_password_changed(), public.owner_mark_installed(uuid) to authenticated;

-- ---------- admins read every studio (never write through these) ----------
create policy "admin: read studios" on public.masters for select to authenticated using (private.is_admin());
create policy "admin: read services" on public.services for select to authenticated using (private.is_admin());
create policy "admin: read hours" on public.working_hours for select to authenticated using (private.is_admin());
create policy "admin: read time off" on public.time_off for select to authenticated using (private.is_admin());
create policy "admin: read clients" on public.clients for select to authenticated using (private.is_admin());
create policy "admin: read bookings" on public.bookings for select to authenticated using (private.is_admin());
create policy "admin: read looks" on public.looks for select to authenticated using (private.is_admin());
create policy "admin: read formulas" on public.formulas for select to authenticated using (private.is_admin());

-- the dashboard: every studio this account can see, and whether it is hers
create or replace function public.owner_studios() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'slug', m.slug, 'name', m.name, 'timezone', m.timezone,
           'booking_engine', m.booking_engine, 'auto_confirm', m.auto_confirm,
           'min_notice_hours', m.min_notice_hours, 'max_days_ahead', m.max_days_ahead,
           'cancel_window_hours', m.cancel_window_hours, 'slot_step_min', m.slot_step_min,
           'phone', m.settings ->> 'phone', 'address', m.settings ->> 'address',
           'status', m.status, 'mine', m.owner_id = auth.uid()) order by m.created_at), '[]'::jsonb)
    from public.masters m;
$$;

create or replace function public.owner_insights(p_master_id uuid, p_period text default 'week') returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  m public.masters;
  v_unit text := case when p_period = 'month' then 'month' else 'week' end;
  v_step interval := case when p_period = 'month' then interval '1 month' else interval '1 week' end;
  v_now timestamp;
  v_first timestamp;
  v_from timestamptz;
  v_to timestamptz;
  r jsonb;
begin
  select * into m from public.masters where id = p_master_id;
  if not found or not (private.is_my_master(p_master_id) or private.is_admin()) then raise exception 'forbidden'; end if;
  v_now := now() at time zone m.timezone;
  v_first := date_trunc(v_unit, v_now) - 11 * v_step;
  v_from := v_first at time zone m.timezone;
  v_to := (date_trunc(v_unit, v_now) + v_step) at time zone m.timezone;

  with bk as (
    select b.*, date_trunc(v_unit, b.start_at at time zone m.timezone) as bucket,
           extract(dow from b.start_at at time zone m.timezone)::int as dow
      from public.bookings b
     where b.master_id = p_master_id and b.start_at >= v_from and b.start_at < v_to
  ),
  firsts as (
    select client_id, min(start_at) as first_at from public.bookings
     where master_id = p_master_id and status in ('pending', 'confirmed', 'completed', 'no_show')
     group by client_id
  ),
  buckets as (select generate_series(v_first, v_first + 11 * v_step, v_step) as bucket),
  series as (
    select jsonb_agg(jsonb_build_object(
             'start', to_char(k.bucket, 'YYYY-MM-DD'),
             'bookings', (select count(*) from bk where bk.bucket = k.bucket and bk.status in ('pending', 'confirmed', 'completed', 'no_show')),
             'completed', (select count(*) from bk where bk.bucket = k.bucket and bk.status = 'completed'),
             'revenue', (select coalesce(sum(price), 0) from bk where bk.bucket = k.bucket and bk.status = 'completed'),
             'expected', (select coalesce(sum(price), 0) from bk where bk.bucket = k.bucket and bk.status in ('pending', 'confirmed')),
             'cancels', (select count(*) from bk where bk.bucket = k.bucket and bk.status = 'cancelled_client'),
             'no_shows', (select count(*) from bk where bk.bucket = k.bucket and bk.status = 'no_show'))
             order by k.bucket) as j
      from buckets k
  )
  select jsonb_build_object(
    'period', v_unit,
    'series', (select j from series),
    'totals', (select jsonb_build_object(
        'bookings', count(*) filter (where status in ('pending', 'confirmed', 'completed', 'no_show')),
        'completed', count(*) filter (where status = 'completed'),
        'revenue', coalesce(sum(price) filter (where status = 'completed'), 0),
        'cancels', count(*) filter (where status = 'cancelled_client'),
        'late_cancels', count(*) filter (where status = 'cancelled_client' and late_cancel),
        'studio_cancels', count(*) filter (where status = 'cancelled_master'),
        'deposit_expired', count(*) filter (where deposit_status = 'expired'),
        'no_shows', count(*) filter (where status = 'no_show'),
        'deposits_paid', coalesce(sum(deposit) filter (where deposit_status = 'paid'), 0))
      from bk),
    'top_services', coalesce((select jsonb_agg(t order by t.n desc, t.revenue desc) from (
        select service_name as name, count(*) as n,
               coalesce(sum(price) filter (where status = 'completed'), 0) as revenue
          from bk where status in ('pending', 'confirmed', 'completed', 'no_show')
         group by service_name order by count(*) desc, 3 desc limit 5) t), '[]'::jsonb),
    'clients', (select jsonb_build_object(
        'new', count(distinct bk.client_id) filter (where f.first_at >= v_from),
        'returning', count(distinct bk.client_id) filter (where f.first_at < v_from))
      from bk join firsts f on f.client_id = bk.client_id
      where bk.status in ('pending', 'confirmed', 'completed', 'no_show')),
    'weekday', (select jsonb_agg(coalesce(x.n, 0) order by d.d) from generate_series(0, 6) d(d)
        left join (select dow, count(*) n from bk where status in ('pending', 'confirmed', 'completed', 'no_show') group by dow) x
          on x.dow = d.d)
  ) into r;
  return r;
end $$;

-- ---------- a paused studio takes no bookings ----------
create or replace function public.create_booking(
  p_slug text, p_service_id uuid, p_start_at timestamptz,
  p_name text, p_phone text, p_email text default null, p_note text default null,
  p_request_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.masters;
  s public.services;
  v_phone text := private.norm_phone(p_phone);
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_client uuid;
  v_dep numeric(10, 2);
  v_dep_status text := 'none';
  v_due timestamptz;
  b public.bookings;
begin
  -- the same request again (double tap, retry after a timeout): same booking
  if p_request_id is not null then
    select * into b from public.bookings where client_request_id = p_request_id;
    if found then return private.booking_json(b); end if;
  end if;

  select * into m from public.masters where slug = lower(p_slug);
  if not found or m.booking_engine <> 'builtin' then raise exception 'not_bookable'; end if;
  if m.status = 'paused' then raise exception 'paused'; end if;
  select * into s from public.services where id = p_service_id and master_id = m.id and active;
  if not found then raise exception 'service_not_found'; end if;
  if length(v_name) not between 1 and 80 then raise exception 'invalid_name'; end if;
  if v_phone is null then raise exception 'invalid_phone'; end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid_email'; end if;

  if not exists (
    select 1 from private.free_slots(m.id, s.id, (p_start_at at time zone m.timezone)::date) t where t = p_start_at
  ) then
    raise exception 'slot_taken';
  end if;

  insert into public.clients (master_id, name, phone, email)
  values (m.id, v_name, v_phone, v_email)
  on conflict (master_id, phone) do update set email = coalesce(public.clients.email, excluded.email)
  returning id into v_client;

  if (select count(*) from public.bookings
       where client_id = v_client and status in ('pending', 'confirmed') and start_at > now()) >= 3 then
    raise exception 'too_many';
  end if;

  -- deposit: the service's; a client with 2+ no-shows always pays one
  v_dep := s.deposit;
  if v_dep <= 0 and private.no_shows(v_client) >= 2 then v_dep := m.noshow_deposit; end if;
  if v_dep > 0 and private.takes_deposits(m.settings) then
    v_dep_status := 'pending';
    if m.deposit_hold_hours > 0 then
      -- N hours to pay, but settled at least an hour before the visit (never sooner than 30 min from now)
      v_due := greatest(least(now() + make_interval(hours => m.deposit_hold_hours), p_start_at - interval '1 hour'),
                        now() + interval '30 minutes');
    end if;
  end if;

  begin
    insert into public.bookings (master_id, service_id, client_id, start_at, end_at, buffer_end_at,
                                 status, price, service_name, client_note, created_by, client_request_id,
                                 deposit, deposit_status, deposit_due_at)
    values (m.id, s.id, v_client, p_start_at, p_start_at + make_interval(mins => s.duration_min),
            p_start_at + make_interval(mins => s.duration_min),
            case when m.auto_confirm then 'confirmed' else 'pending' end,
            s.price, s.name, left(coalesce(p_note, ''), 500), 'client', p_request_id,
            coalesce(v_dep, 0), v_dep_status, v_due)
    returning * into b;
  exception
    when exclusion_violation then raise exception 'slot_taken';
    when unique_violation then
      select * into b from public.bookings where client_request_id = p_request_id;
      if not found then raise; end if;
  end;
  return private.booking_json(b);
end $$;
revoke execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid) from public;
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid) to anon, authenticated;

-- (the profile says whether the studio is paused: the app shows a short-break page)
create or replace function public.get_public_profile(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'master', jsonb_build_object(
      'id', m.id, 'slug', m.slug, 'name', m.name, 'timezone', m.timezone,
      'style', m.style, 'accent', m.accent, 'settings', m.settings,
      'booking_engine', m.booking_engine, 'auto_confirm', m.auto_confirm, 'status', m.status,
      'min_notice_hours', m.min_notice_hours, 'max_days_ahead', m.max_days_ahead,
      'cancel_window_hours', m.cancel_window_hours, 'slot_step_min', m.slot_step_min),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'category', s.category, 'name', s.name, 'description', s.description,
               'includes', s.includes, 'duration_min', s.duration_min, 'buffer_min', s.buffer_min,
               'price', s.price, 'price_from', s.price_from, 'deposit', s.deposit, 'photo', s.photo,
               'fill_weeks', s.fill_weeks) order by s.sort, s.name)
        from public.services s where s.master_id = m.id and s.active), '[]'::jsonb),
    'hours', coalesce((
      select jsonb_agg(jsonb_build_object(
               'weekday', w.weekday, 'start', to_char(w.start_time, 'HH24:MI'), 'end', to_char(w.end_time, 'HH24:MI'))
               order by w.weekday, w.start_time)
        from public.working_hours w where w.master_id = m.id), '[]'::jsonb),
    'looks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'title', l.title, 'tag', l.tag, 'service_id', l.service_id, 'photo', l.photo,
               'before_photo', l.before_photo, 'is_new', l.is_new, 'popular', l.popular) order by l.sort, l.created_at desc)
        from public.looks l where l.master_id = m.id), '[]'::jsonb))
  from public.masters m
  where m.slug = lower(p_slug);
$$;

-- ---------- the admin's list ----------
create or replace function public.admin_studios() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(r order by r ->> 'created_at' desc) from (
      select jsonb_build_object(
        'id', m.id, 'slug', m.slug, 'name', m.name, 'master_name', coalesce(m.settings ->> 'masterName', ''),
        'owner_email', u.email, 'last_sign_in_at', u.last_sign_in_at, 'created_at', m.created_at,
        'status', m.status, 'trial_ends_at', m.trial_ends_at, 'next_payment_at', m.next_payment_at,
        'monthly_price', m.monthly_price, 'admin_notes', m.admin_notes,
        'style', m.style, 'accent', m.accent, 'icon', m.settings -> 'icons' ->> 'i192',
        'bookings_30d', (select count(*) from public.bookings b where b.master_id = m.id and b.created_at > now() - interval '30 days'),
        'setup', jsonb_build_array(
          coalesce(m.settings ->> 'heroPhoto', '') <> '' and coalesce(m.settings ->> 'avatar', '') <> '',
          exists (select 1 from public.services s where s.master_id = m.id and s.active)
            and not exists (select 1 from public.services s where s.master_id = m.id and s.active and coalesce(s.photo, '') = ''),
          exists (select 1 from public.working_hours w where w.master_id = m.id),
          private.takes_deposits(m.settings),
          jsonb_typeof(m.settings -> 'policies') = 'array' and jsonb_array_length(m.settings -> 'policies') > 0,
          (select count(*) from public.looks l where l.master_id = m.id) >= 3,
          exists (select 1 from public.push_subscriptions p where p.master_id = m.id),
          m.app_installed_at is not null)
      ) as r
      from public.masters m
      left join auth.users u on u.id = m.owner_id
    ) t), '[]'::jsonb);
end $$;

-- a free, valid slug for a new studio
create or replace function public.admin_slug_free(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s text := lower(btrim(coalesce(p_slug, '')));
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if s !~ '^[a-z0-9][a-z0-9-]{1,40}$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if s in ('demo', 'admin', 'www', 'api', 'app', 'apps', 'test', 'studio', 'help', 'support', 'manifest', 'manifests', 'img', 'owner', 'login')
    then return jsonb_build_object('ok', false, 'reason', 'reserved'); end if;
  if exists (select 1 from public.masters where slug = s) then return jsonb_build_object('ok', false, 'reason', 'taken'); end if;
  return jsonb_build_object('ok', true);
end $$;

-- status, trial, billing, notes
create or replace function public.admin_save_studio(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  update public.masters set
    status = coalesce(nullif(p ->> 'status', ''), status),
    trial_ends_at = case when p ? 'trial_ends_at' then nullif(p ->> 'trial_ends_at', '')::timestamptz else trial_ends_at end,
    next_payment_at = case when p ? 'next_payment_at' then nullif(p ->> 'next_payment_at', '')::date else next_payment_at end,
    monthly_price = case when p ? 'monthly_price' then nullif(p ->> 'monthly_price', '')::numeric else monthly_price end,
    admin_notes = coalesce(left(p ->> 'admin_notes', 4000), admin_notes)
  where id = p_id;
  if not found then raise exception 'not_found'; end if;
  return (select r from jsonb_array_elements(public.admin_studios()) r where r ->> 'id' = p_id::text);
end $$;

revoke execute on function public.admin_studios(), public.admin_slug_free(text), public.admin_save_studio(uuid, jsonb) from public, anon;
grant execute on function public.admin_studios(), public.admin_slug_free(text), public.admin_save_studio(uuid, jsonb) to authenticated;

-- a paused studio offers no times
create or replace function private.free_slots(p_master uuid, p_service uuid, p_date date, p_ignore uuid default null)
returns setof timestamptz
language sql stable security definer set search_path = '' as $$
  with m as (
    select * from public.masters where id = p_master and status <> 'paused'
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
