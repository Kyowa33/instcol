import { naviguer } from '../router';
import { messageErreur, supabase } from './supabase';

let valide = false;
let adminId: string | null = null;

// Toute mutation de session invalide le cache de contrôle admin.
supabase.auth.onAuthStateChange(() => {
  valide = false;
  adminId = null;
});

/** Connexion admin : Supabase Auth + contrôle de présence dans admin_users. */
export async function connexionAdmin(email: string, motDePasse: string): Promise<void> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: motDePasse });
  if (error) throw new Error('Identifiants incorrects.');
  const { data: admin, error: errAdmin } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle();
  if (errAdmin) throw new Error(messageErreur(errAdmin));
  if (!admin) {
    await supabase.auth.signOut();
    throw new Error("Accès réservé : ce compte n'est pas administrateur.");
  }
  adminId = data.user.id;
  valide = true;
}

/** Vérifie que la session courante appartient à un administrateur. */
export async function estAdmin(): Promise<boolean> {
  if (valide) return adminId !== null;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) {
    valide = true;
    adminId = null;
    return false;
  }
  const { data: admin } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle();
  adminId = admin ? user.id : null;
  valide = true;
  return admin !== null;
}

/** Garde de navigation : redirige vers la connexion si non admin. */
export async function gardeAdmin(): Promise<boolean> {
  if (await estAdmin()) return true;
  naviguer('/admin/login');
  return false;
}

export async function deconnexion(): Promise<void> {
  await supabase.auth.signOut();
  valide = false;
  adminId = null;
  naviguer('/admin/login');
}

export async function emailConnecte(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.email ?? null;
}

/** Envoie le lien de réinitialisation (spec §5 — requestPasswordReset). */
export async function motDePasseOublie(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${location.origin}${location.pathname}#/admin/nouveau-mot-de-passe`,
  });
  if (error) throw new Error(messageErreur(error));
}

/** Applique le nouveau mot de passe (hash géré par Supabase Auth). */
export async function changerMotDePasse(nouveau: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: nouveau });
  if (error) throw new Error(messageErreur(error));
}
