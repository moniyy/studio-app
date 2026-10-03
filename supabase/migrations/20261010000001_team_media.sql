-- A master in a salon writes lash maps with an "after" photo too:
-- she may upload into her studio's formulas/ folder (nothing else).
create or replace function private.owns_media_path(p_name text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mid uuid := split_part(p_name, '/', 1)::uuid;
begin
  return private.is_my_master(v_mid)
      or (split_part(p_name, '/', 2) = 'formulas' and private.my_staff_id(v_mid) is not null);
exception when others then
  return false; -- not a "<master_id>/…" path
end $$;
revoke all on function private.owns_media_path(text) from public;
grant execute on function private.owns_media_path(text) to authenticated;
