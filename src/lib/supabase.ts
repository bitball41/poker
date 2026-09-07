import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anon);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabase: any = supabaseConfigured
  ? createClient(url!, anon!, {
      db: { schema: 'poker' },
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const supabaseRealtime: any = supabaseConfigured
  ? createClient(url!, anon!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
