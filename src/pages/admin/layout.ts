import { echappe, qs } from '../../lib/dom';
import { deconnexion, emailConnecte } from '../../lib/session';

/**
 * Coque commune de l'espace administrateur : barre de navigation + titre.
 * Retourne la zone de contenu à remplir par la page appelante.
 */
export function coqueAdmin(
  racine: HTMLElement,
  titre: string,
  actif: 'dossiers' | 'groupes' | 'utilisateurs' | 'parametrage',
): HTMLElement {
  racine.innerHTML = `<div class="barre">
      <a class="marque" href="#/">Paroisse Saint-Colomban — administration</a>
      <nav>
        <a href="#/admin" class="${actif === 'dossiers' ? 'actif' : ''}">Dossiers</a>
        <a href="#/admin/groupes" class="${actif === 'groupes' ? 'actif' : ''}">Groupes</a>
        <a href="#/admin/utilisateurs" class="${actif === 'utilisateurs' ? 'actif' : ''}">Utilisateurs</a>
        <a href="#/admin/parametrage" class="${actif === 'parametrage' ? 'actif' : ''}">Paramétrage</a>
        <a href="#/">Site public</a>
        <a href="#/admin/login" id="lien-deconnexion">Déconnexion</a>
      </nav>
    </div>
    <div class="conteneur">
      <div class="flex-entre">
        <h1>${echappe(titre)}</h1>
        <span class="aide" id="info-compte"></span>
      </div>
      <div id="zone-contenu"><p class="chargement">Chargement…</p></div>
    </div>`;

  racine.querySelector('#lien-deconnexion')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    void deconnexion();
  });

  void emailConnecte().then((email) => {
    const el = racine.querySelector('#info-compte');
    if (el && email) el.textContent = `Connecté : ${email}`;
  });

  return qs<HTMLElement>('#zone-contenu', racine);
}
