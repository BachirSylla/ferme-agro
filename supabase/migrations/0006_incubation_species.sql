-- ============================================================
-- AGRO ELITE — 0006_incubation_species
-- ============================================================
-- Ajoute species_id à incubation_batches.
--
-- Pourquoi : à la création MVP, on déduisait l'espèce via
-- source_lot_id.species_id. Mais le cas usuel (œufs ramassés non rattachés à
-- un lot d'origine) → source_lot_id = NULL → la carte affichait « Espèce
-- inconnue » alors que l'utilisateur avait bien choisi une espèce dans le
-- formulaire (info perdue).
--
-- species_id rend explicite l'espèce de la couvée, qu'il y ait ou non un
-- source_lot, et permet au lot d'éclosion de récupérer la bonne espèce.
--
-- Nullable pour ne pas casser les couvées historiques. Les écritures côté
-- UI le remplissent systématiquement.

alter table incubation_batches
  add column species_id uuid references species(id) on delete restrict;

create index idx_incub_species on incubation_batches (species_id);

-- RLS et GRANT : l'isolation org_id existante (via la policy org_isolation
-- déjà en place sur incubation_batches dans 0002_rls.sql) et les DEFAULT
-- PRIVILEGES de 0005_grants.sql s'appliquent automatiquement à la nouvelle
-- colonne — rien à ajouter.
