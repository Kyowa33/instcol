# 📄 Spécification Technique de Données (Spec Data) — v1.4
**Projet :** Gestion des Inscriptions Paroissiales — Paroisse Saint-Colomban  
**Architecture :** Application Web Statique + Supabase (PostgreSQL, Auth, Edge Functions, RLS)  
**Plan Supabase :** Free Tier  

---

## 1. Dictionnaire de données

### A. Tables de référence & paramétrage (Administration)

#### Table `annee_scolaire`
Gère les périodes scolaires (ex. Septembre 2024 à Juin 2025).
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`) : Identifiant unique
- `libelle` (`varchar(20)`, NOT NULL, UNIQUE) : Libellé (ex. "2024-2025")
- `date_debut` (`date`, NOT NULL) : Date de début (ex. 01/09/2024)
- `date_fin` (`date`, NOT NULL) : Date de fin (ex. 30/06/2025)
- `est_active` (`boolean`, DEFAULT `false`) : Année en cours d'inscription (1 seule active)

#### Table `lieu`
Lieux de déroulement des activités.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`) : Identifiant unique
- `nom` (`varchar(100)`, NOT NULL) : Nom du lieu (ex. "Bailly-Romainvilliers", "Chessy")
- `adresse` (`text`, NULL) : Adresse physique du lieu

#### Table `activite`
Types d'activités proposées par la paroisse.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`) : Identifiant unique
- `code` (`varchar(20)`, NOT NULL, UNIQUE) : Code unique (ex. "EVEIL", "KT", "AUMONERIE")
- `nom` (`varchar(100)`, NOT NULL) : Nom affiché (ex. "Éveil à la foi", "Catéchisme")

#### Table `niveau_scolaire`
Niveaux scolaires autorisés pour les activités.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`) : Identifiant unique
- `code` (`varchar(20)`, NOT NULL, UNIQUE) : Code niveau (ex. "MATERNELLE_CP", "CE2_CM2")
- `libelle` (`varchar(100)`, NOT NULL) : Libellé (ex. "CE2 à CM2")
- `ordre_affichage` (`int`, NOT NULL) : Ordre de tri dans le formulaire

#### Table `creneau_groupe`
Planning des créneaux ouverts par année, lieu et activité.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`) : Identifiant unique
- `annee_scolaire_id` (`uuid`, FK `annee_scolaire.id`, NOT NULL) : Année scolaire rattachée
- `activite_id` (`uuid`, FK `activite.id`, NOT NULL) : Activité dispensée
- `lieu_id` (`uuid`, FK `lieu.id`, NOT NULL) : Lieu de la rencontre
- `jour_semaine` (`varchar(20)`, NOT NULL) : Ex. "Samedi", "Mercredi", "Vendredi"
- `horaire_debut` (`time`, NULL) : Ex. 10:00:00
- `horaire_fin` (`time`, NULL) : Ex. 11:00:00
- `precision_frequence` (`text`, NULL) : Ex. "1 dimanche / mois", "Le vendredi soir"
- `capacite_max` (`int`, NULL) : Capacité indicative pour l'affichage

#### Table `creneau_niveau` (Liaison M:N)
Associe les niveaux scolaires éligibles à chaque créneau.
- `creneau_groupe_id` (`uuid`, FK `creneau_groupe.id`, PK)
- `niveau_scolaire_id` (`uuid`, FK `niveau_scolaire.id`, PK)

#### Table `tarif_activite`
Tarif individuel par enfant lié à une activité pour une année scolaire.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`) : Identifiant unique
- `annee_scolaire_id` (`uuid`, FK `annee_scolaire.id`, NOT NULL) : Année concernée
- `activite_id` (`uuid`, FK `activite.id`, NOT NULL) : Activité rattachée
- `montant` (`numeric(6,2)`, NOT NULL) : Montant par enfant (ex. 5.00 €, 20.00 €)

#### Table `tarif_famille_param`
Frais de dossier fixes applicables à chaque famille sur une année scolaire.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`) : Identifiant unique
- `annee_scolaire_id` (`uuid`, FK `annee_scolaire.id`, NOT NULL, UNIQUE) : Année concernée
- `frais_fixe_famille` (`numeric(6,2)`, NOT NULL) : Frais de dossier (ex. 35.00 €)

---

### B. Table de gestion des utilisateurs & sécurité

#### Table `admin_users`
Référentiel des comptes utilisateurs Supabase Auth habilités à administrer la plateforme.
- `user_id` (`uuid`, PK, FK `auth.users.id` ON DELETE CASCADE) : Identifiant de l'utilisateur authentifié Supabase
- `created_at` (`timestamptz`, DEFAULT `now()`) : Date de création du rôle d'administrateur

---

### C. Tables applicatives (Dossiers d'inscription)

#### Table `famille`
Dossier principal d'inscription d'une famille.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`) : Identifiant du dossier
- `annee_scolaire_id` (`uuid`, FK `annee_scolaire.id`, NOT NULL) : Année de l'inscription
- `code_dossier` (`varchar(20)`, NOT NULL, UNIQUE) : Référence unique (ex. "STC-2024-001")
- `moyen_paiement` (`enum 'CHEQUE', 'ESPECES'`, NOT NULL) : Mode de règlement
- `num_cheque` (`varchar(50)`, NULL) : Numéro de chèque (si applicable)
- `banque_cheque` (`varchar(100)`, NULL) : Banque émettrice (si applicable)
- `montant_total` (`numeric(6,2)`, NOT NULL) : Montant théorique calculé par le formulaire
- `montant_paye` (`numeric(6,2)`, NULL) : Montant réellement encaissé/réglé par l'admin
- `commentaire_famille` (`text`, NULL) : Remarques / questions saisies par la famille
- `commentaire_admin` (`text`, NULL) : Notes et suivi interne réservés aux admins
- `donnees_extra` (`jsonb`, DEFAULT `'{}'::jsonb`) : Champ NoSQL dynamique famille (ex: covoiturage, remarques)
- `statut_paiement` (`enum 'EN_ATTENTE', 'VALIDE'`, DEFAULT `'EN_ATTENTE'`) : Suivi admin
- `date_creation` (`timestamptz`, DEFAULT `now()`) : Date et heure d'inscription

#### Table `responsable_legal`
Coordonnées des parents / responsables légaux.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`) : Identifiant unique
- `famille_id` (`uuid`, FK `famille.id` ON DELETE CASCADE) : Dossier famille rattaché
- `nom` (`varchar(100)`, NOT NULL) : Nom de famille
- `prenom` (`varchar(100)`, NOT NULL) : Prénom
- `adresse` (`text`, NOT NULL) : Adresse postale
- `code_postal` (`varchar(10)`, NOT NULL) : Code postal
- `ville` (`varchar(100)`, NOT NULL) : Ville
- `telephone` (`varchar(20)`, NOT NULL) : Numéro de portable
- `email` (`varchar(150)`, NOT NULL) : Adresse email de contact
- `est_principal` (`boolean`, DEFAULT `true`) : Indique le responsable référent

#### Table `enfant`
Informations sur les enfants inscrits.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`) : Identifiant unique
- `famille_id` (`uuid`, FK `famille.id` ON DELETE CASCADE) : Dossier famille rattaché
- `nom` (`varchar(100)`, NOT NULL) : Nom de l'enfant
- `prenom` (`varchar(100)`, NOT NULL) : Prénom de l'enfant
- `date_naissance` (`date`, NOT NULL) : Date de naissance
- `sexe` (`enum 'M', 'F'`, NOT NULL) : Genre
- `classe_frequentee` (`varchar(50)`, NOT NULL) : Ex. "CE2", "6ème"
- `etablissement` (`varchar(150)`, NOT NULL) : École / Collège / Lycée
- `telephone_enfant` (`varchar(20)`, NULL) : Portable de l'enfant (optionnel)
- `est_baptise` (`boolean`, NOT NULL DEFAULT false) : Baptisé(e) ?
- `est_confirme` (`boolean`, NOT NULL DEFAULT false) : Confirmé(e) ?
- `premiere_communion` (`boolean`, NOT NULL DEFAULT false) : 1ère communion faite ?
- `date_communion` (`date`, NULL) : Date si 1ère communion effectuée
- `donnees_extra` (`jsonb`, DEFAULT `'{}'::jsonb`) : Champ NoSQL dynamique enfant (ex: santé, PAI, allergies)

#### Table `inscription_enfant`
Choix du créneau/groupe pour chaque enfant.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`) : Identifiant unique
- `enfant_id` (`uuid`, FK `enfant.id` ON DELETE CASCADE) : Enfant concerné
- `creneau_groupe_id` (`uuid`, FK `creneau_groupe.id`) : Créneau choisi

#### Table `autorisation_parentale`
Décharge et autorisations légales.
- `id` (`uuid`, PK, DEFAULT `gen_random_uuid()`) : Identifiant unique
- `famille_id` (`uuid`, FK `famille.id` ON DELETE CASCADE, UNIQUE) : 1 décharge par famille
- `autorise_activites` (`boolean`, NOT NULL DEFAULT true) : Autorisation de participation
- `autorise_mesures_medicales` (`boolean`, NOT NULL DEFAULT false) : Mesures médicales d'urgence (ajouté par la migration 0003)
- `consentement_rgpd` (`boolean`, NOT NULL DEFAULT true) : Accord collecte données religieuses
- `droit_image` (`boolean`, NOT NULL DEFAULT false) : Droit à l'image
- `fait_a` (`varchar(100)`, NOT NULL) : Ville de signature
- `date_signature` (`timestamptz`, DEFAULT `now()`) : Horodatage de signature
- `nom_signataire` (`varchar(150)`, NOT NULL) : Prénom + Nom du signataire
- `ip_adresse` (`varchar(45)`, NULL) : Adresse IP pour preuve légale

---

## 2. Script DDL SQL complet (Supabase)

```sql
-- Types énumérés
CREATE TYPE enum_moyen_paiement AS ENUM ('CHEQUE', 'ESPECES');
CREATE TYPE enum_statut_paiement AS ENUM ('EN_ATTENTE', 'VALIDE');
CREATE TYPE enum_sexe AS ENUM ('M', 'F');

-- 1. Tables de paramétrage
CREATE TABLE annee_scolaire (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    libelle VARCHAR(20) NOT NULL UNIQUE,
    date_debut DATE NOT NULL,
    date_fin DATE NOT NULL,
    est_active BOOLEAN DEFAULT false
);

CREATE TABLE lieu (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nom VARCHAR(100) NOT NULL,
    adresse TEXT
);

CREATE TABLE activite (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL UNIQUE,
    nom VARCHAR(100) NOT NULL
);

CREATE TABLE niveau_scolaire (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(20) NOT NULL UNIQUE,
    libelle VARCHAR(100) NOT NULL,
    ordre_affichage INT NOT NULL DEFAULT 0
);

CREATE TABLE creneau_groupe (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    annee_scolaire_id UUID NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    activite_id UUID NOT NULL REFERENCES activite(id) ON DELETE CASCADE,
    lieu_id UUID NOT NULL REFERENCES lieu(id) ON DELETE CASCADE,
    jour_semaine VARCHAR(20) NOT NULL,
    horaire_debut TIME,
    horaire_fin TIME,
    precision_frequence TEXT,
    capacite_max INT
);

CREATE TABLE creneau_niveau (
    creneau_groupe_id UUID REFERENCES creneau_groupe(id) ON DELETE CASCADE,
    niveau_scolaire_id UUID REFERENCES niveau_scolaire(id) ON DELETE CASCADE,
    PRIMARY KEY (creneau_groupe_id, niveau_scolaire_id)
);

CREATE TABLE tarif_activite (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    annee_scolaire_id UUID NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE,
    activite_id UUID NOT NULL REFERENCES activite(id) ON DELETE CASCADE,
    montant NUMERIC(6,2) NOT NULL DEFAULT 0.00,
    CONSTRAINT uq_tarif_activite_annee UNIQUE (annee_scolaire_id, activite_id)
);

CREATE TABLE tarif_famille_param (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    annee_scolaire_id UUID NOT NULL REFERENCES annee_scolaire(id) ON DELETE CASCADE UNIQUE,
    frais_fixe_famille NUMERIC(6,2) NOT NULL DEFAULT 35.00
);

-- 2. Table Administrateurs
CREATE TABLE admin_users (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Tables métier (Dossiers)
CREATE TABLE famille (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    annee_scolaire_id UUID NOT NULL REFERENCES annee_scolaire(id),
    code_dossier VARCHAR(20) NOT NULL UNIQUE,
    moyen_paiement enum_moyen_paiement NOT NULL,
    num_cheque VARCHAR(50),
    banque_cheque VARCHAR(100),
    montant_total NUMERIC(6,2) NOT NULL,
    montant_paye NUMERIC(6,2),
    commentaire_famille TEXT,
    commentaire_admin TEXT,
    donnees_extra JSONB DEFAULT '{}'::jsonb,
    statut_paiement enum_statut_paiement DEFAULT 'EN_ATTENTE',
    date_creation TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE responsable_legal (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    famille_id UUID NOT NULL REFERENCES famille(id) ON DELETE CASCADE,
    nom VARCHAR(100) NOT NULL,
    prenom VARCHAR(100) NOT NULL,
    adresse TEXT NOT NULL,
    code_postal VARCHAR(10) NOT NULL,
    ville VARCHAR(100) NOT NULL,
    telephone VARCHAR(20) NOT NULL,
    email VARCHAR(150) NOT NULL,
    est_principal BOOLEAN DEFAULT true
);

CREATE TABLE enfant (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    famille_id UUID NOT NULL REFERENCES famille(id) ON DELETE CASCADE,
    nom VARCHAR(100) NOT NULL,
    prenom VARCHAR(100) NOT NULL,
    date_naissance DATE NOT NULL,
    sexe enum_sexe NOT NULL,
    classe_frequentee VARCHAR(50) NOT NULL,
    etablissement VARCHAR(150) NOT NULL,
    telephone_enfant VARCHAR(20),
    est_baptise BOOLEAN NOT NULL DEFAULT false,
    est_confirme BOOLEAN NOT NULL DEFAULT false,
    premiere_communion BOOLEAN NOT NULL DEFAULT false,
    date_communion DATE,
    donnees_extra JSONB DEFAULT '{}'::jsonb
);

CREATE TABLE inscription_enfant (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enfant_id UUID NOT NULL REFERENCES enfant(id) ON DELETE CASCADE,
    creneau_groupe_id UUID NOT NULL REFERENCES creneau_groupe(id)
);

CREATE TABLE autorisation_parentale (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    famille_id UUID NOT NULL REFERENCES famille(id) ON DELETE CASCADE UNIQUE,
    autorise_activites BOOLEAN NOT NULL DEFAULT true,
    autorise_mesures_medicales BOOLEAN NOT NULL DEFAULT false,
    consentement_rgpd BOOLEAN NOT NULL DEFAULT true,
    droit_image BOOLEAN NOT NULL DEFAULT false,
    fait_a VARCHAR(100) NOT NULL,
    date_signature TIMESTAMPTZ DEFAULT now(),
    nom_signataire VARCHAR(150) NOT NULL,
    ip_adresse VARCHAR(45)
);
```

---

## 3. Vues SQL pour la Gestion & l'Administration

### A. Vue du décompte des inscrits par créneau
```sql
CREATE OR REPLACE VIEW v_creneaux_disponibles AS
SELECT 
    cg.id AS creneau_id,
    cg.annee_scolaire_id,
    a.code AS activite_code,
    a.nom AS activite_nom,
    l.nom AS lieu_nom,
    cg.jour_semaine,
    cg.horaire_debut,
    cg.horaire_fin,
    cg.precision_frequence,
    cg.capacite_max,
    COUNT(ie.id) AS nombre_inscrits
FROM creneau_groupe cg
JOIN activite a ON cg.activite_id = a.id
JOIN lieu l ON cg.lieu_id = l.id
LEFT JOIN inscription_enfant ie ON ie.creneau_groupe_id = cg.id
GROUP BY cg.id, a.code, a.nom, l.nom;
```

### B. Vue Récapitulative Admin (Suivi financier et dossiers)
```sql
CREATE OR REPLACE VIEW v_admin_suivi_dossiers AS
SELECT 
    f.id AS famille_id,
    f.code_dossier,
    f.date_creation,
    rl.nom AS nom_responsable,
    rl.prenom AS prenom_responsable,
    rl.email,
    rl.telephone,
    f.montant_total,
    COALESCE(f.montant_paye, 0.00) AS montant_paye,
    (f.montant_total - COALESCE(f.montant_paye, 0.00)) AS reste_a_payer,
    f.moyen_paiement,
    f.statut_paiement,
    f.commentaire_famille,
    f.commentaire_admin,
    f.donnees_extra AS famille_donnees_extra,
    COUNT(DISTINCT e.id) AS nombre_enfants
FROM famille f
JOIN responsable_legal rl ON rl.famille_id = f.id AND rl.est_principal = true
LEFT JOIN enfant e ON e.famille_id = f.id
GROUP BY f.id, rl.nom, rl.prenom, rl.email, rl.telephone;
```

---

## 4. Politiques de Sécurité (Row Level Security - RLS)

```sql
ALTER TABLE famille ENABLE ROW LEVEL SECURITY;
ALTER TABLE responsable_legal ENABLE ROW LEVEL SECURITY;
ALTER TABLE enfant ENABLE ROW LEVEL SECURITY;
ALTER TABLE inscription_enfant ENABLE ROW LEVEL SECURITY;
ALTER TABLE autorisation_parentale ENABLE ROW LEVEL SECURITY;
ALTER TABLE creneau_groupe ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarif_activite ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- 1. Accès Public Anonyme (formulaire d'inscription)
CREATE POLICY "Lecture paramétrage public" ON creneau_groupe FOR SELECT TO anon USING (true);
CREATE POLICY "Lecture tarifs public" ON tarif_activite FOR SELECT TO anon USING (true);

CREATE POLICY "Insertion famille anonyme" ON famille FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Insertion responsable anonyme" ON responsable_legal FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Insertion enfant anonyme" ON enfant FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Insertion inscription anonyme" ON inscription_enfant FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Insertion autorisation anonyme" ON autorisation_parentale FOR INSERT TO anon WITH CHECK (true);

-- 2. Accès Administrateur Vérifié (basé sur la table admin_users)
CREATE POLICY "Lecture admin_users pour admins" ON admin_users FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE POLICY "Admin accès total famille" ON famille FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));
CREATE POLICY "Admin accès total responsable" ON responsable_legal FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));
CREATE POLICY "Admin accès total enfant" ON enfant FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));
CREATE POLICY "Admin accès total inscription" ON inscription_enfant FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));
CREATE POLICY "Admin accès total autorisation" ON autorisation_parentale FOR ALL TO authenticated USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));
```

---

## 5. Gestion des Utilisateurs & Mots de Passe (`auth.js`)

La sécurité de l'application statique s'appuie sur le SDK Supabase Client et l'intégration de `Supabase Auth` :

### Flux de Réinitialisation et Sécurité
1. **Connexion Administrateur (`loginAdmin`)** : Authentifie l'e-mail/mot de passe et valide la présence de l'UUID dans la table `admin_users`. Si l'utilisateur n'est pas admin, la session est rejetée.
2. **Réinitialisation par E-mail (`requestPasswordReset`)** : En cas de mot de passe oublié ou compromis, envoie un lien avec jeton de récupération à usage unique vers `/reset-password.html`.
3. **Mise à Jour du Mot de Passe (`updatePassword`)** : Applique le nouveau mot de passe haché en `bcrypt` sur Supabase Auth.
4. **Garde de Navigation (`requireAdminSession`)** : Vérifie la validité du jeton JWT et la correspondance RLS au chargement de chaque page du tableau de bord d'administration.
