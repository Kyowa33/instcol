import { blocErreur, echappe, qs, toast } from '../../lib/dom';
import { dateFr, euros, heureFr, horodatageFr } from '../../lib/format';
import { gardeAdmin } from '../../lib/session';
import { messageErreur, siErreur, supabase } from '../../lib/supabase';
import type {
  AutorisationParentale,
  Enfant,
  Famille,
  ResponsableLegal,
  StatutPaiement,
} from '../../lib/types';
import { naviguer } from '../../router';
import { coqueAdmin } from './layout';

interface InscriptionLiee {
  id: string;
  creneau_groupe: {
    id: string;
    jour_semaine: string;
    horaire_debut: string | null;
    horaire_fin: string | null;
    precision_frequence: string | null;
    activite: { nom: string } | null;
    lieu: { nom: string } | null;
  } | null;
}

type EnfantLie = Enfant & { inscription_enfant: InscriptionLiee[] | null };
type FamilleLiee = Famille & { annee_scolaire: { libelle: string } | null };

export async function rendreDossier(racine: HTMLElement, id: string): Promise<void> {
  if (!(await gardeAdmin())) return;
  const zone = coqueAdmin(racine, 'Détail du dossier', 'dossiers');

  try {
    const famille = siErreur(
      await supabase.from('famille').select('*, annee_scolaire(libelle)').eq('id', id).maybeSingle(),
    ) as FamilleLiee | null;
    if (!famille) throw new Error('Dossier introuvable (ou accès refusé).');

    const responsables = siErreur(
      await supabase
        .from('responsable_legal')
        .select('*')
        .eq('famille_id', id)
        .order('est_principal', { ascending: false }),
    ) as ResponsableLegal[];

    const enfants = siErreur(
      await supabase.from('enfant').select(
        `*, inscription_enfant(id, creneau_groupe(id, jour_semaine, horaire_debut, horaire_fin,
           precision_frequence, activite(nom), lieu(nom)))`,
      ).eq('famille_id', id),
    ) as EnfantLie[];

    const autorisation = siErreur(
      await supabase.from('autorisation_parentale').select('*').eq('famille_id', id).maybeSingle(),
    ) as AutorisationParentale | null;

    const reste = Number(famille.montant_total) - Number(famille.montant_paye ?? 0);

    const lignesResponsables = responsables
      .map(
        (r) => `<div class="ligne-info">
          <strong>${r.est_principal ? 'Référent' : 'Responsable'}</strong>
          <span>${echappe(`${r.prenom} ${r.nom}`)}<br/>
          ${echappe(r.adresse)}, ${echappe(r.code_postal)} ${echappe(r.ville)}<br/>
          ${echappe(r.telephone)} — ${echappe(r.email)}</span></div>`,
      )
      .join('');

    const lignesEnfants = enfants
      .map((e) => {
        const groupes = (e.inscription_enfant ?? [])
          .map((i) => {
            const cg = i.creneau_groupe;
            if (!cg) return 'Groupe supprimé';
            const h =
              cg.horaire_debut && cg.horaire_fin
                ? ` ${heureFr(cg.horaire_debut)}-${heureFr(cg.horaire_fin)}`
                : '';
            return `${cg.activite?.nom ?? 'Activité'} — ${cg.lieu?.nom ?? 'Lieu'} — ${cg.jour_semaine}${h}` +
              `${cg.precision_frequence ? ` (${cg.precision_frequence})` : ''}`;
          })
          .join('<br/>');
        const sante = (e.donnees_extra as { sante?: string } | null)?.sante;
        return `<tr>
          <td><strong>${echappe(`${e.prenom} ${e.nom}`)}</strong><br/><span class="aide">${e.sexe === 'M' ? 'Garçon' : 'Fille'}</span></td>
          <td>${dateFr(e.date_naissance)}</td>
          <td>${echappe(e.classe_frequentee)}<br/><span class="aide">${echappe(e.etablissement)}</span></td>
          <td>${e.est_baptise ? '<span class="badge">baptisé(e)</span> ' : ''}${
            e.est_confirme ? '<span class="badge">confirmé(e)</span> ' : ''
          }${e.premiere_communion ? `<span class="badge badge-vert">1ère communion ${dateFr(e.date_communion)}</span>` : ''}</td>
          <td>${echappe(e.telephone_enfant ?? '—')}</td>
          <td>${groupes || '—'}</td>
          <td>${sante ? echappe(sante) : '—'}</td>
        </tr>`;
      })
      .join('');

    const infoAutorisation = autorisation
      ? `<div class="ligne-info"><strong>Signée à</strong><span>${echappe(autorisation.fait_a)} — ${horodatageFr(autorisation.date_signature)}</span></div>
         <div class="ligne-info"><strong>Signataire</strong><span>${echappe(autorisation.nom_signataire)}</span></div>
         <div class="ligne-info"><strong>Activités</strong><span>${autorisation.autorise_activites ? 'autorisées' : 'refusées'}</span></div>
         <div class="ligne-info"><strong>Mesures médicales</strong><span>${autorisation.autorise_mesures_medicales ? 'autorisées' : 'refusées'}</span></div>
         <div class="ligne-info"><strong>RGPD</strong><span>${autorisation.consentement_rgpd ? 'accepté' : 'refusé'}</span></div>
         <div class="ligne-info"><strong>Droit à l'image</strong><span>${autorisation.droit_image ? 'oui' : 'non'}</span></div>`
      : '<p class="aide">Aucune autorisation enregistrée.</p>';

    zone.innerHTML = `
      <p class="no-imprimer"><a class="btn" href="#/admin">← Retour aux dossiers</a></p>

      <div class="carte">
        <div class="flex-entre">
          <h2>${echappe(famille.code_dossier)}</h2>
          <span>${famille.statut_paiement === 'VALIDE'
            ? '<span class="badge badge-vert">Paiement validé</span>'
            : '<span class="badge badge-orange">En attente</span>'}</span>
        </div>
        <div class="ligne-info"><strong>Année scolaire</strong><span>${echappe(famille.annee_scolaire?.libelle ?? '—')}</span></div>
        <div class="ligne-info"><strong>Créé le</strong><span>${horodatageFr(famille.date_creation)}</span></div>
        <div class="ligne-info"><strong>Frais</strong><span>${euros(famille.montant_total)} — payé ${euros(famille.montant_paye ?? 0)} — reste ${euros(reste)}</span></div>
        <div class="ligne-info"><strong>Règlement</strong><span>${famille.moyen_paiement === 'CHEQUE' ? 'Chèque' : 'Espèces'}${
          famille.num_cheque ? ` — n° ${echappe(famille.num_cheque)}${famille.banque_cheque ? ` (${echappe(famille.banque_cheque)})` : ''}` : ''
        }</span></div>
        ${famille.commentaire_famille
          ? `<div class="ligne-info"><strong>Remarque famille</strong><span>${echappe(famille.commentaire_famille)}</span></div>`
          : ''}
      </div>

      <div class="carte">
        <h3>Responsables légaux</h3>
        ${lignesResponsables || '<p class="aide">Aucun responsable.</p>'}
      </div>

      <div class="carte">
        <h3>Enfants (${enfants.length})</h3>
        <div class="tableau-enveloppe">
          <table class="tableau">
            <thead><tr>
              <th>Enfant</th><th>Naissance</th><th>Classe</th><th>Sacrements</th>
              <th>Portable</th><th>Groupe(s)</th><th>Santé</th>
            </tr></thead>
            <tbody>${lignesEnfants || '<tr><td colspan="7">Aucun enfant.</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <div class="carte">
        <h3>Autorisation parentale</h3>
        ${infoAutorisation}
      </div>

      <div class="carte no-imprimer">
        <h3>Suivi administrateur</h3>
        <form id="form-suivi">
          <div class="grille-2">
            <label class="champ"><span>Montant encaissé (€)</span>
              <input type="number" name="montant_paye" step="0.01" min="0"
                value="${famille.montant_paye ?? ''}"/></label>
            <label class="champ"><span>Statut de paiement</span>
              <select name="statut_paiement">
                <option value="EN_ATTENTE" ${famille.statut_paiement === 'EN_ATTENTE' ? 'selected' : ''}>En attente</option>
                <option value="VALIDE" ${famille.statut_paiement === 'VALIDE' ? 'selected' : ''}>Validé</option>
              </select></label>
          </div>
          <label class="champ"><span>Notes internes (réservé aux administrateurs)</span>
            <textarea name="commentaire_admin">${echappe(famille.commentaire_admin ?? '')}</textarea></label>
          <div class="btn-groupe">
            <button type="submit" class="btn btn-primaire">Enregistrer le suivi</button>
            <button type="button" class="btn btn-danger" id="btn-supprimer">Supprimer le dossier</button>
          </div>
        </form>
      </div>`;

    qs<HTMLFormElement>('#form-suivi', zone).addEventListener('submit', (ev) => {
      ev.preventDefault();
      const data = new FormData(ev.target as HTMLFormElement);
      const brut = String(data.get('montant_paye') ?? '').trim();
      const maj = {
        montant_paye: brut === '' ? null : Number(brut.replace(',', '.')),
        statut_paiement: String(data.get('statut_paiement')) as StatutPaiement,
        commentaire_admin: String(data.get('commentaire_admin') ?? '').trim() || null,
      };
      void (async () => {
        try {
          const { error } = await supabase.from('famille').update(maj).eq('id', id);
          if (error) throw new Error(error.message);
          toast('Suivi enregistré.', 'succes');
          await rendreDossier(racine, id);
        } catch (e) {
          toast(messageErreur(e), 'erreur');
        }
      })();
    });

    qs('#btn-supprimer', zone).addEventListener('click', () => {
      if (!window.confirm(`Supprimer définitivement le dossier ${famille.code_dossier} ?`)) return;
      void (async () => {
        try {
          const { error } = await supabase.from('famille').delete().eq('id', id);
          if (error) throw new Error(error.message);
          toast('Dossier supprimé.', 'succes');
          naviguer('/admin');
        } catch (e) {
          toast(messageErreur(e), 'erreur');
        }
      })();
    });
  } catch (e) {
    zone.innerHTML = blocErreur(messageErreur(e));
  }
}

