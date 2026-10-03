-- A salon shows its owner by her first name (masterName), never the studio's name.
-- The owner's master row and settings.masterName stay the same both ways.

-- her first name changes in Profile → her master row follows
create or replace function private.owner_name_to_staff() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v text := left(nullif(btrim(new.settings ->> 'masterName'), ''), 60);
begin
  if v is not null and v is distinct from nullif(btrim(old.settings ->> 'masterName'), '') then
    update public.staff set name = v where master_id = new.id and is_owner and name is distinct from v;
  end if;
  return new;
end $$;
drop trigger if exists masters_owner_name on public.masters;
create trigger masters_owner_name after update of settings on public.masters
  for each row execute function private.owner_name_to_staff();

-- she renames herself in Team → her first name in Profile follows
create or replace function private.staff_name_to_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_owner and new.name is distinct from old.name and nullif(btrim(new.name), '') is not null then
    update public.masters
       set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{masterName}', to_jsonb(btrim(new.name)))
     where id = new.master_id and (settings ->> 'masterName') is distinct from btrim(new.name);
  end if;
  return new;
end $$;
drop trigger if exists staff_owner_name on public.staff;
create trigger staff_owner_name after update of name on public.staff
  for each row execute function private.staff_name_to_owner();

-- studios made before: the owner's row takes her first name where she has one
update public.staff st set name = left(btrim(m.settings ->> 'masterName'), 60)
  from public.masters m
 where m.id = st.master_id and st.is_owner
   and nullif(btrim(m.settings ->> 'masterName'), '') is not null
   and st.name is distinct from left(btrim(m.settings ->> 'masterName'), 60);
