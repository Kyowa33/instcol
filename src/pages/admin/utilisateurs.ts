import {
  creerAdmin,
  listerAdmins,
  reinitialiserMotDePasse,
  supprimerAdmin,
  type CompteAdmin,
} from '../../lib/admins';
import { blocErreur, echappe, qs, toast } from '../../lib/dom';
import { dateFr } from '../../lib/format';
import { ouvrirModal } from '../../lib/modal';
import { gardeAdmin } from '../../lib/session';
import { messageErreur } from '../../lib/supabase';
import { coqueAdmin } from './layout';

const MDP_MIN = 8;

function formulaireAjout(): string {
  return `<div class="grille-2">
    <label class="champ"><span>E-mail *</span>
      <input type="email" name="email" required autocomplete="off"/></label>
    <label class="champ"><span>Mot de passe * (${MDP_MIN} caractères minimum)</span>
      <input type="password" name="motdepasse" required minlength="${MDP_MIN}" autocomplete="new-password"/></label>
    <label class="champ"><span>Confirmation *</span>
      <input type="password" name="confirmation" required minlength="${MDP_MIN}" autocomplete="new-password"/></label>
  </div>
  <p class="aide">Le nouvel administrateur pourra se connecter immédiatement
  (aucun e-mail de confirmation n'est envoyé).</p>`;
}

function formulaireNouveauMdp(): string {
  return `<div class="grille-2">
    <label class="champ"><span>Nouveau mot de passe * (${MDP_MIN} caractères minimum)</span>
      <input type="password" name="motdepasse" required minlength="${MDP_MIN}" autocomplete="new-password"/></label>
    <label class="champ"><span>Confirmation *</span>
      <input type="password" name="confirmation" required minlength="${MDP_MIN}" autocomplete="new-password"/></label>
  </div>`;
}

/** Lit mot de passe + confirmation dans la modale, lève si désalignés. */
function lireMotDePasse(voile: HTMLElement): string {
  const form = voile.querySelector('form');
  if (!form) throw new Error('Formulaire introuvable.');
  const data = new FormData(form);
  const mdp = String(data.get('motdepasse') ?? '');
  if (mdp !== String(data.get('confirmation') ?? '')) {
    throw new Error('Les deux mots de passe ne correspondent pas.');
  }
  return mdp;
}

function tableauHtml(comptes: CompteAdmin[]): string {
  if (!comptes.length) {
    return '<p class="aide">Aucun compte administrateur (anomalie : vous ne devriez pas être ici).</p>';
  }
  const lignes = comptes
    .map(
      (c, i) => `<tr>
        <td>${echappe(c.email)}${c.moi ? ' <span class="badge badge-vert">Vous</span>' : ''}</td>
        <td>${dateFr(c.cree_le)}</td>
        <td class="num no-imprimer">
          <button type="button" class="btn btn-petit" data-reset="${i}">Mot de passe</button>
          ${
            // Le compte connecté ne peut pas être supprimé (masqué côté client,
            // et refusé côté serveur par la fonction).
            c.moi
              ? ''
              : `<button type="button" class="btn btn-petit btn-danger" data-supprimer="${i}">Supprimer</button>`
          }
        </td>
      </tr>`,
    )
    .join('');
  return `<div class="tableau-enveloppe">
    <table class="tableau">
      <thead><tr><th>E-mail</th><th>Créé le</th><th class="num no-imprimer">Actions</th></tr></thead>
      <tbody>${lignes}</tbody>
    </table>
  </div>`;
}

export async function rendreUtilisateurs(racine: HTMLElement): Promise<void> {
  if (!(await gardeAdmin())) return;
  const zone = coqueAdmin(racine, 'Utilisateurs', 'utilisateurs');

  try {
    zone.innerHTML = `
      <div class="carte">
        <div class="flex-entre">
          <h2>Comptes administrateurs</h2>
          <button type="button" class="btn btn-primaire" id="btn-ajouter">+ Ajouter</button>
        </div>
        <div id="zone-comptes"><p class="chargement">Chargement…</p></div>
      </div>`;

    const zoneComptes = qs<HTMLElement>('#zone-comptes', zone);
    let comptes: CompteAdmin[] = [];

    const binder = (): void => {
      zoneComptes.querySelectorAll<HTMLButtonElement>('button[data-reset]').forEach((b) => {
        b.addEventListener('click', () => {
          const c = comptes[Number(b.dataset.reset)];
          if (!c) return;
          ouvrirModal(`Nouveau mot de passe — ${c.email}`, formulaireNouveauMdp(), async (voile) => {
            const mdp = lireMotDePasse(voile);
            await reinitialiserMotDePasse(c.id, mdp);
            voile.remove();
            toast('Mot de passe réinitialisé.', 'succes');
            await recharger();
          });
        });
      });

      zoneComptes.querySelectorAll<HTMLButtonElement>('button[data-supprimer]').forEach((b) => {
        b.addEventListener('click', () => {
          const c = comptes[Number(b.dataset.supprimer)];
          if (!c) return;
          if (!window.confirm(`Supprimer définitivement le compte ${c.email} ?`)) return;
          void (async () => {
            try {
              await supprimerAdmin(c.id);
              toast('Compte supprimé.', 'succes');
              await recharger();
            } catch (e) {
              toast(messageErreur(e), 'erreur');
            }
          })();
        });
      });
    };

    const recharger = async (): Promise<void> => {
      zoneComptes.innerHTML = '<p class="chargement">Chargement…</p>';
      try {
        comptes = await listerAdmins();
        zoneComptes.innerHTML = tableauHtml(comptes);
        binder();
      } catch (e) {
        zoneComptes.innerHTML = `<p class="aide">${echappe(messageErreur(e))}</p>`;
      }
    };

    qs('#btn-ajouter', zone).addEventListener('click', () => {
      ouvrirModal('Ajouter un administrateur', formulaireAjout(), async (voile) => {
        const email = String(new FormData(voile.querySelector('form') as HTMLFormElement).get('email') ?? '').trim();
        const mdp = lireMotDePasse(voile);
        await creerAdmin(email, mdp);
        voile.remove();
        toast('Compte administrateur créé.', 'succes');
        await recharger();
      });
    });

    await recharger();
  } catch (e) {
    zone.innerHTML = blocErreur(messageErreur(e));
  }
}