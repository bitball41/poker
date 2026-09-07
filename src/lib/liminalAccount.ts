import { createClient } from '@supabase/supabase-js';

const DEFAULT_LIMINAL_URL = 'https://wjufzyqppnjymctzhctn.supabase.co';
const DEFAULT_LIMINAL_KEY = 'sb_publishable_kp_ST1YFLKA9iV6AhruG3g_qIv7oNQO';

const liminalUrl = import.meta.env.VITE_LIMINAL_SUPABASE_URL || DEFAULT_LIMINAL_URL;
const liminalKey = import.meta.env.VITE_LIMINAL_SUPABASE_KEY || DEFAULT_LIMINAL_KEY;

const liminalClient = createClient(liminalUrl, liminalKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export interface LiminalAccountProfile {
  username: string;
  displayName: string;
  pfp: string | null;
  color: string | null;
  ring: string | null;
}

interface EmbeddedAccount {
  username?: string;
  display_name?: string;
  displayName?: string;
  pfp?: string | null;
  color?: string | null;
  ring?: string | null;
}

declare global {
  interface Window {
    __LIMINAL_ACCOUNT__?: EmbeddedAccount;
  }
}

function normalizeEmbedded(profile: EmbeddedAccount | undefined): LiminalAccountProfile | null {
  if (!profile?.username) return null;
  return {
    username: profile.username,
    displayName: profile.displayName || profile.display_name || profile.username,
    pfp: profile.pfp || null,
    color: profile.color || null,
    ring: profile.ring || null,
  };
}

export function readLiminalSession(): { username: string; passwordHash: string } | null {
  try {
    const username = localStorage.getItem('lc_user');
    const passwordHash = localStorage.getItem('lc_pass_hash');
    return username && passwordHash ? { username, passwordHash } : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the existing Liminal Chat account without creating a second login system.
 * Direct Liminal integration can inject window.__LIMINAL_ACCOUNT__. The standalone
 * build falls back to Liminal Chat's lc_user/lc_pass_hash session and verifies it
 * against the existing profiles table before exposing only safe profile fields.
 */
export async function loadLiminalAccount(): Promise<LiminalAccountProfile | null> {
  const embedded = normalizeEmbedded(window.__LIMINAL_ACCOUNT__);
  if (embedded) return embedded;

  const session = readLiminalSession();
  if (!session) return null;

  try {
    const { data, error } = await liminalClient
      .from('profiles')
      .select('username,display_name,pfp,color,ring,is_banned,password_hash')
      .eq('username', session.username)
      .maybeSingle();
    if (error || !data || data.is_banned || data.password_hash !== session.passwordHash) return null;
    return {
      username: data.username,
      displayName: data.display_name || data.username,
      pfp: data.pfp || null,
      color: data.color || null,
      ring: data.ring || null,
    };
  } catch {
    return null;
  }
}

export function accountIdentityKey(profile: LiminalAccountProfile | null, guestId: string): string {
  return profile ? `liminal:${profile.username.toLowerCase()}` : `guest:${guestId}`;
}
