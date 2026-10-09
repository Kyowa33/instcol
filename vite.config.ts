import { defineConfig } from 'vite';

// base './' : l'app fonctionne depuis n'importe quel sous-dossier d'hébergement statique
// (le routeur est à base de hash => aucune réécriture de route côté serveur nécessaire).
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 8000,
  },
});
