-- ============================================================
-- AGRO ELITE — seed.sql (données de dev local)
-- ============================================================
-- L'insertion de l'utilisateur de test déclenche on_auth_user_created,
-- qui crée automatiquement l'organisation « Ferme » + le profil propriétaire.
-- On rattache ensuite un petit jeu de données d'exemple à cette ferme.
-- À rejouer via `supabase db reset` (migrations + seed).

-- 1) Utilisateur de test -> déclenche la création org + profil
insert into auth.users (id, email)
values ('00000000-0000-0000-0000-0000000000aa', 'proprietaire@ferme.test')
on conflict (id) do nothing;

do $$
declare
  v_org     uuid;
  v_cailles uuid;
  v_canards uuid;
  v_oeufs   uuid;
  v_miel    uuid;
  v_lot     uuid;
  v_sale    uuid;
  v_stock   uuid;
begin
  select org_id into v_org from profiles
   where id = '00000000-0000-0000-0000-0000000000aa';

  -- 2) Catalogue : espèces
  insert into species (org_id, name, category)
    values (v_org, 'Cailles', 'volaille') returning id into v_cailles;
  insert into species (org_id, name, category)
    values (v_org, 'Canards', 'volaille') returning id into v_canards;

  -- 3) Catalogue : produits — le miel n'a PAS d'espèce (produit indépendant)
  insert into products (org_id, species_id, name, unit, default_price)
    values (v_org, v_cailles, 'Œufs de caille', 'unite', 100) returning id into v_oeufs;
  insert into products (org_id, species_id, name, unit, default_price)
    values (v_org, null, 'Miel', 'litre', 5000) returning id into v_miel;

  -- 4) Un lot de cailles
  insert into lots (org_id, species_id, code, initial_count, current_count)
    values (v_org, v_cailles, 'LOT-CAILLES-001', 200, 196) returning id into v_lot;

  -- 5) Production d'œufs sur quelques jours (ponte + casse)
  insert into production_records (org_id, lot_id, product_id, day, quantity, category) values
    (v_org, v_lot, v_oeufs, current_date - 2, 150, 'ponte'),
    (v_org, v_lot, v_oeufs, current_date - 1, 162, 'ponte'),
    (v_org, v_lot, v_oeufs, current_date - 1,   8, 'casse'),
    (v_org, v_lot, v_oeufs, current_date,     158, 'ponte');

  -- 6) Une vente multi-produits (30 œufs + 1 L de miel), payée par Wave
  insert into sales (org_id, day, total, payment_method, status)
    values (v_org, current_date, 30 * 100 + 1 * 5000, 'wave', 'payee') returning id into v_sale;
  insert into sale_items (org_id, sale_id, product_id, quantity, unit_price) values
    (v_org, v_sale, v_oeufs, 30, 100),
    (v_org, v_sale, v_miel,   1, 5000);

  -- 7) Stock d'aliment + sortie imputée au lot (valorisation pour le coût par lot)
  insert into stock_items (org_id, name, type, unit, quantity, reorder_threshold)
    values (v_org, 'Maïs concassé', 'aliment', 'kg', 80, 20) returning id into v_stock;
  insert into stock_movements (org_id, stock_item_id, lot_id, direction, quantity, cost)
    values (v_org, v_stock, v_lot, 'sortie', 10, 3500);

  -- 8) Dépenses (achat d'aliment imputé au lot + transport non imputé)
  insert into expenses (org_id, lot_id, day, category, amount, supplier, payment_method) values
    (v_org, v_lot, current_date - 3, 'aliment',   45000, 'Fournisseur local', 'cash'),
    (v_org, null,  current_date - 1, 'transport',  5000, null,                'orange_money');

  -- 9) Un objectif mensuel
  insert into goals (org_id, metric, target_value, period, start_date)
    values (v_org, 'production_oeufs', 5000, 'mensuel', date_trunc('month', current_date)::date);
end $$;
