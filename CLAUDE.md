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

Deux flux **distincts** coexistent dans le catalogue. La distinction est purement
**conventionnelle** (métier) — pas matérialisée par une colonne. Elle s'applique à
**tout** produit, sans liste codée en dur.

- **Produits de la ferme** (issus des animaux ou récoltes propres) — ex. œufs,
  lait, viande.
  - Cycle : `production_record` (recolte/ponte) → `sale` (revente).
  - Marge = `sale.total` − coûts (intrants, santé, dépenses imputées au lot).
- **Produits de négoce** = TOUT produit ACHETÉ pour être REVENDU, quel qu'il soit :
  miel, mangue, oignon, riz, fournitures, etc. **Le miel n'est qu'un exemple parmi
  d'autres** — aucune logique en dur par nom de produit.
  - Cycle : `expense` (catégorie « achat marchandise ») + entrée `stock_movements`
    → `sale` (revente, sortie `stock_movements`).
  - **JAMAIS** saisi en `production_record` (rien à récolter).
  - Marge = somme des `sale.total` − somme des `expense.amount` pour ces produits.

À garder en tête quand on ajoute de l'UX :
- Les helpers/onboarding de l'écran Production ne doivent pas suggérer un produit
  de négoce comme exemple de saisie.
- Les rapports de marge tirent leurs coûts de `expenses` pour le négoce, et des
  coûts imputés au lot pour la ferme — ne pas mélanger les sources.

#### Stocks vs Cash — anti double-comptage

Le **cash** (et le bénéfice mensuel lu via `v_financial_summary`) provient
EXCLUSIVEMENT de `sales` (entrées) et `expenses` (sorties). Les `stock_movements`
servent à suivre les **quantités physiques** et le **coût par lot** (rapport
analytique via `v_lot_overview`), **jamais à recompter le cash**.

Règles pour ne JAMAIS double-compter :

- **Achat d'un intrant** = 1 `stock_movement` (`direction='entree'`) **+** 1
  `expense` reliés par `expenses.stock_item_id`. Même évènement, compté **une
  seule fois** côté cash (via l'`expense`).
- **Consommation vers un lot** = 1 `stock_movement` (`direction='sortie'`) avec
  `lot_id` + `cost`. **Aucune nouvelle dépense** : le cash est déjà sorti au moment
  de l'achat. Le `cost` sert uniquement à l'imputation analytique au lot.
- **Vente d'un produit fini** = 1 `stock_movement` (`direction='sortie'`) + 1
  `sale`. Le revenu cash apparaît une seule fois via `sale.total`.

**Ne JAMAIS** additionner `stock_movements.cost` avec `expenses.amount` dans un
calcul de bénéfice. Les vues `v_financial_summary` et `v_lot_overview` respectent
déjà ce principe — ne pas le casser côté UI.

**Le bénéfice mensuel doit rester INCHANGÉ après une consommation vers un lot.**
Seul le coût du lot bouge. C'est le juge de paix de la cohérence comptable.

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
