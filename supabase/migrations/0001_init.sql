-- ============================================================================
-- Gestion des Inscriptions Paroissiales — Paroisse Saint-Colomban
-- Migration 0001 : Schéma complet (spécification data v1.4)
--   1. Types énumérés                5. Vues SQL
--   2. Tables de paramétrage         6. Row Level Security
--   3. Administrateurs               7. Fonction soumettre_inscription()
--   4. Tables applicatives
-- À exécuter dans l'éditeur SQL du projet Supabase AVANT la migration 0002_seed.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Types énumérés
-- ----------------------------------------------------------------------------
CREATE TYPE enum_moyen_paiement AS ENUM ('CHEQUE', 'ESPECES');
CREATE TYPE enum_statut_paiement AS ENUM ('EN_ATTENTE', 'VALIDE');
CREATE TYPE enum_sexe AS ENUM ('M', 'F');

-- ----------------------------------------------------------------------------
-- 2. Tables de paramétrage (100 % administrables, par année scolaire)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 3. Administrateurs (2 comptes partageant la même vue des données)
-- ----------------------------------------------------------------------------
CREATE TABLE admin_users (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 4. Tables applicatives (dossiers d'inscription)
-- ----------------------------------------------------------------------------
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
    consentement_rgpd BOOLEAN NOT NULL DEFAULT true,
    droit_image BOOLEAN NOT NULL DEFAULT false,
    fait_a VARCHAR(100) NOT NULL,
    date_signature TIMESTAMPTZ DEFAULT now(),
    nom_signataire VARCHAR(150) NOT NULL,
    ip_adresse VARCHAR(45)
);

-- Index (performances)
CREATE INDEX idx_famille_annee       ON famille(annee_scolaire_id);
CREATE INDEX idx_responsable_famille ON responsable_legal(famille_id);
CREATE INDEX idx_enfant_famille      ON enfant(famille_id);
CREATE INDEX idx_inscription_enfant  ON inscription_enfant(enfant_id);
CREATE INDEX idx_inscription_creneau ON inscription_enfant(creneau_groupe_id);
CREATE INDEX idx_creneau_annee       ON creneau_groupe(annee_scolaire_id);

-- ----------------------------------------------------------------------------
-- 5. Vues SQL
-- ----------------------------------------------------------------------------
-- Fonction utilitaire : TRUE si l'utilisateur connecté est un administrateur.
-- (Créée AVANT les vues qui l'utilisent ; SECURITY DEFINER => lecture de
--  admin_users indépendante du RLS de l'appelant.)
CREATE OR REPLACE FUNCTION public.est_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM admin_users WHERE user_id = auth.uid()
    );
$$;

-- A. Décompte des inscrits par créneau.
CREATE VIEW v_creneaux_disponibles
WITH (security_invoker = true) AS
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

GRANT SELECT ON v_creneaux_disponibles TO anon, authenticated;

-- B. Vue récapitulative admin (suivi financier et dossiers).
--    Sécurité double : security_invoker (RLS de l'appelant) + WHERE est_admin().
CREATE VIEW v_admin_suivi_dossiers
WITH (security_invoker = true) AS
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
    ams.libelle AS annee_scolaire,
    COUNT(DISTINCT e.id) AS nombre_enfants
FROM famille f
JOIN annee_scolaire ams ON ams.id = f.annee_scolaire_id
JOIN responsable_legal rl ON rl.famille_id = f.id AND rl.est_principal = true
LEFT JOIN enfant e ON e.famille_id = f.id
WHERE est_admin()
GROUP BY f.id, rl.nom, rl.prenom, rl.email, rl.telephone, ams.libelle;

GRANT SELECT ON v_admin_suivi_dossiers TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Row Level Security
-- ----------------------------------------------------------------------------
ALTER TABLE annee_scolaire         ENABLE ROW LEVEL SECURITY;
ALTER TABLE lieu                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE activite               ENABLE ROW LEVEL SECURITY;
ALTER TABLE niveau_scolaire        ENABLE ROW LEVEL SECURITY;
ALTER TABLE creneau_groupe         ENABLE ROW LEVEL SECURITY;
ALTER TABLE creneau_niveau         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarif_activite         ENABLE ROW LEVEL SECURITY;
ALTER TABLE tarif_famille_param    ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users            ENABLE ROW LEVEL SECURITY;
ALTER TABLE famille                ENABLE ROW LEVEL SECURITY;
ALTER TABLE responsable_legal      ENABLE ROW LEVEL SECURITY;
ALTER TABLE enfant                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE inscription_enfant     ENABLE ROW LEVEL SECURITY;
ALTER TABLE autorisation_parentale ENABLE ROW LEVEL SECURITY;

-- 6.1 Accès public anonyme (formulaire d'inscription) — lecture du paramétrage
CREATE POLICY "Lecture annee_scolaire publique" ON annee_scolaire      FOR SELECT TO anon USING (true);
CREATE POLICY "Lecture lieu publique"           ON lieu                FOR SELECT TO anon USING (true);
CREATE POLICY "Lecture activite publique"       ON activite            FOR SELECT TO anon USING (true);
CREATE POLICY "Lecture niveau publique"         ON niveau_scolaire     FOR SELECT TO anon USING (true);
CREATE POLICY "Lecture paramétrage public"      ON creneau_groupe      FOR SELECT TO anon USING (true);
CREATE POLICY "Lecture niveaux créneau public"  ON creneau_niveau      FOR SELECT TO anon USING (true);
CREATE POLICY "Lecture tarifs public"           ON tarif_activite      FOR SELECT TO anon USING (true);
CREATE POLICY "Lecture tarif famille public"    ON tarif_famille_param FOR SELECT TO anon USING (true);

-- Insertions anonymes (le parcours standard passe par la fonction
-- soumettre_inscription() — SECURITY DEFINER — mais les politiques de la
-- spécification sont conservées pour autoriser des parcours alternatifs).
CREATE POLICY "Insertion famille anonyme"      ON famille                FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Insertion responsable anonyme"  ON responsable_legal      FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Insertion enfant anonyme"       ON enfant                 FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Insertion inscription anonyme"  ON inscription_enfant     FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Insertion autorisation anonyme" ON autorisation_parentale FOR INSERT TO anon WITH CHECK (true);

-- 6.2 Administrateurs
CREATE POLICY "Lecture admin_users pour admins"
    ON admin_users FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Accès total pour les comptes présents dans admin_users (les 2 administrateurs
-- partagent exactement la même vue des données). Étendu à toutes les tables,
-- paramétrage compris (non couvert par la spécification v1.4).
CREATE POLICY "Admin accès total annee_scolaire"  ON annee_scolaire         FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());
CREATE POLICY "Admin accès total lieu"            ON lieu                   FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());
CREATE POLICY "Admin accès total activite"        ON activite               FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());
CREATE POLICY "Admin accès total niveau"          ON niveau_scolaire        FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());
CREATE POLICY "Admin accès total creneau"         ON creneau_groupe         FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());
CREATE POLICY "Admin accès total creneau_niveau"  ON creneau_niveau         FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());
CREATE POLICY "Admin accès total tarif_activite"  ON tarif_activite         FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());
CREATE POLICY "Admin accès total tarif_famille"   ON tarif_famille_param    FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());
CREATE POLICY "Admin accès total admin_users"     ON admin_users            FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());
CREATE POLICY "Admin accès total famille"         ON famille                FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());
CREATE POLICY "Admin accès total responsable"     ON responsable_legal      FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());
CREATE POLICY "Admin accès total enfant"          ON enfant                 FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());
CREATE POLICY "Admin accès total inscription"     ON inscription_enfant     FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());
CREATE POLICY "Admin accès total autorisation"    ON autorisation_parentale FOR ALL TO authenticated USING (est_admin()) WITH CHECK (est_admin());

-- ----------------------------------------------------------------------------
-- 7. Fonction applicative : soumettre_inscription()
--    - insertion atomique de tout le dossier (famille + responsables +
--      enfants + créneaux + autorisation) dans une seule transaction
--    - calcul SERVEUR des frais à partir de tarif_famille_param / tarif_activite
--    - génération du code dossier "STC-<année>-001" sous verrou advisory
--      (2 soumissions simultanées => pas de collision de code)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.soumettre_inscription(p_donnees JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_annee        annee_scolaire%ROWTYPE;
    v_famille_id   UUID;
    v_enfant_id    UUID;
    v_code         TEXT;
    v_n            INT;
    v_frais_fixe   NUMERIC(6,2) := 0;
    v_montant      NUMERIC(6,2) := 0;
    v_tarif        NUMERIC(6,2);
    v_resp         RECORD;
    v_enfant       RECORD;
    v_aut          JSONB;
    v_creneau_ids  UUID[];
    v_activites    UUID[];
    v_act_id       UUID;
    v_creneau      creneau_groupe%ROWTYPE;
    v_email        TEXT;
BEGIN
    -- 1. Année scolaire active (seule source de vérité pour les inscriptions)
    SELECT * INTO v_annee
      FROM annee_scolaire
     WHERE est_active IS TRUE
     ORDER BY date_debut DESC
     LIMIT 1;
    IF v_annee.id IS NULL THEN
        RAISE EXCEPTION 'Les inscriptions sont fermées : aucune année scolaire active.';
    END IF;

    -- 2. Validations minimales
    v_aut := COALESCE(p_donnees -> 'autorisations', '{}'::jsonb);
    IF NOT COALESCE((v_aut ->> 'consentement_rgpd')::boolean, false) THEN
        RAISE EXCEPTION 'Le consentement RGPD est obligatoire.';
    END IF;
    IF jsonb_array_length(COALESCE(p_donnees -> 'responsables', '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Au moins un responsable légal est requis.';
    END IF;
    IF jsonb_array_length(COALESCE(p_donnees -> 'enfants', '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'Au moins un enfant doit être inscrit.';
    END IF;
    IF COALESCE(p_donnees ->> 'moyen_paiement', '') NOT IN ('CHEQUE', 'ESPECES') THEN
        RAISE EXCEPTION 'Moyen de paiement invalide.';
    END IF;

    -- 3. Frais de dossier fixes (paramétrés par année, ex. 35 €)
    SELECT COALESCE(tfp.frais_fixe_famille, 0)
      INTO v_frais_fixe
      FROM tarif_famille_param tfp
     WHERE tfp.annee_scolaire_id = v_annee.id;
    IF NOT FOUND THEN
        v_frais_fixe := 0;
    END IF;
    v_montant := v_frais_fixe;

    -- 4. Tarifs par enfant : somme des tarifs des activités DISTINCTES choisies
    --    (« 5 € par enfant inscrit à l'éveil », « 20 € par enfant au
    --     catéchisme/aumônerie », sans double comptage si 2 créneaux
    --     appartiennent à la même activité)
    FOR v_enfant IN SELECT value AS e FROM jsonb_array_elements(p_donnees -> 'enfants') LOOP
        SELECT ARRAY(
            SELECT cg.id
              FROM creneau_groupe cg
             WHERE cg.id IN (
                   SELECT (x.value)::uuid
                     FROM jsonb_array_elements_text(v_enfant.e -> 'creneau_ids') AS x(value)
             )
        ) INTO v_creneau_ids;

        IF COALESCE(array_length(v_creneau_ids, 1), 0) = 0 THEN
            RAISE EXCEPTION 'Chaque enfant doit avoir au moins un groupe/creneau.';
        END IF;

        v_activites := '{}'::uuid[];
        FOR v_creneau IN SELECT * FROM creneau_groupe WHERE id = ANY (v_creneau_ids) LOOP
            IF v_creneau.annee_scolaire_id <> v_annee.id THEN
                RAISE EXCEPTION 'Un créneau choisi ne fait pas partie de l''année scolaire active.';
            END IF;
            IF NOT (v_creneau.activite_id = ANY (v_activites)) THEN
                v_activites := array_append(v_activites, v_creneau.activite_id);
            END IF;
        END LOOP;

        FOREACH v_act_id IN ARRAY v_activites LOOP
            SELECT ta.montant INTO v_tarif
              FROM tarif_activite ta
             WHERE ta.annee_scolaire_id = v_annee.id
               AND ta.activite_id = v_act_id;
            v_montant := v_montant + COALESCE(v_tarif, 0);
        END LOOP;
    END LOOP;

    -- 5. Code dossier unique "STC-<année de début>-001" (verrou serialisant)
    PERFORM pg_advisory_xact_lock(hashtext('code_dossier_' || v_annee.id::text));
    SELECT COUNT(*) + 1 INTO v_n FROM famille WHERE annee_scolaire_id = v_annee.id;
    v_code := 'STC-' || to_char(v_annee.date_debut, 'YYYY') || '-' || lpad(v_n::text, 3, '0');

    -- 6. Insertion du dossier principal
    INSERT INTO famille (
        annee_scolaire_id, code_dossier, moyen_paiement, num_cheque, banque_cheque,
        montant_total, commentaire_famille, donnees_extra, statut_paiement
    ) VALUES (
        v_annee.id,
        v_code,
        (p_donnees ->> 'moyen_paiement')::enum_moyen_paiement,
        NULLIF(trim(COALESCE(p_donnees ->> 'num_cheque', '')), ''),
        NULLIF(trim(COALESCE(p_donnees ->> 'banque_cheque', '')), ''),
        v_montant,
        NULLIF(trim(COALESCE(p_donnees ->> 'commentaire_famille', '')), ''),
        COALESCE(p_donnees -> 'donnees_extra', '{}'::jsonb),
        'EN_ATTENTE'
    ) RETURNING id INTO v_famille_id;

    -- 7. Responsables légaux
    FOR v_resp IN SELECT value AS r FROM jsonb_array_elements(p_donnees -> 'responsables') LOOP
        IF COALESCE(v_resp.r ->> 'nom', '') = ''
           OR COALESCE(v_resp.r ->> 'prenom', '') = ''
           OR COALESCE(v_resp.r ->> 'email', '') = '' THEN
            RAISE EXCEPTION 'Responsable légal : nom, prénom et e-mail sont obligatoires.';
        END IF;
        INSERT INTO responsable_legal (
            famille_id, nom, prenom, adresse, code_postal, ville,
            telephone, email, est_principal
        ) VALUES (
            v_famille_id,
            trim(v_resp.r ->> 'nom'),
            trim(v_resp.r ->> 'prenom'),
            trim(v_resp.r ->> 'adresse'),
            trim(v_resp.r ->> 'code_postal'),
            trim(v_resp.r ->> 'ville'),
            trim(v_resp.r ->> 'telephone'),
            lower(trim(v_resp.r ->> 'email')),
            COALESCE((v_resp.r ->> 'est_principal')::boolean, false)
        );
    END LOOP;

    -- 8. Enfants + créneaux choisis
    FOR v_enfant IN SELECT value AS e FROM jsonb_array_elements(p_donnees -> 'enfants') LOOP
        IF COALESCE(v_enfant.e ->> 'prenom', '') = '' OR COALESCE(v_enfant.e ->> 'nom', '') = '' THEN
            RAISE EXCEPTION 'État civil : prénom et nom obligatoires pour chaque enfant.';
        END IF;
        IF (v_enfant.e ->> 'sexe') NOT IN ('M', 'F') THEN
            RAISE EXCEPTION 'Sexe invalide pour l''enfant %.', v_enfant.e ->> 'prenom';
        END IF;

        INSERT INTO enfant (
            famille_id, nom, prenom, date_naissance, sexe, classe_frequentee,
            etablissement, telephone_enfant, est_baptise, est_confirme,
            premiere_communion, date_communion, donnees_extra
        ) VALUES (
            v_famille_id,
            trim(v_enfant.e ->> 'nom'),
            trim(v_enfant.e ->> 'prenom'),
            (v_enfant.e ->> 'date_naissance')::date,
            (v_enfant.e ->> 'sexe')::enum_sexe,
            trim(v_enfant.e ->> 'classe_frequentee'),
            trim(v_enfant.e ->> 'etablissement'),
            NULLIF(trim(COALESCE(v_enfant.e ->> 'telephone_enfant', '')), ''),
            COALESCE((v_enfant.e ->> 'est_baptise')::boolean, false),
            COALESCE((v_enfant.e ->> 'est_confirme')::boolean, false),
            COALESCE((v_enfant.e ->> 'premiere_communion')::boolean, false),
            NULLIF(trim(COALESCE(v_enfant.e ->> 'date_communion', '')), '')::date,
            COALESCE(v_enfant.e -> 'donnees_extra', '{}'::jsonb)
        ) RETURNING id INTO v_enfant_id;

        FOR v_creneau IN
            SELECT cg.* FROM creneau_groupe cg
             WHERE cg.id IN (
                   SELECT (x.value)::uuid
                     FROM jsonb_array_elements_text(v_enfant.e -> 'creneau_ids') AS x(value)
             )
        LOOP
            INSERT INTO inscription_enfant (enfant_id, creneau_groupe_id)
            VALUES (v_enfant_id, v_creneau.id);
        END LOOP;
    END LOOP;

    -- 9. Autorisation parentale (1 par famille)
    INSERT INTO autorisation_parentale (
        famille_id, autorise_activites, consentement_rgpd, droit_image,
        fait_a, nom_signataire, ip_adresse
    ) VALUES (
        v_famille_id,
        COALESCE((v_aut ->> 'autorise_activites')::boolean, true),
        COALESCE((v_aut ->> 'consentement_rgpd')::boolean, false),
        COALESCE((v_aut ->> 'droit_image')::boolean, false),
        NULLIF(trim(COALESCE(v_aut ->> 'fait_a', '')), ''),
        NULLIF(trim(COALESCE(v_aut ->> 'nom_signataire', '')), ''),
        NULLIF(trim(COALESCE(v_aut ->> 'ip_adresse', '')), '')
    );

    SELECT lower(trim(rl.email))
      INTO v_email
      FROM responsable_legal rl
     WHERE rl.famille_id = v_famille_id
     ORDER BY rl.est_principal DESC
     LIMIT 1;

    RETURN jsonb_build_object(
        'famille_id', v_famille_id,
        'code_dossier', v_code,
        'montant_total', v_montant,
        'annee_libelle', v_annee.libelle,
        'email_confirmation', v_email
    );
END;
$$;

REVOKE ALL ON FUNCTION public.soumettre_inscription(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soumettre_inscription(JSONB) TO anon, authenticated;





