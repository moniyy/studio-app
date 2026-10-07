-- Reliability: a keep-alive ping, a log of app errors (with an alert), landing-page counts,
-- a read-only role for the weekly backup, and two more names a studio can't take.

-- ---------- 1. keep-alive: GitHub Actions calls this once a day (Supabase Free pauses idle projects) ----------
create or replace function public.ping() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('ok', true, 'at', now(), 'db', exists (select 1 from public.masters));
$$;
revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

-- ---------- 2. app errors: what broke on phones (no client's personal data) ----------
create table if not exists public.client_errors (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  slug        text not null default '',
  role        text not null default 'client' check (role in ('client', 'owner', 'staff', 'admin', 'landing')),
  kind        text not null default 'error' check (kind in ('error', 'rejection', 'request')),
  message     text not null,
  stack       text not null default '',
  source      text not null default '',
  page        text not null default '',
  user_agent  text not null default '',
  app_version text not null default '',
  fingerprint text not null
);
create index if not exists client_errors_at on public.client_errors (created_at desc);
create index if not exists client_errors_fp on public.client_errors (fingerprint, created_at desc);
alter table public.client_errors enable row level security;
revoke all on public.client_errors from anon, authenticated;

-- emails, phone-like numbers, ids and tokens never stay in a report
create or replace function private.scrub(p text, p_max int) returns text
language sql immutable set search_path = '' as $$
  select left(regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''),
    '[^\s@<>"'']+@[^\s@<>"'']+\.[a-z]{2,}', '[email]', 'gi'),
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '[id]', 'gi'),
    '\+?\d[\d\s().-]{6,}\d', '[number]', 'g'), p_max);
$$;

create or replace function public.log_client_error(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text := case when p ->> 'kind' in ('error', 'rejection', 'request') then p ->> 'kind' else 'error' end;
  v_role text := case when p ->> 'role' in ('client', 'owner', 'staff', 'admin', 'landing') then p ->> 'role' else 'client' end;
  v_msg text := private.scrub(btrim(coalesce(p ->> 'message', '')), 500);
  v_src text := private.scrub(coalesce(p ->> 'source', ''), 300);
  v_fp text;
  v_hour int;
begin
  if v_msg = '' then return; end if;
  v_fp := md5(v_kind || '|' || v_msg || '|' || regexp_replace(v_src, ':\d+(:\d+)?$', ''));
  -- a flood (a loop, a bot) is not news: at most 500 an hour, 20 of one kind in 10 minutes
  if (select count(*) from public.client_errors where created_at > now() - interval '1 hour') >= 500
     or (select count(*) from public.client_errors where fingerprint = v_fp and created_at > now() - interval '10 minutes') >= 20 then
    return;
  end if;
  insert into public.client_errors (slug, role, kind, message, stack, source, page, user_agent, app_version, fingerprint)
  values (left(lower(coalesce(p ->> 'slug', '')), 61), v_role, v_kind, v_msg,
          private.scrub(coalesce(p ->> 'stack', ''), 2000), v_src,
          private.scrub(regexp_replace(coalesce(p ->> 'page', ''), '[?#].*$', ''), 200),
          left(coalesce(p ->> 'ua', ''), 300), left(coalesce(p ->> 'version', ''), 40), v_fp);
  -- more than 10 in an hour: one email to hello@ (at most one an hour)
  select count(*) into v_hour from public.client_errors where created_at > now() - interval '1 hour';
  if v_hour > 10 and not exists (select 1 from public.email_log where kind = 'errors_alert' and created_at > now() - interval '1 hour') then
    perform private.enqueue_email('errors_alert', null, null, 'hello@satinbook.com', null, jsonb_build_object(
      'count', v_hour,
      'top', (select coalesce(jsonb_agg(t), '[]'::jsonb) from (
                select max(message) as message, count(*) as n, max(slug) as slug from public.client_errors
                 where created_at > now() - interval '1 hour' group by fingerprint order by count(*) desc limit 5) t)));
  end if;
end $$;
revoke all on function public.log_client_error(jsonb) from public;
grant execute on function public.log_client_error(jsonb) to anon, authenticated;

-- Admin → Errors: the same error together, counted (last 7 days)
create or replace function public.admin_errors() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'total_24h', (select count(*) from public.client_errors where created_at > now() - interval '24 hours'),
    'total_1h', (select count(*) from public.client_errors where created_at > now() - interval '1 hour'),
    'groups', coalesce((select jsonb_agg(g order by g.n_24h desc, g.last_at desc) from (
      select e.fingerprint, max(e.message) as message, max(e.kind) as kind, max(e.source) as source,
             count(*) filter (where e.created_at > now() - interval '24 hours') as n_24h,
             count(*) as n_7d, min(e.created_at) as first_at, max(e.created_at) as last_at,
             (select coalesce(jsonb_agg(distinct r), '[]'::jsonb) from (select e2.role as r from public.client_errors e2 where e2.fingerprint = e.fingerprint and e2.created_at > now() - interval '7 days' limit 50) rr) as roles,
             (select coalesce(jsonb_agg(distinct s), '[]'::jsonb) from (select e2.slug as s from public.client_errors e2 where e2.fingerprint = e.fingerprint and e2.slug <> '' and e2.created_at > now() - interval '7 days' limit 50) ss) as slugs,
             (select jsonb_build_object('stack', l.stack, 'page', l.page, 'ua', l.user_agent, 'version', l.app_version)
                from public.client_errors l where l.fingerprint = e.fingerprint order by l.created_at desc limit 1) as last
        from public.client_errors e
       where e.created_at > now() - interval '7 days'
       group by e.fingerprint
       order by count(*) filter (where e.created_at > now() - interval '24 hours') desc, max(e.created_at) desc
       limit 100) g), '[]'::jsonb));
end $$;
revoke all on function public.admin_errors() from public, anon;
grant execute on function public.admin_errors() to authenticated;

-- ---------- 3. landing page counts (no cookies, no outside service) ----------
create table if not exists public.events (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind       text not null check (kind in ('view', 'click_try', 'click_demo', 'click_owner_demo', 'lead', 'ref')),
  ref        text not null default '',
  path       text not null default ''
);
create index if not exists events_at on public.events (created_at desc);
alter table public.events enable row level security;
revoke all on public.events from anon, authenticated;

create or replace function public.track_event(p_kind text, p_ref text default '', p_path text default '') returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_ref text := lower(btrim(coalesce(p_ref, '')));
begin
  if p_kind not in ('view', 'click_try', 'click_demo', 'click_owner_demo', 'lead', 'ref') then return; end if;
  if v_ref !~ '^[a-z0-9][a-z0-9_-]{0,60}$' then v_ref := ''; end if;
  -- a bot hammering the page doesn't fill the table
  if (select count(*) from public.events where created_at > now() - interval '1 minute') >= 300 then return; end if;
  insert into public.events (kind, ref, path) values (p_kind, v_ref, left(regexp_replace(coalesce(p_path, ''), '[?#].*$', ''), 100));
end $$;
revoke all on function public.track_event(text, text, text) from public;
grant execute on function public.track_event(text, text, text) to anon, authenticated;

-- Admin → Leads: "Landing · last 7 days"
create or replace function public.admin_landing_stats(p_days int default 7) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 7), 90)));
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'days', greatest(1, least(coalesce(p_days, 7), 90)),
    'views', (select count(*) from public.events where kind = 'view' and created_at > v_from),
    'click_try', (select count(*) from public.events where kind = 'click_try' and created_at > v_from),
    'click_demo', (select count(*) from public.events where kind = 'click_demo' and created_at > v_from),
    'click_owner_demo', (select count(*) from public.events where kind = 'click_owner_demo' and created_at > v_from),
    'leads', (select count(*) from public.leads where created_at > v_from),
    'refs', coalesce((select jsonb_agg(r order by r.n desc) from (
        select ref, count(*) as n from public.events where kind = 'ref' and ref <> '' and created_at > v_from
         group by ref order by count(*) desc limit 10) r), '[]'::jsonb),
    'by_day', coalesce((select jsonb_agg(d order by d.day) from (
        select to_char(date_trunc('day', created_at at time zone 'America/New_York'), 'YYYY-MM-DD') as day, count(*) as views
          from public.events where kind = 'view' and created_at > v_from group by 1) d), '[]'::jsonb));
end $$;
revoke all on function public.admin_landing_stats(int) from public, anon;
grant execute on function public.admin_landing_stats(int) to authenticated;

-- ---------- 4. old rows go: errors after 30 days, landing counts after a year ----------
create or replace function private.prune_logs() returns void
language sql security definer set search_path = '' as $$
  delete from public.client_errors where created_at < now() - interval '30 days';
  delete from public.events where created_at < now() - interval '365 days';
$$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'studio-prune-logs';
    perform cron.schedule('studio-prune-logs', '17 4 * * *', 'select private.prune_logs()');
  end if;
end $$;

-- ---------- 5. the weekly backup reads everything, changes nothing ----------
-- (its password is set outside of git and lives only in the GitHub secret SUPABASE_BACKUP_DB_URL)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'satinbook_backup') then
    create role satinbook_backup login bypassrls;
  end if;
  begin
    grant pg_read_all_data to satinbook_backup;
  exception when others then raise notice 'pg_read_all_data: %', sqlerrm;
  end;
end $$;

-- ---------- 6. names the site uses: a studio can't take them ----------
create or replace function public.admin_slug_free(p_slug text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s text := lower(btrim(coalesce(p_slug, '')));
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  if s !~ '^[a-z0-9][a-z0-9-]{1,40}$' then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if s in ('demo', 'admin', 'www', 'api', 'app', 'apps', 'test', 'studio', 'help', 'support', 'manifest', 'manifests', 'img', 'owner', 'login',
           'masters', 'index', 'config', 'sw', 'assets', 'static', 'privacy', 'terms', 'legal', 'landing')
    then return jsonb_build_object('ok', false, 'reason', 'reserved'); end if;
  if exists (select 1 from public.masters where slug = s) then return jsonb_build_object('ok', false, 'reason', 'taken'); end if;
  return jsonb_build_object('ok', true);
end $$;
