-- ============================================================
-- AGRO ELITE — setup_hosted.sql
-- Schéma complet (migrations 0001 -> 0005) en UN SEUL fichier,
-- à coller dans le SQL Editor d'un projet Supabase HÉBERGÉ.
-- À exécuter une seule fois sur un projet neuf.
-- (Ne contient PAS le seed : tu créeras ta ferme en t'inscrivant
--  réellement dans l'app — le trigger s'en charge.)
-- ============================================================


-- ░░░░░░░░░░░░░░░░░░░░ 0001_init.sql ░░░░░░░░░░░░░░░░░░░░
-- ============================================================
-- AGRO ELITE — 0001_init : extensions, enums, tables, triggers
-- ============================================================

create extension if not exists "pgcrypto";  -- pour gen_random_uuid()

-- ─── Enums ───────────────────────────────────────────────────
create type payment_method     as enum ('cash', 'wave', 'orange_money', 'autre');
create type production_category as enum ('ponte', 'casse', 'consomme', 'recolte');
create type stock_type         as enum ('aliment', 'medicament', 'emballage', 'produit_fini');
create type stock_direction    as enum ('entree', 'sortie');
create type health_type        as enum ('maladie', 'traitement', 'vaccin', 'mortalite');
create type lot_status         as enum ('actif', 'vendu', 'termine');
create type user_role          as enum ('proprietaire', 'superviseur');

-- ─── Trigger générique updated_at ────────────────────────────
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ─── Tenant & accès ──────────────────────────────────────────
create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slogan        text,
  logo_url      text,
  color_primary text not null default '#1f6e3a',
  currency      text not null default 'XOF',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);

-- profiles.id = auth.users.id (pattern standard Supabase pour lier l'utilisateur authentifié)
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  org_id     uuid not null references organizations(id) on delete cascade,
  full_name  text,
  role       user_role not null default 'proprietaire',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_profiles_org on profiles (org_id);

-- ─── Catalogue (configurable) ────────────────────────────────
create table species (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  category   text,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_species_org on species (org_id);

create table products (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  species_id    uuid references species(id) on delete set null,  -- nullable = produit indépendant (miel)
  name          text not null,
  unit          text not null default 'unite',
  default_price integer not null default 0,                      -- en XOF (entier)
  attributes    jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index idx_products_org     on products (org_id);
create index idx_products_species on products (species_id);

-- ─── Opérations ──────────────────────────────────────────────
create table lots (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  species_id    uuid not null references species(id) on delete restrict,
  code          text not null,
  start_date    date not null default current_date,
  initial_count integer not null default 0,
  current_count integer not null default 0,
  status        lot_status not null default 'actif',
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index idx_lots_org     on lots (org_id);
create index idx_lots_species on lots (species_id);

create table production_records (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  lot_id     uuid references lots(id) on delete set null,
  product_id uuid not null references products(id) on delete restrict,
  day        date not null default current_date,
  quantity   numeric not null default 0,
  category   production_category not null default 'ponte',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_prod_org     on production_records (org_id);
create index idx_prod_lot     on production_records (lot_id);
create index idx_prod_product on production_records (product_id);
create index idx_prod_day     on production_records (day);

create table incubation_batches (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  source_lot_id  uuid references lots(id) on delete set null,  -- lot d'où viennent les œufs
  result_lot_id  uuid references lots(id) on delete set null,  -- lot créé à l'éclosion
  set_date       date not null default current_date,
  expected_hatch date,
  eggs_count     integer not null default 0,
  hatched_count  integer,
  status         text not null default 'en_cours',             -- en_cours / eclos / echoue
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index idx_incub_org on incubation_batches (org_id);

create table health_records (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  lot_id         uuid not null references lots(id) on delete cascade,
  day            date not null default current_date,
  type           health_type not null,
  description    text,
  affected_count integer not null default 0,
  cost           integer not null default 0,                    -- en XOF
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index idx_health_org on health_records (org_id);
create index idx_health_lot on health_records (lot_id);

-- ─── Stocks ──────────────────────────────────────────────────
create table stock_items (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  product_id        uuid references products(id) on delete set null,  -- rempli si type = produit_fini
  name              text not null,
  type              stock_type not null,
  unit              text not null default 'unite',
  quantity          numeric not null default 0,
  reorder_threshold numeric not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create index idx_stock_org on stock_items (org_id);

create table stock_movements (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  stock_item_id uuid not null references stock_items(id) on delete cascade,
  lot_id        uuid references lots(id) on delete set null,    -- imputation du coût au lot
  day           date not null default current_date,
  direction     stock_direction not null,
  quantity      numeric not null default 0,
  cost          integer not null default 0,                     -- valorisation en XOF
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index idx_smv_org  on stock_movements (org_id);
create index idx_smv_item on stock_movements (stock_item_id);
create index idx_smv_lot  on stock_movements (lot_id);

-- ─── Commercial ──────────────────────────────────────────────
create table customers (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  phone      text,
  notes      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_customers_org on customers (org_id);

create table sales (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  customer_id    uuid references customers(id) on delete set null,
  day            date not null default current_date,
  total          integer not null default 0,                    -- en XOF
  payment_method payment_method not null default 'cash',
  status         text not null default 'payee',                 -- payee / impayee / partielle
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index idx_sales_org      on sales (org_id);
create index idx_sales_customer on sales (customer_id);
create index idx_sales_day      on sales (day);

create table sale_items (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  sale_id    uuid not null references sales(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  quantity   numeric not null default 0,
  unit_price integer not null default 0,                        -- en XOF
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index idx_sale_items_sale    on sale_items (sale_id);
create index idx_sale_items_product on sale_items (product_id);

-- ─── Finances ────────────────────────────────────────────────
create table expenses (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  lot_id         uuid references lots(id) on delete set null,        -- imputation au lot (marge par lot)
  stock_item_id  uuid references stock_items(id) on delete set null, -- si la dépense = achat d'intrant
  day            date not null default current_date,
  category       text not null,
  amount         integer not null default 0,                         -- en XOF (sortie de cash réelle)
  supplier       text,
  payment_method payment_method not null default 'cash',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index idx_expenses_org on expenses (org_id);
create index idx_expenses_lot on expenses (lot_id);
create index idx_expenses_day on expenses (day);

-- ─── Pilotage ────────────────────────────────────────────────
create table goals (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  metric       text not null,                                   -- ex: production_oeufs, marge_nette, taux_mortalite_max
  target_value numeric not null,
  period       text,                                            -- ex: mensuel, trimestriel
  start_date   date,
  end_date     date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index idx_goals_org on goals (org_id);

-- ─── Triggers updated_at sur toutes les tables ───────────────
do $$
declare t text;
begin
  foreach t in array array[
    'organizations','profiles','species','products','lots','production_records',
    'incubation_batches','health_records','stock_items','stock_movements',
    'customers','sales','sale_items','expenses','goals'
  ]
  loop
    execute format(
      'create trigger trg_%1$s_updated_at before update on %1$I
         for each row execute function set_updated_at()', t);
  end loop;
end $$;

-- ░░░░░░░░░░░░░░░░░░░░ 0002_rls.sql ░░░░░░░░░░░░░░░░░░░░
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

-- ░░░░░░░░░░░░░░░░░░░░ 0003_views.sql ░░░░░░░░░░░░░░░░░░░░
-- ============================================================
-- AGRO ELITE — 0003_views : vues de pilotage (analytics dérivés)
-- ============================================================
-- security_invoker = on  => les vues appliquent le RLS de l'appelant
-- (chaque ferme ne voit que ses propres chiffres à travers la vue).
--
-- Convention coûts : 'expenses.amount' = sorties de cash réelles (P&L).
-- 'stock_movements.cost' = valorisation interne d'un intrant imputé à un lot
-- (sert au coût par lot, PAS au cash de la ferme — pour éviter le double comptage).

-- ─── Vue 1 : vue d'ensemble par lot ──────────────────────────
create view v_lot_overview
with (security_invoker = on) as
select
  l.id            as lot_id,
  l.org_id,
  l.code,
  l.status,
  l.initial_count,
  l.current_count,
  coalesce(prod.total_produit, 0)     as total_produit,
  coalesce(dep.depenses_directes, 0)  as depenses_directes,
  coalesce(st.cout_intrants, 0)       as cout_intrants,
  coalesce(h.cout_sante, 0)           as cout_sante,
  coalesce(dep.depenses_directes, 0)
    + coalesce(st.cout_intrants, 0)
    + coalesce(h.cout_sante, 0)       as cout_total
from lots l
left join (
  select lot_id, sum(quantity) as total_produit
  from production_records
  where deleted_at is null and lot_id is not null
  group by lot_id
) prod on prod.lot_id = l.id
left join (
  select lot_id, sum(amount) as depenses_directes
  from expenses
  where deleted_at is null and lot_id is not null
  group by lot_id
) dep on dep.lot_id = l.id
left join (
  select lot_id, sum(cost) as cout_intrants
  from stock_movements
  where deleted_at is null and lot_id is not null and direction = 'sortie'
  group by lot_id
) st on st.lot_id = l.id
left join (
  select lot_id, sum(cost) as cout_sante
  from health_records
  where deleted_at is null
  group by lot_id
) h on h.lot_id = l.id
where l.deleted_at is null;

-- ─── Vue 2 : résumé financier mensuel par ferme ──────────────
create view v_financial_summary
with (security_invoker = on) as
select
  org_id,
  date_trunc('month', day)::date as mois,
  sum(case when src = 'vente'   then montant else 0 end) as revenus,
  sum(case when src = 'depense' then montant else 0 end) as depenses,
  sum(case when src = 'vente'   then montant else -montant end) as benefice
from (
  select org_id, day, total  as montant, 'vente'   as src from sales    where deleted_at is null
  union all
  select org_id, day, amount as montant, 'depense' as src from expenses where deleted_at is null
) t
group by org_id, date_trunc('month', day);

-- ░░░░░░░░░░░░░░░░░░░░ 0004_auth_trigger.sql ░░░░░░░░░░░░░░░░░░░░
-- ============================================================
-- AGRO ELITE — 0004_auth_trigger : provisioning auto à l'inscription
-- ============================================================
-- À l'inscription d'un utilisateur (insert dans auth.users), on crée
-- automatiquement SA ferme + son profil propriétaire, dans la MÊME transaction.
--
-- PIÈGE IMPORTANT (vérifié) : 0002 active `force row level security`. Au moment
-- du signup, l'utilisateur n'a pas encore de profil, donc auth_org_id() vaut null
-- et les policies REJETTENT les INSERT
-- ("new row violates row-level security policy for table organizations").
--   => La fonction doit s'exécuter avec un rôle qui a l'attribut BYPASSRLS.
--      Sur Supabase, le rôle `postgres` possède bypassrls par défaut, d'où le
--      `owner to postgres` ci-dessous. Si l'inscription échoue malgré tout
--      (environnement atypique), le correctif est, via un rôle admin :
--          alter role postgres bypassrls;

-- ─── Correctif #4 : un profil soft-deleted ne donne plus accès ───
create or replace function auth_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id from profiles
  where id = auth.uid() and deleted_at is null;
$$;

-- ─── Provisioning à l'inscription ────────────────────────────
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_org uuid;
begin
  insert into organizations (name) values ('Ferme')
    returning id into new_org;
  insert into profiles (id, org_id, role)
    values (new.id, new_org, 'proprietaire');
  return new;
end;
$$;

-- Exécution avec un rôle disposant de BYPASSRLS (voir le piège ci-dessus).
alter function handle_new_user() owner to postgres;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ░░░░░░░░░░░░░░░░░░░░ 0005_grants.sql ░░░░░░░░░░░░░░░░░░░░
-- ============================================================
-- AGRO ELITE — 0005_grants : privilèges SQL pour anon / authenticated
-- ============================================================
-- IMPORTANT : le RLS filtre les LIGNES, mais il ne donne aucun privilège.
-- Sans GRANT explicite, le rôle `authenticated` reçoit
-- "permission denied for table/view ...". Supabase n'accorde pas
-- automatiquement ces privilèges sur les objets créés par migration.
-- On les pose ici, et on configure les DEFAULT PRIVILEGES pour que les
-- objets créés PLUS TARD soient couverts automatiquement.

-- ─── Accès au schéma ─────────────────────────────────────────
grant usage on schema public to authenticated, anon;

-- ─── Tables : tout pour l'utilisateur connecté (le RLS limite les lignes) ──
grant select, insert, update, delete on all tables in schema public to authenticated;

-- ─── Vues de pilotage : lecture seule ────────────────────────
-- (les vues sont aussi des "tables" au sens information_schema ; le grant
--  ci-dessus les couvre déjà, mais on garde la lecture explicite au cas où
--  une vue serait créée avant ce grant.)
grant select on v_lot_overview, v_financial_summary to authenticated;

-- ─── Séquences (utile si des colonnes serial/identity apparaissent) ──
grant usage, select on all sequences in schema public to authenticated;

-- ─── Privilèges par défaut pour les objets FUTURS ────────────
-- S'appliquent aux objets créés ensuite PAR le rôle qui exécute cette ligne.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- Note : `anon` (utilisateur non connecté) ne reçoit volontairement AUCUN
-- privilège sur les données — il ne peut que traverser le schéma. Adapter
-- si un jour une partie publique (catalogue vitrine, etc.) est souhaitée.