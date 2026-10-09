import type { Parametrage } from './parametrage';

export interface EnfantAvecCreneaux {
  prenom: string;
  nom: string;
  creneauIds: string[];
}

export interface LigneFrais {
  libelle: string;
  montant: number;
}

export interface DecompteFrais {
  lignes: LigneFrais[];
  total: number;
}

/**
 * Décompte des frais d'inscription (spec) :
 *   frais de dossier fixes (35 €/famille, paramétrés)
 *   + tarif activité × nombre d'enfants inscrits à cette activité
 *     (5 € par enfant à l'éveil, 20 € par enfant au catéchisme/aumônerie)
 * Un enfant n'est compté qu'une fois par activité même s'il choisit 2 créneaux.
 */
export function calculerFrais(p: Parametrage, enfants: EnfantAvecCreneaux[]): DecompteFrais {
  const lignes: LigneFrais[] = [];
  let total = 0;

  lignes.push({ libelle: 'Frais de dossier (par famille)', montant: p.fraisFixeFamille });
  total += p.fraisFixeFamille;

  const nbParActivite = new Map<string, number>();
  for (const e of enfants) {
    const vus = new Set<string>();
    for (const cid of e.creneauIds) {
      const cr = p.creneaux.find((c) => c.id === cid);
      if (!cr || vus.has(cr.activite_id)) continue;
      vus.add(cr.activite_id);
      nbParActivite.set(cr.activite_id, (nbParActivite.get(cr.activite_id) ?? 0) + 1);
    }
  }

  for (const act of p.activites) {
    const nb = nbParActivite.get(act.id) ?? 0;
    if (!nb) continue;
    const montant = p.tarifs[act.id] ?? 0;
    lignes.push({
      libelle: `${act.nom} — ${nb} enfant${nb > 1 ? 's' : ''} × ${montant.toFixed(2)} €`,
      montant: montant * nb,
    });
    total += montant * nb;
  }

  return { lignes, total };
}
