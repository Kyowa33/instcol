import { telechargerCsv } from '../../lib/csv';
import { blocErreur, echappe, qs, toast } from '../../lib/dom';
import { dateFr, plageHeures } from '../../lib/format';
import { gardeAdmin } from '../../lib/session';
import { messageErreur, siErreur, supabase } from '../../lib/supabase';
import type { Activite, AnneeScolaire, Lieu } from '../../lib/types';
import { coqueAdmin } from './layout';

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];

type CreneauVue = {
  id: string;
  activite_id: string;
  lieu_id: string;
  jour_semaine: string;
  horaire_debut: string | null;
  horaire_fin: string | null;
  precision_frequence: string | null;
  capacite_max: number | null;
  annee_scolaire: { libelle: string } | null;
  activite: { code: string; nom: string } | null;
  lieu: { nom: string } | null;
  creneau_niveau: { niveau_scolaire: { libelle: string } | null }[] | null;
};

type EnfantVue = {
  nom: string;
  prenom: string;
  date_naissance: string;
  classe_frequentee: string;
  famille: {
    code_dossier: string;
    responsable_legal: { nom: string; prenom: string; est_principal: boolean }[] | null;
  } | null;
};

type InscriptionVue = { creneau_groupe_id: string; enfant: EnfantVue | null };

/** Un créneau de la vue, avec ses enfants inscrits et sa ligne de recherche. */
interface LigneVue {
  creneau: CreneauVue;
  inscrits: InscriptionVue[];
  texte: string;
}

/** Tri : jour de semaine (ordre réel), horaire, activité. */
function trierGroupes(a: LigneVue, b: LigneVue): number {
  const idx = (j: string): number => {
    const i = JOURS.indexOf(j);
    return i < 0 ? 99 : i;
  };
  return (
    idx(a.creneau.jour_semaine) - idx(b.creneau.jour_semaine) ||
    String(a.creneau.horaire_debut ?? '~').localeCompare(String(b.creneau.horaire_debut ?? '~')) ||
    (a.creneau.activite?.code ?? '').localeCompare(b.creneau.activite?.code ?? '')
  );
}

function trierInscrits(a: InscriptionVue, b: InscriptionVue): number {
  return `${a.enfant?.nom ?? ''} ${a.enfant?.prenom ?? ''}`.localeCompare(
    `${b.enfant?.nom ?? ''} ${b.enfant?.prenom ?? ''}`,
    'fr',
  );
}

function responsablePrincipal(e: EnfantVue | null | undefined): string {
  const rp = e?.famille?.responsable_legal ?? [];
  const p = rp.find((r) => r.est_principal) ?? rp[0];
  return p ? `${p.prenom} ${p.nom}` : '';
}

/** Charge les créneaux d'une année avec leurs enfants inscrits (triés). */
async function chargerVue(anneeId: string): Promise<LigneVue[]> {
  const creneaux = siErreur(
    await supabase
      .from('creneau_groupe')
      .select(
        '*, annee_scolaire(libelle), activite(code, nom), lieu(nom), ' +
          'creneau_niveau(niveau_scolaire(libelle))',
      )
      .eq('annee_scolaire_id', anneeId)
      .order('jour_semaine'),
  ) as unknown as CreneauVue[];

  const ids = creneaux.map((c) => c.id);
  const inscriptions: InscriptionVue[] = ids.length
    ? (siErreur(
        await supabase
          .from('inscription_enfant')
          .select(
            'creneau_groupe_id, enfant(nom, prenom, date_naissance, classe_frequentee, ' +
              'famille(code_dossier, responsable_legal(nom, prenom, est_principal)))',
          )
          .in('creneau_groupe_id', ids),
      ) as unknown as InscriptionVue[])
    : [];

  const parCreneau = new Map<string, InscriptionVue[]>();
  for (const i of inscriptions) {
    const l = parCreneau.get(i.creneau_groupe_id) ?? [];
    l.push(i);
    parCreneau.set(i.creneau_groupe_id, l);
  }

  const vue: LigneVue[] = creneaux.map((c) => {
    const inscrits = (parCreneau.get(c.id) ?? []).sort(trierInscrits);
    const niveaux = (c.creneau_niveau ?? [])
      .map((n) => n.niveau_scolaire?.libelle ?? '')
      .filter(Boolean)
      .join(' ');
    const enfantsTexte = inscrits
      .map((i) =>
        [
          i.enfant?.prenom,
          i.enfant?.nom,
          i.enfant?.classe_frequentee,
          i.enfant?.famille?.code_dossier,
          responsablePrincipal(i.enfant),
        ]
          .join(' ')
          .trim(),
      )
      .join(' ');
    const texte = [
      c.annee_scolaire?.libelle,
      c.activite?.code,
      c.activite?.nom,
      c.lieu?.nom,
      c.jour_semaine,
      plageHeures(c.horaire_debut, c.horaire_fin),
      niveaux,
      enfantsTexte,
    ]
      .join(' ')
      .toLowerCase();
    return { creneau: c, inscrits, texte };
  });

  return vue.sort(trierGroupes);
}

/* ---------------------------------------------------------------------- */
/* Export CSV de la vue filtrée                                            */
/* ---------------------------------------------------------------------- */

function exporterCsv(vue: LigneVue[], libelleAnnee: string): void {
  const entetes = [
    'Année', 'Activité', 'Lieu', 'Jour', 'Début', 'Fin', 'Précision', 'Capacité max',
    'Inscrits', 'Niveaux', 'Code dossier', 'Responsable légal', 'Enfant', 'Naissance',
    'Classe',
  ];
  const lignes: (string | number)[][] = [];
  for (const { creneau: c, inscrits } of vue) {
    const base: (string | number)[] = [
      c.annee_scolaire?.libelle ?? '',
      c.activite ? `${c.activite.code} — ${c.activite.nom}` : '',
      c.lieu?.nom ?? '',
      c.jour_semaine,
      String(c.horaire_debut ?? '').slice(0, 5),
      String(c.horaire_fin ?? '').slice(0, 5),
      c.precision_frequence ?? '',
      c.capacite_max ?? '',
      inscrits.length,
      (c.creneau_niveau ?? [])
        .map((n) => n.niveau_scolaire?.libelle ?? '')
        .filter(Boolean)
        .join(' + '),
    ];
    if (!inscrits.length) {
      lignes.push([...base, '', '', '', '', '']);
      continue;
    }
    for (const i of inscrits) {
      const e = i.enfant;
      lignes.push([
        ...base,
        e?.famille?.code_dossier ?? '',
        responsablePrincipal(e),
        e ? `${e.prenom} ${e.nom}` : '',
        e ? dateFr(e.date_naissance) : '',
        e?.classe_frequentee ?? '',
      ]);
    }
  }
  telechargerCsv(
    `groupes-${libelleAnnee}-${new Date().toISOString().slice(0, 10)}.csv`,
    entetes,
    lignes,
  );
}

/* ---------------------------------------------------------------------- */
/* Page Groupes                                                            */
/* ---------------------------------------------------------------------- */

function tableauHtml(vue: LigneVue[]): string {
  if (!vue.length) {
    return '<p class="aide">Aucun groupe ne correspond à ces filtres.</p>';
  }
  const corps = vue
    .map(({ creneau: c, inscrits }) => {
      const enfants = inscrits.length
        ? inscrits
            .map((i) => {
              const e = i.enfant;
              const nom = `${e?.prenom ?? ''} ${e?.nom ?? ''}`.trim() || 'Enfant';
              const aide = [e?.classe_frequentee ?? '', e?.famille?.code_dossier ?? '']
                .filter(Boolean)
                .join(' · ');
              return `<div>${echappe(nom)}${aide ? ` <span class="aide">${echappe(aide)}</span>` : ''}</div>`;
            })
            .join('')
        : '<span class="aide">Aucun inscrit.</span>';
      const niveaux = (c.creneau_niveau ?? [])
        .map((n) => n.niveau_scolaire?.libelle ?? '')
        .filter(Boolean)
        .join(' + ');
      return `<tr>
        <td><strong>${echappe(c.activite?.code ?? '')}</strong> — ${echappe(c.activite?.nom ?? '')}</td>
        <td>${echappe(c.lieu?.nom ?? '')}</td>
        <td>${echappe(c.jour_semaine)}</td>
        <td>${echappe(plageHeures(c.horaire_debut, c.horaire_fin))}${c.precision_frequence ? `<br/><span class="aide">${echappe(c.precision_frequence)}</span>` : ''}</td>
        <td>${echappe(niveaux) || '—'}</td>
        <td class="num">${inscrits.length}</td>
        <td class="num">${c.capacite_max ?? '—'}</td>
        <td>${enfants}</td>
      </tr>`;
    })
    .join('');
  return `<div class="tableau-enveloppe">
    <table class="tableau">
      <thead><tr>
        <th>Activité</th><th>Lieu</th><th>Jour</th><th>Horaires</th><th>Niveaux</th>
        <th class="num">Inscrits</th><th class="num">Capacité</th><th>Enfants</th>
      </tr></thead>
      <tbody>${corps}</tbody>
    </table>
  </div>`;
}

export async function rendreGroupes(racine: HTMLElement): Promise<void> {
  if (!(await gardeAdmin())) return;
  const zone = coqueAdmin(racine, "Groupes d'enfants", 'groupes');

  try {
    const annees = siErreur(
      await supabase.from('annee_scolaire').select('*').order('date_debut', { ascending: false }),
    ) as AnneeScolaire[];
    const lieux = siErreur(await supabase.from('lieu').select('*').order('nom')) as Lieu[];
    const activites = siErreur(await supabase.from('activite').select('*').order('nom')) as Activite[];

    if (!annees.length) {
      qs<HTMLElement>('#zone-contenu', racine).innerHTML =
        '<p class="aide">Aucune année scolaire : créez-en une dans le Paramétrage.</p>';
      return;
    }

    let anneeId = annees.find((a) => a.est_active)?.id ?? annees[0].id;
    let activiteId = '';
    let lieuId = '';
    let recherche = '';
    let vue: LigneVue[] = [];

    zone.innerHTML = `
      <div class="filtres no-imprimer">
        <label class="champ"><span>Année scolaire</span>
          <select id="f-annee">
            ${annees
              .map(
                (a) =>
                  `<option value="${echappe(a.id)}" ${a.id === anneeId ? 'selected' : ''}>${echappe(a.libelle)}${a.est_active ? ' (active)' : ''}</option>`,
              )
              .join('')}
          </select></label>
        <label class="champ"><span>Activité</span>
          <select id="f-activite">
            <option value="">Toutes</option>
            ${activites
              .map((a) => `<option value="${echappe(a.id)}">${echappe(a.nom)}</option>`)
              .join('')}
          </select></label>
        <label class="champ"><span>Lieu</span>
          <select id="f-lieu">
            <option value="">Tous</option>
            ${lieux.map((l) => `<option value="${echappe(l.id)}">${echappe(l.nom)}</option>`).join('')}
          </select></label>
        <label class="champ"><span>Rechercher</span>
          <input type="search" id="f-texte" placeholder="enfant, code dossier, jour…"/></label>
        <button type="button" class="btn btn-primaire" id="btn-export">Exporter la vue (CSV)</button>
      </div>
      <div class="carte" id="zone-groupes"><p class="chargement">Chargement…</p></div>`;

    const zoneGroupes = qs<HTMLElement>('#zone-groupes', zone);

    const vueFiltree = (): LigneVue[] => {
      const t = recherche.trim().toLowerCase();
      return vue.filter(({ creneau: c, texte }) => {
        const okActivite = !activiteId || c.activite_id === activiteId;
        const okLieu = !lieuId || c.lieu_id === lieuId;
        const okTexte = !t || texte.includes(t);
        return okActivite && okLieu && okTexte;
      });
    };

    const maj = (): void => {
      zoneGroupes.innerHTML = tableauHtml(vueFiltree());
    };

    const rechargerVue = async (): Promise<void> => {
      zoneGroupes.innerHTML = '<p class="chargement">Chargement…</p>';
      try {
        vue = await chargerVue(anneeId);
        maj();
      } catch (e) {
        zoneGroupes.innerHTML = blocErreur(messageErreur(e));
      }
    };

    qs<HTMLSelectElement>('#f-annee', zone).addEventListener('change', (ev) => {
      anneeId = (ev.target as HTMLSelectElement).value;
      void rechargerVue();
    });
    qs<HTMLSelectElement>('#f-activite', zone).addEventListener('change', (ev) => {
      activiteId = (ev.target as HTMLSelectElement).value;
      maj();
    });
    qs<HTMLSelectElement>('#f-lieu', zone).addEventListener('change', (ev) => {
      lieuId = (ev.target as HTMLSelectElement).value;
      maj();
    });
    qs<HTMLInputElement>('#f-texte', zone).addEventListener('input', (ev) => {
      recherche = (ev.target as HTMLInputElement).value;
      maj();
    });
    qs('#btn-export', zone).addEventListener('click', () => {
      const filtree = vueFiltree();
      if (!filtree.length) {
        toast('Aucun groupe à exporter pour cette sélection.', 'erreur');
        return;
      }
      const libelle = annees.find((a) => a.id === anneeId)?.libelle ?? 'toutes-les-annees';
      exporterCsv(filtree, libelle);
      toast(
        `Export CSV généré (${filtree.length} groupe${filtree.length > 1 ? 's' : ''}).`,
        'succes',
      );
    });

    await rechargerVue();
  } catch (e) {
    zone.innerHTML = blocErreur(messageErreur(e));
  }
}