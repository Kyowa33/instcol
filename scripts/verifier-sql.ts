// Contrôle de syntaxe SQL des migrations (parseur PostgreSQL réel — libpg_query).
// Utilisation : bun run check:sql
import { parse } from 'pgsql-parser';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const dossier = path.join(import.meta.dir, '..', 'supabase', 'migrations');
const fichiers = (await readdir(dossier)).filter((f) => f.endsWith('.sql')).sort();

let erreurs = 0;
for (const fichier of fichiers) {
  const sql = await readFile(path.join(dossier, fichier), 'utf8');
  try {
    const ast = (await parse(sql)) as { stmts?: unknown[] } | unknown[];
    const nombre = Array.isArray(ast)
      ? ast.length
      : ((ast as { stmts?: unknown[] }).stmts?.length ?? 0);
    console.log(`OK  ${fichier} : ${nombre} instruction(s) SQL analysée(s)`);
  } catch (e) {
    erreurs += 1;
    console.error(`ECHEC  ${fichier}`);
    console.error(e instanceof Error ? e.message : e);
  }
}

process.exit(erreurs ? 1 : 0);
