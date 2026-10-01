-- Owners are linked to their studio by id, not by email.
-- With email confirmation off, an email in a sign-up is not proof of
-- anything — so nobody can "claim" a studio by registering its email.
-- Link an owner instead (Supabase → SQL Editor, see README):
--   update public.masters set owner_id = (select id from auth.users where email = 'her@email.com')
--    where slug = 'her-slug';
drop function if exists public.claim_my_studios();
