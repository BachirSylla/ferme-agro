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
