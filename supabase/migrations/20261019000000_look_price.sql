-- A look's own price ("$257", "~$145"): shown on the photo instead of the linked service's price.
-- Optional (null = as before). Whether a look without one shows its service's price is a studio
-- setting (settings.lookServicePrice, on unless set to false) — nothing changes for any studio.
-- Only additions: a new nullable column; two functions re-created with the new field.

alter table public.looks add column if not exists price_text text default null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'looks_price_text_ok') then
    alter table public.looks add constraint looks_price_text_ok check (price_text is null or length(btrim(price_text)) between 1 and 24);
  end if;
end $$;

-- what clients see: + a look's price_text (everything else as in 20261017000000_price_label.sql)
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
               'before_photo', l.before_photo, 'is_new', l.is_new, 'popular', l.popular, 'price_text', l.price_text) order by l.sort, l.created_at desc)
        from public.looks l where l.master_id = m.id), '[]'::jsonb))
  from public.masters m
  where m.slug = lower(p_slug);
$$;

-- the dashboard saves it ("" clears it; everything else as in 20261004000000_studio_admin.sql)
create or replace function public.owner_save_look(p_master_id uuid, p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  r public.looks;
begin
  if not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
  if nullif(p ->> 'id', '') is null then
    insert into public.looks (master_id, title, tag, service_id, photo, before_photo, is_new, popular, sort, price_text)
    values (p_master_id, btrim(p ->> 'title'), coalesce(btrim(p ->> 'tag'), ''), nullif(p ->> 'service_id', '')::uuid,
            p ->> 'photo', nullif(p ->> 'before_photo', ''), coalesce((p ->> 'is_new')::boolean, true),
            coalesce((p ->> 'popular')::boolean, false),
            coalesce((select min(sort) - 1 from public.looks where master_id = p_master_id), 0),
            nullif(btrim(p ->> 'price_text'), ''))
    returning * into r;
  else
    update public.looks set
      title = coalesce(nullif(btrim(p ->> 'title'), ''), title),
      tag = coalesce(btrim(p ->> 'tag'), tag),
      service_id = case when p ? 'service_id' then nullif(p ->> 'service_id', '')::uuid else service_id end,
      photo = coalesce(nullif(p ->> 'photo', ''), photo),
      before_photo = case when p ? 'before_photo' then nullif(p ->> 'before_photo', '') else before_photo end,
      is_new = coalesce((p ->> 'is_new')::boolean, is_new),
      popular = coalesce((p ->> 'popular')::boolean, popular),
      price_text = case when p ? 'price_text' then nullif(btrim(p ->> 'price_text'), '') else price_text end
    where id = (p ->> 'id')::uuid and master_id = p_master_id
    returning * into r;
    if not found then raise exception 'not_found'; end if;
  end if;
  return to_jsonb(r) - 'master_id';
end $$;
