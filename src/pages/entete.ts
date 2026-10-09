/** Barre de navigation commune (masquée à l'impression). */
export function barreNavigation(actif: 'accueil' | 'inscription' | 'admin' | ''): string {
  return `<div class="barre no-imprimer">
    <a class="marque" href="#/">Paroisse Saint-Colomban</a>
    <nav>
      <a href="#/" class="${actif === 'accueil' ? 'actif' : ''}">Accueil</a>
      <a href="#/inscription" class="${actif === 'inscription' ? 'actif' : ''}">Formulaire d'inscription</a>
      <a href="#/admin" class="${actif === 'admin' ? 'actif' : ''}">Espace administrateur</a>
    </nav>
  </div>`;
}

/** En-tête héros des pages publiques. */
export function enteteHeros(titre: string, sousTitre: string): string {
  return `<header class="entete">
    <h1>${titre}</h1>
    <p class="sous-titre">${sousTitre}</p>
  </header>`;
}
