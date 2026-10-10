// ============================================================================
// Edge Function : gestion-admins — comptes administrateurs de l'espace admin
// (liste, création, réinitialisation de mot de passe, suppression).
//
// Sécurité DOUBLE :
//   1. l'appelant doit être authentifié ET présent dans admin_users
//      (JWT de l'utilisateur transmis en Authorization, revérifié ici) ;
//   2. la suppression du compte CONNECTÉ est refusée côté serveur
//      (et non uniquement par un bouton masqué côté client).
//
// Requiert le secret SUPABASE_SERVICE_ROLE_KEY (déjà en place, utilisé par
// envoi-confirmation). Déploiement : supabase functions deploy gestion-admins
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

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

interface Corps {
  action: 'lister' | 'creer' | 'reset_mdp' | 'supprimer';
  email?: string;
  mot_de_passe?: string;
  user_id?: string;
}

const MDP_MIN = 8;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS });
  }

  try {
    // 1. Authentification de l'appelant (JWT utilisateur, pas l'anon key).
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!jwt) return reponse({ ok: false, erreur: 'Authentification requise.' }, 401);

    const sb = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const sbPublic = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: auth, error: errAuth } = await sbPublic.auth.getUser(jwt);
    if (errAuth || !auth.user) {
      return reponse({ ok: false, erreur: 'Session expirée : reconnectez-vous.' }, 401);
    }
    const appelant = auth.user.id;

    // 2. L'appelant doit être un administrateur (admin_users, RLS bypassée ici).
    const { data: admin, error: errAdmin } = await sb
      .from('admin_users')
      .select('user_id')
      .eq('user_id', appelant)
      .maybeSingle();
    if (errAdmin) throw new Error(errAdmin.message);
    if (!admin) {
      return reponse({ ok: false, erreur: 'Accès réservé aux administrateurs.' }, 403);
    }

    const corps = (await req.json()) as Corps;

    switch (corps.action) {
      // ---------------------------------------------------------------- lister
      case 'lister': {
        const { data: liste, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 100 });
        if (error) throw new Error(error.message);
        const { data: lignes, error: errL } = await sb
          .from('admin_users')
          .select('user_id, created_at')
          .order('created_at', { ascending: true });
        if (errL) throw new Error(errL.message);
        const comptes = (lignes ?? [])
          .map((l) => {
            const u = liste.users.find((x) => x.id === l.user_id);
            if (!u || !u.email) return null;
            return { id: u.id, email: u.email, cree_le: u.created_at, moi: u.id === appelant };
          })
          .filter((x): x is NonNullable<typeof x> => x !== null);
        return reponse({ ok: true, comptes });
      }

      // ----------------------------------------------------------------- creer
      case 'creer': {
        const email = String(corps.email ?? '').trim().toLowerCase();
        const mdp = String(corps.mot_de_passe ?? '');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return reponse({ ok: false, erreur: 'Adresse e-mail invalide.' }, 400);
        }
        if (mdp.length < MDP_MIN) {
          return reponse(
            { ok: false, erreur: `Mot de passe trop court (${MDP_MIN} caractères minimum).` },
            400,
          );
        }
        const { data: cree, error: errC } = await sb.auth.admin.createUser({
          email,
          password: mdp,
          // Compte utilisable immédiatement (pas d'e-mail de confirmation).
          email_confirm: true,
        });
        if (errC) throw new Error(errC.message);
        const { error: errIns } = await sb
          .from('admin_users')
          .upsert({ user_id: cree.user.id }, { onConflict: 'user_id', ignoreDuplicates: true });
        if (errIns) {
          // Compensation : ne pas laisser un compte auth sans habilitation.
          await sb.auth.admin.deleteUser(cree.user.id);
          throw new Error(errIns.message);
        }
        return reponse({ ok: true });
      }

      // ------------------------------------------------------------- reset_mdp
      case 'reset_mdp': {
        const userId = String(corps.user_id ?? '');
        const mdp = String(corps.mot_de_passe ?? '');
        if (!userId) return reponse({ ok: false, erreur: 'Compte introuvable.' }, 400);
        if (mdp.length < MDP_MIN) {
          return reponse(
            { ok: false, erreur: `Mot de passe trop court (${MDP_MIN} caractères minimum).` },
            400,
          );
        }
        const { error } = await sb.auth.admin.updateUserById(userId, { password: mdp });
        if (error) throw new Error(error.message);
        return reponse({ ok: true });
      }

      // ------------------------------------------------------------- supprimer
      case 'supprimer': {
        const userId = String(corps.user_id ?? '');
        if (!userId) return reponse({ ok: false, erreur: 'Compte introuvable.' }, 400);
        // Garde serveur : impossible de supprimer son propre compte.
        if (userId === appelant) {
          return reponse(
            { ok: false, erreur: 'Impossible de supprimer votre propre compte.' },
            403,
          );
        }
        const { data: cible } = await sb
          .from('admin_users')
          .select('user_id')
          .eq('user_id', userId)
          .maybeSingle();
        if (!cible) {
          return reponse({ ok: false, erreur: 'Compte administrateur introuvable.' }, 404);
        }
        // La ligne admin_users part en cascade (FK ON DELETE CASCADE).
        const { error } = await sb.auth.admin.deleteUser(userId);
        if (error) throw new Error(error.message);
        return reponse({ ok: true });
      }

      default:
        return reponse({ ok: false, erreur: 'Action inconnue.' }, 400);
    }
  } catch (e) {
    return reponse({ ok: false, erreur: e instanceof Error ? e.message : 'Erreur serveur.' }, 500);
  }
});