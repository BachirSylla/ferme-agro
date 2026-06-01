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
