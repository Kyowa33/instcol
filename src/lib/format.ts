const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** 2024-09-01 -> 01/09/2024 */
export function dateFr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [a, m, j] = iso.slice(0, 10).split('-');
  if (!a || !m || !j) return iso;
  return `${j}/${m}/${a}`;
}

/** 2024-11-05 -> 5 nov. 2024 (date longue relative, pour les journaux) */
export function dateLongueFr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return dateFr(iso);
  return `${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`;
}

/** 10:00:00 -> 10h00 */
export function heureFr(iso: string | null | undefined): string {
  if (!iso) return '';
  const [h, m] = iso.split(':');
  if (m === '00' || m === undefined) return `${h}h`;
  return `${h}h${m}`;
}

/** Horaires d'un créneau -> « 10h00 - 11h00 » ou '' */
export function plageHeures(debut: string | null | undefined, fin: string | null | undefined): string {
  if (!debut && !fin) return '';
  if (debut && fin) return `${heureFr(debut)} - ${heureFr(fin)}`;
  return heureFr(debut) || heureFr(fin);
}

/** 1234.5 -> 1 234,50 € */
export function euros(montant: number | string | null | undefined): string {
  const n = Number(montant ?? 0);
  return `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** timestamptz -> 05/11/2024 14:32 */
export function horodatageFr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ` +
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
