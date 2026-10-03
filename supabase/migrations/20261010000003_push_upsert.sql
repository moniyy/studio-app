-- Saving a device twice at once (the dashboard refreshes it quietly) no longer
-- collides on the endpoint (409): one upsert instead of delete + insert.
create or replace function public.owner_push_subscribe(p_master_id uuid, p_endpoint text, p_p256dh text, p_auth text, p_label text default '')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.push_subscriptions;
begin
  if not private.can_view_studio(p_master_id) then raise exception 'forbidden'; end if;
  if p_endpoint !~ '^https://' or length(p_p256dh) < 80 or length(p_auth) < 16 then raise exception 'bad_subscription'; end if;
  -- this device now belongs to this account (and this studio), with fresh keys
  insert into public.push_subscriptions (master_id, user_id, endpoint, p256dh, auth, device_label)
  values (p_master_id, auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_label, ''), 80))
  on conflict (endpoint) do update
    set master_id = excluded.master_id, user_id = excluded.user_id, p256dh = excluded.p256dh,
        auth = excluded.auth, device_label = excluded.device_label
  returning * into r;
  return jsonb_build_object('id', r.id, 'device_label', r.device_label, 'created_at', r.created_at);
end $$;
