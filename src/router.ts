import { blocErreur } from './lib/dom';

export interface Route {
  /** Regex testée sur le chemin après le '#' (ex. ^/admin/dossier/(.+)$) */
  motif: RegExp;
  rendu: (m: RegExpMatchArray) => void | Promise<void>;
}

let racine: HTMLElement = document.body;
let routes: Route[] = [];
let enCours = false;

export function naviguer(chemin: string): void {
  location.hash = chemin.startsWith('#') ? chemin : `#${chemin}`;
}

export function cheminActuel(): string {
  return location.hash.slice(1) || '/';
}

async function traiter(): Promise<void> {
  if (enCours) return;
  enCours = true;
  const chemin = cheminActuel();
  try {
    for (const r of routes) {
      const m = chemin.match(r.motif);
      if (m) {
        racine.innerHTML = '';
        window.scrollTo(0, 0);
        await r.rendu(m);
        return;
      }
    }
    // 404 -> accueil
    racine.innerHTML = `<div class="conteneur"><div class="carte">
      <h1>Page introuvable</h1><p><a class="btn btn-primaire" href="#/">Retour à l'accueil</a></p>
    </div></div>`;
  } catch (e) {
    racine.innerHTML = `<div class="conteneur">${blocErreur(e instanceof Error ? e.message : String(e))}</div>`;
  } finally {
    enCours = false;
  }
}

export function demarrerRouter(liste: Route[], elementRacine: HTMLElement): void {
  routes = liste;
  racine = elementRacine;
  window.addEventListener('hashchange', () => void traiter());
  void traiter();
}
