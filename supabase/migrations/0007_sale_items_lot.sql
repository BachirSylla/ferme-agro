-- ============================================================
-- AGRO ELITE — 0007_sale_items_lot
-- ============================================================
-- Marge par lot : on rattache une ligne de vente à un lot pour pouvoir
-- calculer le revenu attribuable à ce lot.
--
-- Pourquoi NULLABLE :
--   - les ventes existantes (lot_id = null) restent valides telles quelles.
--   - les produits de négoce (miel, mangue, etc.) restent vendables sans lot.
--   - le rattachement n'est jamais obligatoire côté UI.
--
-- Anti-double-comptage (juge de paix) : on NE crée aucun nouveau revenu.
-- `sales.total` reste la source unique des revenus pour v_financial_summary.
-- On ne fait que répartir analytiquement vers les lots via une vue dérivée.

alter table sale_items
  add column lot_id uuid references lots(id) on delete set null;

create index idx_sale_items_lot on sale_items (lot_id);

-- ─── Extension de v_lot_overview ───────────────────────────
-- Ajoute revenu_rattache (somme des sale_items rattachés, hors ventes
-- archivées) et marge (revenu_rattache − cout_total déjà calculé).
-- security_invoker conservé : le RLS de l'appelant s'applique partout.
drop view if exists v_lot_overview;

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
    + coalesce(h.cout_sante, 0)       as cout_total,
  coalesce(rev.revenu_rattache, 0)    as revenu_rattache,
  coalesce(rev.revenu_rattache, 0)
    - (
      coalesce(dep.depenses_directes, 0)
      + coalesce(st.cout_intrants, 0)
      + coalesce(h.cout_sante, 0)
    )                                  as marge
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
left join (
  -- Revenu rattaché : on agrège (quantité × prix unitaire) des sale_items
  -- liés au lot. On exclut les sale_items archivés ET les ventes parentes
  -- archivées (un sale_item dont la vente parente est soft-deleted ne doit
  -- pas compter).
  select si.lot_id,
         sum((si.quantity * si.unit_price)::integer) as revenu_rattache
  from sale_items si
  inner join sales s on s.id = si.sale_id
  where si.deleted_at is null
    and s.deleted_at is null
    and si.lot_id is not null
  group by si.lot_id
) rev on rev.lot_id = l.id
where l.deleted_at is null;

-- Recrée le GRANT (le DROP VIEW a effacé l'autorisation).
grant select on v_lot_overview to authenticated;
