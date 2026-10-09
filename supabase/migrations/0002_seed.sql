-- ============================================================================
-- Migration 0002 : Paramétrage initial (repris à l'identique des tableaux de
-- la spécification fonctionnelle). Idempotent : ré-exécutable.
-- ============================================================================

-- 1. Année scolaire active (septembre A -> juin A+1)
INSERT INTO annee_scolaire (libelle, date_debut, date_fin, est_active)
VALUES ('2027-2028', DATE '2027-09-01', DATE '2028-06-30', true)
ON CONFLICT (libelle)
DO UPDATE SET date_debut = EXCLUDED.date_debut,
              date_fin   = EXCLUDED.date_fin;

-- 2. Lieux (colonnes du tableau de planning ; "Villeneuve-le-C." interprété
--    comme Villeneuve-le-Comte — modifiable depuis le paramétrage admin)
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT * FROM (VALUES
            ('Bailly-Romainvilliers', NULL::text),
            ('Chessy',                NULL::text),
            ('Magny-le-Hongre',       NULL::text),
            ('Serris',                NULL::text),
            ('Villeneuve-le-Comte',   NULL::text),
            ('Coupvray',              NULL::text),
            ('Institution Saint-Colomban', NULL::text)
        ) AS t(nom, adresse)
    LOOP
        IF NOT EXISTS (SELECT 1 FROM lieu WHERE nom = r.nom) THEN
            INSERT INTO lieu (nom, adresse) VALUES (r.nom, r.adresse);
        END IF;
    END LOOP;
END $$;

-- 3. Activités
INSERT INTO activite (code, nom) VALUES
    ('EVEIL',     'Éveil à la foi'),
    ('KT',        'Catéchisme (KT)'),
    ('AUMONERIE', 'Aumônerie')
ON CONFLICT (code) DO UPDATE SET nom = EXCLUDED.nom;

-- 4. Niveaux scolaires (ordre d'affichage dans le formulaire)
INSERT INTO niveau_scolaire (code, libelle, ordre_affichage) VALUES
    ('MATERNELLE_CP',      'Maternelle - CP', 1),
    ('CE1',                'CE1',             2),
    ('CE2_CM2',            'CE2 à CM2',       3),
    ('SIXIEME',            '6ème',            4),
    ('CINQUIEME',          '5ème',            5),
    ('QUATRIEME_TROISIEME','4ème / 3ème',     6),
    ('LYCEE',              'Lycéen',          7)
ON CONFLICT (code) DO UPDATE SET libelle         = EXCLUDED.libelle,
                                 ordre_affichage = EXCLUDED.ordre_affichage;

-- 5. Créneaux / groupes de l'année active (tableau « Planning » de la spec)
DO $$
DECLARE
    v_annee uuid;
    r       record;
    v_act   uuid;
    v_lieu  uuid;
    v_cr    uuid;
    n       text;
BEGIN
    SELECT id INTO v_annee
      FROM annee_scolaire
     WHERE est_active IS TRUE
     ORDER BY date_debut DESC
     LIMIT 1;
    IF v_annee IS NULL THEN
        RAISE NOTICE 'Aucune année scolaire active : créneaux non semés.';
        RETURN;
    END IF;

    FOR r IN
        SELECT * FROM (VALUES
            -- Catéchisme CE1 (Bailly-Romainvilliers uniquement)
            ('KT',        'Bailly-Romainvilliers',      'Samedi',    '10:00'::text, '11:00'::text, NULL::text, ARRAY['CE1']),
            -- Catéchisme CE2 à CM2 (toutes les colonies)
            ('KT',        'Bailly-Romainvilliers',      'Mercredi',  '11:00'::text, '12:00'::text, NULL::text, ARRAY['CE2_CM2']),
            ('KT',        'Bailly-Romainvilliers',      'Samedi',    '10:00'::text, '11:00'::text, NULL::text, ARRAY['CE2_CM2']),
            ('KT',        'Chessy',                     'Mercredi',  '17:30'::text, '19:00'::text, NULL::text, ARRAY['CE2_CM2']),
            ('KT',        'Magny-le-Hongre',             'Samedi',    '10:00'::text, '11:00'::text, NULL::text, ARRAY['CE2_CM2']),
            ('KT',        'Serris',                     'Mercredi',  '17:00'::text, '18:00'::text, NULL::text, ARRAY['CE2_CM2']),
            ('KT',        'Villeneuve-le-Comte',        'Mercredi',  '09:45'::text, '10:45'::text, NULL::text, ARRAY['CE2_CM2']),
            ('KT',        'Coupvray',                   'Samedi',    '10:00'::text, '11:00'::text, NULL::text, ARRAY['CE2_CM2']),
            -- Catéchisme 6ème
            ('KT',        'Bailly-Romainvilliers',      'Vendredi',  '17:30'::text, '18:30'::text, NULL::text, ARRAY['SIXIEME']),
            -- Aumôneries (vendredi soir à l'institution Saint-Colomban)
            ('AUMONERIE', 'Institution Saint-Colomban', 'Vendredi',  NULL,          NULL,          'Le vendredi soir', ARRAY['CINQUIEME']),
            ('AUMONERIE', 'Institution Saint-Colomban', 'Vendredi',  NULL,          NULL,          'Le vendredi soir', ARRAY['QUATRIEME_TROISIEME']),
            ('AUMONERIE', 'Institution Saint-Colomban', 'Vendredi',  NULL,          NULL,          'Le vendredi soir', ARRAY['LYCEE']),
            -- Éveil à la foi (maternelle - CP)
            ('EVEIL',     'Bailly-Romainvilliers',      'Dimanche',  '16:00'::text, '17:00'::text, '1 dimanche / mois (église de Bailly en exception)', ARRAY['MATERNELLE_CP'])
        ) AS t(activite, lieu, jour, debut, fin, freq, niveaux)
    LOOP
        SELECT id INTO v_act  FROM activite WHERE code = r.activite;
        SELECT id INTO v_lieu FROM lieu     WHERE nom  = r.lieu;
        CONTINUE WHEN v_act IS NULL OR v_lieu IS NULL;

        FOREACH n IN ARRAY r.niveaux LOOP
            -- Deux créneaux ne sont identiques que s'ils partagent aussi leur
            -- niveau : « Samedi 10h — CE1 » reste donc distinct de
            -- « Samedi 10h — CE2 à CM2 » (même horaire, groupes différents).
            SELECT cg.id INTO v_cr
              FROM creneau_groupe cg
              JOIN creneau_niveau cn ON cn.creneau_groupe_id = cg.id
              JOIN niveau_scolaire ns ON ns.id = cn.niveau_scolaire_id
             WHERE cg.annee_scolaire_id = v_annee
               AND cg.activite_id       = v_act
               AND cg.lieu_id           = v_lieu
               AND cg.jour_semaine      = r.jour
               AND cg.horaire_debut IS NOT DISTINCT FROM r.debut::time
               AND cg.horaire_fin    IS NOT DISTINCT FROM r.fin::time
               AND cg.precision_frequence IS NOT DISTINCT FROM r.freq
               AND ns.code = n;

            IF v_cr IS NULL THEN
                INSERT INTO creneau_groupe (
                    annee_scolaire_id, activite_id, lieu_id, jour_semaine,
                    horaire_debut, horaire_fin, precision_frequence
                ) VALUES (
                    v_annee, v_act, v_lieu, r.jour,
                    r.debut::time, r.fin::time, r.freq
                ) RETURNING id INTO v_cr;
            END IF;

            INSERT INTO creneau_niveau (creneau_groupe_id, niveau_scolaire_id)
            SELECT v_cr, id FROM niveau_scolaire WHERE code = n
            ON CONFLICT DO NOTHING;
        END LOOP;
    END LOOP;
END $$;

-- 6. Tarifs de l'année active : 35 €/famille + 5 € (éveil) + 20 € (KT/aumônerie)
DO $$
DECLARE
    v_annee uuid;
    r       record;
    v_act   uuid;
BEGIN
    SELECT id INTO v_annee
      FROM annee_scolaire
     WHERE est_active IS TRUE
     ORDER BY date_debut DESC
     LIMIT 1;
    IF v_annee IS NULL THEN
        RAISE NOTICE 'Aucune année scolaire active : tarifs non semés.';
        RETURN;
    END IF;

    INSERT INTO tarif_famille_param (annee_scolaire_id, frais_fixe_famille)
    VALUES (v_annee, 35.00)
    ON CONFLICT (annee_scolaire_id)
    DO UPDATE SET frais_fixe_famille = EXCLUDED.frais_fixe_famille;

    FOR r IN
        SELECT * FROM (VALUES
            ('EVEIL',     5.00::numeric),
            ('KT',        20.00::numeric),
            ('AUMONERIE', 20.00::numeric)
        ) AS t(code, montant)
    LOOP
        SELECT id INTO v_act FROM activite WHERE code = r.code;
        CONTINUE WHEN v_act IS NULL;

        INSERT INTO tarif_activite (annee_scolaire_id, activite_id, montant)
        VALUES (v_annee, v_act, r.montant)
        ON CONFLICT (annee_scolaire_id, activite_id)
        DO UPDATE SET montant = EXCLUDED.montant;
    END LOOP;
END $$;


