-- =========================================================
-- Admin billing, after the first checks
--   • founding price: $19/mo forever for the first studios (a flag the
--     admin sees on the card; the amount itself is plan_amount)
--   • "Mark paid" can be undone (10 s in the admin): the payment keeps
--     what it changed, undo puts it back and removes the payment
-- =========================================================

alter table public.masters add column if not exists founding boolean not null default false;
alter table public.studio_payments
  add column if not exists prev_last_paid_at timestamptz,
  add column if not exists prev_status text;

-- the list: + founding
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

create or replace function public.admin_mark_paid(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.masters;
  v_from date;
  v_next date;
  v_pid bigint;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  select * into m from public.masters where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  v_from := coalesce(m.next_payment_at, (now() at time zone 'America/New_York')::date);
  v_next := (v_from + make_interval(months => private.plan_months(m.billing_plan)))::date;
  insert into public.studio_payments (master_id, amount, plan, due_date, next_date, marked_by, prev_last_paid_at, prev_status)
  values (m.id, m.plan_amount, m.billing_plan, m.next_payment_at, v_next, auth.uid(), m.last_paid_at, m.status)
  returning id into v_pid;
  update public.masters
     set next_payment_at = v_next, last_paid_at = now(),
         status = case when status = 'trial' then 'active' else status end
   where id = m.id;
  return (select r || jsonb_build_object('payment_id', v_pid) from jsonb_array_elements(public.admin_studios()) r where r ->> 'id' = p_id::text);
end $$;

-- only the latest payment of a studio can be undone (so dates never go out of order)
create or replace function public.admin_undo_paid(p_payment_id bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  p public.studio_payments;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  select * into p from public.studio_payments where id = p_payment_id for update;
  if not found then raise exception 'not_found'; end if;
  if exists (select 1 from public.studio_payments x where x.master_id = p.master_id and x.id > p.id) then raise exception 'not_latest'; end if;
  update public.masters
     set next_payment_at = p.due_date, last_paid_at = p.prev_last_paid_at, status = coalesce(p.prev_status, status)
   where id = p.master_id;
  delete from public.studio_payments where id = p.id;
  return (select r from jsonb_array_elements(public.admin_studios()) r where r ->> 'id' = p.master_id::text);
end $$;

revoke execute on function public.admin_mark_paid(uuid), public.admin_undo_paid(bigint) from public, anon;
grant execute on function public.admin_mark_paid(uuid), public.admin_undo_paid(bigint) to authenticated;
