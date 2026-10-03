-- Pretty links (…/studio-app/<slug>): a studio can't take a name the site itself uses.
create or replace function public.admin_slug_free(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s text := lower(btrim(coalesce(p_slug, '')));
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if s !~ '^[a-z0-9][a-z0-9-]{1,40}$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if s in ('demo', 'admin', 'www', 'api', 'app', 'apps', 'test', 'studio', 'help', 'support', 'manifest', 'manifests', 'img', 'owner', 'login',
           'masters', 'index', 'config', 'sw', 'assets', 'static')
    then return jsonb_build_object('ok', false, 'reason', 'reserved'); end if;
  if exists (select 1 from public.masters where slug = s) then return jsonb_build_object('ok', false, 'reason', 'taken'); end if;
  return jsonb_build_object('ok', true);
end $$;
