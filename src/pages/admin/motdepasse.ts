import { toast } from '../../lib/dom';
import { changerMotDePasse, estAdmin } from '../../lib/session';
import { messageErreur } from '../../lib/supabase';
import { naviguer } from '../../router';

/** Page de définition d'un nouveau mot de passe (lien de réinitialisation e-mail). */
export function rendreNouveauMotDePasse(racine: HTMLElement): void {
  racine.innerHTML = `<div class="conteneur">
    <div class="carte" style="max-width:440px;margin:40px auto">
      <h1>Nouveau mot de passe</h1>
      <form id="form-mdp">
        <label class="champ"><span>Nouveau mot de passe * (8 caractères minimum)</span>
          <input type="password" name="motdepasse" required minlength="8" autocomplete="new-password"/></label>
        <label class="champ"><span>Confirmation *</span>
          <input type="password" name="confirmation" required minlength="8" autocomplete="new-password"/></label>
        <div class="btn-groupe">
          <button type="submit" class="btn btn-primaire">Mettre à jour</button>
        </div>
      </form>
      <p class="aide" style="margin-top:14px"><a href="#/admin/login">Retour à la connexion</a></p>
    </div>
  </div>`;

  racine.querySelector<HTMLFormElement>('#form-mdp')?.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = ev.target as HTMLFormElement;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const mdp = String(data.get('motdepasse') ?? '');
    if (mdp !== String(data.get('confirmation') ?? '')) {
      toast('Les deux mots de passe ne correspondent pas.', 'erreur');
      return;
    }
    void changerMotDePasse(mdp)
      .then(async () => {
        toast('Mot de passe mis à jour.', 'succes');
        if (await estAdmin()) naviguer('/admin');
        else naviguer('/admin/login');
      })
      .catch((e) => toast(messageErreur(e), 'erreur'));
  });
}
