-- =========================================================
-- Part 3b — deposits, after the visit, no-shows, insights
--   • deposits without our own payments: the client pays her by
--     Cash App / Zelle / Venmo / PayPal / Square (settings.payments),
--     the booking waits "Awaiting deposit"; the master marks it received.
--     Not received in time → pg_cron cancels it, frees the slot and
--     pushes the master.
--   • completed: by the master, or automatically 2 h after the end
--   • 2+ no-shows → a deposit is always asked from that client
--   • owner_insights: bookings, revenue, cancellations, no-shows,
--     top services, new vs returning, load by weekday
-- =========================================================

-- ---------- columns ----------
alter table public.masters
  -- how long a client has to send the deposit (0 = never auto-cancel)
  add column if not exists deposit_hold_hours int not null default 12 check (deposit_hold_hours between 0 and 72),
  -- the deposit asked from a client with 2+ no-shows when the service has none
  add column if not exists noshow_deposit numeric(10, 2) not null default 30 check (noshow_deposit >= 0);

alter table public.bookings
  add column if not exists deposit numeric(10, 2) not null default 0 check (deposit >= 0),
  add column if not exists deposit_status text not null default 'none'
    check (deposit_status in ('none', 'pending', 'paid', 'waived', 'expired')),
  add column if not exists deposit_due_at timestamptz,
  add column if not exists deposit_paid_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists auto_completed boolean not null default false;
create index if not exists bookings_deposit_due_idx on public.bookings (deposit_due_at) where deposit_status = 'pending';

-- does the studio take deposits online (at least one way to pay her)?
create or replace function private.takes_deposits(p_settings jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select exists (select 1 from jsonb_each_text(coalesce(p_settings -> 'payments', '{}'::jsonb)) e where btrim(e.value) <> '');
$$;

create or replace function private.no_shows(p_client uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.bookings where client_id = p_client and status = 'no_show';
$$;
revoke all on function private.no_shows(uuid) from public;
grant execute on function private.no_shows(uuid) to authenticated;

-- ---------- what the client sees about her booking ----------
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

-- ---------- create_booking: + deposit (service deposit, or forced after 2 no-shows) ----------
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

-- ---------- owner: status (completed time), deposit ----------
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
                              then left(nullif(btrim(coalesce(p_reason, '')), ''), 300) else cancel_reason end,
         completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else null end,
         auto_completed = false,
         -- a cancelled booking no longer waits for a deposit
         deposit_status = case when p_status = 'cancelled_master' and deposit_status = 'pending' then 'none' else deposit_status end
   where id = b.id
   returning * into b;
  return private.booking_json(b);
end $$;

-- p_status: 'paid' (received), 'waived' (not needed), 'pending' (undo)
create or replace function public.owner_set_deposit(p_booking_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking_id for update;
  if not found or not private.is_my_master(b.master_id) then raise exception 'not_found'; end if;
  if p_status not in ('paid', 'waived', 'pending') then raise exception 'bad_status'; end if;
  if p_status = 'pending' and b.deposit <= 0 then raise exception 'bad_status'; end if;
  update public.bookings
     set deposit_status = p_status,
         deposit_paid_at = case when p_status = 'paid' then now() else null end,
         -- undo: nothing auto-cancels it again
         deposit_due_at = case when p_status = 'pending' then null else deposit_due_at end
   where id = b.id
   returning * into b;
  return private.owner_booking_row(b);
end $$;
revoke execute on function public.owner_set_deposit(uuid, text) from public, anon;
grant execute on function public.owner_set_deposit(uuid, text) to authenticated;

-- ---------- owner: what the dashboard shows for a booking ----------
create or replace function private.owner_booking_row(b public.bookings) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', b.id, 'status', b.status, 'start_at', b.start_at, 'end_at', b.end_at,
    'price', b.price, 'service_id', b.service_id, 'service_name', b.service_name,
    'service_photo', s.photo, 'duration_min', s.duration_min,
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
  left join public.clients c on c.id = b.client_id;
$$;

-- client list: + flagged (2+ no-shows)
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

-- ---------- rules: + deposit hold time, no-show deposit ----------
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
                                'slot_step_min', m.slot_step_min, 'deposit_hold_hours', m.deposit_hold_hours,
                                'noshow_deposit', m.noshow_deposit,
                                'takes_deposits', private.takes_deposits(m.settings)))
  from public.masters m where m.id = p_master_id;
$$;

create or replace function public.owner_save_rules(p_master_id uuid, p_rules jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  update public.masters set
    auto_confirm        = coalesce((p_rules ->> 'auto_confirm')::boolean, auto_confirm),
    min_notice_hours    = coalesce((p_rules ->> 'min_notice_hours')::int, min_notice_hours),
    max_days_ahead      = coalesce((p_rules ->> 'max_days_ahead')::int, max_days_ahead),
    cancel_window_hours = coalesce((p_rules ->> 'cancel_window_hours')::int, cancel_window_hours),
    slot_step_min       = coalesce((p_rules ->> 'slot_step_min')::int, slot_step_min),
    deposit_hold_hours  = coalesce((p_rules ->> 'deposit_hold_hours')::int, deposit_hold_hours),
    noshow_deposit      = coalesce((p_rules ->> 'noshow_deposit')::numeric, noshow_deposit)
  where id = p_master_id;
  return public.owner_schedule(p_master_id);
end $$;

-- ---------- the clock: unpaid deposits, finished visits ----------
create or replace function private.expire_deposits() returns int
language sql security definer set search_path = '' as $$
  with x as (
    update public.bookings
       set status = 'cancelled_master', deposit_status = 'expired', cancel_reason = 'Deposit not received'
     where deposit_status = 'pending' and deposit_due_at <= now()
       and status in ('pending', 'confirmed') and start_at > now()
    returning 1)
  select count(*)::int from x;
$$;

create or replace function private.auto_complete() returns int
language sql security definer set search_path = '' as $$
  with x as (
    update public.bookings
       set status = 'completed', completed_at = now(), auto_completed = true
     where status = 'confirmed' and end_at < now() - interval '2 hours'
    returning 1)
  select count(*)::int from x;
$$;
revoke all on function private.expire_deposits(), private.auto_complete() from public;

-- ---------- push: + "deposit not received, slot freed" ----------
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
  elsif new.start_at is distinct from old.start_at and new.status in ('pending', 'confirmed') and not by_owner then
    v_kind := 'move';
  end if;
  if v_kind is null then return new; end if;
  if not exists (select 1 from public.push_subscriptions s where s.master_id = new.master_id) then return new; end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  if v_url is null or v_secret is null then return new; end if;

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('kind', v_kind, 'booking_id', new.id,
                               'old_start_at', case when tg_op = 'UPDATE' then old.start_at end),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 8000);
  return new;
exception when others then
  return new;
end $$;

-- ---------- insights (the signed-in master, her own studio only) ----------
-- p_period: 'week' (last 12 weeks) or 'month' (last 12 months), in the studio's time zone
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
  if not found or not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
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
revoke execute on function public.owner_insights(uuid, text) from public, anon;
grant execute on function public.owner_insights(uuid, text) to authenticated;

-- ---------- schedule the clock (pg_cron, where available) ----------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobname) from cron.job where jobname in ('studio-expire-deposits', 'studio-auto-complete');
    perform cron.schedule('studio-expire-deposits', '*/5 * * * *', 'select private.expire_deposits()');
    perform cron.schedule('studio-auto-complete', '*/15 * * * *', 'select private.auto_complete()');
  end if;
end $$;
