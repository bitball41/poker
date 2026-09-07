import { useCallback, useEffect, useMemo, useState } from 'react';
import { getGuestId, getGuestName } from '../lib/guest';
import {
  accountIdentityKey,
  LIMINAL_AUTH_EVENT,
  loadLiminalAccount,
  type LiminalAccountProfile,
} from '../lib/liminalAccount';

export interface LiminalIdentity {
  loading: boolean;
  account: LiminalAccountProfile | null;
  identityKey: string;
  playerId: string;
  displayName: string;
  pfp: string | null;
  refresh: () => Promise<void>;
}

export function useLiminalIdentity(): LiminalIdentity {
  const guestId = useMemo(() => getGuestId(), []);
  const [account, setAccount] = useState<LiminalAccountProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setAccount(await loadLiminalAccount());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initial = async () => {
      setLoading(true);
      const profile = await loadLiminalAccount();
      if (cancelled) return;
      setAccount(profile);
      setLoading(false);
    };
    const onAuthChange = () => { void refresh(); };

    void initial();
    window.addEventListener(LIMINAL_AUTH_EVENT, onAuthChange);
    return () => {
      cancelled = true;
      window.removeEventListener(LIMINAL_AUTH_EVENT, onAuthChange);
    };
  }, [refresh]);

  return {
    loading,
    account,
    identityKey: accountIdentityKey(account, guestId),
    playerId: account ? `liminal:${account.username}` : guestId,
    displayName: account?.displayName || getGuestName(),
    pfp: account?.pfp || null,
    refresh,
  };
}
