-- ============================================================
-- AGRO ELITE — 0004_auth_trigger : signup → org + profile auto
-- ============================================================

-- ─── Correctif auth_org_id() : ignorer les profils soft-deleted ──
-- Sans le filtre `deleted_at is null`, un profil supprimé continuerait
-- à donner accès à sa ferme via le RLS (cf. revue 0002/0003, écart #4).
create or replace function auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles
   where id = auth.uid()
     and deleted_at is null;
$$;

-- ─── Auto-provisioning du nouvel inscrit ─────────────────────
-- Un signup auth.users → 1 organizations + 1 profiles, dans la MÊME
-- transaction. Si l'un des INSERT échoue, le signup est rollbackée
-- (pas d'auth.users orphelin sans profile).
--
-- POURQUOI security definer + owner postgres :
--   Les tables sont en `force row level security` (0002). À l'instant T
--   du trigger, auth_org_id() est null (le profile n'existe pas encore)
--   → la policy org_isolation refuserait l'INSERT avec l'erreur
--   "new row violates row-level security policy".
--   SECURITY DEFINER fait tourner la fonction comme son OWNER ; sur
--   Supabase l'utilisateur `postgres` porte l'attribut BYPASSRLS, ce
--   qui shunte FORCE RLS pour ces deux INSERT spécifiquement.
--
-- Si malgré tout l'inscription échoue en local avec une erreur RLS,
-- vérifier en SQL :
--   select rolbypassrls from pg_roles where rolname = 'postgres';
-- → doit être true. Sinon (rare) :
--   alter role postgres bypassrls;   -- via un rôle admin
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org_id uuid;
begin
  insert into organizations (name)
    values ('Ferme')
    returning id into new_org_id;

  insert into profiles (id, org_id, role)
    values (new.id, new_org_id, 'proprietaire');

  return new;
end;
$$;

alter function handle_new_user() owner to postgres;
comment on function handle_new_user() is
  'Trigger auth.users : crée org + profile à l''inscription. '
  'Owner = postgres (BYPASSRLS sur Supabase) pour contourner le force RLS.';

-- ─── Trigger ─────────────────────────────────────────────────
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
