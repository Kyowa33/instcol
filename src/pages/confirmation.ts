import { echappe } from '../lib/dom';
import { euros, horodatageFr } from '../lib/format';
import { CLE_CONFIRMATION } from '../lib/inscription';
import { barreNavigation, enteteHeros } from './entete';

export interface DonneesConfirmation {
  code_dossier: string;
  annee_libelle: string;
  montant_total: number;
  email: string | null;
  emailEnvoye: boolean;
  emailErreur?: string;
  moyen_paiement: string;
  paiement_detail: string;
  responsable: string;
  coordonnees: string;
  commentaire: string;
  decompte: { libelle: string; montant: number }[];
  enfants: { identite: string; detail: string; groupes: string[] }[];
  signature: { fait_a: string; nom: string };
  date: string;
}

function lireConfirmation(): DonneesConfirmation | null {
  try {
    const brut = sessionStorage.getItem(CLE_CONFIRMATION);
    return brut ? (JSON.parse(brut) as DonneesConfirmation) : null;
  } catch {
    return null;
  }
}

export function rendreConfirmation(racine: HTMLElement): void {
  const c = lireConfirmation();
  if (!c) {
    racine.innerHTML = `${barreNavigation('inscription')}
      ${enteteHeros('Confirmation', 'Votre inscription à la Paroisse Saint-Colomban')}
      <div class="conteneur conteneur-etroit"><div class="carte">
        <h2>Aucune inscription à afficher</h2>
        <p>Le récapitulatif n'est plus disponible dans cette session (il vous a été
        envoyé par e-mail).</p>
        <p><a class="btn btn-primaire" href="#/inscription">Refaire une inscription</a></p>
      </div></div>`;
    return;
  }

  const statut = c.emailEnvoye
    ? `<div class="carte succes-palette">
         <h2>Inscription enregistrée — e-mail envoyé</h2>
         <p>Un e-mail de confirmation avec le récapitulatif PDF signé a été envoyé à
         <strong>${echappe(c.email ?? '')}</strong>.</p>
       </div>`
    : `<div class="carte encadre">
         <h2>Inscription enregistrée</h2>
         <p>L'e-mail de confirmation n'a pas pu être envoyé${
           c.emailErreur ? ` (${echappe(c.emailErreur)})` : ''
         }. Vous pouvez imprimer ou enregistrer le récapitulatif ci-dessous.</p>
       </div>`;

  const enfants = c.enfants
    .map(
      (e) => `<div class="ligne-info"><strong>${echappe(e.identite)}</strong>
        <span>${echappe(e.detail)}<br/>${e.groupes.map(echappe).join('<br/>')}</span></div>`,
    )
    .join('');

  const decompte = c.decompte
    .map((l) => `<tr><td>${echappe(l.libelle)}</td><td>${euros(l.montant)}</td></tr>`)
    .join('');

  racine.innerHTML = `${barreNavigation('inscription')}
    ${enteteHeros('Confirmation d\'inscription', `Dossier ${echappe(c.code_dossier)}`)}
    <div class="conteneur conteneur-etroit">
      ${statut}
      <div class="carte" id="recapitulatif">
        <h2>Récapitulatif d'inscription</h2>
        <div class="ligne-info"><strong>Dossier</strong><span>${echappe(c.code_dossier)}</span></div>
        <div class="ligne-info"><strong>Année scolaire</strong><span>${echappe(c.annee_libelle)}</span></div>
        <div class="ligne-info"><strong>Date</strong><span>${horodatageFr(c.date)}</span></div>
        <div class="ligne-info"><strong>Responsable légal</strong><span>${echappe(c.responsable)}<br/>${echappe(c.coordonnees)}</span></div>
        <div class="ligne-info"><strong>E-mail de contact</strong><span>${echappe(c.email ?? '—')}</span></div>
        <div class="ligne-info"><strong>Paiement</strong><span>${echappe(c.moyen_paiement)}${c.paiement_detail ? ` — ${echappe(c.paiement_detail)}` : ''}</span></div>

        <h3>Enfants inscrits</h3>
        ${enfants}

        <h3>Décompte des frais</h3>
        <table class="tableau"><tbody>${decompte}
          <tr><td><strong>Total</strong></td><td><strong>${euros(c.montant_total)}</strong></td></tr>
        </tbody></table>

        ${c.commentaire ? `<p class="aide">Remarque : ${echappe(c.commentaire)}</p>` : ''}

        <h3>Autorisation parentale</h3>
        <p>Fait à ${echappe(c.signature.fait_a)} — Signature : <strong>${echappe(c.signature.nom)}</strong></p>
        <p class="aide">Consentement RGPD accepté. Conservez ce document : il vaut
        confirmation de votre inscription et de la décharge parentale.</p>
      </div>

      <div class="btn-groupe no-imprimer">
        <button type="button" class="btn btn-primaire" id="btn-imprimer">Imprimer / Enregistrer en PDF</button>
        <a class="btn" href="#/">Retour à l'accueil</a>
        <a class="btn" href="#/inscription">Nouvelle inscription</a>
      </div>
    </div>`;

  racine.querySelector('#btn-imprimer')?.addEventListener('click', () => window.print());
}
