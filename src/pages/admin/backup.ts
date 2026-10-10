import { genererBackup, gzip } from '../../lib/backup';
import { blocErreur, echappe, qs, toast } from '../../lib/dom';
import { gardeAdmin } from '../../lib/session';
import { messageErreur, siErreur, supabase } from '../../lib/supabase';
import type { AnneeScolaire } from '../../lib/types';
import { coqueAdmin } from './layout';

function telechargerBlob(nom: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nom;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function rendreBackup(racine: HTMLElement): Promise<void> {
  if (!(await gardeAdmin())) return;
  const zone = coqueAdmin(racine, 'Backup', 'backup');

  try {
    const annees = siErreur(
      await supabase.from('annee_scolaire').select('*').order('date_debut', { ascending: false }),
    ) as AnneeScolaire[];

    zone.innerHTML = `
      <div class="carte">
        <h2>Export de sauvegarde (SQL)</h2>
        <div class="filtres">
          <label class="champ"><span>Année scolaire</span>
            <select id="f-annee">
              <option value="">Toutes les années</option>
              ${annees
                .map(
                  (a) =>
                    `<option value="${echappe(a.id)}">${echappe(a.libelle)}${a.est_active ? ' (active)' : ''}</option>`,
                )
                .join('')}
            </select></label>
          <button type="button" class="btn btn-primaire" id="btn-backup">Exporter le backup (.sql.gz)</button>
        </div>
        <p class="aide"><strong>Toutes les années</strong> : le script commence par un
        TRUNCATE de toutes les tables de données, puis ré-insère tout
        (restauration complète). <strong>Une année précise</strong> : INSERT uniquement
        (données de l'année + tables de référence), avec upsert pour un rejeu sûr.</p>
        <p class="aide">Tables incluses : annee_scolaire, lieu, activite, niveau_scolaire,
        creneau_groupe, creneau_niveau, tarif_activite, tarif_famille_param, famille,
        responsable_legal, enfant, inscription_enfant, autorisation_parentale.
        Hors périmètre : les comptes Supabase Auth (auth.users / admin_users).
        Format : données seules, <strong>sans DDL</strong> (schéma conforme aux
        migrations 0001-0003) — à rejouer dans l'éditeur SQL Supabase.</p>
        <div id="zone-backup"></div>
      </div>`;

    const zoneBackup = qs<HTMLElement>('#zone-backup', zone);
    const bouton = qs<HTMLButtonElement>('#btn-backup', zone);

    qs<HTMLSelectElement>('#f-annee', zone).addEventListener('change', () => {
      zoneBackup.innerHTML = '';
    });

    bouton.addEventListener('click', () => {
      const anneeId = qs<HTMLSelectElement>('#f-annee', zone).value || null;
      const libelle = annees.find((a) => a.id === anneeId)?.libelle ?? '';
      bouton.disabled = true;
      zoneBackup.innerHTML = '<p class="chargement">Génération du backup…</p>';
      void (async () => {
        try {
          const res = await genererBackup(anneeId, libelle);
          const compresse = await gzip(res.sql);
          const blob = compresse ?? new Blob([res.sql], { type: 'text/sql;charset=utf-8' });
          const nom = compresse ? res.nomFichier : res.nomFichier.replace(/\.gz$/, '');
          telechargerBlob(nom, blob);
          const poids = `${(blob.size / 1024).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} Ko`;
          zoneBackup.innerHTML = `<p class="aide">Dernier export :
            ${echappe(nom)} — ${res.nombreLignes} ligne${res.nombreLignes > 1 ? 's' : ''}, ${poids}
            ${compresse ? '(gzip)' : '— compression gzip non supportée par ce navigateur, fichier non compressé'}.</p>`;
          toast('Backup généré.', 'succes');
        } catch (e) {
          zoneBackup.innerHTML = '';
          toast(messageErreur(e), 'erreur');
        } finally {
          bouton.disabled = false;
        }
      })();
    });
  } catch (e) {
    zone.innerHTML = blocErreur(messageErreur(e));
  }
}