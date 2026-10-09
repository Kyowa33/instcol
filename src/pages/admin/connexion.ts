import { echappe, toast } from '../../lib/dom';
import { connexionAdmin, motDePasseOublie } from '../../lib/session';
import { messageErreur } from '../../lib/supabase';
import { naviguer } from '../../router';

export function rendreConnexion(racine: HTMLElement): void {
  const formulaireConnexion = `
    <div class="carte" style="max-width:440px;margin:40px auto">
      <h1>Administration</h1>
      <p class="aide">Accès réservé aux administrateurs de la paroisse.</p>
      <form id="form-connexion">
        <label class="champ"><span>E-mail *</span>
          <input type="email" name="email" required autocomplete="username"/></label>
        <label class="champ"><span>Mot de passe *</span>
          <input type="password" name="motdepasse" required autocomplete="current-password"/></label>
        <div class="btn-groupe">
          <button type="submit" class="btn btn-primaire">Se connecter</button>
          <button type="button" class="btn" id="lien-oubli">Mot de passe oublié ?</button>
        </div>
      </form>
      <p class="aide" style="margin-top:14px"><a href="#/">← Retour au site public</a></p>
    </div>`;

  const formulaireReset = `
    <div class="carte" style="max-width:440px;margin:40px auto">
      <h1>Mot de passe oublié</h1>
      <p class="aide">Un lien de réinitialisation sera envoyé par e-mail.</p>
      <form id="form-reset">
        <label class="champ"><span>E-mail administrateur *</span>
          <input type="email" name="email" required autocomplete="username"/></label>
        <div class="btn-groupe">
          <button type="submit" class="btn btn-primaire">Envoyer le lien</button>
          <button type="button" class="btn" id="lien-retour">Retour</button>
        </div>
      </form>
    </div>`;

  racine.innerHTML = formulaireConnexion;

  racine.querySelector('#lien-oubli')?.addEventListener('click', () => {
    racine.innerHTML = formulaireReset;
    binder();
  });

  function binder(): void {
    racine.querySelector('#lien-retour')?.addEventListener('click', () => {
      racine.innerHTML = formulaireConnexion;
      binder();
    });

    racine.querySelector<HTMLFormElement>('#form-connexion')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target as HTMLFormElement;
      if (!form.reportValidity()) return;
      const data = new FormData(form);
      const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (btn) btn.disabled = true;
      void connexionAdmin(String(data.get('email') ?? ''), String(data.get('motdepasse') ?? ''))
        .then(() => {
          toast('Connexion réussie.', 'succes');
          naviguer('/admin');
        })
        .catch((e) => {
          toast(messageErreur(e), 'erreur');
          if (btn) btn.disabled = false;
        });
    });

    racine.querySelector<HTMLFormElement>('#form-reset')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const form = ev.target as HTMLFormElement;
      if (!form.reportValidity()) return;
      const email = String(new FormData(form).get('email') ?? '');
      const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (btn) btn.disabled = true;
      void motDePasseOublie(email)
        .then(() => {
          toast(`Lien envoyé à ${echappe(email)} (pensez à vérifier les indésirables).`, 'succes');
          racine.innerHTML = formulaireConnexion;
          binder();
        })
        .catch((e) => {
          toast(messageErreur(e), 'erreur');
          if (btn) btn.disabled = false;
        });
    });
  }

  binder();
}
