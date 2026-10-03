-- =========================================================
-- Part 6 — salons: several masters (staff) in one studio
--   • studios are Solo (as before) or Team (masters.kind)
--   • staff: everyone who takes bookings; every studio gets one staff row
--     for its owner, and all existing data is moved onto it — a solo
--     studio works exactly as before
--   • services per master (staff_services, optional price / duration),
--     hours and time off per master (time off without a master = the
--     whole studio), bookings.staff_id, looks.staff_id, formulas.staff_id
--   • no double booking per MASTER (two masters can work at the same time)
--   • roles: the owner sees and runs everything; a staff member sees only
--     her own bookings, clients (with their lash maps and notes), hours,
--     time off and numbers — in the functions and in RLS
--   • push per user: the owner and the booking's master hear about it
-- (Column names follow the rest of the schema: a studio is master_id.)
-- =========================================================

-- ---------- 1. studio type ----------
alter table public.masters add column if not exists kind text not null default 'solo' check (kind in ('solo', 'team'));

-- ---------- 2. staff ----------
create table if not exists public.staff (
  id             uuid primary key default gen_random_uuid(),
  master_id      uuid not null references public.masters (id) on delete cascade,
  user_id        uuid references auth.users (id) on delete set null,
  name           text not null check (length(name) between 1 and 60),
  title          text not null default '' check (length(title) <= 60),
  photo          text,
  bio            text not null default '' check (length(bio) <= 1000),
  color          text not null default '#8E8E93' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  active         boolean not null default true,
  sort           int not null default 0,
  commission_pct numeric(5, 2) not null default 0 check (commission_pct between 0 and 100),
  is_owner       boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists staff_master_idx on public.staff (master_id, sort);
create unique index if not exists staff_user_once on public.staff (master_id, user_id) where user_id is not null;
create unique index if not exists staff_one_owner on public.staff (master_id) where is_owner;

create table if not exists public.staff_services (
  staff_id          uuid not null references public.staff (id) on delete cascade,
  service_id        uuid not null references public.services (id) on delete cascade,
  price_override    numeric(10, 2) check (price_override >= 0),
  duration_override int check (duration_override between 5 and 720),
  primary key (staff_id, service_id)
);
create index if not exists staff_services_service_idx on public.staff_services (service_id);

-- every studio: its owner as the first master, doing every service
insert into public.staff (master_id, user_id, name, title, photo, color, is_owner, sort)
select m.id, m.owner_id, left(coalesce(nullif(btrim(m.settings ->> 'masterName'), ''), m.name), 60), '', nullif(m.settings ->> 'avatar', ''),
       case when m.accent ~ '^#[0-9A-Fa-f]{6}$' then m.accent else '#8E8E93' end, true, 0
  from public.masters m
 where not exists (select 1 from public.staff s where s.master_id = m.id and s.is_owner);
insert into public.staff_services (staff_id, service_id)
select st.id, sv.id from public.staff st join public.services sv on sv.master_id = st.master_id
 where st.is_owner on conflict do nothing;

-- ---------- 3. hours, time off, bookings, looks, lash maps → per master ----------
alter table public.working_hours add column if not exists staff_id uuid references public.staff (id) on delete cascade;
update public.working_hours w set staff_id = s.id from public.staff s where s.master_id = w.master_id and s.is_owner and w.staff_id is null;
alter table public.working_hours alter column staff_id set not null;
alter table public.working_hours drop constraint if exists working_hours_no_overlap;
alter table public.working_hours add constraint working_hours_no_overlap
  exclude using gist (staff_id with =, weekday with =, public.timerange(start_time, end_time) with &&);

alter table public.time_off add column if not exists staff_id uuid references public.staff (id) on delete cascade; -- null = the whole studio
update public.time_off o set staff_id = s.id from public.staff s where s.master_id = o.master_id and s.is_owner and o.staff_id is null;

alter table public.bookings add column if not exists staff_id uuid references public.staff (id);
update public.bookings b set staff_id = s.id from public.staff s where s.master_id = b.master_id and s.is_owner and b.staff_id is null;
alter table public.bookings alter column staff_id set not null;
alter table public.bookings drop constraint if exists bookings_no_overlap;
alter table public.bookings add constraint bookings_no_overlap
  exclude using gist (staff_id with =, tstzrange(start_at, buffer_end_at, '[)') with &&)
  where (status in ('pending', 'confirmed'));
create index if not exists bookings_staff_idx on public.bookings (staff_id, start_at);

alter table public.looks add column if not exists staff_id uuid references public.staff (id) on delete set null;
update public.looks l set staff_id = s.id from public.staff s where s.master_id = l.master_id and s.is_owner and l.staff_id is null;
alter table public.formulas add column if not exists staff_id uuid references public.staff (id) on delete set null;
update public.formulas f set staff_id = s.id from public.staff s where s.master_id = f.master_id and s.is_owner and f.staff_id is null;

-- ---------- 4. keeping it consistent (older code paths keep working) ----------
-- a new studio gets its owner as a master
create or replace function private.masters_owner_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.staff (master_id, user_id, name, color, is_owner)
    values (new.id, new.owner_id, left(coalesce(nullif(btrim(new.settings ->> 'masterName'), ''), new.name), 60),
            case when new.accent ~ '^#[0-9A-Fa-f]{6}$' then new.accent else '#8E8E93' end, true);
  elsif new.owner_id is distinct from old.owner_id then
    update public.staff set user_id = new.owner_id where master_id = new.id and is_owner;
  end if;
  return new;
end $$;
drop trigger if exists masters_owner_staff on public.masters;
create trigger masters_owner_staff after insert or update of owner_id on public.masters
  for each row execute function private.masters_owner_staff();

-- a new service: every active master of the studio does it (Team: the owner adjusts)
create or replace function private.services_assign_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.staff_services (staff_id, service_id)
  select s.id, new.id from public.staff s where s.master_id = new.master_id and s.active
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists services_assign_staff on public.services;
create trigger services_assign_staff after insert on public.services
  for each row execute function private.services_assign_staff();

-- hours / bookings written without a master belong to the owner's row; a master must be of the same studio
create or replace function private.fill_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.staff_id is null and tg_table_name <> 'time_off' then
    select id into new.staff_id from public.staff where master_id = new.master_id and is_owner;
  end if;
  if new.staff_id is not null and not exists (select 1 from public.staff where id = new.staff_id and master_id = new.master_id) then
    raise exception 'bad_staff';
  end if;
  return new;
end $$;
drop trigger if exists working_hours_staff on public.working_hours;
create trigger working_hours_staff before insert or update on public.working_hours for each row execute function private.fill_staff();
drop trigger if exists bookings_staff on public.bookings;
create trigger bookings_staff before insert or update of staff_id on public.bookings for each row execute function private.fill_staff();
drop trigger if exists time_off_staff on public.time_off;
create trigger time_off_staff before insert or update on public.time_off for each row execute function private.fill_staff();

-- ---------- 5. who is who ----------
create or replace function private.my_staff_id(mid uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.id from public.staff s where s.master_id = mid and s.user_id = auth.uid() and s.active limit 1;
$$;
create or replace function private.is_my_staff(sid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff s where s.id = sid and s.user_id = auth.uid() and s.active);
$$;
-- owner, or a master working there
create or replace function private.can_view_studio(mid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_my_master(mid) or private.my_staff_id(mid) is not null;
$$;
-- a client of "my" bookings (a staff member sees only her own clients)
create or replace function private.is_my_client(cid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings b join public.staff s on s.id = b.staff_id
                  where b.client_id = cid and s.user_id = auth.uid() and s.active);
$$;
revoke all on function private.my_staff_id(uuid), private.is_my_staff(uuid), private.can_view_studio(uuid), private.is_my_client(uuid) from public;
grant execute on function private.my_staff_id(uuid), private.is_my_staff(uuid), private.can_view_studio(uuid), private.is_my_client(uuid) to authenticated;

-- ---------- 6. RLS ----------
alter table public.staff enable row level security;
alter table public.staff_services enable row level security;
revoke all on public.staff, public.staff_services from anon;
grant select, insert, update, delete on public.staff, public.staff_services to authenticated;

create policy "owner: staff" on public.staff for all to authenticated
  using (private.is_my_master(master_id)) with check (private.is_my_master(master_id));
create policy "staff: own row" on public.staff for select to authenticated using (user_id = auth.uid());
create policy "admin: read staff" on public.staff for select to authenticated using (private.is_admin());
create policy "owner: staff services" on public.staff_services for all to authenticated
  using (exists (select 1 from public.staff s where s.id = staff_id and private.is_my_master(s.master_id)))
  with check (exists (select 1 from public.staff s where s.id = staff_id and private.is_my_master(s.master_id)));
create policy "staff: own services" on public.staff_services for select to authenticated using (private.is_my_staff(staff_id));
create policy "admin: read staff services" on public.staff_services for select to authenticated using (private.is_admin());

create policy "staff: read studio" on public.masters for select to authenticated using (private.my_staff_id(id) is not null);
create policy "staff: services" on public.services for select to authenticated using (private.my_staff_id(master_id) is not null);
create policy "staff: own hours" on public.working_hours for all to authenticated
  using (private.is_my_staff(staff_id)) with check (private.is_my_staff(staff_id));
create policy "staff: time off" on public.time_off for select to authenticated
  using (private.is_my_staff(staff_id) or (staff_id is null and private.my_staff_id(master_id) is not null));
create policy "staff: own time off" on public.time_off for insert to authenticated with check (private.is_my_staff(staff_id));
create policy "staff: delete own time off" on public.time_off for delete to authenticated using (private.is_my_staff(staff_id));
-- (a master changes her bookings only through the functions below, which check everything)
create policy "staff: own bookings" on public.bookings for select to authenticated using (private.is_my_staff(staff_id));
create policy "staff: own clients" on public.clients for select to authenticated using (private.is_my_client(id));
create policy "staff: update own clients" on public.clients for update to authenticated
  using (private.is_my_client(id)) with check (private.is_my_client(id));
create policy "staff: lash maps of own clients" on public.formulas for select to authenticated using (private.is_my_client(client_id));
create policy "staff: own lash maps" on public.formulas for insert to authenticated with check (private.is_my_staff(staff_id) and private.is_my_client(client_id));
create policy "staff: edit own lash maps" on public.formulas for update to authenticated using (private.is_my_staff(staff_id)) with check (private.is_my_staff(staff_id));
create policy "staff: delete own lash maps" on public.formulas for delete to authenticated using (private.is_my_staff(staff_id));

-- the studio row: billing and the admin's notes are never readable by the
-- studio's accounts (owner or staff) — only through the admin's functions
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
    from information_schema.columns
   where table_schema = 'public' and table_name = 'masters'
     and column_name not in ('admin_notes', 'monthly_price', 'plan_amount', 'payment_link', 'billing_plan',
                             'last_paid_at', 'next_payment_at', 'founding', 'trial_ends_at', 'owner_email');
  execute 'revoke select on public.masters from authenticated';
  execute format('grant select (%s) on public.masters to authenticated', cols);
end $$;

-- ---------- 7. push per user ----------
alter table public.push_subscriptions add column if not exists user_id uuid references auth.users (id) on delete cascade;
update public.push_subscriptions p set user_id = m.owner_id from public.masters m where m.id = p.master_id and p.user_id is null;
drop policy if exists "owner: push subscriptions" on public.push_subscriptions;
create policy "user: own push subscriptions" on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and private.can_view_studio(master_id));

create or replace function public.owner_push_subscribe(p_master_id uuid, p_endpoint text, p_p256dh text, p_auth text, p_label text default '')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.push_subscriptions;
begin
  if not private.can_view_studio(p_master_id) then raise exception 'forbidden'; end if;
  if p_endpoint !~ '^https://' or length(p_p256dh) < 80 or length(p_auth) < 16 then raise exception 'bad_subscription'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint; -- this device now belongs to this account
  insert into public.push_subscriptions (master_id, user_id, endpoint, p256dh, auth, device_label)
  values (p_master_id, auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_label, ''), 80))
  returning * into r;
  return jsonb_build_object('id', r.id, 'device_label', r.device_label, 'created_at', r.created_at);
end $$;

create or replace function public.owner_push_devices(p_master_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('device_label', device_label, 'created_at', created_at) order by created_at), '[]'::jsonb)
    from public.push_subscriptions where master_id = p_master_id and user_id = auth.uid();
$$;

-- the trigger also says who did it (that account isn't notified about its own action)
create or replace function private.push_on_booking() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_url text;
  v_secret text;
  by_owner boolean := auth.uid() is not null and private.is_my_master(new.master_id);
begin
  if tg_op = 'INSERT' then
    if new.created_by = 'client' and new.status in ('pending', 'confirmed') then
      v_kind := case when new.status = 'pending' then 'request' else 'new' end;
    end if;
  elsif new.status is distinct from old.status and new.status = 'cancelled_client' then
    v_kind := 'cancel';
  elsif new.status is distinct from old.status and new.status = 'cancelled_master'
        and new.deposit_status = 'expired' and not by_owner then
    v_kind := 'deposit_expired';
  elsif (new.start_at is distinct from old.start_at or new.staff_id is distinct from old.staff_id)
        and new.status in ('pending', 'confirmed') and not by_owner then
    v_kind := 'move';
  end if;
  if v_kind is null then return new; end if;
  if not exists (select 1 from public.push_subscriptions s where s.master_id = new.master_id) then return new; end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  if v_url is null or v_secret is null then return new; end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('kind', v_kind, 'booking_id', new.id, 'actor', auth.uid(),
                               'old_start_at', case when tg_op = 'UPDATE' then old.start_at end),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 8000);
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists bookings_push on public.bookings;
create trigger bookings_push
  after insert or update of status, start_at, staff_id on public.bookings
  for each row execute function private.push_on_booking();

-- ---------- 8. free times per master ----------
-- a master's free start times for a service on a day (her hours, her and the
-- studio's time off, her bookings; her own duration / price for the service)
create or replace function private.staff_slots(p_staff uuid, p_service uuid, p_date date, p_ignore uuid default null)
returns setof timestamptz
language sql stable security definer set search_path = '' as $$
  with st as (
    select * from public.staff where id = p_staff and active
  ), m as (
    select ms.* from public.masters ms join st on st.master_id = ms.id where ms.status <> 'paused'
  ), s as (
    select sv.id, sv.buffer_min, coalesce(ss.duration_override, sv.duration_min) as dur
      from public.services sv
      join public.staff_services ss on ss.service_id = sv.id and ss.staff_id = p_staff
      join m on m.id = sv.master_id
     where sv.id = p_service and sv.active
  ), lim as (
    select m.id as mid, (now() at time zone m.timezone)::date as today,
           now() + make_interval(hours => m.min_notice_hours) as earliest,
           m.max_days_ahead, m.slot_step_min, m.timezone
      from m
  ), cand as (
    select (lt at time zone lim.timezone) as t
      from lim, s,
           public.working_hours wh,
           generate_series(p_date + wh.start_time,
                           p_date + wh.end_time - make_interval(mins => s.dur),
                           make_interval(mins => lim.slot_step_min)) as lt
     where wh.staff_id = p_staff
       and wh.weekday = extract(dow from p_date)
       and p_date >= lim.today
       and p_date <= lim.today + lim.max_days_ahead
  )
  select distinct c.t
    from cand c, s, lim
   where c.t >= lim.earliest
     and not exists (
       select 1 from public.time_off o
        where o.master_id = lim.mid and (o.staff_id = p_staff or o.staff_id is null)
          and tstzrange(o.start_at, o.end_at, '[)') && tstzrange(c.t, c.t + make_interval(mins => s.dur), '[)'))
     and not exists (
       select 1 from public.bookings b
        where b.staff_id = p_staff
          and b.status in ('pending', 'confirmed')
          and b.id is distinct from p_ignore
          and tstzrange(b.start_at, b.buffer_end_at, '[)')
              && tstzrange(c.t, c.t + make_interval(mins => s.dur + s.buffer_min), '[)'))
   order by c.t;
$$;

-- any master: a time is free if at least one master who does the service is free then
create or replace function private.free_slots(p_master uuid, p_service uuid, p_date date, p_ignore uuid default null)
returns setof timestamptz
language sql stable security definer set search_path = '' as $$
  select distinct t
    from public.staff st
    join public.staff_services ss on ss.staff_id = st.id and ss.service_id = p_service,
         private.staff_slots(st.id, p_service, p_date, p_ignore) t
   where st.master_id = p_master and st.active
   order by t;
$$;

-- is the master free at that time (ignoring her hours: for the owner's "book anyway")
create or replace function private.staff_is_free(p_staff uuid, p_service uuid, p_start timestamptz, p_ignore uuid default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  with st as (select * from public.staff where id = p_staff),
  s as (select sv.buffer_min, coalesce(ss.duration_override, sv.duration_min) as dur
          from public.services sv left join public.staff_services ss on ss.service_id = sv.id and ss.staff_id = p_staff
         where sv.id = p_service)
  select not exists (
           select 1 from public.time_off o, st, s
            where o.master_id = st.master_id and (o.staff_id = p_staff or o.staff_id is null)
              and tstzrange(o.start_at, o.end_at, '[)') && tstzrange(p_start, p_start + make_interval(mins => s.dur), '[)'))
     and not exists (
           select 1 from public.bookings b, s
            where b.staff_id = p_staff and b.status in ('pending', 'confirmed') and b.id is distinct from p_ignore
              and tstzrange(b.start_at, b.buffer_end_at, '[)') && tstzrange(p_start, p_start + make_interval(mins => s.dur + s.buffer_min), '[)'));
$$;

-- duration / price of a service for one master
create or replace function private.staff_service(p_staff uuid, p_service uuid, out dur int, out price numeric)
language sql stable security definer set search_path = '' as $$
  select coalesce(ss.duration_override, sv.duration_min), coalesce(ss.price_override, sv.price)
    from public.services sv left join public.staff_services ss on ss.service_id = sv.id and ss.staff_id = p_staff
   where sv.id = p_service;
$$;
revoke all on function private.staff_slots(uuid, uuid, date, uuid), private.free_slots(uuid, uuid, date, uuid),
  private.staff_is_free(uuid, uuid, timestamptz, uuid), private.staff_service(uuid, uuid) from public;

-- ---------- 9. what clients see ----------
drop function if exists public.get_openings(text, uuid, date, int, uuid);
create or replace function public.get_openings(p_slug text, p_service_id uuid, p_from date, p_days int default 14, p_ignore uuid default null, p_staff_id uuid default null)
returns setof timestamptz
language sql stable security definer set search_path = '' as $$
  select distinct t
    from public.masters m,
         generate_series(p_from::timestamp, (p_from + least(greatest(p_days, 1), 92) - 1)::timestamp, interval '1 day') as d,
         lateral (
           select x from private.free_slots(m.id, p_service_id, d::date, p_ignore) x where p_staff_id is null
           union all
           select x from private.staff_slots(p_staff_id, p_service_id, d::date, p_ignore) x
            where p_staff_id is not null and exists (select 1 from public.staff st where st.id = p_staff_id and st.master_id = m.id)
         ) as q(t)
   where m.slug = lower(p_slug) and m.booking_engine = 'builtin'
   order by t;
$$;
drop function if exists public.get_available_slots(text, uuid, date, uuid);
create or replace function public.get_available_slots(p_slug text, p_service_id uuid, p_date date, p_ignore uuid default null, p_staff_id uuid default null)
returns setof timestamptz
language sql stable security definer set search_path = '' as $$
  select t from public.get_openings(p_slug, p_service_id, p_date, 1, p_ignore, p_staff_id) t;
$$;
grant execute on function public.get_openings(text, uuid, date, int, uuid, uuid), public.get_available_slots(text, uuid, date, uuid, uuid) to anon, authenticated;

-- the booking as the client sees it: + her master
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
    'staff_id', b.staff_id,
    'staff_name', case when m.kind = 'team' then st.name end,
    'staff_photo', case when m.kind = 'team' then st.photo end,
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
      'slug', m.slug, 'name', m.name, 'timezone', m.timezone, 'kind', m.kind,
      'cancel_window_hours', m.cancel_window_hours, 'auto_confirm', m.auto_confirm,
      'phone', m.settings ->> 'phone', 'address', m.settings ->> 'address',
      'payments', coalesce(m.settings -> 'payments', '{}'::jsonb),
      'review_url', m.settings ->> 'reviewUrl')
  )
  from public.masters m
  left join public.services s on s.id = b.service_id
  left join public.clients c on c.id = b.client_id
  left join public.staff st on st.id = b.staff_id
  where m.id = b.master_id;
$$;
revoke all on function private.booking_json(public.bookings) from public;

-- the profile: + studio type, the team (with what each one does), looks per master,
-- and the hours of everyone working (the app merges overlapping ones)
create or replace function public.get_public_profile(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'master', jsonb_build_object(
      'id', m.id, 'slug', m.slug, 'name', m.name, 'timezone', m.timezone,
      'style', m.style, 'accent', m.accent, 'settings', m.settings, 'kind', m.kind,
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
        from public.working_hours w join public.staff st on st.id = w.staff_id and st.active
       where w.master_id = m.id), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'name', st.name, 'title', st.title, 'photo', st.photo, 'bio', st.bio, 'color', st.color,
               'is_owner', st.is_owner,
               'services', coalesce((select jsonb_agg(jsonb_build_object('id', ss.service_id, 'price', ss.price_override, 'duration', ss.duration_override))
                                       from public.staff_services ss join public.services sv on sv.id = ss.service_id and sv.active
                                      where ss.staff_id = st.id), '[]'::jsonb))
             order by st.sort, st.created_at)
        from public.staff st where st.master_id = m.id and st.active), '[]'::jsonb),
    'looks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'title', l.title, 'tag', l.tag, 'service_id', l.service_id, 'photo', l.photo, 'staff_id', l.staff_id,
               'before_photo', l.before_photo, 'is_new', l.is_new, 'popular', l.popular) order by l.sort, l.created_at desc)
        from public.looks l where l.master_id = m.id), '[]'::jsonb))
  from public.masters m
  where m.slug = lower(p_slug);
$$;

-- a booking: with a chosen master, or "any available" (null) — the master who is
-- free then; equal → the one with less booked time that day
drop function if exists public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid);
create or replace function public.create_booking(
  p_slug text, p_service_id uuid, p_start_at timestamptz,
  p_name text, p_phone text, p_email text default null, p_note text default null,
  p_request_id uuid default null, p_staff_id uuid default null)
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
  v_day date;
  v_staff uuid;
  v_dur int;
  v_price numeric;
  b public.bookings;
begin
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
  if p_staff_id is not null and not exists (
    select 1 from public.staff st join public.staff_services ss on ss.staff_id = st.id and ss.service_id = s.id
     where st.id = p_staff_id and st.master_id = m.id and st.active) then
    raise exception 'staff_not_found';
  end if;
  v_day := (p_start_at at time zone m.timezone)::date;
  if not exists (select 1 from private.free_slots(m.id, s.id, v_day) t where t = p_start_at) then raise exception 'slot_taken'; end if;

  insert into public.clients (master_id, name, phone, email)
  values (m.id, v_name, v_phone, v_email)
  on conflict (master_id, phone) do update set email = coalesce(public.clients.email, excluded.email)
  returning id into v_client;

  if (select count(*) from public.bookings
       where client_id = v_client and status in ('pending', 'confirmed') and start_at > now()) >= 3 then
    raise exception 'too_many';
  end if;

  v_dep := s.deposit;
  if v_dep <= 0 and private.no_shows(v_client) >= 2 then v_dep := m.noshow_deposit; end if;
  if v_dep > 0 and private.takes_deposits(m.settings) then
    v_dep_status := 'pending';
    if m.deposit_hold_hours > 0 then
      v_due := greatest(least(now() + make_interval(hours => m.deposit_hold_hours), p_start_at - interval '1 hour'),
                        now() + interval '30 minutes');
    end if;
  end if;

  -- the masters to try, in order: the chosen one, or everyone free then (least booked that day first)
  for v_staff in
    select st.id
      from public.staff st
      join public.staff_services ss on ss.staff_id = st.id and ss.service_id = s.id
     where st.master_id = m.id and st.active
       and (p_staff_id is null or st.id = p_staff_id)
       and exists (select 1 from private.staff_slots(st.id, s.id, v_day) t where t = p_start_at)
     order by (select coalesce(sum(extract(epoch from (x.end_at - x.start_at))), 0)
                 from public.bookings x
                where x.staff_id = st.id and x.status in ('pending', 'confirmed', 'completed')
                  and (x.start_at at time zone m.timezone)::date = v_day), st.sort, st.created_at
  loop
    select dur, price into v_dur, v_price from private.staff_service(v_staff, s.id);
    begin
      insert into public.bookings (master_id, staff_id, service_id, client_id, start_at, end_at, buffer_end_at,
                                   status, price, service_name, client_note, created_by, client_request_id,
                                   deposit, deposit_status, deposit_due_at)
      values (m.id, v_staff, s.id, v_client, p_start_at, p_start_at + make_interval(mins => v_dur),
              p_start_at + make_interval(mins => v_dur),
              case when m.auto_confirm then 'confirmed' else 'pending' end,
              v_price, s.name, left(coalesce(p_note, ''), 500), 'client', p_request_id,
              coalesce(v_dep, 0), v_dep_status, v_due)
      returning * into b;
      return private.booking_json(b);
    exception
      when exclusion_violation then null; -- taken a moment ago: the next master
      when unique_violation then
        select * into b from public.bookings where client_request_id = p_request_id;
        if found then return private.booking_json(b); end if;
        raise;
    end;
  end loop;
  raise exception 'slot_taken';
end $$;
revoke execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid, uuid) from public;
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid, uuid) to anon, authenticated;

-- a client moves her booking: same master
create or replace function public.reschedule_booking(p_token uuid, p_new_start_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  m public.masters;
  v_dur int;
begin
  select * into b from public.bookings where manage_token = p_token for update;
  if not found then raise exception 'not_found'; end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'not_active'; end if;
  if b.start_at <= now() then raise exception 'too_late'; end if;
  select * into m from public.masters where id = b.master_id;
  if b.service_id is null then raise exception 'service_not_found'; end if;
  if not exists (
    select 1 from private.staff_slots(b.staff_id, b.service_id, (p_new_start_at at time zone m.timezone)::date, b.id) t where t = p_new_start_at
  ) then
    raise exception 'slot_taken';
  end if;
  select dur into v_dur from private.staff_service(b.staff_id, b.service_id);
  begin
    update public.bookings
       set start_at = p_new_start_at,
           end_at = p_new_start_at + make_interval(mins => v_dur),
           status = case when m.auto_confirm then 'confirmed' else 'pending' end,
           late_cancel = b.late_cancel or (b.start_at - now() < make_interval(hours => m.cancel_window_hours))
     where id = b.id
     returning * into b;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;
  return private.booking_json(b);
end $$;

-- ---------- 10. the dashboard: owner (everything) and staff (her own) ----------
-- every studio this account works in, with its role there
create or replace function public.owner_studios() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', m.id, 'slug', m.slug, 'name', m.name, 'timezone', m.timezone,
           'booking_engine', m.booking_engine, 'auto_confirm', m.auto_confirm,
           'min_notice_hours', m.min_notice_hours, 'max_days_ahead', m.max_days_ahead,
           'cancel_window_hours', m.cancel_window_hours, 'slot_step_min', m.slot_step_min,
           'phone', m.settings ->> 'phone', 'address', m.settings ->> 'address',
           'status', m.status, 'kind', m.kind,
           'mine', m.owner_id = auth.uid() or private.my_staff_id(m.id) is not null,
           'role', case when m.owner_id = auth.uid() then 'owner' when private.my_staff_id(m.id) is not null then 'staff' else 'admin' end,
           'staff_id', private.my_staff_id(m.id)) order by m.created_at), '[]'::jsonb)
    from public.masters m;
$$;

-- a master's sign-in email, for the studio's owner only
create or replace function private.staff_email(sid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select u.email from public.staff st join auth.users u on u.id = st.user_id
   where st.id = sid and private.is_my_master(st.master_id);
$$;
revoke all on function private.staff_email(uuid) from public;
grant execute on function private.staff_email(uuid) to authenticated;

-- the team (owner: everyone; staff: herself)
create or replace function public.owner_staff(p_master_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', st.id, 'name', st.name, 'title', st.title, 'photo', st.photo, 'bio', st.bio, 'color', st.color,
           'active', st.active, 'sort', st.sort, 'commission_pct', st.commission_pct, 'is_owner', st.is_owner,
           'has_login', st.user_id is not null,
           'email', private.staff_email(st.id),
           'services', coalesce((select jsonb_agg(jsonb_build_object('id', ss.service_id, 'price', ss.price_override, 'duration', ss.duration_override))
                                   from public.staff_services ss where ss.staff_id = st.id), '[]'::jsonb))
         order by st.active desc, st.sort, st.created_at), '[]'::jsonb)
    from public.staff st where st.master_id = p_master_id;
$$;

-- add / edit a master (owner). Accounts for staff are made by the owner-invite-staff function.
create or replace function public.owner_save_staff(p_master_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.staff;
  v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  if not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
  if v_id is null then
    insert into public.staff (master_id, name, title, photo, bio, color, commission_pct, sort)
    values (p_master_id, btrim(p ->> 'name'), coalesce(btrim(p ->> 'title'), ''), nullif(p ->> 'photo', ''), coalesce(p ->> 'bio', ''),
            coalesce(nullif(p ->> 'color', ''), '#8E8E93'), coalesce((p ->> 'commission_pct')::numeric, 0),
            coalesce((select max(sort) + 1 from public.staff where master_id = p_master_id), 1))
    returning * into r;
    -- a new master starts with the owner's hours
    insert into public.working_hours (master_id, staff_id, weekday, start_time, end_time)
    select w.master_id, r.id, w.weekday, w.start_time, w.end_time
      from public.working_hours w join public.staff o on o.id = w.staff_id and o.is_owner where w.master_id = p_master_id;
  else
    if (p ->> 'active') = 'false' and exists (select 1 from public.staff where id = v_id and is_owner) then raise exception 'owner_stays'; end if;
    if (p ->> 'active') = 'false' and exists (select 1 from public.bookings where staff_id = v_id and status in ('pending', 'confirmed') and start_at > now())
      then raise exception 'has_bookings'; end if;
    update public.staff set
      name = coalesce(nullif(btrim(p ->> 'name'), ''), name),
      title = coalesce(btrim(p ->> 'title'), title),
      photo = case when p ? 'photo' then nullif(p ->> 'photo', '') else photo end,
      bio = coalesce(p ->> 'bio', bio),
      color = coalesce(nullif(p ->> 'color', ''), color),
      commission_pct = coalesce((p ->> 'commission_pct')::numeric, commission_pct),
      active = coalesce((p ->> 'active')::boolean, active),
      sort = coalesce((p ->> 'sort')::int, sort)
    where id = v_id and master_id = p_master_id
    returning * into r;
    if not found then raise exception 'not_found'; end if;
  end if;
  -- what she does: [{id, price?, duration?}]
  if p ? 'services' then
    delete from public.staff_services where staff_id = r.id
       and service_id not in (select (x ->> 'id')::uuid from jsonb_array_elements(p -> 'services') x);
    insert into public.staff_services (staff_id, service_id, price_override, duration_override)
    select r.id, (x ->> 'id')::uuid, nullif(x ->> 'price', '')::numeric, nullif(x ->> 'duration', '')::int
      from jsonb_array_elements(p -> 'services') x
      join public.services sv on sv.id = (x ->> 'id')::uuid and sv.master_id = p_master_id
    on conflict (staff_id, service_id) do update set price_override = excluded.price_override, duration_override = excluded.duration_override;
  end if;
  return (select r2 from jsonb_array_elements(public.owner_staff(p_master_id)) r2 where r2 ->> 'id' = r.id::text);
end $$;

-- a master's upcoming bookings, each with the masters who could take it instead
create or replace function public.owner_staff_future(p_staff_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mid uuid;
begin
  select master_id into v_mid from public.staff where id = p_staff_id;
  if v_mid is null or not private.is_my_master(v_mid) then raise exception 'forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', b.id, 'start_at', b.start_at, 'end_at', b.end_at, 'service_name', b.service_name, 'status', b.status,
             'client_name', c.name,
             'options', coalesce((
               select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name, 'color', o.color) order by o.sort)
                 from public.staff o join public.staff_services ss on ss.staff_id = o.id and ss.service_id = b.service_id
                where o.master_id = v_mid and o.active and o.id <> p_staff_id
                  and private.staff_is_free(o.id, b.service_id, b.start_at, b.id)), '[]'::jsonb))
           order by b.start_at)
      from public.bookings b left join public.clients c on c.id = b.client_id
     where b.staff_id = p_staff_id and b.status in ('pending', 'confirmed') and b.start_at > now()), '[]'::jsonb);
end $$;

-- the dashboard's view of a booking: + its master
create or replace function private.owner_booking_row(b public.bookings) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'status', b.status, 'start_at', b.start_at, 'end_at', b.end_at,
    'price', b.price, 'service_id', b.service_id, 'service_name', b.service_name,
    'service_photo', s.photo, 'duration_min', s.duration_min,
    'staff_id', b.staff_id, 'staff_name', st.name, 'staff_color', st.color,
    'client_id', b.client_id, 'client_name', c.name, 'client_phone', c.phone, 'client_email', c.email,
    'client_tags', coalesce(c.tags, '{}'), 'client_no_shows', private.no_shows(b.client_id),
    'client_note', b.client_note, 'late_cancel', b.late_cancel,
    'created_by', b.created_by, 'created_at', b.created_at, 'updated_at', b.updated_at,
    'cancelled_at', b.cancelled_at, 'cancel_reason', b.cancel_reason,
    'completed_at', b.completed_at, 'auto_completed', b.auto_completed,
    'deposit', b.deposit, 'deposit_status', b.deposit_status,
    'deposit_due_at', b.deposit_due_at, 'deposit_paid_at', b.deposit_paid_at,
    'last_formula', (select jsonb_build_object('curl', f.curl, 'lengths', f.lengths, 'thickness', f.thickness,
                                               'lash_type', f.lash_type, 'glue', f.glue, 'created_at', f.created_at)
                       from public.formulas f
                      where f.client_id = b.client_id and f.created_at < greatest(b.start_at, now())
                      order by f.created_at desc limit 1))
  from (select 1) x
  left join public.services s on s.id = b.service_id
  left join public.clients c on c.id = b.client_id
  left join public.staff st on st.id = b.staff_id;
$$;

-- confirm / cancel / complete / no-show: the owner, or the booking's own master
create or replace function public.owner_set_status(p_booking_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or not (private.is_my_master(b.master_id) or private.is_my_staff(b.staff_id)) then raise exception 'not_found'; end if;
  if p_status not in ('confirmed', 'cancelled_master', 'completed', 'no_show') then raise exception 'bad_status'; end if;
  if p_status = 'confirmed' and b.status <> 'pending' then raise exception 'bad_status'; end if;
  if p_status = 'cancelled_master' and b.status not in ('pending', 'confirmed') then raise exception 'bad_status'; end if;
  update public.bookings
     set status = p_status,
         cancel_reason = case when p_status = 'cancelled_master'
                              then left(nullif(btrim(coalesce(p_reason, '')), ''), 300) else cancel_reason end,
         completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else null end,
         auto_completed = false,
         deposit_status = case when p_status = 'cancelled_master' and deposit_status = 'pending' then 'none' else deposit_status end
   where id = b.id
   returning * into b;
  return private.booking_json(b);
end $$;

-- a booking made in the dashboard: the owner picks the master (default: herself),
-- a staff member books only herself
drop function if exists public.owner_create_booking(uuid, uuid, timestamptz, text, text, text, text, boolean);
create or replace function public.owner_create_booking(
  p_master_id uuid, p_service_id uuid, p_start_at timestamptz,
  p_name text, p_phone text, p_email text default null, p_note text default null,
  p_force boolean default false, p_staff_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.masters;
  s public.services;
  v_phone text := private.norm_phone(p_phone);
  v_name text := btrim(coalesce(p_name, ''));
  v_client uuid;
  v_staff uuid;
  v_dur int;
  v_price numeric;
  b public.bookings;
begin
  if private.is_my_master(p_master_id) then
    v_staff := coalesce(p_staff_id, (select id from public.staff where master_id = p_master_id and is_owner));
    if not exists (select 1 from public.staff where id = v_staff and master_id = p_master_id and active) then raise exception 'staff_not_found'; end if;
  elsif private.my_staff_id(p_master_id) is not null then
    v_staff := private.my_staff_id(p_master_id);
  else
    raise exception 'forbidden';
  end if;
  select * into m from public.masters where id = p_master_id;
  select * into s from public.services where id = p_service_id and master_id = m.id;
  if not found then raise exception 'service_not_found'; end if;
  if length(v_name) not between 1 and 80 then raise exception 'invalid_name'; end if;
  if v_phone is null then raise exception 'invalid_phone'; end if;
  if not private.staff_is_free(v_staff, s.id, p_start_at) then raise exception 'slot_taken'; end if;
  if not p_force and not exists (
    select 1 from private.staff_slots(v_staff, s.id, (p_start_at at time zone m.timezone)::date) t where t = p_start_at
  ) then
    raise exception 'outside_hours';
  end if;

  insert into public.clients (master_id, name, phone, email)
  values (m.id, v_name, v_phone, nullif(lower(btrim(coalesce(p_email, ''))), ''))
  on conflict (master_id, phone) do update set email = coalesce(public.clients.email, excluded.email)
  returning id into v_client;

  select dur, price into v_dur, v_price from private.staff_service(v_staff, s.id);
  begin
    insert into public.bookings (master_id, staff_id, service_id, client_id, start_at, end_at, buffer_end_at,
                                 status, price, service_name, client_note, created_by)
    values (m.id, v_staff, s.id, v_client, p_start_at, p_start_at + make_interval(mins => v_dur),
            p_start_at + make_interval(mins => v_dur),
            'confirmed', v_price, s.name, left(coalesce(p_note, ''), 500), 'master')
    returning * into b;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;
  return private.booking_json(b);
end $$;

-- move a booking (time, and for the owner also to another master — checked for that master)
drop function if exists public.owner_reschedule(uuid, timestamptz, boolean);
create or replace function public.owner_reschedule(p_booking_id uuid, p_new_start_at timestamptz, p_force boolean default false, p_staff_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
  m public.masters;
  v_staff uuid;
  v_dur int;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or not (private.is_my_master(b.master_id) or private.is_my_staff(b.staff_id)) then raise exception 'not_found'; end if;
  if b.status not in ('pending', 'confirmed') then raise exception 'not_active'; end if;
  v_staff := coalesce(p_staff_id, b.staff_id);
  if v_staff <> b.staff_id then
    if not private.is_my_master(b.master_id) then raise exception 'forbidden'; end if;
    if not exists (select 1 from public.staff where id = v_staff and master_id = b.master_id and active) then raise exception 'staff_not_found'; end if;
  end if;
  select * into m from public.masters where id = b.master_id;
  if b.service_id is null then raise exception 'service_not_found'; end if;
  if not private.staff_is_free(v_staff, b.service_id, p_new_start_at, b.id) then raise exception 'slot_taken'; end if;
  if not p_force and not exists (
    select 1 from private.staff_slots(v_staff, b.service_id, (p_new_start_at at time zone m.timezone)::date, b.id) t where t = p_new_start_at
  ) then
    raise exception 'outside_hours';
  end if;
  select dur into v_dur from private.staff_service(v_staff, b.service_id);
  begin
    update public.bookings
       set start_at = p_new_start_at,
           end_at = p_new_start_at + make_interval(mins => v_dur),
           staff_id = v_staff
     where id = b.id
     returning * into b;
  exception when exclusion_violation then
    raise exception 'slot_taken';
  end;
  return private.booking_json(b);
end $$;

-- free times in the dashboard (the owner: any master; staff: herself)
drop function if exists public.owner_slots(uuid, uuid, date, uuid);
create or replace function public.owner_slots(p_master_id uuid, p_service_id uuid, p_date date, p_ignore uuid default null, p_staff_id uuid default null)
returns setof timestamptz
language plpgsql stable security definer set search_path = '' as $$
declare
  v_staff uuid;
begin
  if private.is_my_master(p_master_id) then
    v_staff := coalesce(p_staff_id, (select id from public.staff where master_id = p_master_id and is_owner));
  else
    v_staff := private.my_staff_id(p_master_id);
    if v_staff is null then return; end if;
  end if;
  return query select t from private.staff_slots(v_staff, p_service_id, p_date, p_ignore) t;
end $$;

-- hours, time off and rules of one master (owner: any, default herself; staff: her own)
drop function if exists public.owner_schedule(uuid);
create or replace function public.owner_schedule(p_master_id uuid, p_staff_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_staff uuid;
  m public.masters;
begin
  if private.is_my_master(p_master_id) then
    v_staff := coalesce(p_staff_id, (select id from public.staff where master_id = p_master_id and is_owner));
  else
    v_staff := private.my_staff_id(p_master_id);
    if v_staff is null then raise exception 'forbidden'; end if;
  end if;
  select * into m from public.masters where id = p_master_id;
  return jsonb_build_object(
    'staff_id', v_staff,
    'hours', coalesce((select jsonb_agg(jsonb_build_object('weekday', w.weekday,
                         'start', to_char(w.start_time, 'HH24:MI'), 'end', to_char(w.end_time, 'HH24:MI'))
                         order by w.weekday, w.start_time)
                         from public.working_hours w where w.staff_id = v_staff), '[]'::jsonb),
    'time_off', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'start_at', o.start_at,
                            'end_at', o.end_at, 'reason', o.reason, 'whole_studio', o.staff_id is null) order by o.start_at)
                            from public.time_off o where o.master_id = m.id and o.end_at > now()
                             and (o.staff_id = v_staff or o.staff_id is null)), '[]'::jsonb),
    'rules', jsonb_build_object('auto_confirm', m.auto_confirm, 'min_notice_hours', m.min_notice_hours,
                                'max_days_ahead', m.max_days_ahead, 'cancel_window_hours', m.cancel_window_hours,
                                'slot_step_min', m.slot_step_min, 'deposit_hold_hours', m.deposit_hold_hours,
                                'noshow_deposit', m.noshow_deposit,
                                'takes_deposits', private.takes_deposits(m.settings)));
end $$;

drop function if exists public.owner_save_hours(uuid, jsonb);
create or replace function public.owner_save_hours(p_master_id uuid, p_hours jsonb, p_staff_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_staff uuid;
begin
  if private.is_my_master(p_master_id) then
    v_staff := coalesce(p_staff_id, (select id from public.staff where master_id = p_master_id and is_owner));
    if not exists (select 1 from public.staff where id = v_staff and master_id = p_master_id) then raise exception 'staff_not_found'; end if;
  else
    v_staff := private.my_staff_id(p_master_id);
    if v_staff is null or (p_staff_id is not null and p_staff_id <> v_staff) then raise exception 'forbidden'; end if;
  end if;
  delete from public.working_hours where staff_id = v_staff;
  insert into public.working_hours (master_id, staff_id, weekday, start_time, end_time)
  select p_master_id, v_staff, (h ->> 'weekday')::smallint, (h ->> 'start')::time, (h ->> 'end')::time
    from jsonb_array_elements(coalesce(p_hours, '[]'::jsonb)) h;
  return public.owner_schedule(p_master_id, v_staff);
exception
  when exclusion_violation then raise exception 'hours_overlap';
  when check_violation then raise exception 'hours_invalid';
end $$;

drop function if exists public.owner_add_time_off(uuid, timestamptz, timestamptz, text);
create or replace function public.owner_add_time_off(p_master_id uuid, p_start_at timestamptz, p_end_at timestamptz, p_reason text default '',
                                                     p_staff_id uuid default null, p_whole_studio boolean default false)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_staff uuid;
  r public.time_off;
begin
  if private.is_my_master(p_master_id) then
    v_staff := case when p_whole_studio then null else coalesce(p_staff_id, (select id from public.staff where master_id = p_master_id and is_owner)) end;
  else
    v_staff := private.my_staff_id(p_master_id);
    if v_staff is null or p_whole_studio or (p_staff_id is not null and p_staff_id <> v_staff) then raise exception 'forbidden'; end if;
  end if;
  insert into public.time_off (master_id, staff_id, start_at, end_at, reason)
  values (p_master_id, v_staff, p_start_at, p_end_at, left(coalesce(p_reason, ''), 120))
  returning * into r;
  return jsonb_build_object('id', r.id, 'start_at', r.start_at, 'end_at', r.end_at, 'reason', r.reason, 'whole_studio', r.staff_id is null);
end $$;

-- a lash map: written by the owner or by the client's own master
create or replace function public.owner_save_formula(p_master_id uuid, p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  r public.formulas;
  v_staff uuid;
begin
  if not private.can_view_studio(p_master_id) then raise exception 'forbidden'; end if;
  v_staff := coalesce((select b.staff_id from public.bookings b where b.id = nullif(p ->> 'booking_id', '')::uuid and b.master_id = p_master_id),
                      private.my_staff_id(p_master_id));
  if not private.is_my_master(p_master_id) then v_staff := private.my_staff_id(p_master_id); end if;
  if nullif(p ->> 'id', '') is null then
    insert into public.formulas (master_id, staff_id, client_id, booking_id, curl, lengths, thickness, lash_type, glue, note, photo)
    values (p_master_id, v_staff, (p ->> 'client_id')::uuid, nullif(p ->> 'booking_id', '')::uuid,
            nullif(p ->> 'curl', ''), nullif(p ->> 'lengths', ''), nullif(p ->> 'thickness', ''),
            nullif(p ->> 'lash_type', ''), nullif(p ->> 'glue', ''), coalesce(p ->> 'note', ''), nullif(p ->> 'photo', ''))
    returning * into r;
  else
    update public.formulas set
      curl = nullif(p ->> 'curl', ''), lengths = nullif(p ->> 'lengths', ''), thickness = nullif(p ->> 'thickness', ''),
      lash_type = nullif(p ->> 'lash_type', ''), glue = nullif(p ->> 'glue', ''), note = coalesce(p ->> 'note', ''),
      photo = case when p ? 'photo' then nullif(p ->> 'photo', '') else photo end
    where id = (p ->> 'id')::uuid and master_id = p_master_id
    returning * into r;
    if not found then raise exception 'not_found'; end if;
  end if;
  return to_jsonb(r) - 'master_id';
end $$;

-- a service: + who does it (Team; omitted = unchanged / everyone for a new one)
create or replace function public.owner_service_staff(p_service_id uuid, p_staff_ids uuid[]) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_mid uuid;
begin
  select master_id into v_mid from public.services where id = p_service_id;
  if v_mid is null or not private.is_my_master(v_mid) then raise exception 'forbidden'; end if;
  delete from public.staff_services where service_id = p_service_id and not (staff_id = any (p_staff_ids));
  insert into public.staff_services (staff_id, service_id)
  select st.id, p_service_id from public.staff st where st.master_id = v_mid and st.id = any (p_staff_ids)
  on conflict do nothing;
  return true;
end $$;

-- Solo / Team (back to Solo only when she is the only active master)
create or replace function public.owner_set_kind(p_master_id uuid, p_kind text) returns text
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
  if p_kind not in ('solo', 'team') then raise exception 'bad_kind'; end if;
  if p_kind = 'solo' and (select count(*) from public.staff where master_id = p_master_id and active) > 1 then raise exception 'team_has_staff'; end if;
  update public.masters set kind = p_kind where id = p_master_id;
  return p_kind;
end $$;

-- ---------- 11. numbers: the owner sees the studio and each master; a master sees herself ----------
drop function if exists public.owner_insights(uuid, text);
create or replace function public.owner_insights(p_master_id uuid, p_period text default 'week', p_staff_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.masters;
  v_unit text := case when p_period = 'month' then 'month' else 'week' end;
  v_step interval := case when p_period = 'month' then interval '1 month' else interval '1 week' end;
  v_now timestamp;
  v_first timestamp;
  v_from timestamptz;
  v_to timestamptz;
  v_staff uuid;
  v_owner boolean := private.is_my_master(p_master_id) or private.is_admin();
  r jsonb;
begin
  select * into m from public.masters where id = p_master_id;
  if not found then raise exception 'forbidden'; end if;
  if v_owner then v_staff := p_staff_id;
  else
    v_staff := private.my_staff_id(p_master_id);
    if v_staff is null then raise exception 'forbidden'; end if;
  end if;
  v_now := now() at time zone m.timezone;
  v_first := date_trunc(v_unit, v_now) - 11 * v_step;
  v_from := v_first at time zone m.timezone;
  v_to := (date_trunc(v_unit, v_now) + v_step) at time zone m.timezone;

  with bk as (
    select b.*, date_trunc(v_unit, b.start_at at time zone m.timezone) as bucket,
           extract(dow from b.start_at at time zone m.timezone)::int as dow
      from public.bookings b
     where b.master_id = p_master_id and b.start_at >= v_from and b.start_at < v_to
       and (v_staff is null or b.staff_id = v_staff)
  ),
  firsts as (
    select client_id, min(start_at) as first_at from public.bookings
     where master_id = p_master_id and status in ('pending', 'confirmed', 'completed', 'no_show')
       and (v_staff is null or staff_id = v_staff)
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
    'staff_id', v_staff,
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
          on x.dow = d.d),
    -- each master (owner, whole studio only): revenue, bookings, load, returning clients, no-shows
    'staff', case when v_owner and v_staff is null then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id, 'name', st.name, 'color', st.color, 'active', st.active,
               'revenue', (select coalesce(sum(b.price), 0) from bk b where b.staff_id = st.id and b.status = 'completed'),
               'bookings', (select count(*) from bk b where b.staff_id = st.id and b.status in ('pending', 'confirmed', 'completed', 'no_show')),
               'no_shows', (select count(*) from bk b where b.staff_id = st.id and b.status = 'no_show'),
               'clients', (select count(distinct b.client_id) from bk b where b.staff_id = st.id and b.status in ('pending', 'confirmed', 'completed', 'no_show')),
               'returning', (select count(distinct b.client_id) from bk b
                              where b.staff_id = st.id and b.status in ('pending', 'confirmed', 'completed', 'no_show')
                                and exists (select 1 from public.bookings e where e.client_id = b.client_id and e.staff_id = st.id
                                             and e.start_at < b.start_at and e.status in ('confirmed', 'completed'))),
               'booked_min', (select coalesce(sum(extract(epoch from (b.end_at - b.start_at)) / 60), 0)::int from bk b
                               where b.staff_id = st.id and b.status in ('pending', 'confirmed', 'completed', 'no_show')),
               'open_min', (select coalesce(sum(extract(epoch from (w.end_time - w.start_time)) / 60), 0)::int
                              from generate_series(v_first::date, (v_to at time zone m.timezone)::date - 1, interval '1 day') d
                              join public.working_hours w on w.staff_id = st.id and w.weekday = extract(dow from d)))
             order by st.sort, st.created_at)
        from public.staff st where st.master_id = p_master_id and (st.active or exists (select 1 from bk b where b.staff_id = st.id))), '[]'::jsonb) end
  ) into r;
  return r;
end $$;
revoke execute on function public.owner_insights(uuid, text, uuid) from public, anon;
grant execute on function public.owner_insights(uuid, text, uuid) to authenticated;

-- payouts by commission for a period (owner only): completed visits by start date, studio time zone
create or replace function public.owner_payouts(p_master_id uuid, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.masters;
begin
  if not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
  select * into m from public.masters where id = p_master_id;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', st.id, 'name', st.name, 'commission_pct', st.commission_pct, 'is_owner', st.is_owner,
             'visits', x.n, 'revenue', x.rev, 'payout', round(x.rev * st.commission_pct / 100, 2))
           order by st.sort, st.created_at)
      from public.staff st
      cross join lateral (
        select count(*)::int as n, coalesce(sum(b.price), 0) as rev from public.bookings b
         where b.staff_id = st.id and b.status = 'completed'
           and (b.start_at at time zone m.timezone)::date between p_from and p_to) x
     where st.master_id = p_master_id and (st.active or x.n > 0)), '[]'::jsonb);
end $$;

revoke execute on function public.owner_staff(uuid), public.owner_save_staff(uuid, jsonb), public.owner_staff_future(uuid),
  public.owner_create_booking(uuid, uuid, timestamptz, text, text, text, text, boolean, uuid),
  public.owner_reschedule(uuid, timestamptz, boolean, uuid), public.owner_slots(uuid, uuid, date, uuid, uuid),
  public.owner_schedule(uuid, uuid), public.owner_save_hours(uuid, jsonb, uuid),
  public.owner_add_time_off(uuid, timestamptz, timestamptz, text, uuid, boolean),
  public.owner_service_staff(uuid, uuid[]), public.owner_set_kind(uuid, text), public.owner_payouts(uuid, date, date)
  from public, anon;
grant execute on function public.owner_staff(uuid), public.owner_save_staff(uuid, jsonb), public.owner_staff_future(uuid),
  public.owner_create_booking(uuid, uuid, timestamptz, text, text, text, text, boolean, uuid),
  public.owner_reschedule(uuid, timestamptz, boolean, uuid), public.owner_slots(uuid, uuid, date, uuid, uuid),
  public.owner_schedule(uuid, uuid), public.owner_save_hours(uuid, jsonb, uuid),
  public.owner_add_time_off(uuid, timestamptz, timestamptz, text, uuid, boolean),
  public.owner_service_staff(uuid, uuid[]), public.owner_set_kind(uuid, text), public.owner_payouts(uuid, date, date)
  to authenticated;

-- ---------- 12. the admin list: + Solo / Team and how many masters ----------
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
        'billing_plan', m.billing_plan, 'plan_amount', m.plan_amount, 'payment_link', m.payment_link,
        'last_paid_at', m.last_paid_at, 'admin_notes', m.admin_notes, 'founding', m.founding,
        'kind', m.kind, 'staff_count', (select count(*) from public.staff st where st.master_id = m.id and st.active),
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
