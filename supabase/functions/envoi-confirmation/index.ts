// ============================================================================
// Edge Function : envoi-confirmation — e-mail de confirmation automatique avec
// récapitulatif PDF signé (spec : « Oui » à la question Attestation/Validation).
// Sécurité : données RELUES en base (service_role) ; l'e-mail part uniquement
// vers un responsable légal du dossier et si code_dossier correspond.
// Secrets : RESEND_API_KEY, EMAIL_FROM (optionnel).
// Déploiement : supabase functions deploy envoi-confirmation
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { PDFDocument, StandardFonts, type PDFFont } from 'npm:pdf-lib@1.17.1';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function encodeBase64(octets: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < octets.length; i += 0x8000) {
    bin += String.fromCharCode(...octets.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

interface Recap {
  code: string;
  annee: string;
  dateCreation: string;
  montantTotal: number;
  moyen: string;
  cheque: string;
  commentaire: string;
  email: string;
  responsables: string[];
  coordonnees: string;
  enfants: { identite: string; detail: string; groupes: string[] }[];
  autorisation: { faitA: string; nom: string; date: string; rgpd: boolean; mesuresMedicales: boolean; droitImage: boolean } | null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    const { famille_id, code_dossier } = await req.json();
    if (!famille_id || !code_dossier) {
      return reponse({ ok: false, erreur: 'Paramètres manquants.' }, 400);
    }

    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false } },
    );

    const { data: famille, error: errF } = await sb
      .from('famille')
      .select('*, annee_scolaire(libelle)')
      .eq('id', famille_id)
      .maybeSingle();
    if (errF) throw new Error(errF.message);
    if (!famille || famille.code_dossier !== code_dossier) {
      return reponse({ ok: false, erreur: 'Dossier introuvable.' }, 404);
    }

    const [{ data: responsables }, { data: enfants }, { data: autorisation }] = await Promise.all([
      sb.from('responsable_legal').select('*').eq('famille_id', famille_id),
      sb.from('enfant').select(
        `*, inscription_enfant(
           creneau_groupe(jour_semaine, horaire_debut, horaire_fin, precision_frequence,
                          activite(nom), lieu(nom)))`,
      ).eq('famille_id', famille_id),
      sb.from('autorisation_parentale').select('*').eq('famille_id', famille_id).maybeSingle(),
    ]);

    const principal = (responsables ?? []).find((r) => r.est_principal) ?? responsables?.[0];
    if (!principal?.email) {
      return reponse({ ok: false, erreur: 'Aucun e-mail de contact.' }, 400);
    }
    const destinataire = String(principal.email).toLowerCase();
    if (!(responsables ?? []).some((r) => String(r.email ?? '').toLowerCase() === destinataire)) {
      return reponse({ ok: false, erreur: 'Destination non autorisée.' }, 403);
    }

    const recap: Recap = {
      code: famille.code_dossier,
      annee: (famille.annee_scolaire as { libelle: string } | null)?.libelle ?? '',
      dateCreation: famille.date_creation,
      montantTotal: Number(famille.montant_total),
      moyen: famille.moyen_paiement === 'CHEQUE' ? 'Chèque' : 'Espèces',
      cheque: famille.num_cheque
        ? `n° ${famille.num_cheque}${famille.banque_cheque ? ` — ${famille.banque_cheque}` : ''}`
        : '',
      commentaire: famille.commentaire_famille ?? '',
      email: destinataire,
      responsables: (responsables ?? []).map(
        (r) => `${r.prenom} ${r.nom} — ${r.adresse}, ${r.code_postal} ${r.ville} — ${r.telephone} — ${r.email}`,
      ),
      coordonnees: `${principal.prenom} ${principal.nom}, ${principal.adresse}, ${principal.code_postal} ${principal.ville}`,
      enfants: (enfants ?? []).map((e) => ({
        identite: `${e.prenom} ${e.nom}`,
        detail: `né(e) le ${e.date_naissance} — ${e.sexe === 'M' ? 'Garçon' : 'Fille'} — ${e.classe_frequentee} — ${e.etablissement}` +
          (e.est_baptise ? ' — baptisé(e)' : '') +
          (e.est_confirme ? ' — confirmé(e)' : '') +
          (e.premiere_communion ? ` — 1ère communion${e.date_communion ? ' le ' + e.date_communion : ''}` : ''),
        groupes: (e.inscription_enfant ?? []).map((i: {
          creneau_groupe: {
            jour_semaine: string; horaire_debut: string | null; horaire_fin: string | null;
            precision_frequence: string | null;
            activite: { nom: string }; lieu: { nom: string };
          } | null;
        }) => {
          const cg = i.creneau_groupe;
          if (!cg) return 'Groupe supprimé';
          const h = cg.horaire_debut && cg.horaire_fin
            ? ` ${cg.horaire_debut.slice(0, 5)}-${cg.horaire_fin.slice(0, 5)}`
            : '';
          return `${cg.activite.nom} — ${cg.lieu.nom} — ${cg.jour_semaine}${h}` +
            `${cg.precision_frequence ? ` (${cg.precision_frequence})` : ''}`;
        }),
      })),
      autorisation: autorisation
        ? {
            faitA: autorisation.fait_a,
            nom: autorisation.nom_signataire,
            date: autorisation.date_signature,
            rgpd: autorisation.consentement_rgpd,
            mesuresMedicales: autorisation.autorise_mesures_medicales,
            droitImage: autorisation.droit_image,
          }
        : null,
    };

    const html = construireHtml(recap);
    let attachment: { filename: string; content: string; contentType: string } | null = null;
    try {
      const pdf = await construirePdf(recap);
      attachment = {
        filename: `recapitulatif-${recap.code}.pdf`,
        content: encodeBase64(pdf),
        contentType: 'application/pdf',
      };
    } catch (e) {
      console.error('Génération PDF impossible, envoi du seul HTML :', e);
    }

    const apiCle = Deno.env.get('RESEND_API_KEY');
    if (!apiCle) {
      return reponse({ ok: false, erreur: 'RESEND_API_KEY non configuré (e-mail non envoyé).' }, 500);
    }
    const envoi = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiCle}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: Deno.env.get('EMAIL_FROM') ?? 'Paroisse Saint-Colomban <onboarding@resend.dev>',
        to: [destinataire],
        subject: `Inscription ${recap.code} — récapitulatif Paroisse Saint-Colomban`,
        html,
        ...(attachment ? { attachments: [attachment] } : {}),
      }),
    });

    if (!envoi.ok) {
      console.error('Resend :', await envoi.text());
      return reponse({ ok: false, erreur: `Échec d'envoi (${envoi.status}).` }, 502);
    }
    return reponse({ ok: true, email: destinataire, pdf: Boolean(attachment) });
  } catch (e) {
    console.error(e);
    return reponse({ ok: false, erreur: e instanceof Error ? e.message : 'Erreur inconnue.' }, 500);
  }
});

// ----------------------------------------------------------------------------
// Récapitulatif HTML (e-mail)
// ----------------------------------------------------------------------------
function echappe(texte: string): string {
  return texte
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function construireHtml(r: Recap): string {
  const enfants = r.enfants.map((e) => `
    <tr>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;"><strong>${echappe(e.identite)}</strong><br/>
          <span style="color:#6b7280;font-size:12px;">${echappe(e.detail)}</span></td>
      <td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${e.groupes.map(echappe).join('<br/>')}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="fr"><body style="font-family:Arial,Helvetica,sans-serif;color:#111827;line-height:1.5;">
  <p>Bonjour,</p>
  <p>Votre inscription <strong>${echappe(r.code)}</strong> (année ${echappe(r.annee)}) a bien été enregistrée
     auprès de la Paroisse Saint-Colomban. Vous trouverez ci-joint le récapitulatif signé au format PDF.</p>
  <table style="border-collapse:collapse;width:100%;max-width:640px;font-size:14px;">
    <tr><td style="padding:4px 8px;"><strong>Dossier</strong></td><td>${echappe(r.code)}</td></tr>
    <tr><td style="padding:4px 8px;"><strong>Frais</strong></td><td>${r.montantTotal.toFixed(2)} € (${echappe(r.moyen)}${r.cheque ? ' — ' + echappe(r.cheque) : ''})</td></tr>
    <tr><td style="padding:4px 8px;"><strong>Contact</strong></td><td>${echappe(r.coordonnees)}</td></tr>
  </table>
  <h3 style="margin-bottom:4px;">Enfants inscrits</h3>
  <table style="border-collapse:collapse;width:100%;max-width:640px;font-size:14px;">
    <thead><tr style="background:#f3f4f6;">
      <th style="padding:6px 8px;text-align:left;">Enfant</th><th style="padding:6px 8px;text-align:left;">Groupe(s)</th>
    </tr></thead>
    <tbody>${enfants}</tbody>
  </table>
  ${r.autorisation ? `<p style="font-size:12px;color:#6b7280;">Décharge signée par ${echappe(r.autorisation.nom)}
     à ${echappe(r.autorisation.faitA)} — RGPD : ${r.autorisation.rgpd ? 'accepté' : 'refusé'} —
     mesures médicales d'urgence : ${r.autorisation.mesuresMedicales ? 'autorisées' : 'refusées'} —
     droit à l'image : ${r.autorisation.droitImage ? 'oui' : 'non'}.</p>` : ''}
  <p style="font-size:12px;color:#6b7280;">Ce message est envoyé automatiquement, merci de ne pas y répondre.</p>
</body></html>`;
}

// ----------------------------------------------------------------------------
// Récapitulatif PDF signé (pdf-lib, police Helvetica — encodage WinAnsi)
// ----------------------------------------------------------------------------
function assainit(t: string): string {
  return t
    .replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ /g, ' ');
}

async function construirePdf(r: Recap): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const normal: PDFFont = await doc.embedFont(StandardFonts.Helvetica);
  const gras: PDFFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const largeur = 595;
  const hauteur = 842;
  const marge = 50;
  let page = doc.addPage([largeur, hauteur]);
  let y = hauteur - marge;

  const saut = (n: number): void => {
    y -= n;
    if (y < marge + 20) {
      page = doc.addPage([largeur, hauteur]);
      y = hauteur - marge;
    }
  };

  const texte = (t: string, opts: { taille?: number; police?: PDFFont; espace?: number } = {}): void => {
    const taille = opts.taille ?? 10;
    const police = opts.police ?? normal;
    const max = largeur - 2 * marge;
    let ligne = '';
    for (const mot of assainit(t).split(' ')) {
      const essai = ligne ? `${ligne} ${mot}` : mot;
      if (police.widthOfTextAtSize(essai, taille) > max) {
        if (ligne) {
          page.drawText(ligne, { x: marge, y, size: taille, font: police });
          saut(taille + 3);
        }
        ligne = mot;
      } else {
        ligne = essai;
      }
    }
    if (ligne) {
      page.drawText(ligne, { x: marge, y, size: taille, font: police });
    }
    saut(taille + (opts.espace ?? 5));
  };

  texte('Paroisse Saint-Colomban — Récapitulatif d’inscription', { police: gras, taille: 14 });
  texte(`Dossier ${r.code} — année scolaire ${r.annee}`, { police: gras, taille: 11 });
  texte(`Enregistré le ${new Date(r.dateCreation).toLocaleString('fr-FR')}`);
  saut(8);

  texte('Responsable légal', { police: gras, taille: 11 });
  for (const resp of r.responsables) texte(resp);
  saut(8);

  texte('Enfants inscrits', { police: gras, taille: 11 });
  for (const e of r.enfants) {
    texte(e.identite, { police: gras });
    texte(e.detail);
    for (const g of e.groupes) texte(`  - ${g}`);
    saut(5);
  }
  saut(4);

  texte('Frais d’inscription', { police: gras, taille: 11 });
  texte(`Total : ${r.montantTotal.toFixed(2)} € — règlement par ${r.moyen}${r.cheque ? ` (${r.cheque})` : ''}`);
  if (r.commentaire) texte(`Remarque de la famille : ${r.commentaire}`);
  saut(8);

  texte('Autorisation parentale (décharge)', { police: gras, taille: 11 });
  if (r.autorisation) {
    texte(`Fait à ${r.autorisation.faitA}, le ${new Date(r.autorisation.date).toLocaleString('fr-FR')}`);
    texte(`Signature : ${r.autorisation.nom}`);
    texte(`Consentement RGPD : ${r.autorisation.rgpd ? 'oui' : 'non'} — Mesures médicales : ${r.autorisation.mesuresMedicales ? 'oui' : 'non'} — Droit à l’image : ${r.autorisation.droitImage ? 'oui' : 'non'}`);
  }
  saut(12);
  texte('Document généré automatiquement par la plateforme d’inscription de la Paroisse Saint-Colomban.', {
    taille: 8,
  });

  return await doc.save();
}


