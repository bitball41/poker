import { createClient } from '@supabase/supabase-js';

const DEFAULT_LIMINAL_URL = 'https://wjufzyqppnjymctzhctn.supabase.co';
const DEFAULT_LIMINAL_KEY = 'sb_publishable_kp_ST1YFLKA9iV6AhruG3g_qIv7oNQO';
const RESERVED_NAMES = ['claude', 'system', 'liminal', 'admin'];
export const LIMINAL_AUTH_EVENT = 'liminal-poker-auth-changed';

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

function toSafeProfile(row: any): LiminalAccountProfile {
  return {
    username: row.username,
    displayName: row.display_name || row.username,
    pfp: row.pfp || null,
    color: row.color || null,
    ring: row.ring || null,
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

function saveLiminalSession(username: string, passwordHash: string): void {
  localStorage.setItem('lc_user', username);
  localStorage.setItem('lc_pass_hash', passwordHash);
  window.dispatchEvent(new Event(LIMINAL_AUTH_EVENT));
}

export function signOutLiminalAccount(): void {
  try {
    localStorage.removeItem('lc_user');
    localStorage.removeItem('lc_pass_hash');
  } finally {
    window.dispatchEvent(new Event(LIMINAL_AUTH_EVENT));
  }
}

export async function sha256Hex(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Password hashing is unavailable in this browser.');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validateLiminalUsername(username: string): string | null {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return 'Usernames are 3-20 characters: letters, numbers, underscores.';
  }
  if (RESERVED_NAMES.includes(username.toLowerCase())) return 'That username is reserved.';
  return null;
}

async function fetchProfile(username: string): Promise<any | null> {
  const { data, error } = await liminalClient
    .from('profiles')
    .select('username,display_name,pfp,color,ring,is_banned,password_hash')
    .eq('username', username)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function loginLiminalAccount(username: string, password: string): Promise<LiminalAccountProfile> {
  const cleanUsername = username.trim();
  if (!cleanUsername || !password) throw new Error('Enter your username and password.');

  const row = await fetchProfile(cleanUsername);
  if (!row) throw new Error('Account not found.');
  if (row.is_banned) throw new Error('This Liminal account is unavailable.');

  const passwordHash = await sha256Hex(password);
  if (row.password_hash !== passwordHash) throw new Error('Incorrect password.');

  saveLiminalSession(row.username, passwordHash);
  return toSafeProfile(row);
}

export async function signupLiminalAccount(
  username: string,
  displayName: string,
  password: string,
): Promise<LiminalAccountProfile> {
  const cleanUsername = username.trim();
  const cleanDisplayName = displayName.trim();
  const usernameError = validateLiminalUsername(cleanUsername);
  if (usernameError) throw new Error(usernameError);
  if (!cleanDisplayName || cleanDisplayName.length > 40) {
    throw new Error('Display names must be 1-40 characters.');
  }
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');

  const taken = await fetchProfile(cleanUsername);
  if (taken) throw new Error('That username is already taken.');

  const passwordHash = await sha256Hex(password);
  const { data, error } = await liminalClient
    .from('profiles')
    .insert({
      username: cleanUsername,
      display_name: cleanDisplayName,
      password_hash: passwordHash,
    })
    .select('username,display_name,pfp,color,ring,is_banned,password_hash')
    .single();
  if (error) throw error;
  if (!data) throw new Error('Liminal account creation failed.');

  saveLiminalSession(data.username, passwordHash);
  return toSafeProfile(data);
}

/**
 * Resolve the existing Liminal Chat account without creating a second account system.
 * Integration order:
 * 1. Direct in-app injection via window.__LIMINAL_ACCOUNT__.
 * 2. Same-origin saved Liminal session.
 * 3. Cross-origin parent/iframe identity handshake.
 */
export async function loadLiminalAccount(): Promise<LiminalAccountProfile | null> {
  const embedded = normalizeEmbedded(window.__LIMINAL_ACCOUNT__);
  if (embedded) return embedded;

  const session = readLiminalSession();
  if (!session) return requestParentIdentity();

  try {
    const row = await fetchProfile(session.username);
    if (!row || row.is_banned || row.password_hash !== session.passwordHash) {
      return requestParentIdentity();
    }
    return toSafeProfile(row);
  } catch {
    return requestParentIdentity();
  }
}

export function accountIdentityKey(profile: LiminalAccountProfile | null, guestId: string): string {
  return profile ? `liminal:${profile.username.toLowerCase()}` : `guest:${guestId}`;
}
