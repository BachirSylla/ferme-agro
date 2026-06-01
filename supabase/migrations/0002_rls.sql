-- ============================================================
-- AGRO ELITE — 0002_rls : Row Level Security par org_id
-- ============================================================

-- Renvoie l'org_id de l'utilisateur authentifié.
-- SECURITY DEFINER => contourne le RLS de profiles (évite la récursion infinie
-- quand la politique de profiles appelle cette fonction).
create or replace function auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles where id = auth.uid();
$$;

-- ─── Tables possédant une colonne org_id ─────────────────────
-- Politique unique "org_isolation" : on ne lit/écrit que les lignes de sa ferme.
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','species','products','lots','production_records',
    'incubation_batches','health_records','stock_items','stock_movements',
    'customers','sales','sale_items','expenses','goals'
  ]
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy org_isolation on %I
         for all to authenticated
         using (org_id = auth_org_id())
         with check (org_id = auth_org_id())', t);
  end loop;
end $$;

-- ─── organizations : l'utilisateur ne voit/modifie que SA ferme ──
alter table organizations enable row level security;
alter table organizations force row level security;
create policy org_self on organizations
  for all to authenticated
  using (id = auth_org_id())
  with check (id = auth_org_id());
