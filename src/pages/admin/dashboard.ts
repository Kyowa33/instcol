import { blocErreur, echappe, qs, toast } from '../../lib/dom';
import { telechargerCsv } from '../../lib/csv';
import { euros, horodatageFr } from '../../lib/format';
import { gardeAdmin } from '../../lib/session';
import { messageErreur, siErreur, supabase } from '../../lib/supabase';
import type { DossierSuivi } from '../../lib/types';
import { naviguer } from '../../router';
import { coqueAdmin } from './layout';

function badgeStatut(statut: string): string {
  return statut === 'VALIDE'
    ? '<span class="badge badge-vert">Validé</span>'
    : '<span class="badge badge-orange">En attente</span>';
}

export async function rendreDashboard(racine: HTMLElement): Promise<void> {
  if (!(await gardeAdmin())) return;
  const zone = coqueAdmin(racine, 'Suivi des inscriptions', 'dossiers');

  try {
    const dossiers = siErreur(
      await supabase
        .from('v_admin_suivi_dossiers')
        .select('*')
        .order('date_creation', { ascending: false }),
    ) as DossierSuivi[];

    // Années pour le filtre dédié (libellé unique en base, la vue n'expose
    // pas l'id). Requête tolérante : sans elle, la page s'affiche en « Toutes ».
    let anneesDispo: { libelle: string; est_active: boolean }[] = [];
    try {
      anneesDispo = siErreur(
        await supabase
          .from('annee_scolaire')
          .select('libelle, est_active')
          .order('date_debut', { ascending: false }),
      ) as { libelle: string; est_active: boolean }[];
    } catch {
      anneesDispo = [];
    }

    let filtreTexte = '';
    let filtreStatut = '';
    // Par défaut : l'année scolaire active (toutes si aucune n'est active).
    let filtreAnnee = anneesDispo.find((a) => a.est_active)?.libelle ?? '';

    const filtrees = (): DossierSuivi[] =>
      dossiers.filter((d) => {
        const t = filtreTexte.toLowerCase();
        const okTexte =
          !t ||
          d.code_dossier.toLowerCase().includes(t) ||
          `${d.prenom_responsable} ${d.nom_responsable}`.toLowerCase().includes(t) ||
          d.email.toLowerCase().includes(t) ||
          d.annee_scolaire.toLowerCase().includes(t);
        const okStatut = !filtreStatut || d.statut_paiement === filtreStatut;
        const okAnnee = !filtreAnnee || d.annee_scolaire === filtreAnnee;
        return okTexte && okStatut && okAnnee;
      });

    const statsHtml = (): string => {
      const l = filtrees();
      const attendu = l.reduce((s, d) => s + Number(d.montant_total), 0);
      const paye = l.reduce((s, d) => s + Number(d.montant_paye), 0);
      const enfants = l.reduce((s, d) => s + Number(d.nombre_enfants), 0);
      const attente = l.filter((d) => d.statut_paiement === 'EN_ATTENTE').length;
      return `<div class="stats">
        <div class="stat"><div class="valeur">${l.length}</div><div class="libelle">dossiers</div></div>
        <div class="stat"><div class="valeur">${enfants}</div><div class="libelle">enfants inscrits</div></div>
        <div class="stat"><div class="valeur">${euros(attendu)}</div><div class="libelle">frais attendus</div></div>
        <div class="stat"><div class="valeur">${euros(paye)}</div><div class="libelle">encaissé</div></div>
        <div class="stat"><div class="valeur">${attente}</div><div class="libelle">en attente de règlement</div></div>
      </div>`;
    };

    const corpsHtml = (): string => {
      const l = filtrees();
      if (!l.length) {
        return `<tr><td colspan="9">Aucun dossier ne correspond à ces filtres.</td></tr>`;
      }
      return l
        .map(
          (d) => `<tr data-id="${d.famille_id}" style="cursor:pointer">
          <td><strong>${echappe(d.code_dossier)}</strong></td>
          <td>${horodatageFr(d.date_creation)}</td>
          <td>${echappe(`${d.prenom_responsable} ${d.nom_responsable}`)}<br/>
              <span class="aide">${echappe(d.email)}</span></td>
          <td class="num">${d.nombre_enfants}</td>
          <td class="num">${euros(d.montant_total)}</td>
          <td class="num">${euros(d.montant_paye)}</td>
          <td class="num">${euros(d.reste_a_payer)}</td>
          <td>${d.moyen_paiement === 'CHEQUE' ? 'Chèque' : 'Espèces'}</td>
          <td>${badgeStatut(d.statut_paiement)}</td>
        </tr>`,
        )
        .join('');
    };

    zone.innerHTML = `
      <div id="zone-stats">${statsHtml()}</div>
      <div class="filtres no-imprimer">
        <label class="champ"><span>Rechercher</span>
          <input type="search" id="f-texte" placeholder="code, nom, e-mail, année…"/></label>
        <label class="champ"><span>Année scolaire</span>
          <select id="f-annee">
            <option value="">Toutes les années</option>
            ${anneesDispo
              .map(
                (a) =>
                  `<option value="${echappe(a.libelle)}" ${a.libelle === filtreAnnee ? 'selected' : ''}>${echappe(a.libelle)}${a.est_active ? ' (active)' : ''}</option>`,
              )
              .join('')}
          </select></label>
        <label class="champ"><span>Statut de paiement</span>
          <select id="f-statut">
            <option value="">Tous</option>
            <option value="EN_ATTENTE">En attente</option>
            <option value="VALIDE">Validé</option>
          </select></label>
        <button type="button" class="btn" id="btn-csv">Exporter en CSV</button>
      </div>
      <div class="carte">
        <div class="tableau-enveloppe">
          <table class="tableau">
            <thead><tr>
              <th>Dossier</th><th>Date</th><th>Responsable</th><th class="num">Enfants</th>
              <th class="num">Total</th><th class="num">Payé</th><th class="num">Reste</th>
              <th>Moyen</th><th>Statut</th>
            </tr></thead>
            <tbody id="corps-tableau">${corpsHtml()}</tbody>
          </table>
        </div>
        <p class="aide">Cliquez sur une ligne pour ouvrir le dossier.</p>
      </div>`;

    const maj = (): void => {
      qs('#zone-stats', zone).innerHTML = statsHtml();
      qs('#corps-tableau', zone).innerHTML = corpsHtml();
    };

    qs<HTMLInputElement>('#f-texte', zone).addEventListener('input', (ev) => {
      filtreTexte = (ev.target as HTMLInputElement).value;
      maj();
    });
    qs<HTMLSelectElement>('#f-annee', zone).addEventListener('change', (ev) => {
      filtreAnnee = (ev.target as HTMLSelectElement).value;
      maj();
    });
    qs<HTMLSelectElement>('#f-statut', zone).addEventListener('change', (ev) => {
      filtreStatut = (ev.target as HTMLSelectElement).value;
      maj();
    });
    qs('#btn-csv', zone).addEventListener('click', () => exporterCsv(filtrees()));
    qs('#corps-tableau', zone).addEventListener('click', (ev) => {
      const ligne = (ev.target as Element).closest('tr[data-id]');
      if (ligne) naviguer(`/admin/dossier/${ligne.getAttribute('data-id') ?? ''}`);
    });
  } catch (e) {
    zone.innerHTML = blocErreur(messageErreur(e));
  }
}

function exporterCsv(lignes: DossierSuivi[]): void {
  if (!lignes.length) {
    toast('Aucune ligne à exporter.', 'erreur');
    return;
  }
  const entetes = [
    'Dossier', 'Date', 'Responsable', 'Email', 'Telephone', 'Enfants',
    'Total', 'Paye', 'Reste', 'Moyen', 'Statut', 'Annee',
  ];
  const corps = lignes.map((d) => [
    d.code_dossier,
    horodatageFr(d.date_creation),
    `${d.prenom_responsable} ${d.nom_responsable}`,
    d.email,
    d.telephone,
    d.nombre_enfants,
    d.montant_total,
    d.montant_paye,
    d.reste_a_payer,
    d.moyen_paiement,
    d.statut_paiement,
    d.annee_scolaire,
  ]);
  telechargerCsv(`dossiers-${new Date().toISOString().slice(0, 10)}.csv`, entetes, corps);
}

