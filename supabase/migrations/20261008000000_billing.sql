-- =========================================================
-- Manual billing in the admin (the master pays through a BSB Link)
--   • per studio: payment link, plan (monthly / quarterly / yearly) and the
--     amount per period; "per month" (monthly_price) becomes the plan amount
--   • admin_mark_paid: logs the payment and moves the next payment date by
--     one period of the plan (a trial that pays becomes Active)
--   • every payment is kept in studio_payments (admin only)
-- =========================================================

alter table public.masters
  add column if not exists billing_plan text not null default 'monthly' check (billing_plan in ('monthly', 'quarterly', 'yearly')),
  add column if not exists plan_amount numeric(10, 2) check (plan_amount >= 0),
  add column if not exists payment_link text check (payment_link is null or (payment_link ~ '^https://' and length(payment_link) <= 500)),
  add column if not exists last_paid_at timestamptz;
update public.masters set plan_amount = monthly_price where plan_amount is null and monthly_price is not null;
-- a new studio's first payment is due when its trial ends
update public.masters set next_payment_at = trial_ends_at::date where next_payment_at is null and status = 'trial' and trial_ends_at is not null;

create table if not exists public.studio_payments (
  id         bigint generated always as identity primary key,
  master_id  uuid not null references public.masters (id) on delete cascade,
  amount     numeric(10, 2),
  plan       text not null,
  due_date   date,            -- the date this payment covered
  next_date  date not null,   -- the next payment date it moved to
  paid_at    timestamptz not null default now(),
  marked_by  uuid references auth.users (id) on delete set null
);
create index if not exists studio_payments_master_idx on public.studio_payments (master_id, paid_at desc);
alter table public.studio_payments enable row level security; -- no policies: through the admin functions only
revoke all on public.studio_payments from anon, authenticated;

create or replace function private.plan_months(p_plan text) returns int
language sql immutable set search_path = '' as $$
  select case p_plan when 'quarterly' then 3 when 'yearly' then 12 else 1 end;
$$;

-- the list: + plan, amount, payment link, last payment
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
        'last_paid_at', m.last_paid_at, 'admin_notes', m.admin_notes,
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

-- status, trial, billing (plan, amount, link, next payment), notes
create or replace function public.admin_save_studio(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_link text := nullif(btrim(coalesce(p ->> 'payment_link', '')), '');
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if p ? 'payment_link' and v_link is not null and v_link !~ '^https://\S+$' then raise exception 'invalid_link'; end if;
  update public.masters set
    status = coalesce(nullif(p ->> 'status', ''), status),
    trial_ends_at = case when p ? 'trial_ends_at' then nullif(p ->> 'trial_ends_at', '')::timestamptz else trial_ends_at end,
    next_payment_at = case when p ? 'next_payment_at' then nullif(p ->> 'next_payment_at', '')::date else next_payment_at end,
    billing_plan = coalesce(nullif(p ->> 'billing_plan', ''), billing_plan),
    plan_amount = case when p ? 'plan_amount' then nullif(p ->> 'plan_amount', '')::numeric
                       when p ? 'monthly_price' then nullif(p ->> 'monthly_price', '')::numeric else plan_amount end,
    payment_link = case when p ? 'payment_link' then v_link else payment_link end,
    admin_notes = coalesce(left(p ->> 'admin_notes', 4000), admin_notes)
  where id = p_id;
  if not found then raise exception 'not_found'; end if;
  return (select r from jsonb_array_elements(public.admin_studios()) r where r ->> 'id' = p_id::text);
end $$;

-- paid: next payment = the due date (or today, if none) + one period of the plan
create or replace function public.admin_mark_paid(p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.masters;
  v_from date;
  v_next date;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  select * into m from public.masters where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  v_from := coalesce(m.next_payment_at, (now() at time zone 'America/New_York')::date);
  v_next := (v_from + make_interval(months => private.plan_months(m.billing_plan)))::date;
  insert into public.studio_payments (master_id, amount, plan, due_date, next_date, marked_by)
  values (m.id, m.plan_amount, m.billing_plan, m.next_payment_at, v_next, auth.uid());
  update public.masters
     set next_payment_at = v_next, last_paid_at = now(),
         status = case when status = 'trial' then 'active' else status end
   where id = m.id;
  return (select r from jsonb_array_elements(public.admin_studios()) r where r ->> 'id' = p_id::text);
end $$;

revoke execute on function public.admin_studios(), public.admin_save_studio(uuid, jsonb), public.admin_mark_paid(uuid) from public, anon;
grant execute on function public.admin_studios(), public.admin_save_studio(uuid, jsonb), public.admin_mark_paid(uuid) to authenticated;
