import { echappe, toast } from './dom';
import { messageErreur } from './supabase';

/**
 * Ouvre une modale contenant un formulaire.
 * `onValider` reçoit le voile (l'appelant le ferme via `voile.remove()`).
 * Les erreurs levées sont affichées en toast et réactivent le bouton.
 */
export function ouvrirModal(
  titre: string,
  corps: string,
  onValider: (voile: HTMLElement) => Promise<void>,
): void {
  const voile = document.createElement('div');
  voile.className = 'voile';
  voile.innerHTML = `<div class="boite">
      <h2>${echappe(titre)}</h2>
      <form id="form-modal">${corps}
        <div class="btn-groupe">
          <button type="submit" class="btn btn-primaire">Enregistrer</button>
          <button type="button" class="btn" data-annuler>Annuler</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(voile);

  voile.querySelector('[data-annuler]')?.addEventListener('click', () => voile.remove());
  voile.addEventListener('click', (ev) => {
    if (ev.target === voile) voile.remove();
  });
  voile.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = ev.target as HTMLFormElement;
    if (!form.reportValidity()) return;
    const btn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (btn) btn.disabled = true;
    onValider(voile).catch((e) => {
      toast(messageErreur(e), 'erreur');
      if (btn) btn.disabled = false;
    });
  });
}