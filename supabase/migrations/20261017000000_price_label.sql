-- A price label: a short text shown instead of the price ("$15 off", "Save $175", "Free · 48h").
-- Off by default (null) — every studio keeps showing its prices exactly as before.
-- Only additions: a new nullable column; two functions re-created with the new field.

alter table public.services add column if not exists price_label text default null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'services_price_label_ok') then
    alter table public.services add constraint services_price_label_ok
      check (price_label is null or length(btrim(price_label)) between 1 and 24);
  end if;
end $$;

-- what clients see: + price_label (everything else as in 20261016000000_service_options.sql)
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
               'fill_weeks', s.fill_weeks, 'price_on_request', s.price_on_request, 'only_days', s.only_days,
               'price_label', s.price_label) order by s.sort, s.name)
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

-- the dashboard saves it ("" clears it)
create or replace function public.owner_save_service(p_master_id uuid, p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  r public.services;
  v_inc text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p -> 'includes', '[]'::jsonb)) x where btrim(x) <> ''), '{}');
begin
  if not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
  if nullif(p ->> 'id', '') is null then
    insert into public.services (master_id, category, name, description, includes, duration_min, buffer_min,
                                 price, price_from, deposit, photo, active, fill_weeks, sort, price_on_request, only_days, price_label)
    values (p_master_id, coalesce(nullif(btrim(p ->> 'category'), ''), 'Other'), btrim(p ->> 'name'),
            coalesce(p ->> 'description', ''), v_inc, (p ->> 'duration_min')::int, coalesce((p ->> 'buffer_min')::int, 0),
            coalesce((p ->> 'price')::numeric, 0), coalesce((p ->> 'price_from')::boolean, false),
            coalesce((p ->> 'deposit')::numeric, 0), nullif(p ->> 'photo', ''), coalesce((p ->> 'active')::boolean, true),
            nullif(p ->> 'fill_weeks', '')::int,
            coalesce((select max(sort) + 1 from public.services where master_id = p_master_id), 0),
            coalesce((p ->> 'price_on_request')::boolean, false), private.weekdays(p -> 'only_days'),
            nullif(btrim(p ->> 'price_label'), ''))
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
      only_days = case when p ? 'only_days' then private.weekdays(p -> 'only_days') else only_days end,
      price_label = case when p ? 'price_label' then nullif(btrim(p ->> 'price_label'), '') else price_label end
    where id = (p ->> 'id')::uuid and master_id = p_master_id
    returning * into r;
    if not found then raise exception 'not_found'; end if;
  end if;
  return to_jsonb(r) - 'master_id';
end $$;
