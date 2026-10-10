import { siErreur, supabase } from './supabase';

type Ligne = Record<string, unknown>;

interface TableBackup {
  table: string;
  colonnes: string[];
  /** Clé composite (ON CONFLICT DO NOTHING) ; sinon la PK « id ». */
  cleComposite?: string[];
}

/**
 * Tables de données (hors DDL), dans l'ordre d'INSERTion : les dépendances
 * de clés étrangères sont toujours créées après leur parent.
 * `admin_users` est exclue : sa FK référence auth.users, gérée par Supabase
 * (comptes hors périmètre de ce backup).
 */
const TABLES: TableBackup[] = [
  { table: 'lieu', colonnes: ['id', 'nom', 'adresse'] },
  { table: 'activite', colonnes: ['id', 'code', 'nom'] },
  { table: 'niveau_scolaire', colonnes: ['id', 'code', 'libelle', 'ordre_affichage'] },
  {
    table: 'annee_scolaire',
    colonnes: ['id', 'libelle', 'date_debut', 'date_fin', 'est_active'],
  },
  {
    table: 'creneau_groupe',
    colonnes: [
      'id', 'annee_scolaire_id', 'activite_id', 'lieu_id', 'jour_semaine',
      'horaire_debut', 'horaire_fin', 'precision_frequence', 'capacite_max',
    ],
  },
  {
    table: 'creneau_niveau',
    colonnes: ['creneau_groupe_id', 'niveau_scolaire_id'],
    cleComposite: ['creneau_groupe_id', 'niveau_scolaire_id'],
  },
  { table: 'tarif_activite', colonnes: ['id', 'annee_scolaire_id', 'activite_id', 'montant'] },
  { table: 'tarif_famille_param', colonnes: ['id', 'annee_scolaire_id', 'frais_fixe_famille'] },
  {
    table: 'famille',
    colonnes: [
      'id', 'annee_scolaire_id', 'code_dossier', 'moyen_paiement', 'num_cheque',
      'banque_cheque', 'montant_total', 'montant_paye', 'commentaire_famille',
      'commentaire_admin', 'donnees_extra', 'statut_paiement', 'date_creation',
    ],
  },
  {
    table: 'responsable_legal',
    colonnes: [
      'id', 'famille_id', 'nom', 'prenom', 'adresse', 'code_postal', 'ville',
      'telephone', 'email', 'est_principal',
    ],
  },
  {
    table: 'enfant',
    colonnes: [
      'id', 'famille_id', 'nom', 'prenom', 'date_naissance', 'sexe', 'classe_frequentee',
      'etablissement', 'telephone_enfant', 'est_baptise', 'est_confirme',
      'premiere_communion', 'date_communion', 'donnees_extra',
    ],
  },
  { table: 'inscription_enfant', colonnes: ['id', 'enfant_id', 'creneau_groupe_id'] },
  {
    table: 'autorisation_parentale',
    colonnes: [
      'id', 'famille_id', 'autorise_activites', 'autorise_mesures_medicales',
      'consentement_rgpd', 'droit_image', 'fait_a', 'date_signature', 'nom_signataire',
      'ip_adresse',
    ],
  },
];

/** Tables du TRUNCATE (restauration complète), ordre inverse pour la lisibilité. */
const TABLES_TRUNCATE = [...TABLES.map((t) => t.table)].reverse();

/** Tables rattachées à une année (filtre par annee_scolaire_id). */
const TABLES_PAR_ANNEE = new Set([
  'annee_scolaire', 'creneau_groupe', 'tarif_activite', 'tarif_famille_param', 'famille',
]);

/** Charge une table entière par pagination (limite PostgREST = 1000 par requête). */
async function chargerTable(table: string): Promise<Ligne[]> {
  const TAILLE = 1000;
  const lignes: Ligne[] = [];
  for (let debut = 0; ; debut += TAILLE) {
    const lot = siErreur(
      await supabase.from(table).select('*').range(debut, debut + TAILLE - 1),
    ) as Ligne[];
    lignes.push(...lot);
    if (lot.length < TAILLE) break;
  }
  return lignes;
}

/** Sérialise une valeur SQL (NULL, booléens, nombres, chaînes, jsonb). */
function valeurSql(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `'${s.replace(/'/g, "''")}'`;
}

/** Génère les INSERT (lots de 500 lignes) pour une table. */
function blocsInsert(t: TableBackup, lignes: Ligne[]): string[] {
  if (!lignes.length) return [];
  const conflit = t.cleComposite
    ? `ON CONFLICT (${t.cleComposite.join(', ')}) DO NOTHING`
    : // Rejeu idempotent : la ligne existante est écrasée par le backup.
      `ON CONFLICT (id) DO UPDATE SET ${t.colonnes
        .filter((c) => c !== 'id')
        .map((c) => `${c} = EXCLUDED.${c}`)
        .join(', ')}`;
  const morceaux: string[] = [];
  const TAILLE = 500;
  for (let i = 0; i < lignes.length; i += TAILLE) {
    const valeurs = lignes
      .slice(i, i + TAILLE)
      .map((l) => `(${t.colonnes.map((c) => valeurSql(l[c])).join(', ')})`)
      .join(',\n');
    morceaux.push(
      `INSERT INTO ${t.table} (${t.colonnes.join(', ')})\nVALUES\n${valeurs}\n${conflit};`,
    );
  }
  return morceaux;
}

export interface ResultatBackup {
  /** Nom de fichier .sql.gz */
  nomFichier: string;
  /** Contenu SQL non compressé (utile pour afficher un aperçu / test). */
  sql: string;
  nombreLignes: number;
}

/**
 * Génère un script SQL de sauvegarde des données (sans DDL), prêt à être
 * rejoué dans l'éditeur SQL Supabase :
 * - « Toutes les années » : commence par TRUNCATE de toutes les tables de
 *   données (restauration complète), puis INSERT ;
 * - une année précise : INSERT uniquement (données de l'année + tables de
 *   référence), avec ON CONFLICT pour un rejeu sûr.
 * Les comptes Supabase Auth (auth.users / admin_users) ne sont pas inclus.
 */
export async function genererBackup(
  anneeId: string | null,
  libelleAnnee: string,
): Promise<ResultatBackup> {
  const donnees = new Map<string, Ligne[]>();
  const idsCreneau = new Set<string>();
  const idsFamille = new Set<string>();
  const idsEnfant = new Set<string>();
  let nombreLignes = 0;

  // Ordre de TABLES = ordre des dépendances : les sets d'ids sont remplis
  // avant les filtres qui en dépendent.
  for (const t of TABLES) {
    let lignes = await chargerTable(t.table);
    if (anneeId) {
      if (TABLES_PAR_ANNEE.has(t.table)) {
        lignes = lignes.filter((l) => l.annee_scolaire_id === anneeId);
      } else if (t.table === 'creneau_niveau') {
        lignes = lignes.filter((l) => idsCreneau.has(String(l.creneau_groupe_id)));
      } else if (t.table === 'responsable_legal' || t.table === 'enfant' || t.table === 'autorisation_parentale') {
        lignes = lignes.filter((l) => idsFamille.has(String(l.famille_id)));
      } else if (t.table === 'inscription_enfant') {
        lignes = lignes.filter(
          (l) =>
            idsEnfant.has(String(l.enfant_id)) && idsCreneau.has(String(l.creneau_groupe_id)),
        );
      }
    }
    for (const l of lignes) {
      if (t.table === 'creneau_groupe') idsCreneau.add(String(l.id));
      else if (t.table === 'famille') idsFamille.add(String(l.id));
      else if (t.table === 'enfant') idsEnfant.add(String(l.id));
    }
    donnees.set(t.table, lignes);
    nombreLignes += lignes.length;
  }

  const maintenant = new Date();
  const horodatage = `${String(maintenant.getDate()).padStart(2, '0')}/${String(maintenant.getMonth() + 1).padStart(2, '0')}/${maintenant.getFullYear()} ${String(maintenant.getHours()).padStart(2, '0')}:${String(maintenant.getMinutes()).padStart(2, '0')}`;
  const complet = anneeId === null;

  const entete = [
    '-- ============================================================================',
    `-- Backup instcol — export généré le ${horodatage}`,
    `-- Filtre : ${complet ? 'Toutes les années (restauration complète)' : `Année ${libelleAnnee} (données de l'année + référence)`}`,
    '-- Contient les DONNÉES uniquement (sans DDL) : le schéma doit être conforme',
    '-- aux migrations 0001-0003. Les comptes Supabase Auth (auth.users /',
    '-- admin_users) ne sont pas inclus (gérés par Supabase).',
    '-- Restauration : exécuter ce fichier dans l\'éditeur SQL Supabase.',
    '-- ============================================================================',
    'BEGIN;',
    '',
  ];

  const nettoyage = complet
    ? [
        '-- 1. Nettoyage (restauration complète)',
        `TRUNCATE TABLE`,
        `  ${TABLES_TRUNCATE.join(', ')};`,
        '',
      ]
    : [`-- 1. Pas de TRUNCATE : export limité à l'année « ${libelleAnnee} »`, ''];

  const inserts: string[] = [];
  for (const t of TABLES) {
    const lignes = donnees.get(t.table) ?? [];
    inserts.push(
      `-- 2. Table ${t.table} (${lignes.length} ligne${lignes.length > 1 ? 's' : ''})`,
      ...blocsInsert(t, lignes),
      '',
    );
  }

  const sql = [...entete, ...nettoyage, ...inserts, 'COMMIT;', ''].join('\n');
  const base = complet
    ? 'toutes-les-annees'
    : (libelleAnnee || 'annee').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  return {
    nomFichier: `backup-instcol-${base}-${maintenant.toISOString().slice(0, 10)}.sql.gz`,
    sql,
    nombreLignes,
  };
}

/** Compresse en gzip (CompressionStream, navigateurs récents). null si absent. */
export async function gzip(texte: string): Promise<Blob | null> {
  const CS = (
    globalThis as {
      CompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array>;
    }
  ).CompressionStream;
  if (!CS) return null;
  const flux = new Blob([texte]).stream().pipeThrough(new CS('gzip'));
  return await new Response(flux).blob();
}