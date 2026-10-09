-- ------------------------------------------------------------------------------
-- 0003 : Autorisations étendues (étape 4 du formulaire public)
--
-- La décharge parentale compte désormais 4 consentements OBLIGATOIRES :
--   1. participation aux activités        -> autorise_activites (existant)
--   2. mesures médicales d'urgence        -> autorise_mesures_medicales (NOUVEAU)
--   3. diffusion photos / vidéos          -> droit_image (existant)
--   4. utilisation des coordonnées (RGPD) -> consentement_rgpd (existant)
--
-- La fonction soumettre_inscription() est recréée pour :
--   - contrôler les 4 consentements côté serveur (défense en profondeur),
--   - persister la nouvelle colonne.
-- ------------------------------------------------------------------------------

ALTER TABLE autorisation_parentale
    ADD COLUMN IF NOT EXISTS autorise_mesures_medicales BOOLEAN NOT NULL DEFAULT false;

DROP FUNCTION IF EXISTS public.soumettre_inscription(JSONB);

CREATE FUNCTION public.soumettre_inscription(p_donnees JSONB)
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
    IF NOT COALESCE((v_aut ->> 'autorise_activites')::boolean, false) THEN
        RAISE EXCEPTION 'L''autorisation de participation aux activités est obligatoire.';
    END IF;
    IF NOT COALESCE((v_aut ->> 'autorise_mesures_medicales')::boolean, false) THEN
        RAISE EXCEPTION 'L''autorisation des mesures médicales d''urgence est obligatoire.';
    END IF;
    IF NOT COALESCE((v_aut ->> 'droit_image')::boolean, false) THEN
        RAISE EXCEPTION 'L''autorisation de diffusion (photos / vidéos) est obligatoire.';
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
        famille_id, autorise_activites, autorise_mesures_medicales,
        consentement_rgpd, droit_image, fait_a, nom_signataire, ip_adresse
    ) VALUES (
        v_famille_id,
        COALESCE((v_aut ->> 'autorise_activites')::boolean, false),
        COALESCE((v_aut ->> 'autorise_mesures_medicales')::boolean, false),
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
