# AGRO ELITE — Gestion de ferme

App web responsive + **PWA mobile** de gestion de ferme. Mono-utilisateur (propriétaire,
+ 1 superviseur éventuel), mais conçue **multi-fermes** dès le départ. La ferme produit déjà
(volailles, œufs, miel…) : prévoir la saisie de l'existant (soldes et stocks d'ouverture).

- Langue de l'UI et des libellés : **français**
- Devise : **FCFA / XOF** (sans décimales)
- Contexte : Sénégal, connexion réseau parfois instable → l'app doit rester utilisable hors-ligne

## Principes d'architecture (non négociables)

1. **Entités génériques, jamais de module par espèce.** Les espèces et produits sont des
   *données* configurables (tables `species`, `product`), pas du code. Ajouter une activité
   (miel, poisson, lapins…) = insérer des lignes, jamais créer un module dédié.
2. **Gestion par lot, jamais par animal individuel.** L'unité opérationnelle est `lot`
   (ex. « 200 cailles arrivées le 12/03 »). `current_count` se décrémente avec la mortalité
   et les ventes.
3. **Multi-tenant par `org_id` + RLS.** Toutes les tables portent `org_id` (FK → `organization`).
   L'isolation des fermes est garantie par le Row Level Security de Postgres, pas seulement
   côté front.
4. **Pilotage dérivé.** Bénéfices, marges, tableau de bord, écart objectif/réel = vues SQL ou
   requêtes. Ne jamais stocker un agrégat qu'on peut calculer.

## Stack

- **Front** : React + Vite + TypeScript + Tailwind, packagé en **PWA** (installable, service
  worker, offline).
- **Offline (MVP)** : cache service-worker + file d'écritures en **IndexedDB via Dexie.js**,
  synchro au retour du réseau. PowerSync est *différé* tant qu'il n'y a qu'1–2 utilisateurs.
- **Backend** : **Supabase** (PostgreSQL + Auth + Storage + RLS + Edge Functions Deno).
  C'est du Postgres standard → aucun lock-in.
- **Thème** : palette en **variables CSS** (`--brand-*`) lue par Tailwind, valeurs chargées au
  runtime depuis la ligne `organization`.

## Multi-fermes & marque

- L'identité PWA *installée* (icône d'accueil, nom, splash) est **générique et partagée** :
  nom « Ferme », couleur neutre agricole. Pas de manifest dynamique pour l'instant.
- La personnalisation par ferme (logo, couleurs, nom affiché, slogan) se fait **uniquement à
  l'intérieur** de l'app : champs dans `organization` + variables CSS + logo dans Supabase Storage.

## Modèle de données

Source de vérité = `supabase/migrations/`. Inventaire des tables :

- **Catalogue (configurable)** : `species`, `product`
  (`product.species_id` *nullable* → produit indépendant, ex. le miel).
- **Opérations** : `lot`, `production_record`, `incubation_batch`, `health_record`.
- **Stocks** : `stock_item` (type : aliment / médicament / emballage / produit_fini),
  `stock_movement` (porte `lot_id` + `cost` → imputation du coût au lot).
- **Commercial** : `customer`, `sale`, `sale_item`.
- **Finances** : `expense` (`lot_id` *nullable* → permet la marge par lot).
- **Pilotage** : `goal`. Tableau de bord & marges = **vues** (ex. `lot_profitability`).
- **Accès** : `organization` (+ champs de branding), `profile` (`org_id`, `role`).

Enums Postgres :

- `payment_method` : `cash` · `wave` · `orange_money` · `autre`
- `production_category` : `ponte` · `casse` · `consomme` · `recolte`
- `stock_type` : `aliment` · `medicament` · `emballage` · `produit_fini`
- `health_type` : `maladie` · `traitement` · `vaccin` · `mortalite`
- `lot_status` : `actif` · `vendu` · `termine`
- `user_role` : `proprietaire` · `superviseur` (l'enum SQL est nommé `user_role` car `role` est mot-clé Postgres)
- `stock_direction` : `entree` · `sortie`

### Règles métier

- Un `product` peut viser une `species` (œuf ← caille) ou aucune (miel).
- Un `incubation_batch` peut générer un nouveau `lot` à l'éclosion.
- Une vente (`sale`) a plusieurs lignes (`sale_item`) pour permettre plusieurs produits.

#### Produits de la ferme vs produits de négoce (convention, pas de champ en base)

Deux flux **distincts** coexistent dans le catalogue. La distinction n'est pas
matérialisée par une colonne (pour l'instant) — c'est une règle d'usage à respecter
côté UI et conseils utilisateur. Le futur module **Stocks** la formalisera via le
suivi des entrées (achats + récoltes) et des sorties (ventes/consommation).

- **Produits de la ferme** (issus des animaux ou récoltes propres) — ex. œufs, lait, viande.
  - Cycle : `production_record` (recolte/ponte) → `sale` (revente).
  - Marge = `sale.total` − coûts (intrants, santé, dépenses imputées au lot).
- **Produits de négoce** (achetés pour être revendus tels quels) — ex. **miel** dans
  le contexte AGRO ELITE actuel (la ferme l'achète, ne le récolte pas).
  - Cycle : `expense` (catégorie ex. `achat_marchandise`) → `sale` (revente).
  - **JAMAIS** saisi en `production_record` (rien à récolter).
  - Marge = `sale.total` − `expense.amount` pour ces produits.

À garder en tête quand on ajoute de l'UX :
- Les helpers/onboarding de l'écran Production ne doivent pas suggérer le miel
  comme exemple de saisie (ni aucun produit du même flux).
- Les rapports de marge devront tirer leurs coûts de `expenses` pour le négoce,
  et des coûts imputés au lot pour la ferme — ne pas mélanger.

## Conventions

- PK en `uuid` (`gen_random_uuid()`). Colonnes `created_at` / `updated_at` partout ;
  `deleted_at` nullable → **soft delete uniquement**, ne jamais supprimer un historique.
- Tables et colonnes en `snake_case`, noms de tables au pluriel (`lots`, `sales`…).
- Montants stockés en **entiers** (XOF, sans décimales) — jamais de `float`.
- Toujours passer par le RLS : ne jamais le désactiver, ne jamais se reposer sur un filtre
  `org_id` fait seulement côté client.
- **Toute nouvelle table doit recevoir un `GRANT` à `authenticated`** (ou être couverte par les
  `default privileges` posés dans `supabase/migrations/0005_grants.sql`). Sans ce GRANT :
  `permission denied for table …` partout, même avec un RLS correct — le RLS filtre des lignes,
  il n'accorde pas le droit d'accéder à la table.
- Migrations versionnées en SQL dans `supabase/migrations/`. **Jamais** de modification de schéma
  manuelle en prod via l'UI. Même version de Postgres en local et en prod.

## Commandes (à compléter selon le repo)

- `npm run dev` — serveur de dev Vite
- `npm run build` / `npm run preview`
- `npm run typecheck` / `npm run lint`

### Schéma Supabase — workflow actuel (projet hébergé, sans CLI)

Le CLI Supabase **n'est pas installé** et n'est pas requis pour le moment. Le schéma
de prod est appliqué directement via le **SQL Editor du Dashboard**, en collant le
contenu agrégé de `supabase/setup_hosted.sql` (concat ordonnée de `0001` → `0005`).

- Nouvelle évolution du schéma : créer un fichier `supabase/migrations/000X_xxx.sql`
  **et** mettre à jour `supabase/setup_hosted.sql` (ou jouer le delta dans le SQL
  Editor à la main). La numérotation est la source de vérité.
- Types TS : régénération **manuelle** de `src/types/db.ts` à chaque changement de
  schéma, tant que le CLI n'est pas installé.
- Le seed (`supabase/seed.sql`) n'est pas joué sur le projet hébergé — réservé au
  dev local le jour où un stack local sera mis en place.

### Réactiver le CLI plus tard (optionnel)

Si un jour le CLI est installé :
- `supabase link --project-ref <ref>` (mot de passe DB en interactif)
- `supabase db push` — applique les migrations sur le projet lié
- `supabase gen types typescript --linked > src/types/db.ts` — types depuis le distant
- `supabase start` / `supabase db reset` — stack locale Docker (miroir de prod)

## Workflow

- Lancer `typecheck` + `lint` avant de considérer une tâche terminée.
- Régénérer les types DB après chaque migration.
- Commits petits et ciblés ; messages en français acceptés.

## Roadmap — NE PAS sur-construire

Construire la **Phase 1 (MVP)** d'abord ; le reste seulement à la demande explicite.

- **P1 (MVP)** : auth + rôles, catalogue espèces/produits, lots, saisie production journalière,
  ventes + dépenses simples, dashboard minimal, PWA installable, saisie des soldes/stocks d'ouverture.
- **P2** : stocks/intrants + coût par lot, finances complètes (marge par produit), incubation, alertes.
- **P3** : santé/vaccins + rappels, objectifs, rapports exportables (PDF/Excel), offline robuste
  (PowerSync), activation multi-fermes.
- **P4** : analytics/prévisions, commandes clients / e-commerce, traçabilité QR.

## À NE PAS faire

- ❌ Créer un composant, une route ou une table « spécial cailles » ou « spécial miel ».
  Tout passe par le catalogue générique.
- ❌ Suivre les animaux un par un. Toujours par lot.
- ❌ Stocker un total/bénéfice qui se calcule (utiliser une vue).
- ❌ Faire un hard delete. Toujours soft delete.
- ❌ Contourner ou désactiver le RLS.
