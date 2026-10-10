import './styles.css';
import { demarrerRouter, type Route } from './router';
import { rendreAccueil } from './pages/accueil';
import { rendreConfirmation } from './pages/confirmation';
import { rendreInscription } from './pages/inscription';
import { rendreConnexion } from './pages/admin/connexion';
import { rendreDashboard } from './pages/admin/dashboard';
import { rendreDossier } from './pages/admin/dossier';
import { rendreGroupes } from './pages/admin/groupes';
import { rendreParametrage } from './pages/admin/parametrage';
import { rendreNouveauMotDePasse } from './pages/admin/motdepasse';
import { rendreUtilisateurs } from './pages/admin/utilisateurs';

const racine = document.getElementById('app');
if (!racine) throw new Error("Élément racine '#app' introuvable dans index.html");

// Retour du lien « mot de passe oublié » : le jeton Supabase peut arriver dans
// le fragment de l'URL (#access_token=...&type=recovery). On le redirige vers
// la page de nouveau mot de passe pour que le routeur hash fonctionne.
if (location.hash.includes('access_token') || location.hash.includes('type=recovery')) {
  history.replaceState(
    null,
    '',
    `${location.pathname}${location.search}#/admin/nouveau-mot-de-passe`,
  );
}


const routes: Route[] = [
  { motif: /^\/$/, rendu: () => rendreAccueil(racine) },
  { motif: /^\/inscription$/, rendu: () => rendreInscription(racine) },
  { motif: /^\/confirmation$/, rendu: () => rendreConfirmation(racine) },
  { motif: /^\/admin$/, rendu: () => rendreDashboard(racine) },
  { motif: /^\/admin\/login$/, rendu: () => rendreConnexion(racine) },
  { motif: /^\/admin\/nouveau-mot-de-passe$/, rendu: () => rendreNouveauMotDePasse(racine) },
  { motif: /^\/admin\/dossier\/([^/]+)$/, rendu: (m) => rendreDossier(racine, m[1]) },
  { motif: /^\/admin\/groupes$/, rendu: () => rendreGroupes(racine) },
  { motif: /^\/admin\/utilisateurs$/, rendu: () => rendreUtilisateurs(racine) },
  { motif: /^\/admin\/parametrage$/, rendu: () => rendreParametrage(racine) },
];

demarrerRouter(routes, racine);
