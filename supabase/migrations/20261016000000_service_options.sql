-- Two service options, both off by default (every studio keeps working exactly as before):
--   price_on_request — no price shown ("On request"): the master prices it individually;
--   only_days        — the service can be booked only on these weekdays (0 = Sunday … 6 = Saturday),
--                      e.g. a "Frenchie Friday" deal; null = any day she works.
-- Only additions: new columns with defaults; three functions re-created with the new fields.

alter table public.services add column if not exists price_on_request boolean not null default false;
alter table public.services add column if not exists only_days smallint[] default null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'services_only_days_ok') then
    alter table public.services add constraint services_only_days_ok
      check (only_days is null or (cardinality(only_days) between 1 and 7 and only_days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]));
  end if;
end $$;

-- free times of one master: + "only on these weekdays" (everything else as in 20261010000000_team.sql)
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
       and (sv.only_days is null or extract(dow from p_date)::smallint = any (sv.only_days))
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

-- what clients see: + price_on_request, only_days
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
               'fill_weeks', s.fill_weeks, 'price_on_request', s.price_on_request, 'only_days', s.only_days) order by s.sort, s.name)
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

-- the dashboard saves the two options too
-- [5, 2, 5] / [] / null → {2,5} / null (a weekday list, or none = every day)
create or replace function private.weekdays(p jsonb) returns smallint[]
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p) = 'array' and jsonb_array_length(p) between 1 and 7
              then (select array_agg(distinct x::smallint order by x::smallint) from jsonb_array_elements_text(p) x where x ~ '^[0-6]$')
         end;
$$;

create or replace function public.owner_save_service(p_master_id uuid, p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  r public.services;
  v_inc text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'includes', '[]'::jsonb)) x where btrim(x) <> ''), '{}');
begin
  if not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
  if nullif(p ->> 'id', '') is null then
    insert into public.services (master_id, category, name, description, includes, duration_min, buffer_min,
                                 price, price_from, deposit, photo, active, fill_weeks, sort, price_on_request, only_days)
    values (p_master_id, coalesce(nullif(btrim(p ->> 'category'), ''), 'Other'), btrim(p ->> 'name'),
            coalesce(p ->> 'description', ''), v_inc, (p ->> 'duration_min')::int, coalesce((p ->> 'buffer_min')::int, 0),
            coalesce((p ->> 'price')::numeric, 0), coalesce((p ->> 'price_from')::boolean, false),
            coalesce((p ->> 'deposit')::numeric, 0), nullif(p ->> 'photo', ''), coalesce((p ->> 'active')::boolean, true),
            nullif(p ->> 'fill_weeks', '')::int,
            coalesce((select max(sort) + 1 from public.services where master_id = p_master_id), 0),
            coalesce((p ->> 'price_on_request')::boolean, false), private.weekdays(p -> 'only_days'))
    returning * into r;
  else
    update public.services set
      category = coalesce(nullif(btrim(p ->> 'category'), ''), category),
      name = coalesce(nullif(btrim(p ->> 'name'), ''), name),
      description = coalesce(p ->> 'description', description),
      includes = case when p ? 'includes' then v_inc else includes end,
      duration_min = coalesce((p ->> 'duration_min')::int, duration_min),
      buffer_min = coalesce((p ->> 'buffer_min')::int, buffer_min),
      price = coalesce((p ->> 'price')::numeric, price),
      price_from = coalesce((p ->> 'price_from')::boolean, price_from),
      deposit = coalesce((p ->> 'deposit')::numeric, deposit),
      photo = case when p ? 'photo' then nullif(p ->> 'photo', '') else photo end,
      active = coalesce((p ->> 'active')::boolean, active),
      fill_weeks = case when p ? 'fill_weeks' then nullif(p ->> 'fill_weeks', '')::int else fill_weeks end,
      price_on_request = coalesce((p ->> 'price_on_request')::boolean, price_on_request),
      only_days = case when p ? 'only_days' then private.weekdays(p -> 'only_days') else only_days end
    where id = (p ->> 'id')::uuid and master_id = p_master_id
    returning * into r;
    if not found then raise exception 'not_found'; end if;
  end if;
  return to_jsonb(r) - 'master_id';
end $$;
