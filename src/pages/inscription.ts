import { echappe, qs, toast } from '../lib/dom';
import { dateFr, euros, plageHeures } from '../lib/format';
import {
  CLE_CONFIRMATION,
  chargerBrouillon,
  effacerBrouillon,
  etatVide,
  nouveauEnfant,
  sauverBrouillon,
  soumettreInscription,
  type EtatEnfant,
  type EtatInscription,
} from '../lib/inscription';
import { chargerParametrage, ErreurAnneesInactives, oublierParametrage, type Parametrage } from '../lib/parametrage';
import { messageErreur } from '../lib/supabase';
import { calculerFrais, type EnfantAvecCreneaux } from '../lib/tarifs';
import { naviguer } from '../router';
import type { DonneesConfirmation } from './confirmation';
import { barreNavigation, enteteHeros } from './entete';

const LIBELLES_ETAPES = [
  '1. Responsable légal',
  '2. Enfants & groupes',
  '3. Frais & paiement',
  '4. Autorisations',
];

const AUJOURDHUI = new Date().toISOString().slice(0, 10);

export async function rendreInscription(racine: HTMLElement): Promise<void> {
  racine.innerHTML = `${barreNavigation('inscription')}
    ${enteteHeros("Formulaire d'inscription", 'Éveil à la foi, catéchisme, aumônerie')}
    <div class="conteneur conteneur-etroit"><p class="chargement">Chargement du formulaire…</p></div>`;

  let p: Parametrage;
  try {
    p = await chargerParametrage();
  } catch (e) {
    if (e instanceof ErreurAnneesInactives) {
      // Aucune année active : message simple, sans jargon ni bouton.
      racine.innerHTML = `${barreNavigation('inscription')}
        ${enteteHeros("Formulaire d'inscription", 'Éveil à la foi, catéchisme, aumônerie')}
        <div class="conteneur conteneur-etroit">
          <div class="carte">
            <p>Les inscriptions sont actuellement fermées. Pour toute demande,
            veuillez vous rapprocher des responsables de la paroisse.</p>
          </div>
        </div>`;
      return;
    }
    racine.innerHTML = `${barreNavigation('inscription')}
      ${enteteHeros("Formulaire d'inscription", 'Éveil à la foi, catéchisme, aumônerie')}
      <div class="conteneur conteneur-etroit">
        <div class="carte erreur-palette"><h2>Inscriptions momentanément indisponibles</h2>
        <p>${echappe(messageErreur(e))}</p>
        <p><a class="btn" href="#/">Retour à l'accueil</a></p></div>
      </div>`;
    return;
  }

  const etat: EtatInscription = chargerBrouillon() ?? etatVide();
  if (!etat.responsables.length) etat.responsables.push(...etatVide().responsables);

  racine.innerHTML = `${barreNavigation('inscription')}
    ${enteteHeros("Formulaire d'inscription", `Année scolaire ${echappe(p.annee.libelle)}`)}
    <div class="conteneur conteneur-etroit">
      <ol class="etapes" id="barre-etapes"></ol>
      <div id="contenu-etape"></div>
      <p class="aide no-imprimer">Vos réponses sont conservées dans ce navigateur tant que
      l'inscription n'est pas envoyée.</p>
    </div>`;

  const contenu = qs<HTMLElement>('#contenu-etape', racine);
  const barre = qs<HTMLElement>('#barre-etapes', racine);

  /* --------------------------- Utilitaires --------------------------- */

  function enfantsAvecCreneaux(): EnfantAvecCreneaux[] {
    return etat.enfants.map((e) => ({
      prenom: e.prenom,
      nom: e.nom,
      creneauIds: e.creneau_ids,
    }));
  }

  function resumeFraisHtml(): string {
    const { lignes, total } = calculerFrais(p, enfantsAvecCreneaux());
    const rows = lignes
      .map((l) => `<tr><td>${echappe(l.libelle)}</td><td>${euros(l.montant)}</td></tr>`)
      .join('');
    return `<table><tbody>${rows}
      <tr class="total"><td>Total à régler</td><td>${euros(total)}</td></tr></tbody></table>`;
  }

  function majResume(): void {
    const zone = contenu.querySelector('#resume-frais');
    if (zone) zone.innerHTML = resumeFraisHtml();
  }

  function majBarre(): void {
    barre.innerHTML = LIBELLES_ETAPES.map((l, i) => {
      const n = i + 1;
      const classe = n === etat.etape ? 'active' : n < etat.etape ? 'fait' : '';
      return `<li class="${classe}">${echappe(l)}</li>`;
    }).join('');
  }

  function enregistrer(): void {
    sauverBrouillon(etat);
  }

  function libelleCreneau(id: string): string {
    const c = p.creneaux.find((x) => x.id === id);
    if (!c) return 'Groupe supprimé';
    const act = p.activites.find((a) => a.id === c.activite_id)?.nom ?? '';
    const lieu = p.lieux.find((l) => l.id === c.lieu_id)?.nom ?? '';
    const h = plageHeures(c.horaire_debut, c.horaire_fin);
    return `${act} — ${lieu} — ${c.jour_semaine}${h ? ' ' + h : ''}` +
      `${c.precision_frequence ? ` (${c.precision_frequence})` : ''}`;
  }

  /* --------------------------- Validation ---------------------------- */

  function validerChamps(): boolean {
    const els = contenu.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      'input,select,textarea',
    );
    for (const el of Array.from(els)) {
      if (el.disabled || el.closest('.masque')) continue;
      if (!el.checkValidity()) {
        el.reportValidity();
        return false;
      }
    }
    return true;
  }

  function validerEtape(): boolean {
    if (!validerChamps()) return false;

    if (etat.etape === 2) {
      if (!etat.enfants.length) {
        toast('Ajoutez au moins un enfant.', 'erreur');
        return false;
      }
      for (const [i, e] of etat.enfants.entries()) {
        if (!e.niveau_id) {
          toast(`Sélectionnez le niveau scolaire de ${e.prenom || `l'enfant ${i + 1}`}.`, 'erreur');
          return false;
        }
        if (!e.creneau_ids.length) {
          toast(`Choisissez au moins un groupe pour ${e.prenom || `l'enfant ${i + 1}`}.`, 'erreur');
          return false;
        }
      }
    }

    if (etat.etape === 3 && !etat.moyen_paiement) {
      toast('Choisissez un moyen de paiement.', 'erreur');
      return false;
    }

    if (etat.etape === 4) {
      if (!etat.autorisation.autorise_activites) {
        toast("L'autorisation de participation est obligatoire.", 'erreur');
        return false;
      }
      if (!etat.autorisation.autorise_mesures_medicales) {
        toast("L'autorisation des mesures médicales d'urgence est obligatoire.", 'erreur');
        return false;
      }
      if (!etat.autorisation.droit_image) {
        toast("L'autorisation de diffusion (photos / vidéos) est obligatoire.", 'erreur');
        return false;
      }
      if (!etat.autorisation.consentement_rgpd) {
        toast("L'autorisation d'utilisation de vos coordonnées est obligatoire (RGPD).", 'erreur');
        return false;
      }
    }
    return true;
  }

  /* ------------------------ Rendu des étapes ------------------------- */

  function rendreEtape(): void {
    majBarre();
    switch (etat.etape) {
      case 1: contenu.innerHTML = htmlEtape1(); break;
      case 2: contenu.innerHTML = htmlEtape2(); break;
      case 3: contenu.innerHTML = htmlEtape3(); break;
      default: contenu.innerHTML = htmlEtape4(); break;
    }
    majResume();
  }

  /* ----------------------- Gabarits de champs ------------------------ */

  function grille(blocs: string[]): string {
    return `<div class="grille-2">${blocs.join('')}</div>`;
  }

  function champTexte(
    cle: string,
    label: string,
    valeur: string,
    o: { type?: string; requis?: boolean; aide?: string; max?: string } = {},
  ): string {
    return `<label class="champ"><span>${echappe(label)}${o.requis ? ' *' : ''}</span>
      <input type="${o.type ?? 'text'}" data-champ="${cle}" value="${echappe(valeur)}"
        ${o.requis ? 'required' : ''} ${o.max ? `max="${o.max}"` : ''}/>
      ${o.aide ? `<small class="aide">${echappe(o.aide)}</small>` : ''}</label>`;
  }

  function champZone(cle: string, label: string, valeur: string, aide?: string): string {
    return `<label class="champ"><span>${echappe(label)}</span>
      <textarea data-champ="${cle}">${echappe(valeur)}</textarea>
      ${aide ? `<small class="aide">${echappe(aide)}</small>` : ''}</label>`;
  }

  function champSelect(
    cle: string,
    label: string,
    valeur: string,
    options: { v: string; l: string }[],
    requis = false,
  ): string {
    const opts = ['<option value="">— Choisir —</option>']
      .concat(
        options.map(
          (o) =>
            `<option value="${echappe(o.v)}" ${o.v === valeur ? 'selected' : ''}>${echappe(o.l)}</option>`,
        ),
      )
      .join('');
    return `<label class="champ"><span>${echappe(label)}${requis ? ' *' : ''}</span>
      <select data-champ="${cle}" ${requis ? 'required' : ''}>${opts}</select></label>`;
  }

  function caseA(coche: boolean, cle: string, label: string, aide?: string): string {
    return `<label class="case"><input type="checkbox" data-champ="${cle}" ${coche ? 'checked' : ''}/>
      <span>${label}${aide ? `<small>${aide}</small>` : ''}</span></label>`;
  }

  /* ------------------------------ Étape 1 ---------------------------- */

  function htmlEtape1(): string {
    const cartes = etat.responsables
      .map(
        (r, i) => `<fieldset>
        <legend>Responsable ${i + 1}${r.est_principal ? ' — référent' : ''}</legend>
        ${grille([
          champTexte(`resp.${i}.prenom`, 'Prénom', r.prenom, { requis: true }),
          champTexte(`resp.${i}.nom`, 'Nom', r.nom, { requis: true }),
        ])}
        ${i > 0
          ? `<p><button type="button" class="btn btn-petit" data-action="dupliquer-adresse" data-index="${i}">Dupliquer l'adresse du responsable 1</button></p>`
          : ''}
        ${champTexte(`resp.${i}.adresse`, 'Adresse postale', r.adresse, { requis: true })}
        ${grille([
          champTexte(`resp.${i}.code_postal`, 'Code postal', r.code_postal, { requis: true }),
          champTexte(`resp.${i}.ville`, 'Ville', r.ville, { requis: true }),
        ])}
        ${grille([
          champTexte(`resp.${i}.telephone`, 'Portable', r.telephone, {
            requis: true,
            type: 'tel',
            aide: 'Ex. 06 12 34 56 78',
          }),
          champTexte(`resp.${i}.email`, 'E-mail', r.email, {
            requis: true,
            type: 'email',
            aide: 'Recevra la confirmation et le récapitulatif PDF',
          }),
        ])}
        ${i > 0
          ? `<p><button type="button" class="btn btn-petit" data-action="supprimer-resp" data-index="${i}">Retirer ce responsable</button></p>`
          : ''}
      </fieldset>`,
      )
      .join('');

    return `<div class="carte">
      <h2>Personnes exerçant l'autorité parentale</h2>
      <p class="aide">Le premier responsable est le référent du dossier.</p>
      ${cartes}
      <p><button type="button" class="btn" data-action="ajouter-resp">+ Ajouter un responsable</button></p>
      <div class="btn-groupe">
        <button type="button" class="btn btn-primaire" data-action="suivant">Continuer →</button>
      </div>
    </div>`;
  }

  /* ------------------------------ Étape 2 ---------------------------- */

  function lignesCreneaux(e: EtatEnfant, i: number): string {
    const dispoById = new Map(p.dispos.map((d) => [d.creneau_id, d]));
    const actById = new Map(p.activites.map((a) => [a.id, a.nom]));
    const lieuById = new Map(p.lieux.map((l) => [l.id, l.nom]));
    const tries = [...p.creneaux].sort((a, b) =>
      (actById.get(a.activite_id) ?? '').localeCompare(actById.get(b.activite_id) ?? ''),
    );

    return tries
      .map((c) => {
        const visible = !e.niveau_id || c.niveaux.includes(e.niveau_id);
        const d = dispoById.get(c.id);
        const complet =
          c.capacite_max !== null && d !== undefined && d.nombre_inscrits >= c.capacite_max;
        const compte = d
          ? `${d.nombre_inscrits} inscrit${d.nombre_inscrits > 1 ? 's' : ''}` +
            (c.capacite_max ? ` / ${c.capacite_max} max` : '') +
            (complet ? ' — complet' : '')
          : '';
        const h = plageHeures(c.horaire_debut, c.horaire_fin);
        return `<label class="creneau ${visible ? '' : 'masque'}" data-niveaux="${echappe(c.niveaux.join(','))}">
          <input type="checkbox" data-champ="enfant.${i}.creneau" value="${c.id}"
            ${e.creneau_ids.includes(c.id) ? 'checked' : ''}/>
          <span class="info">
            <strong>${echappe(actById.get(c.activite_id) ?? '')} — ${echappe(lieuById.get(c.lieu_id) ?? '')}</strong>
            ${echappe(c.jour_semaine)}${h ? ` ${echappe(h)}` : ''}
            ${c.precision_frequence ? `<br/><span class="aide">${echappe(c.precision_frequence)}</span>` : ''}
            <span class="compte ${complet ? 'complet' : ''}">${compte}</span>
          </span>
        </label>`;
      })
      .join('');
  }

  function htmlEnfant(e: EtatEnfant, i: number): string {
    const optionsNiveaux = [...p.niveaux]
      .sort((a, b) => a.ordre_affichage - b.ordre_affichage)
      .map((n) => ({ v: n.id, l: n.libelle }));

    return `<fieldset class="carte-enfant">
      <legend>Enfant ${i + 1} — état civil</legend>
      ${grille([
        champTexte(`enfant.${i}.prenom`, 'Prénom', e.prenom, { requis: true }),
        champTexte(`enfant.${i}.nom`, 'Nom', e.nom, { requis: true }),
      ])}
      ${grille([
        champTexte(`enfant.${i}.date_naissance`, 'Date de naissance', e.date_naissance, {
          requis: true,
          type: 'date',
          max: AUJOURDHUI,
        }),
        champSelect(
          `enfant.${i}.sexe`,
          'Sexe',
          e.sexe,
          [
            { v: 'M', l: 'Garçon' },
            { v: 'F', l: 'Fille' },
          ],
          true,
        ),
      ])}
      ${grille([
        champTexte(`enfant.${i}.classe_frequentee`, 'Classe fréquentée', e.classe_frequentee, {
          requis: true,
          aide: 'Ex. CE2, 6ème',
        }),
        champTexte(`enfant.${i}.etablissement`, 'Établissement', e.etablissement, {
          requis: true,
          aide: 'École, collège ou lycée',
        }),
      ])}
      ${champTexte(`enfant.${i}.telephone_enfant`, "Portable de l'enfant (s'il en possède un)", e.telephone_enfant, {
        type: 'tel',
      })}
      <div class="grille-2">
        ${caseA(e.est_baptise, `enfant.${i}.est_baptise`, 'Baptisé(e)')}
        ${caseA(e.est_confirme, `enfant.${i}.est_confirme`, 'Confirmé(e)')}
      </div>
      ${caseA(e.premiere_communion, `enfant.${i}.premiere_communion`, '1ère communion effectuée')}
      <div class="bloc-communion ${e.premiere_communion ? '' : 'masque'}">
        ${champTexte(`enfant.${i}.date_communion`, 'Date de la 1ère communion', e.date_communion, {
          type: 'date',
        })}
      </div>

      ${champSelect(`enfant.${i}.niveau_id`, 'Niveau (pour le choix des groupes)', e.niveau_id, optionsNiveaux, true)}

      <h3>Groupes / créneaux</h3>
      <p class="aide">Filtrez avec le niveau ci-dessus. Vous pouvez inscrire l'enfant à
      plusieurs groupes ; le nombre d'inscrits est indicatif.</p>
      <div class="creneaux">${lignesCreneaux(e, i)}</div>

      ${champZone(`enfant.${i}.sante`, 'Remarques santé / allergies / PAI (facultatif)', e.sante)}
      ${i > 0
        ? `<p><button type="button" class="btn btn-petit" data-action="supprimer-enfant" data-index="${i}">Retirer cet enfant</button></p>`
        : ''}
    </fieldset>`;
  }

  function htmlEtape2(): string {
    const cartes = etat.enfants.length
      ? etat.enfants.map((e, i) => htmlEnfant(e, i)).join('')
      : `<div class="encadre">Aucun enfant ajouté pour le moment — cliquez sur
         « Ajouter un enfant ».</div>`;

    return `<div class="carte">
      <h2>État civil des enfants & choix des groupes</h2>
      ${cartes}
      <div class="btn-groupe">
        <button type="button" class="btn" data-action="ajouter-enfant">+ Ajouter un enfant</button>
        <button type="button" class="btn" data-action="precedent">← Retour</button>
        <button type="button" class="btn btn-primaire" data-action="suivant"
          ${etat.enfants.length ? '' : 'disabled'}>Continuer →</button>
      </div>
      <div id="resume-frais" class="resume-frais" style="margin-top:18px">${resumeFraisHtml()}</div>
    </div>`;
  }

  /* ------------------------------ Étape 3 ---------------------------- */

  function htmlEtape3(): string {
    const cheque = etat.moyen_paiement === 'CHEQUE';
    return `<div class="carte">
      <h2>Frais d'inscription</h2>
      <div id="resume-frais" class="resume-frais">${resumeFraisHtml()}</div>
      <p class="aide">Décompte indicatif calculé à partir des tarifs de l'année
      ${echappe(p.annee.libelle)} — le montant enregistré est revérifié lors de l'envoi.</p>

      <fieldset>
        <legend>Je choisis de régler les frais d'inscription par :</legend>
        <label class="case">
          <input type="radio" name="moyen-paiement" data-champ="famille.moyen_paiement"
            value="CHEQUE" ${cheque ? 'checked' : ''} required/>
          <span>Chèque (ordre : <strong>Paroisse Saint-Colomban</strong>)</span>
        </label>
        <label class="case">
          <input type="radio" name="moyen-paiement" data-champ="famille.moyen_paiement"
            value="ESPECES" ${etat.moyen_paiement === 'ESPECES' ? 'checked' : ''}/>
          <span>Espèces</span>
        </label>
        <div id="bloc-cheque" class="${cheque ? '' : 'masque'}">
          ${grille([
            champTexte('famille.num_cheque', 'N° du chèque', etat.num_cheque, {
              requis: cheque,
            }),
            champTexte('famille.banque_cheque', 'Banque', etat.banque_cheque),
          ])}
        </div>
      </fieldset>

      ${champZone(
        'famille.commentaire_famille',
        'Remarques / questions pour la paroisse (facultatif)',
        etat.commentaire_famille,
      )}

      <div class="btn-groupe">
        <button type="button" class="btn" data-action="precedent">← Retour</button>
        <button type="button" class="btn btn-primaire" data-action="suivant">Continuer →</button>
      </div>
    </div>`;
  }

  /* ------------------------------ Étape 4 ---------------------------- */

  function htmlEtape4(): string {
    const a = etat.autorisation;
    const ref = etat.responsables[0];
    const identite = `${ref.prenom} ${ref.nom}`.trim() || '________';
    return `<div class="carte">
      <h2>Autorisation de décharge parentale</h2>
      <div class="encadre">
        Je soussigné(e) <strong>${echappe(identite)}</strong> :
      </div>

      ${caseA(
        a.autorise_activites,
        'aut.autorise_activites',
        "<strong>autorise mon (mes) enfant(s), sus désigné(s), à participer aux activités organisées dans le cadre de l'éveil à la foi, du catéchisme ou de l'aumônerie</strong> (rencontres, temps forts, célébrations, sorties…) *",
      )}
      ${caseA(
        a.autorise_mesures_medicales,
        'aut.autorise_mesures_medicales',
        "<strong>autorise les responsables à prendre toutes les mesures médicales nécessaires en cas d'urgence</strong> *",
      )}
      ${caseA(
        a.droit_image,
        'aut.droit_image',
        "<strong>autorise la diffusion de photos, vidéos ou de tout autre document sur lequel pourrait figurer mon (mes) enfant(s) dans le cadre des activités de l'éveil à la foi, de la catéchèse ou de l'aumônerie</strong> *",
      )}
      ${caseA(
        a.consentement_rgpd,
        'aut.consentement_rgpd',
        "<strong>autorise la paroisse Saint-Colomban et le diocèse de Meaux à utiliser mes coordonnées dans le cadre de correspondances liées aux activités et événements paroissiaux, aux informations générales sur le diocèse et aux invitations aux événements diocésains, au service du Denier de l'Eglise, à l'envoi des reçus fiscaux.</strong> Ces données seront exclusivement exploitées par la paroisse Saint-Colomban et le diocèse de Meaux dans le cadre de ses activités. Aucune information ne sera transmise à un tiers<sup>(1)</sup> *",
      )}

      <div class="encadre aide">
        <sup>(1)</sup> Vos données personnelles recueillies légitimement font l'objet d'un
        traitement informatique uniquement par nos services dans le cadre de votre demande
        faite auprès de votre paroisse ou du diocèse de Meaux. Conformément au Règlement
        Général pour la Protection des Données du 18 mai 2018, vous bénéficiez d'un droit de
        consultation, modification et suppression sur vos informations personnelles. Il peut
        s'exercer, en vous adressant à l'Evêché :
        <a href="mailto:rgpd@catho77.fr"><u>rgpd@catho77.fr</u></a>. Vous pouvez également,
        pour des motifs légitimes, vous opposer au traitement des données personnelles. Cette
        décision peut cependant compromettre la prise en compte par la paroisse ou le
        diocèse de votre demande. <u>Le diocèse de Meaux et la paroisse ne procèdent à aucun
        échange et aucune revente de données à d'autres organismes</u>.
      </div>

      ${grille([
        champTexte('aut.fait_a', 'Fait à (ville)', a.fait_a, { requis: true }),
        champTexte('aut.nom_signataire', 'Prénom et Nom du signataire', a.nom_signataire, {
          requis: true,
        }),
      ])}

      <div id="resume-frais" class="resume-frais">${resumeFraisHtml()}</div>

      <div class="btn-groupe">
        <button type="button" class="btn" data-action="precedent">← Retour</button>
        <button type="button" class="btn btn-succes" data-action="soumettre">
          Valider et envoyer l'inscription
        </button>
      </div>
      <p class="aide">Un e-mail de confirmation avec le récapitulatif PDF signé vous sera
      envoyé immédiatement.</p>
    </div>`;
  }

  /* --------------------- Écouteurs d'événements ---------------------- */

  function appliquerChamp(cible: HTMLElement, valeur: string | boolean): void {
    const cle = cible.dataset.champ;
    if (!cle) return;
    const parts = cle.split('.');

    if (parts[0] === 'resp') {
      const r = etat.responsables[Number(parts[1])];
      if (r) (r as unknown as Record<string, unknown>)[parts[2]] = valeur;
    } else if (parts[0] === 'enfant') {
      const e = etat.enfants[Number(parts[1])];
      if (e) (e as unknown as Record<string, unknown>)[parts[2]] = valeur;
    } else if (parts[0] === 'famille') {
      (etat as unknown as Record<string, unknown>)[parts[1]] = valeur;
    } else if (parts[0] === 'aut') {
      (etat.autorisation as unknown as Record<string, unknown>)[parts[1]] = valeur;
    }
    enregistrer();
  }

  function idsCoches(carte: Element): string[] {
    return Array.from(carte.querySelectorAll<HTMLInputElement>('input[data-champ$=".creneau"]:checked'))
      .map((x) => x.value);
  }

  function filtrerCarte(carte: Element, e: EtatEnfant): void {
    carte.querySelectorAll<HTMLElement>('.creneau').forEach((l) => {
      const niveaux = (l.dataset.niveaux ?? '').split(',').filter(Boolean);
      const visible = !e.niveau_id || niveaux.includes(e.niveau_id);
      l.classList.toggle('masque', !visible);
      const cb = l.querySelector('input');
      if (cb instanceof HTMLInputElement && !visible && cb.checked) cb.checked = false;
    });
    e.creneau_ids = idsCoches(carte);
    enregistrer();
  }

  contenu.addEventListener('input', (ev) => {
    const c = ev.target;
    if (c instanceof HTMLInputElement && c.type !== 'checkbox' && c.type !== 'radio') {
      appliquerChamp(c, c.value);
    } else if (c instanceof HTMLTextAreaElement) {
      appliquerChamp(c, c.value);
    }
  });

  contenu.addEventListener('change', (ev) => {
    const c = ev.target;
    if (!(c instanceof HTMLInputElement || c instanceof HTMLSelectElement)) return;
    const cle = c.dataset.champ ?? '';

    if (cle.endsWith('.creneau')) {
      const carte = c.closest('fieldset');
      const e = etat.enfants[Number(cle.split('.')[1])];
      if (carte && e) {
        e.creneau_ids = idsCoches(carte);
        enregistrer();
        majResume();
      }
      return;
    }

    const valeur: string | boolean =
      c instanceof HTMLInputElement
        ? c.type === 'checkbox'
          ? c.checked
          : c.type === 'radio'
            ? c.value
            : c.value
        : c.value;
    appliquerChamp(c, valeur);

    if (cle.endsWith('.niveau_id')) {
      const carte = c.closest('fieldset');
      const e = etat.enfants[Number(cle.split('.')[1])];
      if (carte && e) filtrerCarte(carte, e);
      majResume();
    } else if (cle.endsWith('.premiere_communion')) {
      const bloc = c.closest('fieldset')?.querySelector('.bloc-communion');
      const coche = c instanceof HTMLInputElement && c.checked;
      bloc?.classList.toggle('masque', !coche);
      if (!coche) {
        const e = etat.enfants[Number(cle.split('.')[1])];
        if (e) {
          e.date_communion = '';
          const inp = bloc?.querySelector('input');
          if (inp instanceof HTMLInputElement) inp.value = '';
        }
      }
    } else if (cle === 'famille.moyen_paiement') {
      const cheque = etat.moyen_paiement === 'CHEQUE';
      contenu.querySelector('#bloc-cheque')?.classList.toggle('masque', !cheque);
      const inp = contenu.querySelector<HTMLInputElement>('input[data-champ="famille.num_cheque"]');
      if (inp) {
        if (cheque) inp.setAttribute('required', '');
        else inp.removeAttribute('required');
      }
    }
  });

  contenu.addEventListener('click', (ev) => {
    const cible = ev.target;
    const bouton = cible instanceof Element ? cible.closest('button[data-action]') : null;
    if (!(bouton instanceof HTMLButtonElement)) return;

    switch (bouton.dataset.action) {
      case 'suivant':
        if (validerEtape()) {
          etat.etape = Math.min(4, etat.etape + 1);
          enregistrer();
          rendreEtape();
        }
        break;
      case 'precedent':
        etat.etape = Math.max(1, etat.etape - 1);
        enregistrer();
        rendreEtape();
        break;
      case 'ajouter-enfant':
        etat.enfants.push(nouveauEnfant());
        enregistrer();
        rendreEtape();
        break;
      case 'supprimer-enfant':
        etat.enfants.splice(Number(bouton.dataset.index), 1);
        enregistrer();
        rendreEtape();
        break;
      case 'ajouter-resp': {
        const ref = etat.responsables[0];
        etat.responsables.push({
          ...etatVide().responsables[0],
          est_principal: false,
          adresse: ref.adresse,
          code_postal: ref.code_postal,
          ville: ref.ville,
        });
        enregistrer();
        rendreEtape();
        break;
      }
      case 'dupliquer-adresse': {
        const i = Number(bouton.dataset.index);
        const ref = etat.responsables[0];
        const r = etat.responsables[i];
        if (i > 0 && r && ref) {
          r.adresse = ref.adresse;
          r.code_postal = ref.code_postal;
          r.ville = ref.ville;
          enregistrer();
          rendreEtape();
          toast("Adresse dupliquée depuis le responsable 1.", 'succes');
        }
        break;
      }
      case 'supprimer-resp':
        etat.responsables.splice(Number(bouton.dataset.index), 1);
        enregistrer();
        rendreEtape();
        break;
      case 'soumettre':
        void envoyer(bouton);
        break;
      default:
        break;
    }
  });

  async function envoyer(bouton: HTMLButtonElement): Promise<void> {
    if (!validerEtape()) return;
    bouton.disabled = true;
    const texteInitial = bouton.textContent ?? bouton.textContent;
    bouton.textContent = 'Envoi en cours…';

    try {
      const res = await soumettreInscription(etat);
      const { lignes } = calculerFrais(p, enfantsAvecCreneaux());
      const principal = etat.responsables.find((r) => r.est_principal) ?? etat.responsables[0];

      const conf: DonneesConfirmation = {
        code_dossier: res.code_dossier,
        annee_libelle: res.annee_libelle,
        montant_total: Number(res.montant_total),
        email: res.email_confirmation,
        emailEnvoye: res.emailEnvoye,
        emailErreur: res.emailErreur,
        moyen_paiement: etat.moyen_paiement === 'CHEQUE' ? 'Chèque' : 'Espèces',
        paiement_detail: etat.num_cheque
          ? `n° ${etat.num_cheque}${etat.banque_cheque ? ` — ${etat.banque_cheque}` : ''}`
          : '',
        responsable: `${principal.prenom} ${principal.nom}`,
        coordonnees: `${principal.adresse}, ${principal.code_postal} ${principal.ville}`,
        commentaire: etat.commentaire_famille,
        decompte: lignes,
        enfants: etat.enfants.map((e) => ({
          identite: `${e.prenom} ${e.nom}`,
          detail:
            `né(e) le ${dateFr(e.date_naissance)} — ${e.classe_frequentee} — ${e.etablissement}` +
            (e.est_baptise ? ' — baptisé(e)' : '') +
            (e.est_confirme ? ' — confirmé(e)' : '') +
            (e.premiere_communion
              ? ` — 1ère communion${e.date_communion ? ' le ' + dateFr(e.date_communion) : ''}`
              : ''),
          groupes: e.creneau_ids.map(libelleCreneau),
        })),
        signature: {
          fait_a: etat.autorisation.fait_a,
          nom: etat.autorisation.nom_signataire,
        },
        date: new Date().toISOString(),
      };

      sessionStorage.setItem(CLE_CONFIRMATION, JSON.stringify(conf));
      effacerBrouillon();
      // Les effectifs (dispos) ont changé : on invalite le cache du paramétrage
      // pour que l'accueil ré-affiche des compteurs à jour.
      oublierParametrage();
      naviguer('/confirmation');
    } catch (e) {
      toast(messageErreur(e), 'erreur');
      bouton.disabled = false;
      bouton.textContent = texteInitial;
    }
  }

  rendreEtape();






}
