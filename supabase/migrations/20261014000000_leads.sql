-- satinbook.com landing page: "Start your free trial" → a lead.
-- Anyone may send the form (through submit_lead only — the table itself is closed);
-- only the platform admin reads and works the leads (Admin → Leads). Each new lead
-- emails hello@satinbook.com (Resend, through the email queue).

create table if not exists public.leads (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null,
  instagram   text not null default '',
  email       text not null,
  niche       text not null default '',
  city        text not null default '',
  ref         text not null default '',   -- ?ref=<slug>: the studio app the visitor came from
  status      text not null default 'new' check (status in ('new', 'contacted', 'trial', 'lost')),
  notes       text not null default '',
  studio_id   uuid references public.masters (id) on delete set null,
  updated_at  timestamptz not null default now()
);
create index if not exists leads_created on public.leads (created_at desc);
alter table public.leads enable row level security;
revoke all on public.leads from anon, authenticated;
grant select on public.leads to authenticated;
drop policy if exists "admin: leads" on public.leads;
create policy "admin: leads" on public.leads for select to authenticated using (private.is_admin());

-- the form: checks, a little spam protection, the email to hello@satinbook.com
create or replace function public.submit_lead(p_name text, p_email text, p_instagram text default '', p_niche text default '',
                                              p_city text default '', p_ref text default '', p_hp text default '')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := left(btrim(coalesce(p_name, '')), 80);
  v_ig text := left(regexp_replace(btrim(coalesce(p_instagram, '')), '^(https?://)?(www\.)?instagram\.com/|^@', '', 'i'), 60);
  r public.leads;
begin
  -- the hidden field bots fill in: thank them, keep nothing
  if coalesce(p_hp, '') <> '' then return jsonb_build_object('ok', true); end if;
  if length(v_name) < 2 then raise exception 'invalid_name'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid_email'; end if;
  if (select count(*) from public.leads where email = v_email and created_at > now() - interval '1 day') >= 3
     or (select count(*) from public.leads where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too_many';
  end if;
  insert into public.leads (name, instagram, email, niche, city, ref)
  values (v_name, regexp_replace(v_ig, '[/?#].*$', ''), v_email, left(btrim(coalesce(p_niche, '')), 40),
          left(btrim(coalesce(p_city, '')), 80), left(lower(btrim(coalesce(p_ref, ''))), 61))
  returning * into r;
  perform private.enqueue_email('lead', null, null, 'hello@satinbook.com', null, jsonb_build_object('lead_id', r.id));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.submit_lead(text, text, text, text, text, text, text) from public;
grant execute on function public.submit_lead(text, text, text, text, text, text, text) to anon, authenticated;

-- Admin → Leads
create or replace function public.admin_leads() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(to_jsonb(l) || jsonb_build_object('studio_slug', m.slug) order by l.created_at desc)
                     from public.leads l left join public.masters m on m.id = l.studio_id), '[]'::jsonb);
end $$;
create or replace function public.admin_save_lead(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.leads;
begin
  if not private.is_admin() then raise exception 'forbidden'; end if;
  update public.leads set
    status = coalesce(nullif(p ->> 'status', ''), status),
    notes = coalesce(p ->> 'notes', notes),
    studio_id = case when p ? 'studio_id' then nullif(p ->> 'studio_id', '')::uuid else studio_id end,
    updated_at = now()
  where id = p_id returning * into r;
  if not found then raise exception 'not_found'; end if;
  return to_jsonb(r);
end $$;
revoke all on function public.admin_leads(), public.admin_save_lead(uuid, jsonb) from public, anon;
grant execute on function public.admin_leads(), public.admin_save_lead(uuid, jsonb) to authenticated;
