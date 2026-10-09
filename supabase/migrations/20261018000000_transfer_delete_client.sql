-- Handing a studio over (Admin → Transfer to email) and removing a client (Clients → Delete client).
-- Only additions: a table for invitations not accepted yet, three functions; admin_studios re-created
-- with one more field. Nothing existing changes for any studio.

-- ---------- studio transfers ----------
-- An existing account becomes the owner at once (no row needed, one is kept as a record);
-- a new email gets an invitation: she becomes the owner when she sets her password.
create table if not exists public.studio_transfers (
  id          uuid primary key default gen_random_uuid(),
  master_id   uuid not null references public.masters (id) on delete cascade,
  email       text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254),
  token       uuid not null unique default gen_random_uuid(),
  created_by  uuid references auth.users (id) on delete set null,
  user_id     uuid references auth.users (id) on delete set null, -- who became the owner
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists studio_transfers_master_idx on public.studio_transfers (master_id, created_at desc);
alter table public.studio_transfers enable row level security; -- no policies: the Edge Functions only
revoke all on public.studio_transfers from anon, authenticated;

-- an account by its email (the Edge Functions, service role only)
create or replace function public.admin_user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where lower(u.email) = lower(btrim(p_email)) limit 1;
$$;
revoke all on function public.admin_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.admin_user_id_by_email(text) to service_role;

-- the admin list: + an invitation waiting to be accepted (everything else as in 20261010000000_team.sql)
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
        -- Transfer to email: an invitation she hasn't accepted yet
        'transfer_to', (select t.email from public.studio_transfers t where t.master_id = m.id and t.accepted_at is null and t.cancelled_at is null and t.expires_at > now() order by t.created_at desc limit 1),
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

-- ---------- Clients → Delete client (the studio's owner only) ----------
-- her coming appointments are cancelled first (the time is free again), then she and her
-- whole booking history (and its email log) are removed; her lash maps go with her
create or replace function public.owner_delete_client(p_client_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c public.clients;
  v_cancelled int;
  v_bookings int;
begin
  select * into c from public.clients where id = p_client_id;
  if not found then raise exception 'not_found'; end if;
  if not private.is_my_master(c.master_id) then raise exception 'forbidden'; end if;
  update public.bookings set status = 'cancelled_master', cancel_reason = 'Client removed'
   where client_id = c.id and master_id = c.master_id and status in ('pending', 'confirmed') and start_at > now();
  get diagnostics v_cancelled = row_count;
  delete from public.email_log where booking_id in (select id from public.bookings where client_id = c.id and master_id = c.master_id);
  delete from public.bookings where client_id = c.id and master_id = c.master_id;
  get diagnostics v_bookings = row_count;
  delete from public.clients where id = c.id;
  return jsonb_build_object('cancelled', v_cancelled, 'bookings', v_bookings);
end $$;
revoke all on function public.owner_delete_client(uuid) from public, anon;
grant execute on function public.owner_delete_client(uuid) to authenticated;
