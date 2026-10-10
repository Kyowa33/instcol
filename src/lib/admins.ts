import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from './supabase';

/** Compte administrateur renvoyé par la fonction gestion-admins. */
export interface CompteAdmin {
  id: string;
  email: string;
  cree_le: string;
  /** true pour le compte de l'administrateur connecté. */
  moi: boolean;
}

interface ReponseGestion {
  ok?: boolean;
  erreur?: string;
  comptes?: CompteAdmin[];
}

/**
 * Appelle la Edge Function `gestion-admins` (service_role côté serveur).
 * L'authentification transmet le JWT de l'admin connecté : la fonction
 * revérifie elle-même qu'il est bien dans admin_users.
 */
async function appelerGestionAdmins(
  action: string,
  params: Record<string, unknown> = {},
): Promise<ReponseGestion> {
  const { data } = await supabase.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) throw new Error('Session expirée : reconnectez-vous.');
  const rep = await fetch(`${SUPABASE_URL}/functions/v1/gestion-admins`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...params }),
  });
  const json = (await rep.json()) as ReponseGestion;
  if (!json.ok) {
    throw new Error(json.erreur ?? 'Opération impossible (fonction non déployée ?).');
  }
  return json;
}

export async function listerAdmins(): Promise<CompteAdmin[]> {
  const json = await appelerGestionAdmins('lister');
  return json.comptes ?? [];
}

export async function creerAdmin(email: string, motDePasse: string): Promise<void> {
  await appelerGestionAdmins('creer', { email, mot_de_passe: motDePasse });
}

export async function reinitialiserMotDePasse(userId: string, nouveau: string): Promise<void> {
  await appelerGestionAdmins('reset_mdp', { user_id: userId, mot_de_passe: nouveau });
}

/** La fonction refuse la suppression du compte connecté (garde serveur). */
export async function supprimerAdmin(userId: string): Promise<void> {
  await appelerGestionAdmins('supprimer', { user_id: userId });
}