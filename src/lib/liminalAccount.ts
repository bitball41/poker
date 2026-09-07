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

interface LiminalIdentityMessage {
  type?: string;
  profile?: EmbeddedAccount;
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

function inferredParentOrigin(): string | null {
  if (import.meta.env.VITE_LIMINAL_PARENT_ORIGIN) return import.meta.env.VITE_LIMINAL_PARENT_ORIGIN;
  try {
    return document.referrer ? new URL(document.referrer).origin : null;
  } catch {
    return null;
  }
}

async function requestParentIdentity(timeoutMs = 450): Promise<LiminalAccountProfile | null> {
  if (window.parent === window) return null;
  const parentOrigin = inferredParentOrigin();
  if (!parentOrigin) return null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (profile: LiminalAccountProfile | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(profile);
    };
    const onMessage = (event: MessageEvent<LiminalIdentityMessage>) => {
      if (event.source !== window.parent || event.origin !== parentOrigin) return;
      if (event.data?.type !== 'LIMINAL_POKER_IDENTITY') return;
      finish(normalizeEmbedded(event.data.profile));
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'LIMINAL_POKER_IDENTITY_REQUEST' }, parentOrigin);
  });
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
 * Integration order:
 * 1. Direct in-app injection via window.__LIMINAL_ACCOUNT__.
 * 2. Same-origin saved Liminal Chat session.
 * 3. Cross-origin parent/iframe identity handshake.
 *
 * Password hashes are used only to verify the legacy saved session and are never
 * returned from this module or exposed to Poker components.
 */
export async function loadLiminalAccount(): Promise<LiminalAccountProfile | null> {
  const embedded = normalizeEmbedded(window.__LIMINAL_ACCOUNT__);
  if (embedded) return embedded;

  const session = readLiminalSession();
  if (!session) return requestParentIdentity();

  try {
    const { data, error } = await liminalClient
      .from('profiles')
      .select('username,display_name,pfp,color,ring,is_banned,password_hash')
      .eq('username', session.username)
      .maybeSingle();
    if (error || !data || data.is_banned || data.password_hash !== session.passwordHash) {
      return requestParentIdentity();
    }
    return {
      username: data.username,
      displayName: data.display_name || data.username,
      pfp: data.pfp || null,
      color: data.color || null,
      ring: data.ring || null,
    };
  } catch {
    return requestParentIdentity();
  }
}

export function accountIdentityKey(profile: LiminalAccountProfile | null, guestId: string): string {
  return profile ? `liminal:${profile.username.toLowerCase()}` : `guest:${guestId}`;
}
