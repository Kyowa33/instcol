# 🏛️ Inscriptions Paroissiales — Paroisse Saint-Colomban

Application web **statique** (Bun + TypeScript + Vite) + **Supabase** (PostgreSQL,
Auth, Edge Functions, RLS) pour la gestion des inscriptions à l'éveil à la foi,
au catéchisme et à l'aumônerie.

## Fonctionnalités

**Public (parents)**
- Accueil avec planning des groupes et effets **nombre d'inscrits** (indicatif, jamais bloquant).
- Formulaire en 4 étapes : responsable(s) légal(aux) → enfants (état civil, sacrements,
  niveau, choix des groupes) → frais/paiement (chèque ou espèces) → autorisation + **consentement RGPD**.
- Décompte des frais **calculé automatiquement** (frais de dossier + tarifs par activité),
  puis **revérifié côté serveur** par la fonction `soumettre_inscription()`.
- Brouillon conservé dans le navigateur, dossier référencé `STC-<année>-001`.
- E-mail de confirmation automatique avec **récapitulatif PDF signé** (Edge Function + Resend),
  plus une version imprimable / export PDF depuis la page de confirmation.

**Administrateur (2 comptes partagés)**
- Connexion (`admin_users`), réinitialisation de mot de passe, garde de session.
- Tableau de bord : statistiques, recherche/filtres (**année scolaire** — active par
  défaut — et statut de paiement), export **CSV** (respecte les filtres), détail dossier
  (montant encaissé, statut de paiement, notes internes, suppression).
- **Détail dossier** : modification des informations d'un enfant (état civil,
  sacrements, santé, groupes / créneaux de l'année) et **suppression d'un enfant**,
  avec **recalcul automatique du montant total** du dossier (frais de dossier +
  tarifs des activités, mêmes règles que la RPC d'inscription).
- **Gestion des utilisateurs** (rubrique « Utilisateurs ») : liste des comptes
  admin, **ajout** (e-mail + mot de passe), **réinitialisation de mot de passe**,
  **suppression** — la suppression du compte connecté est **refusée côté serveur**
  (via l'Edge Function `gestion-admins`).
- **Rubrique « Backup »** (technique) : export **SQL gzippé** de toutes les
  données, prêt à être rejoué dans l'éditeur SQL Supabase pour restaurer la
  base. Filtre par année (« Toutes les années » par défaut) : en mode complet,
  le script démarre par un `TRUNCATE` de toutes les tables puis ré-insère tout
  (données seules, **sans DDL**, ordre des clés étrangères respecté ; comptes
  Supabase Auth hors périmètre).
- **Paramétrage 100 % administrable** : années scolaires (une seule active),
  lieux, activités, niveaux, créneaux (+ niveaux éligibles), tarifs par activité,
  frais de dossier. Tout est paramétrable **par année scolaire**.
- **Filtrage par année** sur les onglets paramétrés par année (créneaux, tarifs,
  frais de dossier) : le tableau n'affiche que les éléments de l'année choisie
  (année active par défaut, ou la plus récente — pas de vue « toutes années »).
- **Rubrique « Groupes »** : vue des groupes d'enfants par activité / lieu / jour /
  horaire (enfants inscrits, niveaux, effectif, capacité), filtrable (année — active
  par défaut —, activité, lieu, recherche enfant / code dossier) et **exportable en
  CSV** (une ligne par enfant).
- **Recopie du paramétrage à la création d'une année** : l'administrateur est invité
  (case cochée par défaut) à reprendre créneaux, niveaux éligibles, tarifs et frais de
  dossier de l'année active, puis à ajuster si besoin.

## Démarrage

```bash
bun install
cp .env.example .env        # puis renseigner VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
bun run dev                 # http://localhost:5173
bun run build               # typecheck + build (dist/)
bun run preview
bun run check:sql           # syntaxe SQL (parseur PostgreSQL réel)
bun run test:sql            # exécute les 2 migrations + RPC + RLS sur PostgreSQL (PGlite/WASM)
```

## Mise en place Supabase

1. Créer un projet sur [supabase.com](https://supabase.com) (plan Free).
2. Exécuter dans **SQL Editor**, dans l'ordre :
   - `supabase/migrations/0001_init.sql` (DDL + vues + RLS + fonction RPC)
   - `supabase/migrations/0002_seed.sql` (paramétrage initial repris de la spec)
3. Créer les comptes administrateurs :
   - **Authentication → Users → Add user** (e-mail + mot de passe) pour les 2 administrateurs ;
   - pour chacun, exécuter :
     ```sql
     INSERT INTO admin_users (user_id) VALUES ('<uuid-du-compte>') ON CONFLICT DO NOTHING;
     ```
4. Copier l'**URL du projet** et la **clé anon** dans `.env`.

## E-mail de confirmation (Edge Function)

```bash
supabase functions secrets set RESEND_API_KEY=re_xxx EMAIL_FROM="Paroisse Saint-Colomban <inscriptions@exemple.fr>"
supabase functions deploy envoi-confirmation
```

## Gestion des utilisateurs admin (Edge Function)

La création / réinitialisation / suppression des comptes Supabase Auth exige la
clé `service_role` : elle est réalisée par l'Edge Function `gestion-admins`
(appelée avec le JWT de l'admin connecté, qui doit être présent dans
`admin_users`). La suppression du compte connecté est refusée côté serveur.

```bash
supabase functions deploy gestion-admins
```

La clé `SUPABASE_SERVICE_ROLE_KEY` est déjà fournie automatiquement à l'Edge
Function par Supabase (secret en place via `envoi-confirmation`).

- Le service [Resend](https://resend.com) offre un plan gratuit (100 e-mails/jour).
- Sans ces secrets, l'inscription fonctionne toujours : la page de confirmation
  propose l'impression / l'enregistrement PDF du récapitulatif.
- L'e-mail part **uniquement** vers l'adresse d'un responsable légal du dossier
  (données relues avec la clé `service_role`).

## Déploiement statique

`bun run build` produit le dossier `dist/` — hébergeable sur n'importe quel
serveur statique (Netlify, Vercel, GitHub Pages, Apache…). Le routeur utilise
le **hash** (`#/admin`), aucune réécriture de URL n'est nécessaire.

## Structure

```
supabase/
  migrations/0001_init.sql        DDL + vues + RLS + RPC soumettre_inscription()
  migrations/0002_seed.sql        Année active, 7 lieux, 3 activités, 7 niveaux,
                                  13 créneaux, tarifs 35 € / 5 € / 20 €
  functions/envoi-confirmation/   E-mail + récapitulatif PDF signé (pdf-lib, Resend)
src/
  main.ts  router.ts (hash)  styles.css
  lib/     supabase, types, parametrage, tarifs, session, inscription, format, dom
  pages/   accueil, inscription (assistant 4 étapes), confirmation
  pages/admin/  connexion, dashboard, dossier, parametrage, motdepasse, layout
```

## Notes / hypothèses

- « Villeneuve-le-C. » (spec) interprété comme **Villeneuve-le-Comte** — modifiable
  dans l'espace admin → Paramétrage → Lieux.
- Pas de paiement en ligne (choix explicite de la spec) : chèque ou espèces.
- La jauge par créneau est **affichée mais non bloquante** (choix de la spec).
- `autorisation_parentale.ip_adresse` reste `NULL` côté navigateur (pas de collecte d'IP).
- Les politiques RLS « admin » couvrent aussi les tables de paramétrage
  (complément nécessaire à la spec v1.4 qui ne listait que les tables de dossiers).
