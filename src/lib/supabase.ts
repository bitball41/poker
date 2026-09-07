import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anon);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = supabaseConfigured
  ? createClient(url!, anon!, {
      db: { schema: 'poker' },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;

/** Ensure a stable anonymous Supabase Auth identity for secure lobby membership. */
export async function ensureSupabaseUser(): Promise<string> {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;
  const existing = sessionData?.session?.user?.id as string | undefined;
  if (existing) return existing;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    throw new Error(
      `Anonymous multiplayer sign-in failed. Enable Anonymous Sign-Ins in Supabase Auth. (${error.message ?? String(error)})`,
    );
  }
  const id = data?.user?.id as string | undefined;
  if (!id) throw new Error('Supabase did not return a user after anonymous sign-in.');
  return id;
}
