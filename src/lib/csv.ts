/** Échappe une cellule CSV (séparateur « ; », guillemets doublés). */
function cellule(c: string | number): string {
  return `"${String(c).replace(/"/g, '""')}"`;
}

/**
 * Construit un CSV (Excel-friendly : BOM UTF-8, séparateur « ; »,
 * lignes CRLF) et déclenche son téléchargement.
 */
export function telechargerCsv(
  nomFichier: string,
  entetes: string[],
  lignes: (string | number)[][],
): void {
  const csv = [entetes, ...lignes].map((r) => r.map(cellule).join(';')).join('\r\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nomFichier;
  a.click();
  URL.revokeObjectURL(a.href);
}