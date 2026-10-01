-- =========================================================
-- Part 3a — the master runs her studio herself
--   • idempotent create_booking (a retried or double-tapped request
--     returns the same booking instead of a second one)
--   • services: "from $" prices, fill interval, CRUD + order
--   • looks (her portfolio) and studio profile editing
--   • CRM: tags, patch test date; lash map / formula per visit
--   • photos in Supabase Storage: bucket "studio-media", one folder per
--     studio (<master_id>/…), only that studio's owner may write
-- =========================================================

-- ---------- columns ----------
alter table public.bookings add column if not exists client_request_id uuid unique;

alter table public.services
  add column if not exists price_from boolean not null default false,
  add column if not exists fill_weeks int check (fill_weeks between 1 and 12);

alter table public.clients
  add column if not exists tags text[] not null default '{}',
  add column if not exists patch_test_at date;

-- ---------- looks (portfolio) ----------
create table if not exists public.looks (
  id           uuid primary key default gen_random_uuid(),
  master_id    uuid not null references public.masters (id) on delete cascade,
  title        text not null check (length(title) between 1 and 60),
  tag          text not null default '' check (length(tag) <= 30),
  service_id   uuid references public.services (id) on delete set null,
  photo        text not null,
  before_photo text,
  is_new       boolean not null default false,
  popular      boolean not null default false,
  sort         int not null default 0,
  created_at   timestamptz not null default now()
);
create index if not exists looks_master_idx on public.looks (master_id, sort);

-- ---------- lash map / formula: what she used, visit by visit ----------
create table if not exists public.formulas (
  id         uuid primary key default gen_random_uuid(),
  master_id  uuid not null references public.masters (id) on delete cascade,
  client_id  uuid not null references public.clients (id) on delete cascade,
  booking_id uuid references public.bookings (id) on delete set null,
  curl       text check (length(curl) <= 8),       -- J, B, C, CC, D, L…
  lengths    text check (length(lengths) <= 30),   -- "9–13"
  thickness  text check (length(thickness) <= 12), -- "0.07"
  lash_type  text check (length(lash_type) <= 30), -- Classic / Hybrid / Volume
  glue       text check (length(glue) <= 60),
  note       text not null default '' check (length(note) <= 1000),
  photo      text,
  created_at timestamptz not null default now()
);
create index if not exists formulas_client_idx on public.formulas (client_id, created_at desc);

alter table public.looks enable row level security;
alter table public.formulas enable row level security;
create policy "owner: looks" on public.looks for all to authenticated
  using (private.is_my_master(master_id)) with check (private.is_my_master(master_id));
create policy "owner: formulas" on public.formulas for all to authenticated
  using (private.is_my_master(master_id)) with check (private.is_my_master(master_id));
revoke all on public.looks, public.formulas from anon;
grant select, insert, update, delete on public.looks, public.formulas to authenticated;

-- ---------- create_booking: + request id (idempotent) ----------
drop function if exists public.create_booking(text, uuid, timestamptz, text, text, text, text);
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
  b public.bookings;
begin
  -- the same request again (double tap, retry after a timeout): same booking
  if p_request_id is not null then
    select * into b from public.bookings where client_request_id = p_request_id;
    if found then return private.booking_json(b); end if;
  end if;

  select * into m from public.masters where slug = lower(p_slug);
  if not found or m.booking_engine <> 'builtin' then raise exception 'not_bookable'; end if;
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

  begin
    insert into public.bookings (master_id, service_id, client_id, start_at, end_at, buffer_end_at,
                                 status, price, service_name, client_note, created_by, client_request_id)
    values (m.id, s.id, v_client, p_start_at, p_start_at + make_interval(mins => s.duration_min),
            p_start_at + make_interval(mins => s.duration_min),
            case when m.auto_confirm then 'confirmed' else 'pending' end,
            s.price, s.name, left(coalesce(p_note, ''), 500), 'client', p_request_id)
    returning * into b;
  exception
    when exclusion_violation then raise exception 'slot_taken';
    when unique_violation then
      -- two copies of one request raced each other: hand back the winner
      select * into b from public.bookings where client_request_id = p_request_id;
      if not found then raise; end if;
  end;
  return private.booking_json(b);
end $$;
revoke execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid) from public;
grant execute on function public.create_booking(text, uuid, timestamptz, text, text, text, text, uuid) to anon, authenticated;

-- ---------- public profile: + looks, "from" prices, fill interval ----------
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

-- ---------- owner: what the dashboard shows for a booking ----------
create or replace function private.owner_booking_row(b public.bookings) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'status', b.status, 'start_at', b.start_at, 'end_at', b.end_at,
    'price', b.price, 'service_id', b.service_id, 'service_name', b.service_name,
    'service_photo', s.photo, 'duration_min', s.duration_min,
    'client_id', b.client_id, 'client_name', c.name, 'client_phone', c.phone, 'client_email', c.email,
    'client_tags', coalesce(c.tags, '{}'), 'client_note', b.client_note, 'late_cancel', b.late_cancel,
    'created_by', b.created_by, 'created_at', b.created_at, 'updated_at', b.updated_at,
    'cancelled_at', b.cancelled_at, 'cancel_reason', b.cancel_reason,
    -- "Last time: C · 10–13 · 0.07 Hybrid"
    'last_formula', (select jsonb_build_object('curl', f.curl, 'lengths', f.lengths, 'thickness', f.thickness,
                                               'lash_type', f.lash_type, 'glue', f.glue, 'created_at', f.created_at)
                       from public.formulas f
                      where f.client_id = b.client_id and f.created_at < greatest(b.start_at, now())
                      order by f.created_at desc limit 1))
  from (select 1) x
  left join public.services s on s.id = b.service_id
  left join public.clients c on c.id = b.client_id;
$$;

-- ---------- owner: services ----------
create or replace function public.owner_services(p_master_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(s) - 'master_id' order by s.sort, s.name), '[]'::jsonb)
    from public.services s where s.master_id = p_master_id;
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
                                 price, price_from, deposit, photo, active, fill_weeks, sort)
    values (p_master_id, coalesce(nullif(btrim(p ->> 'category'), ''), 'Other'), btrim(p ->> 'name'),
            coalesce(p ->> 'description', ''), v_inc, (p ->> 'duration_min')::int, coalesce((p ->> 'buffer_min')::int, 0),
            coalesce((p ->> 'price')::numeric, 0), coalesce((p ->> 'price_from')::boolean, false),
            coalesce((p ->> 'deposit')::numeric, 0), nullif(p ->> 'photo', ''), coalesce((p ->> 'active')::boolean, true),
            nullif(p ->> 'fill_weeks', '')::int,
            coalesce((select max(sort) + 1 from public.services where master_id = p_master_id), 0))
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
      fill_weeks = case when p ? 'fill_weeks' then nullif(p ->> 'fill_weeks', '')::int else fill_weeks end
    where id = (p ->> 'id')::uuid and master_id = p_master_id
    returning * into r;
    if not found then raise exception 'not_found'; end if;
  end if;
  return to_jsonb(r) - 'master_id';
end $$;

create or replace function public.owner_delete_service(p_id uuid) returns boolean
language sql security invoker set search_path = '' as $$
  with d as (delete from public.services where id = p_id returning 1) select exists (select 1 from d);
$$;

-- new order = the order of the ids
create or replace function public.owner_reorder(p_master_id uuid, p_table text, p_ids uuid[]) returns boolean
language plpgsql security invoker set search_path = '' as $$
begin
  if not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
  if p_table = 'services' then
    update public.services s set sort = x.i from unnest(p_ids) with ordinality x(id, i)
     where s.id = x.id and s.master_id = p_master_id;
  elsif p_table = 'looks' then
    update public.looks l set sort = x.i from unnest(p_ids) with ordinality x(id, i)
     where l.id = x.id and l.master_id = p_master_id;
  else
    raise exception 'bad_table';
  end if;
  return true;
end $$;

-- ---------- owner: studio profile ----------
create or replace function public.owner_profile(p_master_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('id', m.id, 'slug', m.slug, 'name', m.name, 'style', m.style, 'accent', m.accent,
                            'timezone', m.timezone, 'settings', m.settings)
    from public.masters m where m.id = p_master_id;
$$;

-- settings: the keys given replace the stored ones (null removes a key)
create or replace function public.owner_save_profile(p_master_id uuid, p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  patch jsonb := coalesce(p -> 'settings', '{}'::jsonb);
begin
  if not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
  if length(patch::text) > 200000 then raise exception 'too_big'; end if;
  update public.masters set
    name = coalesce(nullif(btrim(p ->> 'name'), ''), name),
    style = coalesce(nullif(p ->> 'style', ''), style),
    accent = case when p ? 'accent' then nullif(p ->> 'accent', '') else accent end,
    settings = jsonb_strip_nulls(settings || patch)
  where id = p_master_id;
  return public.owner_profile(p_master_id);
end $$;

-- ---------- owner: looks ----------
create or replace function public.owner_looks(p_master_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(l) - 'master_id' order by l.sort, l.created_at desc), '[]'::jsonb)
    from public.looks l where l.master_id = p_master_id;
$$;

create or replace function public.owner_save_look(p_master_id uuid, p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  r public.looks;
begin
  if not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
  if nullif(p ->> 'id', '') is null then
    insert into public.looks (master_id, title, tag, service_id, photo, before_photo, is_new, popular, sort)
    values (p_master_id, btrim(p ->> 'title'), coalesce(btrim(p ->> 'tag'), ''), nullif(p ->> 'service_id', '')::uuid,
            p ->> 'photo', nullif(p ->> 'before_photo', ''), coalesce((p ->> 'is_new')::boolean, true),
            coalesce((p ->> 'popular')::boolean, false),
            coalesce((select min(sort) - 1 from public.looks where master_id = p_master_id), 0))
    returning * into r;
  else
    update public.looks set
      title = coalesce(nullif(btrim(p ->> 'title'), ''), title),
      tag = coalesce(btrim(p ->> 'tag'), tag),
      service_id = case when p ? 'service_id' then nullif(p ->> 'service_id', '')::uuid else service_id end,
      photo = coalesce(nullif(p ->> 'photo', ''), photo),
      before_photo = case when p ? 'before_photo' then nullif(p ->> 'before_photo', '') else before_photo end,
      is_new = coalesce((p ->> 'is_new')::boolean, is_new),
      popular = coalesce((p ->> 'popular')::boolean, popular)
    where id = (p ->> 'id')::uuid and master_id = p_master_id
    returning * into r;
    if not found then raise exception 'not_found'; end if;
  end if;
  return to_jsonb(r) - 'master_id';
end $$;

create or replace function public.owner_delete_look(p_id uuid) returns boolean
language sql security invoker set search_path = '' as $$
  with d as (delete from public.looks where id = p_id returning 1) select exists (select 1 from d);
$$;

-- ---------- owner: clients (CRM) ----------
create or replace function public.owner_clients(p_master_id uuid, p_q text default null) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(t.r order by t.r ->> 'name'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'notes', c.notes, 'tags', c.tags,
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
          or exists (select 1 from unnest(c.tags) t where t ilike p_q || '%')
          or regexp_replace(c.phone, '\D', '', 'g') like '%' || nullif(regexp_replace(p_q, '\D', '', 'g'), '') || '%')
   group by c.id
  ) t;
$$;

create or replace function public.owner_client(p_client_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'client', jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email,
                                 'notes', c.notes, 'tags', c.tags, 'patch_test_at', c.patch_test_at,
                                 'created_at', c.created_at),
    'history', coalesce((select jsonb_agg(private.owner_booking_row(b) order by b.start_at desc)
                           from public.bookings b where b.client_id = c.id), '[]'::jsonb),
    'formulas', coalesce((select jsonb_agg(to_jsonb(f) - 'master_id' order by f.created_at desc)
                            from public.formulas f where f.client_id = c.id), '[]'::jsonb))
  from public.clients c where c.id = p_client_id;
$$;

-- contacts, tags, patch test, notes
create or replace function public.owner_save_client(p_client_id uuid, p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_phone text := case when p ? 'phone' then private.norm_phone(p ->> 'phone') end;
begin
  if p ? 'phone' and v_phone is null then raise exception 'invalid_phone'; end if;
  update public.clients set
    name = coalesce(nullif(btrim(p ->> 'name'), ''), name),
    phone = coalesce(v_phone, phone),
    email = case when p ? 'email' then nullif(lower(btrim(p ->> 'email')), '') else email end,
    notes = coalesce(left(p ->> 'notes', 2000), notes),
    tags = case when p ? 'tags' then coalesce((select array_agg(distinct left(btrim(x), 24)) from jsonb_array_elements_text(p -> 'tags') x where btrim(x) <> ''), '{}') else tags end,
    patch_test_at = case when p ? 'patch_test_at' then nullif(p ->> 'patch_test_at', '')::date else patch_test_at end
  where id = p_client_id;
  if not found then raise exception 'not_found'; end if;
  return public.owner_client(p_client_id);
exception when unique_violation then
  raise exception 'phone_taken';
end $$;

-- ---------- owner: lash map ----------
create or replace function public.owner_save_formula(p_master_id uuid, p jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  r public.formulas;
begin
  if not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
  if nullif(p ->> 'id', '') is null then
    insert into public.formulas (master_id, client_id, booking_id, curl, lengths, thickness, lash_type, glue, note, photo)
    values (p_master_id, (p ->> 'client_id')::uuid, nullif(p ->> 'booking_id', '')::uuid,
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

create or replace function public.owner_delete_formula(p_id uuid) returns boolean
language sql security invoker set search_path = '' as $$
  with d as (delete from public.formulas where id = p_id returning 1) select exists (select 1 from d);
$$;

-- ---------- who may call what ----------
revoke execute on function
  public.owner_services(uuid), public.owner_save_service(uuid, jsonb), public.owner_delete_service(uuid),
  public.owner_reorder(uuid, text, uuid[]), public.owner_profile(uuid), public.owner_save_profile(uuid, jsonb),
  public.owner_looks(uuid), public.owner_save_look(uuid, jsonb), public.owner_delete_look(uuid),
  public.owner_save_client(uuid, jsonb), public.owner_save_formula(uuid, jsonb), public.owner_delete_formula(uuid)
  from public, anon;
grant execute on function
  public.owner_services(uuid), public.owner_save_service(uuid, jsonb), public.owner_delete_service(uuid),
  public.owner_reorder(uuid, text, uuid[]), public.owner_profile(uuid), public.owner_save_profile(uuid, jsonb),
  public.owner_looks(uuid), public.owner_save_look(uuid, jsonb), public.owner_delete_look(uuid),
  public.owner_save_client(uuid, jsonb), public.owner_save_formula(uuid, jsonb), public.owner_delete_formula(uuid)
  to authenticated;

-- ---------- photos: Storage bucket, a folder per studio ----------
create or replace function private.owns_media_path(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  return private.is_my_master(split_part(p_name, '/', 1)::uuid);
exception when others then
  return false; -- not a "<master_id>/…" path
end $$;
revoke all on function private.owns_media_path(text) from public;
grant execute on function private.owns_media_path(text) to authenticated;

do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('studio-media', 'studio-media', true, 5242880, array['image/webp', 'image/jpeg', 'image/png'])
    on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
                                   allowed_mime_types = excluded.allowed_mime_types;
    execute $p$create policy "studio media: owner uploads" on storage.objects for insert to authenticated
      with check (bucket_id = 'studio-media' and private.owns_media_path(name))$p$;
    execute $p$create policy "studio media: owner updates" on storage.objects for update to authenticated
      using (bucket_id = 'studio-media' and private.owns_media_path(name))$p$;
    execute $p$create policy "studio media: owner deletes" on storage.objects for delete to authenticated
      using (bucket_id = 'studio-media' and private.owns_media_path(name))$p$;
    execute $p$create policy "studio media: owner lists" on storage.objects for select to authenticated
      using (bucket_id = 'studio-media' and private.owns_media_path(name))$p$;
  end if;
end $$;
