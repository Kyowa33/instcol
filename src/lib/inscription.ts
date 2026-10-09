import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from './supabase';
import type { MoyenPaiement, Sexe } from './types';

export const CLE_BROUILLON = 'instcol_brouillon';
export const CLE_CONFIRMATION = 'instcol_confirmation';

export interface EtatResponsable {
  id: string;
  nom: string;
  prenom: string;
  adresse: string;
  code_postal: string;
  ville: string;
  telephone: string;
  email: string;
  est_principal: boolean;
}

export interface EtatEnfant {
  id: string;
  prenom: string;
  nom: string;
  date_naissance: string;
  sexe: Sexe | '';
  classe_frequentee: string;
  etablissement: string;
  telephone_enfant: string;
  est_baptise: boolean;
  est_confirme: boolean;
  premiere_communion: boolean;
  date_communion: string;
  niveau_id: string;
  creneau_ids: string[];
  sante: string;
}

export interface EtatAutorisation {
  autorise_activites: boolean;
  autorise_mesures_medicales: boolean;
  consentement_rgpd: boolean;
  droit_image: boolean;
  fait_a: string;
  nom_signataire: string;
}

export interface EtatInscription {
  etape: number;
  responsables: EtatResponsable[];
  enfants: EtatEnfant[];
  moyen_paiement: MoyenPaiement | '';
  num_cheque: string;
  banque_cheque: string;
  commentaire_famille: string;
  autorisation: EtatAutorisation;
}

export function nouvelId(): string {
  return crypto.randomUUID();
}

export function etatVide(): EtatInscription {
  return {
    etape: 1,
    responsables: [
      {
        id: nouvelId(), nom: '', prenom: '', adresse: '', code_postal: '',
        ville: '', telephone: '', email: '', est_principal: true,
      },
    ],
    enfants: [],
    moyen_paiement: '',
    num_cheque: '',
    banque_cheque: '',
    commentaire_famille: '',
    autorisation: {
      autorise_activites: false,
      autorise_mesures_medicales: false,
      consentement_rgpd: false,
      droit_image: false,
      fait_a: '',
      nom_signataire: '',
    },
  };
}

export function nouveauEnfant(): EtatEnfant {
  return {
    id: nouvelId(), prenom: '', nom: '', date_naissance: '', sexe: '',
    classe_frequentee: '', etablissement: '', telephone_enfant: '',
    est_baptise: false, est_confirme: false, premiere_communion: false,
    date_communion: '', niveau_id: '', creneau_ids: [], sante: '',
  };
}

/** Brouillon local : le formulaire survit à un rafraîchissement de page. */
export function sauverBrouillon(etat: EtatInscription): void {
  try {
    sessionStorage.setItem(CLE_BROUILLON, JSON.stringify(etat));
  } catch {
    /* stockage indisponible */
  }
}

export function chargerBrouillon(): EtatInscription | null {
  try {
    const brut = sessionStorage.getItem(CLE_BROUILLON);
    return brut ? (JSON.parse(brut) as EtatInscription) : null;
  } catch {
    return null;
  }
}

export function effacerBrouillon(): void {
  try {
    sessionStorage.removeItem(CLE_BROUILLON);
  } catch {
    /* ignoré */
  }
}

/** Payload attendu par la fonction SQL soumettre_inscription(). */
export function construirePayload(etat: EtatInscription): Record<string, unknown> {
  return {
    responsables: etat.responsables.map((r) => ({
      nom: r.nom.trim(),
      prenom: r.prenom.trim(),
      adresse: r.adresse.trim(),
      code_postal: r.code_postal.trim(),
      ville: r.ville.trim(),
      telephone: r.telephone.trim(),
      email: r.email.trim().toLowerCase(),
      est_principal: r.est_principal,
    })),
    enfants: etat.enfants.map((e) => ({
      prenom: e.prenom.trim(),
      nom: e.nom.trim(),
      date_naissance: e.date_naissance,
      sexe: e.sexe,
      classe_frequentee: e.classe_frequentee.trim(),
      etablissement: e.etablissement.trim(),
      telephone_enfant: e.telephone_enfant.trim(),
      est_baptise: e.est_baptise,
      est_confirme: e.est_confirme,
      premiere_communion: e.premiere_communion,
      date_communion: e.premiere_communion ? e.date_communion : '',
      donnees_extra: { sante: e.sante.trim() },
      creneau_ids: e.creneau_ids,
    })),
    moyen_paiement: etat.moyen_paiement,
    num_cheque: etat.num_cheque.trim(),
    banque_cheque: etat.banque_cheque.trim(),
    commentaire_famille: etat.commentaire_famille.trim(),
    autorisations: {
      autorise_activites: etat.autorisation.autorise_activites,
      autorise_mesures_medicales: etat.autorisation.autorise_mesures_medicales,
      consentement_rgpd: etat.autorisation.consentement_rgpd,
      droit_image: etat.autorisation.droit_image,
      fait_a: etat.autorisation.fait_a.trim(),
      nom_signataire: etat.autorisation.nom_signataire.trim(),
    },
  };
}

export interface ResultatSoumission {
  famille_id: string;
  code_dossier: string;
  montant_total: number;
  annee_libelle: string;
  email_confirmation: string | null;
  emailEnvoye: boolean;
  emailErreur?: string;
}

/**
 * Soumission atomique via RPC (les frais sont revérifiés côté serveur à partir
 * des tarifs), puis déclenchement best-effort de l'e-mail de confirmation.
 */
export async function soumettreInscription(etat: EtatInscription): Promise<ResultatSoumission> {
  const { data, error } = await supabase.rpc('soumettre_inscription', {
    p_donnees: construirePayload(etat),
  });
  if (error) throw new Error(error.message);

  const res = data as {
    famille_id: string;
    code_dossier: string;
    montant_total: number;
    annee_libelle: string;
    email_confirmation: string | null;
  };

  let emailEnvoye = false;
  let emailErreur: string | undefined;
  try {
    const rep = await fetch(`${SUPABASE_URL}/functions/v1/envoi-confirmation`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ famille_id: res.famille_id, code_dossier: res.code_dossier }),
    });
    const json = (await rep.json()) as { ok?: boolean; erreur?: string };
    emailEnvoye = Boolean(json.ok);
    emailErreur = json.erreur;
  } catch {
    emailErreur = "Service d'e-mail injoignable — le récapitulatif reste imprimable.";
  }

  return { ...res, emailEnvoye, emailErreur };
}

