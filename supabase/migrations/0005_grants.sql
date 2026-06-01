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
