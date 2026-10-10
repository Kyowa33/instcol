// Test d'exécution réel des migrations SQL sur PGlite (PostgreSQL 16 en WASM)
// avec émulation de l'environnement Supabase (rôles anon/authenticated, auth.uid).
// Utilisation : bun run test:sql
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const racine = path.join(import.meta.dir, '..');
const lire = (f: string): Promise<string> =>
  readFile(path.join(racine, 'supabase', 'migrations', f), 'utf8');

let ok = 0;
let ko = 0;
function verifie(condition: boolean, libelle: string): void {
  if (condition) {
    ok += 1;
    console.log(`  PASS  ${libelle}`);
  } else {
    ko += 1;
    console.error(`  FAIL  ${libelle}`);
  }
}

async function compte(db: PGlite, sql: string): Promise<number> {
  const r = await db.query<{ n: number }>(sql);
  return Number(r.rows[0].n);
}

const db = new PGlite();

// --- Émulation de l'environnement Supabase -------------------------------
await db.exec(`
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  END $$;
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`);

console.log('— Migration 0001_init.sql —');
await db.exec(await lire('0001_init.sql'));
console.log('— Migration 0002_seed.sql —');
await db.exec(await lire('0002_seed.sql'));
console.log('— Migration 0003_autorisations_etendues.sql —');
await db.exec(await lire('0003_autorisations_etendues.sql'));

// Privilèges par défaut (équivalent des privileges par defaut Supabase)
await db.exec(`
  GRANT USAGE ON SCHEMA public TO anon, authenticated;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
  GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
`);

console.log('— Seed —');
verifie((await compte(db, 'SELECT count(*)::int n FROM annee_scolaire')) === 1, '1 année scolaire');
verifie(
  (await compte(db, 'SELECT count(*)::int n FROM annee_scolaire WHERE est_active')) === 1,
  '1 année active',
);
verifie((await compte(db, 'SELECT count(*)::int n FROM lieu')) === 7, '7 lieux');
verifie((await compte(db, 'SELECT count(*)::int n FROM activite')) === 3, '3 activités');
verifie((await compte(db, 'SELECT count(*)::int n FROM niveau_scolaire')) === 7, '7 niveaux');
verifie((await compte(db, 'SELECT count(*)::int n FROM creneau_groupe')) === 13, '13 créneaux');
verifie((await compte(db, 'SELECT count(*)::int n FROM creneau_niveau')) === 13, '13 liaisons créneau/niveau');
verifie((await compte(db, 'SELECT count(*)::int n FROM tarif_activite')) === 3, '3 tarifs activité');
verifie(
  (await compte(db, 'SELECT count(*)::int n FROM tarif_famille_param WHERE frais_fixe_famille = 35')) === 1,
  'frais de dossier 35 €',
);

// --- Soumission d'inscription (RPC) en tant que rôle anon ----------------
const creneauRes = await db.query<{ id: string }>(`
  SELECT cg.id
  FROM creneau_groupe cg
  JOIN activite a ON a.id = cg.activite_id
  JOIN creneau_niveau cn ON cn.creneau_groupe_id = cg.id
  JOIN niveau_scolaire n ON n.id = cn.niveau_scolaire_id
  WHERE a.code = 'KT' AND n.code = 'CE2_CM2'
  ORDER BY cg.jour_semaine, cg.horaire_debut
  LIMIT 1`);
const creneauId = creneauRes.rows[0]?.id ?? '';
verifie(creneauId !== '', 'créneau de test trouvé (KT / CE2-CM2)');

const donnees = {
  responsables: [
    {
      nom: 'DURAND', prenom: 'Marie', adresse: '1 rue de la Paix', code_postal: '77120',
      ville: 'Bailly-Romainvilliers', telephone: '0611223344',
      email: 'marie.durand@example.fr', est_principal: true,
    },
  ],
  enfants: [
    {
      prenom: 'Lucas', nom: 'DURAND', date_naissance: '2015-04-12', sexe: 'M',
      classe_frequentee: 'CE2', etablissement: 'Ecole Jules Ferry', telephone_enfant: '',
      est_baptise: true, est_confirme: false, premiere_communion: false, date_communion: '',
      donnees_extra: { sante: 'rien de particulier' }, creneau_ids: [creneauId],
    },
  ],
  moyen_paiement: 'CHEQUE',
  num_cheque: '12345',
  banque_cheque: 'Banque Postale',
  commentaire_famille: 'Test de soumission',
  autorisations: {
    autorise_activites: true, autorise_mesures_medicales: true,
    consentement_rgpd: true, droit_image: true,
    fait_a: 'Bailly-Romainvilliers', nom_signataire: 'Marie DURAND',
  },
};

type Ligne = { res: { code_dossier: string; montant_total: number; email_confirmation: string } };

await db.exec('SET ROLE anon');
const res1 = await db.query<Ligne>('SELECT soumettre_inscription($1::jsonb) AS res', [
  JSON.stringify(donnees),
]);
const inscription1 = res1.rows[0].res;
verifie(inscription1.code_dossier === 'STC-2027-001', `code dossier 1 = ${inscription1.code_dossier}`);
verifie(
  Number(inscription1.montant_total) === 55,
  `frais calculés = ${inscription1.montant_total} € (35 + 20 attendus)`,
);
verifie(inscription1.email_confirmation === 'marie.durand@example.fr', 'e-mail de confirmation renvoyé');
await db.exec('RESET ROLE');

await db.exec('SET ROLE anon');
const res2 = await db.query<Ligne>('SELECT soumettre_inscription($1::jsonb) AS res', [
  JSON.stringify(donnees),
]);
verifie(res2.rows[0].res.code_dossier === 'STC-2027-002', 'code dossier 2 séquencé (concurrence)');
await db.exec('RESET ROLE');

verifie((await compte(db, 'SELECT count(*)::int n FROM famille')) === 2, '2 dossiers famille');
verifie((await compte(db, 'SELECT count(*)::int n FROM responsable_legal')) === 2, '2 responsables');
verifie((await compte(db, 'SELECT count(*)::int n FROM enfant')) === 2, '2 enfants');
verifie((await compte(db, 'SELECT count(*)::int n FROM inscription_enfant')) === 2, '2 inscriptions à un créneau');
verifie(
  (await compte(db, 'SELECT count(*)::int n FROM autorisation_parentale')) === 2,
  '2 autorisations parentales',
);
verifie(
  (await compte(
    db,
    'SELECT count(*)::int n FROM autorisation_parentale WHERE autorise_mesures_medicales',
  )) === 2,
  '2 autorisations avec mesures médicales enregistrées',
);
verifie(
  (await compte(db, 'SELECT count(*)::int n FROM v_creneaux_disponibles WHERE nombre_inscrits > 0')) === 1,
  'décompte public : 1 créneau pourvu',
);

// Rejets attendus
await db.exec('SET ROLE anon');
try {
  const refuse = JSON.parse(JSON.stringify(donnees)) as Record<string, unknown>;
  (refuse.autorisations as Record<string, unknown>).consentement_rgpd = false;
  await db.query('SELECT soumettre_inscription($1::jsonb) AS res', [JSON.stringify(refuse)]);
  verifie(false, 'RGPD absent => rejet');
} catch (e) {
  verifie(String(e).includes('RGPD'), 'RGPD absent => rejet');
}
try {
  const sansMedical = JSON.parse(JSON.stringify(donnees)) as Record<string, unknown>;
  (sansMedical.autorisations as Record<string, unknown>).autorise_mesures_medicales = false;
  await db.query('SELECT soumettre_inscription($1::jsonb) AS res', [JSON.stringify(sansMedical)]);
  verifie(false, 'mesures médicales refusées => rejet');
} catch (e) {
  verifie(String(e).includes('mesures médicales'), 'mesures médicales refusées => rejet');
}
try {
  const sansDroitImage = JSON.parse(JSON.stringify(donnees)) as Record<string, unknown>;
  (sansDroitImage.autorisations as Record<string, unknown>).droit_image = false;
  await db.query('SELECT soumettre_inscription($1::jsonb) AS res', [JSON.stringify(sansDroitImage)]);
  verifie(false, 'droit à l’image refusé => rejet');
} catch (e) {
  verifie(String(e).includes('diffusion'), 'droit à l’image refusé => rejet');
}
try {
  const sansGroupe = JSON.parse(JSON.stringify(donnees)) as Record<string, unknown>;
  (sansGroupe.enfants as Record<string, unknown>[])[0].creneau_ids = [];
  await db.query('SELECT soumettre_inscription($1::jsonb) AS res', [JSON.stringify(sansGroupe)]);
  verifie(false, 'enfant sans groupe => rejet');
} catch (e) {
  verifie(String(e).includes('creneau'), 'enfant sans groupe => rejet');
}
await db.exec('RESET ROLE');

// --- RLS & administration ------------------------------------------------
const adminRow = await db.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
const adminId = adminRow.rows[0].id;
await db.query('INSERT INTO admin_users (user_id) VALUES ($1)', [adminId]);
const autreRow = await db.query<{ id: string }>('INSERT INTO auth.users DEFAULT VALUES RETURNING id');
const autreId = autreRow.rows[0].id;

await db.exec('SET ROLE authenticated');
await db.exec(`SET request.jwt.claim.sub = '${adminId}'`);
verifie(
  (await compte(db, 'SELECT count(*)::int n FROM v_admin_suivi_dossiers')) === 2,
  'vue admin : l administrateur voit les 2 dossiers',
);
verifie((await compte(db, 'SELECT count(*)::int n FROM famille')) === 2, 'admin lit la table famille');
const maj = await db.query<{ id: string }>(
  "UPDATE famille SET commentaire_admin = 'note interne' RETURNING id",
);
verifie(maj.rows.length === 2, 'admin peut modifier les dossiers');

await db.exec(`SET request.jwt.claim.sub = '${autreId}'`);
verifie(
  (await compte(db, 'SELECT count(*)::int n FROM v_admin_suivi_dossiers')) === 0,
  'compte non admin : vue vide',
);
verifie((await compte(db, 'SELECT count(*)::int n FROM famille')) === 0, 'compte non admin : famille vide');
const refus = await db.query<{ id: string }>(
  "UPDATE famille SET commentaire_admin = 'hack' RETURNING id",
);
verifie(refus.rows.length === 0, 'compte non admin ne peut rien modifier');
await db.exec('RESET ROLE');
await db.exec('RESET request.jwt.claim.sub');

await db.exec('SET ROLE anon');
verifie(
  (await compte(db, 'SELECT count(*)::int n FROM creneau_groupe')) === 13,
  'anon lit le paramétrage (créneaux)',
);
verifie(
  (await compte(db, 'SELECT count(*)::int n FROM v_creneaux_disponibles')) === 13,
  'anon lit les compteurs publics',
);
verifie((await compte(db, 'SELECT count(*)::int n FROM famille')) === 0, 'anon ne voit AUCUN dossier');
const vol = await db.query<{ id: string }>('UPDATE famille SET montant_paye = 0 RETURNING id');
verifie(vol.rows.length === 0, 'anon ne peut rien modifier');
await db.exec('RESET ROLE');

console.log(`\n${ok} réussite(s), ${ko} échec(s)`);
await db.close();
process.exit(ko ? 1 : 0);


