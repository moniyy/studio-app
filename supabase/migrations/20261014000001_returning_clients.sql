-- One meaning of "visits" everywhere: completed visits.
--   Clients list: "3 visits" = her completed visits.
--   Insights → Clients: of the clients with a completed visit in the period,
--     Returning = 2+ completed visits (so far), New = this is her first.
--   The same per master (with that master).
-- Before, Insights counted any booking and "returning" meant "first booked before the
-- period" — a client with 3 visits this quarter could show as New ("Returning 0").
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
  -- completed visits per client up to the end of the period (with this master, if one is picked)
  done as (
    select client_id, count(*) as n from public.bookings
     where master_id = p_master_id and status = 'completed' and start_at < v_to
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
        'new', count(distinct bk.client_id) filter (where d.n < 2),
        'returning', count(distinct bk.client_id) filter (where d.n >= 2))
      from bk join done d on d.client_id = bk.client_id
      where bk.status = 'completed'),
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
               'clients', (select count(distinct b.client_id) from bk b where b.staff_id = st.id and b.status = 'completed'),
               'returning', (select count(distinct b.client_id) from bk b
                              where b.staff_id = st.id and b.status = 'completed'
                                and (select count(*) from public.bookings e where e.client_id = b.client_id and e.staff_id = st.id
                                      and e.status = 'completed' and e.start_at < v_to) >= 2),
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
