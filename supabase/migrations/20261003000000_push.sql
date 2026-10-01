-- =========================================================
-- Push notifications for the master (Web Push)
--   push_subscriptions — one row per device that turned notifications on
--   a trigger on bookings calls the send-push Edge Function (pg_net) on:
--     new booking / new request, cancellation by the client, reschedule
--   The function URL and a shared secret live in Supabase Vault
--   (push_function_url, push_hook_secret) — never in this file.
-- =========================================================

do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then raise notice 'pg_net is not available here (%), push trigger stays idle', sqlerrm;
end $$;

create table public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  master_id    uuid not null references public.masters (id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  device_label text not null default '',
  created_at   timestamptz not null default now()
);
create index push_subscriptions_master_idx on public.push_subscriptions (master_id);

alter table public.push_subscriptions enable row level security;
create policy "owner: push subscriptions" on public.push_subscriptions for all to authenticated
  using (private.is_my_master(master_id)) with check (private.is_my_master(master_id));
revoke all on public.push_subscriptions from anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

-- This device turned notifications on (or refreshed its keys)
create or replace function public.owner_push_subscribe(p_master_id uuid, p_endpoint text, p_p256dh text, p_auth text, p_label text default '')
returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  r public.push_subscriptions;
begin
  if not private.is_my_master(p_master_id) then raise exception 'forbidden'; end if;
  if p_endpoint !~ '^https://' or length(p_p256dh) < 80 or length(p_auth) < 16 then raise exception 'bad_subscription'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint; -- same device, fresh keys
  insert into public.push_subscriptions (master_id, endpoint, p256dh, auth, device_label)
  values (p_master_id, p_endpoint, p_p256dh, p_auth, left(coalesce(p_label, ''), 80))
  returning * into r;
  return jsonb_build_object('id', r.id, 'device_label', r.device_label, 'created_at', r.created_at);
exception when unique_violation then
  raise exception 'forbidden'; -- the endpoint belongs to another studio
end $$;

create or replace function public.owner_push_unsubscribe(p_endpoint text) returns boolean
language sql security invoker set search_path = '' as $$
  with d as (delete from public.push_subscriptions where endpoint = p_endpoint returning 1) select exists (select 1 from d);
$$;

create or replace function public.owner_push_devices(p_master_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('device_label', device_label, 'created_at', created_at) order by created_at), '[]'::jsonb)
    from public.push_subscriptions where master_id = p_master_id;
$$;

revoke execute on function
  public.owner_push_subscribe(uuid, text, text, text, text),
  public.owner_push_unsubscribe(text),
  public.owner_push_devices(uuid)
  from public, anon;
grant execute on function
  public.owner_push_subscribe(uuid, text, text, text, text),
  public.owner_push_unsubscribe(text),
  public.owner_push_devices(uuid)
  to authenticated;

-- ---------------------------------------------------------
-- Trigger: what happened → ask send-push to tell the master's devices
-- (her own actions in the dashboard are not news to her)
-- ---------------------------------------------------------
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
  elsif new.start_at is distinct from old.start_at and new.status in ('pending', 'confirmed') and not by_owner then
    v_kind := 'move';
  end if;
  if v_kind is null then return new; end if;
  if not exists (select 1 from public.push_subscriptions s where s.master_id = new.master_id) then return new; end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_hook_secret';
  if v_url is null or v_secret is null then return new; end if;

  -- fire-and-forget: pg_net sends it after the transaction commits
  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('kind', v_kind, 'booking_id', new.id,
                               'old_start_at', case when tg_op = 'UPDATE' then old.start_at end),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 8000);
  return new;
exception when others then
  return new; -- a notification must never stop a booking
end $$;

create trigger bookings_push
  after insert or update of status, start_at on public.bookings
  for each row execute function private.push_on_booking();
