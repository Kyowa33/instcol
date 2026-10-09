import { siErreur, supabase } from './supabase';
import type {
  Activite,
  AnneeScolaire,
  CreneauDispo,
  CreneauGroupe,
  Lieu,
  NiveauScolaire,
  TarifFamilleParam,
} from './types';

export interface CreneauAvecNiveaux extends CreneauGroupe {
  /** ids de niveau_scolaire éligibles (table creneau_niveau) */
  niveaux: string[];
}

export interface Parametrage {
  annee: AnneeScolaire;
  lieux: Lieu[];
  activites: Activite[];
  niveaux: NiveauScolaire[];
  creneaux: CreneauAvecNiveaux[];
  /** activite_id -> montant par enfant */
  tarifs: Record<string, number>;
  fraisFixeFamille: number;
  /** décomptes publics (vue v_creneaux_disponibles) */
  dispos: CreneauDispo[];
}

let cache: Promise<Parametrage> | null = null;

/** Charge (et met en cache) le paramétrage de l'année scolaire active. */
export function chargerParametrage(): Promise<Parametrage> {
  if (!cache) cache = charger();
  return cache;
}

/** À appeler après une modification côté admin. */
export function oublierParametrage(): void {
  cache = null;
}

async function charger(): Promise<Parametrage> {
  const annees = siErreur(
    await supabase
      .from('annee_scolaire')
      .select('*')
      .eq('est_active', true)
      .order('date_debut', { ascending: false })
      .limit(1),
  ) as AnneeScolaire[];
  const annee = annees[0];
  if (!annee) {
    throw new Error(
      "Aucune année scolaire active : les inscriptions sont fermées. " +
        "Connectez-vous à l'espace admin pour activer une année.",
    );
  }

  const lieux = siErreur(await supabase.from('lieu').select('*').order('nom')) as Lieu[];
  const activites = siErreur(await supabase.from('activite').select('*').order('nom')) as Activite[];
  const niveaux = siErreur(
    await supabase.from('niveau_scolaire').select('*').order('ordre_affichage'),
  ) as NiveauScolaire[];

  const creneaux = siErreur(
    await supabase
      .from('creneau_groupe')
      .select('*')
      .eq('annee_scolaire_id', annee.id)
      .order('jour_semaine'),
  ) as CreneauGroupe[];

  const ids = creneaux.map((c) => c.id);
  const liaisons = ids.length
    ? siErreur(await supabase.from('creneau_niveau').select('*').in('creneau_groupe_id', ids))
    : [];
  const niveauxParCreneau = new Map<string, string[]>();
  for (const l of liaisons as { creneau_groupe_id: string; niveau_scolaire_id: string }[]) {
    const liste = niveauxParCreneau.get(l.creneau_groupe_id) ?? [];
    liste.push(l.niveau_scolaire_id);
    niveauxParCreneau.set(l.creneau_groupe_id, liste);
  }

  const tarifsBruts = siErreur(
    await supabase.from('tarif_activite').select('*').eq('annee_scolaire_id', annee.id),
  ) as { activite_id: string; montant: number }[];
  const tarifs: Record<string, number> = {};
  for (const t of tarifsBruts) tarifs[t.activite_id] = Number(t.montant);

  const tfp = siErreur(
    await supabase
      .from('tarif_famille_param')
      .select('*')
      .eq('annee_scolaire_id', annee.id)
      .maybeSingle(),
  ) as TarifFamilleParam | null;

  const dispos = siErreur(
    await supabase.from('v_creneaux_disponibles').select('*').eq('annee_scolaire_id', annee.id),
  ) as CreneauDispo[];

  const avecNiveaux: CreneauAvecNiveaux[] = creneaux.map((c) => ({
    ...c,
    niveaux: niveauxParCreneau.get(c.id) ?? [],
  }));

  return {
    annee,
    lieux,
    activites,
    niveaux,
    creneaux: avecNiveaux,
    tarifs,
    fraisFixeFamille: Number(tfp?.frais_fixe_famille ?? 0),
    dispos,
  };
}
