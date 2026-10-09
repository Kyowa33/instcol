import { blocErreur, echappe, qs, toast } from '../../lib/dom';
import { dateFr, heureFr } from '../../lib/format';
import { oublierParametrage } from '../../lib/parametrage';
import { gardeAdmin } from '../../lib/session';
import { messageErreur, siErreur, supabase } from '../../lib/supabase';
import type { Activite, AnneeScolaire, Lieu, NiveauScolaire } from '../../lib/types';
import { coqueAdmin } from './layout';

interface Option {
  v: string;
  l: string;
}

type TypeChamp = 'texte' | 'nombre' | 'date' | 'heure' | 'case' | 'select' | 'zone';

interface ChampCfg {
  cle: string;
  label: string;
  type: TypeChamp;
  requis?: boolean;
  pas?: string;
  options?: () => Option[];
}

interface TableCfg {
  cle: string;
  titre: string;
  table: string;
  tri: string;
  colonnes: ChampCfg[];
  affichage: string[];
  speciale?: 'annee' | 'tarif_famille' | 'tarif_activite' | 'creneau';
  messageVide: string;
}

type Ligne = Record<string, unknown>;

// Listes de référence chargées une fois pour alimenter les menus déroulants.
let annees: AnneeScolaire[] = [];
let lieux: Lieu[] = [];
let activites: Activite[] = [];
let niveaux: NiveauScolaire[] = [];

const optAnnees = (): Option[] =>
  annees.map((a) => ({ v: a.id, l: `${a.libelle}${a.est_active ? ' (active)' : ''}` }));
const optLieux = (): Option[] => lieux.map((l) => ({ v: l.id, l: l.nom }));
const optActivites = (): Option[] => activites.map((a) => ({ v: a.id, l: a.nom }));
const optNiveaux = (): Option[] => niveaux.map((n) => ({ v: n.id, l: n.libelle }));
const JOURS: Option[] = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].map(
  (j) => ({ v: j, l: j }),
);

const ONGLETS: TableCfg[] = [
  {
    cle: 'annees',
    titre: 'Années scolaires',
    table: 'annee_scolaire',
    tri: 'date_debut',
    speciale: 'annee',
    messageVide: 'Aucune année scolaire.',
    colonnes: [
      { cle: 'libelle', label: 'Libellé (ex. 2025-2026)', type: 'texte', requis: true },
      { cle: 'date_debut', label: 'Début (01/09)', type: 'date', requis: true },
      { cle: 'date_fin', label: 'Fin (30/06)', type: 'date', requis: true },
      { cle: 'est_active', label: 'Année active — inscriptions ouvertes', type: 'case' },
    ],
    affichage: ['libelle', 'date_debut', 'date_fin', 'est_active'],
  },
  {
    cle: 'lieux',
    titre: 'Lieux',
    table: 'lieu',
    tri: 'nom',
    messageVide: 'Aucun lieu.',
    colonnes: [
      { cle: 'nom', label: 'Nom', type: 'texte', requis: true },
      { cle: 'adresse', label: 'Adresse', type: 'zone' },
    ],
    affichage: ['nom', 'adresse'],
  },
  {
    cle: 'activites',
    titre: 'Activités',
    table: 'activite',
    tri: 'nom',
    messageVide: 'Aucune activité.',
    colonnes: [
      { cle: 'code', label: 'Code (ex. EVEIL)', type: 'texte', requis: true },
      { cle: 'nom', label: 'Nom affiché', type: 'texte', requis: true },
    ],
    affichage: ['code', 'nom'],
  },
  {
    cle: 'niveaux',
    titre: 'Niveaux scolaires',
    table: 'niveau_scolaire',
    tri: 'ordre_affichage',
    messageVide: 'Aucun niveau.',
    colonnes: [
      { cle: 'code', label: 'Code (ex. CE2_CM2)', type: 'texte', requis: true },
      { cle: 'libelle', label: 'Libellé (ex. CE2 à CM2)', type: 'texte', requis: true },
      { cle: 'ordre_affichage', label: "Ordre d'affichage", type: 'nombre', requis: true },
    ],
    affichage: ['ordre_affichage', 'code', 'libelle'],
  },
  {
    cle: 'creneaux',
    titre: 'Créneaux / groupes',
    table: 'creneau_groupe',
    tri: 'jour_semaine',
    speciale: 'creneau',
    messageVide: 'Aucun créneau.',
    colonnes: [
      { cle: 'annee_scolaire_id', label: 'Année scolaire', type: 'select', requis: true, options: optAnnees },
      { cle: 'activite_id', label: 'Activité', type: 'select', requis: true, options: optActivites },
      { cle: 'lieu_id', label: 'Lieu', type: 'select', requis: true, options: optLieux },
      { cle: 'jour_semaine', label: 'Jour', type: 'select', requis: true, options: () => JOURS },
      { cle: 'horaire_debut', label: 'Horaire début', type: 'heure' },
      { cle: 'horaire_fin', label: 'Horaire fin', type: 'heure' },
      { cle: 'precision_frequence', label: 'Précision / fréquence', type: 'zone' },
      { cle: 'capacite_max', label: 'Capacité max (indicative)', type: 'nombre' },
    ],
    affichage: [
      'annee_scolaire_id', 'activite_id', 'lieu_id', 'jour_semaine',
      'horaire_debut', 'horaire_fin', 'capacite_max',
    ],
  },
  {
    cle: 'tarifs_activite',
    titre: 'Tarifs par activité',
    table: 'tarif_activite',
    tri: 'annee_scolaire_id',
    speciale: 'tarif_activite',
    messageVide: 'Aucun tarif.',
    colonnes: [
      { cle: 'annee_scolaire_id', label: 'Année scolaire', type: 'select', requis: true, options: optAnnees },
      { cle: 'activite_id', label: 'Activité', type: 'select', requis: true, options: optActivites },
      { cle: 'montant', label: 'Montant par enfant (€)', type: 'nombre', requis: true, pas: '0.01' },
    ],
    affichage: ['annee_scolaire_id', 'activite_id', 'montant'],
  },
  {
    cle: 'tarif_famille',
    titre: 'Frais de dossier',
    table: 'tarif_famille_param',
    tri: 'annee_scolaire_id',
    speciale: 'tarif_famille',
    messageVide: 'Aucun frais de dossier.',
    colonnes: [
      { cle: 'annee_scolaire_id', label: 'Année scolaire', type: 'select', requis: true, options: optAnnees },
      { cle: 'frais_fixe_famille', label: 'Frais fixes par famille (€)', type: 'nombre', requis: true, pas: '0.01' },
    ],
    affichage: ['annee_scolaire_id', 'frais_fixe_famille'],
  },
];

/* ---------------------------------------------------------------------- */
/* Affichage des tableaux                                                  */
/* ---------------------------------------------------------------------- */

function valeurCellule(cfg: TableCfg, cle: string, ligne: Ligne): string {
  const champ = cfg.colonnes.find((c) => c.cle === cle);
  const v = ligne[cle];
  if (!champ) return echappe(String(v ?? '—'));
  switch (champ.type) {
    case 'case':
      return v ? 'oui' : 'non';
    case 'date':
      return dateFr(String(v ?? ''));
    case 'heure':
      return heureFr(String(v ?? '')) || '—';
    case 'select': {
      const opt = champ.options?.().find((o) => o.v === String(v));
      return echappe(opt?.l ?? '—');
    }
    case 'nombre':
      return String(v ?? '—');
    default:
      return echappe(String(v ?? '—'));
  }
}

function tableauHtml(cfg: TableCfg, lignes: Ligne[]): string {
  if (!lignes.length) {
    return `<p class="aide">${echappe(cfg.messageVide)}</p>`;
  }
  const entetes = cfg.affichage
    .map((cle) => `<th>${echappe(cfg.colonnes.find((c) => c.cle === cle)?.label ?? cle)}</th>`)
    .join('');
  const corps = lignes
    .map(
      (ligne, i) => `<tr>
        ${cfg.affichage.map((cle) => `<td>${valeurCellule(cfg, cle, ligne)}</td>`).join('')}
        <td class="num">
          <button type="button" class="btn btn-petit" data-modifier="${i}">Modifier</button>
          <button type="button" class="btn btn-petit btn-danger" data-supprimer="${i}">Supprimer</button>
        </td>
      </tr>`,
    )
    .join('');
  return `<div class="tableau-enveloppe">
    <table class="tableau">
      <thead><tr>${entetes}<th class="num">Actions</th></tr></thead>
      <tbody>${corps}</tbody>
    </table>
  </div>`;
}

/* ---------------------------------------------------------------------- */
/* Formulaire modal                                                        */
/* ---------------------------------------------------------------------- */

function champModal(c: ChampCfg, valeur: unknown): string {
  const label = `${echappe(c.label)}${c.requis ? ' *' : ''}`;
  switch (c.type) {
    case 'case':
      return `<label class="case"><input type="checkbox" name="${c.cle}" ${valeur ? 'checked' : ''}/>
        <span>${label}</span></label>`;
    case 'zone':
      return `<label class="champ"><span>${label}</span>
        <textarea name="${c.cle}" ${c.requis ? 'required' : ''}>${echappe(String(valeur ?? ''))}</textarea></label>`;
    case 'select': {
      const options = (c.options?.() ?? [])
        .map(
          (o) =>
            `<option value="${echappe(o.v)}" ${String(valeur ?? '') === o.v ? 'selected' : ''}>${echappe(o.l)}</option>`,
        )
        .join('');
      const vide = c.requis ? '' : '<option value="">—</option>';
      return `<label class="champ"><span>${label}</span>
        <select name="${c.cle}" ${c.requis ? 'required' : ''}>${vide}${options}</select></label>`;
    }
    case 'date':
      return `<label class="champ"><span>${label}</span>
        <input type="date" name="${c.cle}" ${c.requis ? 'required' : ''} value="${echappe(String(valeur ?? '').slice(0, 10))}"/></label>`;
    case 'heure':
      return `<label class="champ"><span>${label}</span>
        <input type="time" name="${c.cle}" value="${echappe(String(valeur ?? '').slice(0, 5))}"/></label>`;
    case 'nombre':
      return `<label class="champ"><span>${label}</span>
        <input type="number" name="${c.cle}" step="${c.pas ?? '1'}" ${c.requis ? 'required' : ''}
          value="${valeur === null || valeur === undefined ? '' : echappe(String(valeur))}"/></label>`;
    default:
      return `<label class="champ"><span>${label}</span>
        <input type="text" name="${c.cle}" ${c.requis ? 'required' : ''} value="${echappe(String(valeur ?? ''))}"/></label>`;
  }
}

function blocNiveaux(niveauxChoisis: Set<string>): string {
  const options = optNiveaux();
  if (!options.length) return '';
  return `<fieldset><legend>Niveaux scolaires autorisés pour ce créneau</legend>
    ${options
      .map(
        (o) => `<label class="case"><input type="checkbox" data-niveau value="${o.v}"
          ${niveauxChoisis.has(o.v) ? 'checked' : ''}/><span>${echappe(o.l)}</span></label>`,
      )
      .join('')}
  </fieldset>`;
}

function defaut(c: ChampCfg): unknown {
  if (c.type === 'case') return false;
  if (c.type === 'select' && c.cle === 'annee_scolaire_id') {
    return annees.find((a) => a.est_active)?.id ?? '';
  }
  return '';
}

function formHtml(cfg: TableCfg, ligne: Ligne | null, niveauxChoisis: Set<string>): string {
  const champs = cfg.colonnes.map((c) => champModal(c, ligne ? ligne[c.cle] : defaut(c))).join('');
  const bloc = cfg.speciale === 'creneau' ? blocNiveaux(niveauxChoisis) : '';
  return `<div class="grille-2">${champs}</div>${bloc}`;
}

function ouvrirModal(
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
    onValider(voile)
      .catch((e) => {
        toast(messageErreur(e), 'erreur');
        if (btn) btn.disabled = false;
      });
  });
}

function lireValeurs(voile: HTMLElement, cfg: TableCfg): Ligne {
  const v: Ligne = {};
  for (const c of cfg.colonnes) {
    const el = voile.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      `[name="${c.cle}"]`,
    );
    if (!el) continue;
    if (c.type === 'case') {
      v[c.cle] = el instanceof HTMLInputElement ? el.checked : false;
    } else if (c.type === 'nombre') {
      const brut = el.value.trim();
      v[c.cle] = brut === '' ? null : Number(brut.replace(',', '.'));
    } else {
      v[c.cle] = el.value === '' ? null : el.value;
    }
  }
  return v;
}

async function enregistrerLigne(
  cfg: TableCfg,
  valeurs: Ligne,
  id: string | null,
  voile: HTMLElement,
): Promise<void> {
  const niveauxChoisis = Array.from(
    voile.querySelectorAll<HTMLInputElement>('input[data-niveau]:checked'),
  ).map((i) => i.value);

  // Une seule année active à la fois
  if (cfg.speciale === 'annee' && valeurs.est_active === true) {
    siErreur(await supabase.from('annee_scolaire').update({ est_active: false }).neq('id', id ?? ''));
  }

  let ligneId = id;

  // Clés uniques : mise à jour si la ligne existe déjà
  if (!id && cfg.speciale === 'tarif_activite') {
    const ex = siErreur(
      await supabase
        .from('tarif_activite')
        .select('id')
        .eq('annee_scolaire_id', String(valeurs.annee_scolaire_id))
        .eq('activite_id', String(valeurs.activite_id))
        .maybeSingle(),
    ) as { id: string } | null;
    if (ex) ligneId = ex.id;
  }
  if (!id && cfg.speciale === 'tarif_famille') {
    const ex = siErreur(
      await supabase
        .from('tarif_famille_param')
        .select('id')
        .eq('annee_scolaire_id', String(valeurs.annee_scolaire_id))
        .maybeSingle(),
    ) as { id: string } | null;
    if (ex) ligneId = ex.id;
  }

  if (ligneId) {
    siErreur(await supabase.from(cfg.table).update(valeurs).eq('id', ligneId));
  } else {
    const ins = siErreur(
      await supabase.from(cfg.table).insert(valeurs).select('id').single(),
    ) as { id: string };
    ligneId = ins.id;
  }

  // Liaison M:N créneau <-> niveaux
  if (cfg.speciale === 'creneau' && ligneId) {
    siErreur(await supabase.from('creneau_niveau').delete().eq('creneau_groupe_id', ligneId));
    if (niveauxChoisis.length) {
      siErreur(
        await supabase.from('creneau_niveau').insert(
          niveauxChoisis.map((n) => ({
            creneau_groupe_id: ligneId,
            niveau_scolaire_id: n,
          })),
        ),
      );
    }
  }
}

async function ouvrirFormulaire(
  cfg: TableCfg,
  ligne: Ligne | null,
  recharger: () => Promise<void>,
): Promise<void> {
  const niveauxChoisis = new Set<string>();
  if (ligne && cfg.speciale === 'creneau') {
    const liaisons = siErreur(
      await supabase
        .from('creneau_niveau')
        .select('niveau_scolaire_id')
        .eq('creneau_groupe_id', String(ligne.id)),
    ) as { niveau_scolaire_id: string }[];
    for (const l of liaisons) niveauxChoisis.add(l.niveau_scolaire_id);
  }

  ouvrirModal(
    ligne ? `Modifier — ${cfg.titre}` : `Nouveau — ${cfg.titre}`,
    formHtml(cfg, ligne, niveauxChoisis),
    async (voile) => {
      const valeurs = lireValeurs(voile, cfg);
      await enregistrerLigne(cfg, valeurs, ligne ? String(ligne.id) : null, voile);
      oublierParametrage();
      voile.remove();
      toast('Enregistré.', 'succes');
      await recharger();
    },
  );
}

export async function rendreParametrage(racine: HTMLElement): Promise<void> {
  if (!(await gardeAdmin())) return;
  const zone = coqueAdmin(racine, 'Paramétrage', 'parametrage');

  try {
    annees = siErreur(
      await supabase.from('annee_scolaire').select('*').order('date_debut', { ascending: false }),
    ) as AnneeScolaire[];
    lieux = siErreur(await supabase.from('lieu').select('*').order('nom')) as Lieu[];
    activites = siErreur(await supabase.from('activite').select('*').order('nom')) as Activite[];
    niveaux = siErreur(
      await supabase.from('niveau_scolaire').select('*').order('ordre_affichage'),
    ) as NiveauScolaire[];

    zone.innerHTML = `
      <div class="onglets" id="onglets">
        ${ONGLETS.map(
          (o, i) =>
            `<button type="button" data-index="${i}" class="${i === 0 ? 'actif' : ''}">${echappe(o.titre)}</button>`,
        ).join('')}
      </div>
      <div id="zone-tableau"><p class="chargement">Chargement…</p></div>`;

    const tableauZone = qs<HTMLElement>('#zone-tableau', zone);
    let actif = 0;

    async function afficher(i: number): Promise<void> {
      actif = i;
      zone.querySelectorAll('#onglets button').forEach((b, j) => {
        b.classList.toggle('actif', j === i);
      });
      const cfg = ONGLETS[i];
      try {
        const lignes = siErreur(await supabase.from(cfg.table).select('*').order(cfg.tri)) as Ligne[];
        tableauZone.innerHTML = `<div class="carte">
          <div class="flex-entre">
            <h2>${echappe(cfg.titre)}</h2>
            <button type="button" class="btn btn-primaire" id="btn-nouveau">+ Nouveau</button>
          </div>
          ${tableauHtml(cfg, lignes)}
        </div>`;

        qs('#btn-nouveau', tableauZone).addEventListener(
          'click',
          () => void ouvrirFormulaire(cfg, null, recharger),
        );

        tableauZone.querySelectorAll<HTMLButtonElement>('button[data-modifier]').forEach((b) => {
          b.addEventListener('click', () => {
            const ligne = lignes[Number(b.dataset.modifier)] ?? null;
            void ouvrirFormulaire(cfg, ligne, recharger);
          });
        });

        tableauZone.querySelectorAll<HTMLButtonElement>('button[data-supprimer]').forEach((b) => {
          b.addEventListener('click', () => {
            const ligne = lignes[Number(b.dataset.supprimer)];
            if (!ligne) return;
            if (!window.confirm('Supprimer définitivement cette ligne ?')) return;
            void (async () => {
              try {
                const { error } = await supabase
                  .from(cfg.table)
                  .delete()
                  .eq('id', String(ligne.id));
                if (error) throw new Error(error.message);
                oublierParametrage();
                toast('Ligne supprimée.', 'succes');
                await recharger();
              } catch (e) {
                toast(messageErreur(e), 'erreur');
              }
            })();
          });
        });
      } catch (e) {
        tableauZone.innerHTML = blocErreur(messageErreur(e));
      }
    }

    const recharger = (): Promise<void> => afficher(actif);

    zone.querySelector('#onglets')?.addEventListener('click', (ev) => {
      const b = (ev.target as Element).closest('button[data-index]');
      if (b) void afficher(Number(b.getAttribute('data-index')));
    });

    await afficher(0);
  } catch (e) {
    zone.innerHTML = blocErreur(messageErreur(e));
  }
}




