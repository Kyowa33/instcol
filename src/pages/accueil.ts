import { blocErreur, echappe } from '../lib/dom';
import { euros, plageHeures } from '../lib/format';
import { chargerParametrage, type Parametrage } from '../lib/parametrage';
import type { CreneauAvecNiveaux } from '../lib/parametrage';
import { barreNavigation, enteteHeros } from './entete';

const ORDRE_JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

function rangJour(jour: string): number {
  const i = ORDRE_JOURS.findIndex((j) => j.toLowerCase() === jour.toLowerCase());
  return i === -1 ? 99 : i;
}

function lignesPlanning(p: Parametrage): string {
  const dispoById = new Map(p.dispos.map((d) => [d.creneau_id, d]));
  const lieuxById = new Map(p.lieux.map((l) => [l.id, l.nom]));
  const niveauxById = new Map(p.niveaux.map((n) => [n.id, n.libelle]));
  const lignes: string[] = [];

  for (const act of p.activites) {
    const creneaux = p.creneaux
      .filter((c) => c.activite_id === act.id)
      .sort((a, b) => rangJour(a.jour_semaine) - rangJour(b.jour_semaine));

    for (const c of creneaux as CreneauAvecNiveaux[]) {
      const d = dispoById.get(c.id);
      const niveaux = c.niveaux
        .map((id) => niveauxById.get(id))
        .filter((x): x is string => Boolean(x))
        .join(', ');
      const compte = d
        ? `${d.nombre_inscrits} inscrit${d.nombre_inscrits > 1 ? 's' : ''}` +
          (c.capacite_max ? ` / ${c.capacite_max} places` : '')
        : '';
      lignes.push(`<tr>
        <td><strong>${echappe(act.nom)}</strong>${niveaux ? `<br/><span class="aide">${echappe(niveaux)}</span>` : ''}</td>
        <td>${echappe(lieuxById.get(c.lieu_id) ?? '—')}</td>
        <td>${echappe(c.jour_semaine)}</td>
        <td>${echappe(plageHeures(c.horaire_debut, c.horaire_fin) || '—')}</td>
        <td>${c.precision_frequence ? echappe(c.precision_frequence) : '—'}</td>
        <td class="num">${compte ? `<span class="badge">${compte}</span>` : '—'}</td>
      </tr>`);
    }
  }
  return lignes.join('') || '<tr><td colspan="6">Aucun créneau paramétré pour l\'année en cours.</td></tr>';
}

function lignesTarifs(p: Parametrage): string {
  const lignes = [`<tr><td>Frais de dossier (par famille)</td><td class="num">${euros(p.fraisFixeFamille)}</td></tr>`];
  for (const act of p.activites) {
    const m = p.tarifs[act.id];
    if (m === undefined) continue;
    lignes.push(`<tr><td>${echappe(act.nom)} — par enfant inscrit</td><td class="num">${euros(m)}</td></tr>`);
  }
  return lignes.join('');
}

export async function rendreAccueil(racine: HTMLElement): Promise<void> {
  racine.innerHTML = `${barreNavigation('accueil')}
    ${enteteHeros(
      'Institutions Saint-Colomban',
      'Éveil à la foi, catéchisme et aumônerie — inscriptions de l\'année scolaire',
    )}
    <div class="conteneur"><p class="chargement">Chargement du planning…</p></div>`;

  try {
    const p = await chargerParametrage();

    racine.innerHTML = `${barreNavigation('accueil')}
      ${enteteHeros(
        'Institutions Saint-Colomban',
        `Inscriptions ${echappe(p.annee.libelle)} — éveil à la foi, catéchisme et aumônerie`,
      )}
      <div class="conteneur">
        <div class="carte">
          <div class="flex-entre">
            <div>
              <h2>Inscriptions ouvertes — ${echappe(p.annee.libelle)}</h2>
              <p>Remplissez le formulaire en ligne : il calcule automatiquement les frais,
              propose les groupes disponibles pour chaque enfant et vous envoie un
              récapitulatif signé par e-mail.</p>
            </div>
            <div class="btn-groupe no-imprimer" style="margin-top:0">
              <a class="btn btn-primaire" href="#/inscription">Commencer l'inscription</a>
              <a class="btn" href="#/admin">Espace administrateur</a>
            </div>
          </div>
        </div>

        <div class="carte">
          <h2>Planning des groupes (${echappe(p.annee.libelle)})</h2>
          <p class="aide">Le nombre d'inscrits est indicatif : il n'y a pas de blocage
          automatique, mais privilégiez les groupes les moins chargés.</p>
          <div class="tableau-enveloppe">
            <table class="tableau">
              <thead><tr>
                <th>Activité / niveaux</th><th>Lieu</th><th>Jour</th>
                <th>Horaire</th><th>Fréquence</th><th class="num">Effectif</th>
              </tr></thead>
              <tbody>${lignesPlanning(p)}</tbody>
            </table>
          </div>
        </div>

        <div class="carte">
          <h2>Frais d'inscription</h2>
          <div class="tableau-enveloppe">
            <table class="tableau">
              <thead><tr><th>Poste</th><th class="num">Montant</th></tr></thead>
              <tbody>${lignesTarifs(p)}</tbody>
            </table>
          </div>
          <p class="aide">Règlement par chèque (ordre : Paroisse Saint-Colomban) ou en espèces.
          Aucun paiement en ligne.</p>
          <p class="no-imprimer"><a class="btn btn-primaire" href="#/inscription">Accéder au formulaire</a></p>
        </div>
      </div>`;
  } catch (e) {
    racine.innerHTML = `${barreNavigation('accueil')}
      ${enteteHeros('Institutions Saint-Colomban', 'Inscriptions paroissiales')}
      <div class="conteneur">${blocErreur(e instanceof Error ? e.message : String(e))}</div>`;
  }
}
