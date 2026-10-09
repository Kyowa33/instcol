// Types reflétant le dictionnaire de données de la spécification v1.4.

export type Sexe = 'M' | 'F';
export type MoyenPaiement = 'CHEQUE' | 'ESPECES';
export type StatutPaiement = 'EN_ATTENTE' | 'VALIDE';

export interface AnneeScolaire {
  id: string;
  libelle: string;
  date_debut: string;
  date_fin: string;
  est_active: boolean;
}

export interface Lieu {
  id: string;
  nom: string;
  adresse: string | null;
}

export interface Activite {
  id: string;
  code: string;
  nom: string;
}

export interface NiveauScolaire {
  id: string;
  code: string;
  libelle: string;
  ordre_affichage: number;
}

export interface CreneauGroupe {
  id: string;
  annee_scolaire_id: string;
  activite_id: string;
  lieu_id: string;
  jour_semaine: string;
  horaire_debut: string | null;
  horaire_fin: string | null;
  precision_frequence: string | null;
  capacite_max: number | null;
}

export interface CreneauNiveau {
  creneau_groupe_id: string;
  niveau_scolaire_id: string;
}

export interface TarifActivite {
  id: string;
  annee_scolaire_id: string;
  activite_id: string;
  montant: number;
}

export interface TarifFamilleParam {
  id: string;
  annee_scolaire_id: string;
  frais_fixe_famille: number;
}

export interface Famille {
  id: string;
  annee_scolaire_id: string;
  code_dossier: string;
  moyen_paiement: MoyenPaiement;
  num_cheque: string | null;
  banque_cheque: string | null;
  montant_total: number;
  montant_paye: number | null;
  commentaire_famille: string | null;
  commentaire_admin: string | null;
  donnees_extra: Record<string, unknown>;
  statut_paiement: StatutPaiement;
  date_creation: string;
}

export interface ResponsableLegal {
  id: string;
  famille_id: string;
  nom: string;
  prenom: string;
  adresse: string;
  code_postal: string;
  ville: string;
  telephone: string;
  email: string;
  est_principal: boolean;
}

export interface Enfant {
  id: string;
  famille_id: string;
  nom: string;
  prenom: string;
  date_naissance: string;
  sexe: Sexe;
  classe_frequentee: string;
  etablissement: string;
  telephone_enfant: string | null;
  est_baptise: boolean;
  est_confirme: boolean;
  premiere_communion: boolean;
  date_communion: string | null;
  donnees_extra: Record<string, unknown>;
}

export interface InscriptionEnfant {
  id: string;
  enfant_id: string;
  creneau_groupe_id: string;
}

export interface AutorisationParentale {
  id: string;
  famille_id: string;
  autorise_activites: boolean;
  autorise_mesures_medicales: boolean;
  consentement_rgpd: boolean;
  droit_image: boolean;
  fait_a: string;
  date_signature: string;
  nom_signataire: string;
  ip_adresse: string | null;
}

/** Ligne de la vue publique v_creneaux_disponibles (+ niveaux rejoints côté client). */
export interface CreneauDispo {
  creneau_id: string;
  annee_scolaire_id: string;
  activite_code: string;
  activite_nom: string;
  lieu_nom: string;
  jour_semaine: string;
  horaire_debut: string | null;
  horaire_fin: string | null;
  precision_frequence: string | null;
  capacite_max: number | null;
  nombre_inscrits: number;
}

/** Ligne de la vue admin v_admin_suivi_dossiers. */
export interface DossierSuivi {
  famille_id: string;
  code_dossier: string;
  date_creation: string;
  nom_responsable: string;
  prenom_responsable: string;
  email: string;
  telephone: string;
  montant_total: number;
  montant_paye: number;
  reste_a_payer: number;
  moyen_paiement: MoyenPaiement;
  statut_paiement: StatutPaiement;
  commentaire_famille: string | null;
  commentaire_admin: string | null;
  famille_donnees_extra: Record<string, unknown>;
  annee_scolaire: string;
  nombre_enfants: number;
}
