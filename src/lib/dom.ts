/** Échappe une valeur pour l'insérer dans du HTML généré. */
export function echappe(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Sélecteur typé qui lève une erreur explicite si l'élément est absent. */
export function qs<T extends Element>(sel: string, racine: ParentNode = document): T {
  const el = racine.querySelector(sel);
  if (!el) throw new Error(`Élément introuvable : ${sel}`);
  return el as T;
}

/** Petit toast en bas d'écran (succès / erreur / info). */
export function toast(message: string, type: 'info' | 'succes' | 'erreur' = 'info'): void {
  let zone = document.getElementById('toasts');
  if (!zone) {
    zone = document.createElement('div');
    zone.id = 'toasts';
    document.body.appendChild(zone);
  }
  const bulle = document.createElement('div');
  bulle.className = `toast toast-${type}`;
  bulle.textContent = message;
  zone.appendChild(bulle);
  window.setTimeout(() => bulle.remove(), type === 'erreur' ? 7000 : 4000);
}

/** Bloc d'erreur standard affiché au centre des pages. */
export function blocErreur(message: string): string {
  return `<div class="carte erreur-palette"><h2>Impossible de charger la page</h2>
    <p>${echappe(message)}</p>
    <p class="aide">Vérifiez la connexion à Supabase (fichier <code>.env</code>) et que les
    migrations SQL ont bien été exécutées.</p>
    <p><a class="btn btn-primaire" href="#/">Retour à l'accueil</a></p></div>`;
}

/** Bouton standard. */
export function btn(label: string, classe = 'btn'): string {
  return `<button type="button" class="${classe}">${label}</button>`;
}
