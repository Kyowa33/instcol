import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const cleAnon = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !cleAnon) {
  throw new Error(
    'Variables manquantes : créez un fichier .env à partir de .env.example ' +
      '(VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY).',
  );
}

export const SUPABASE_URL = url;
export const SUPABASE_ANON_KEY = cleAnon;

export const supabase: SupabaseClient = createClient(url, cleAnon, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Déballe une réponse Supabase et lève une Error en cas d'échec. */
export function siErreur<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Message d'erreur lisible (réseau, RLS, contrainte…) pour l'affichage. */
export function messageErreur(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
