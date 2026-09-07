import { useEffect, useMemo, useState } from 'react';
import { getGuestId, getGuestName } from '../lib/guest';
import {
  accountIdentityKey,
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
}

export function useLiminalIdentity(): LiminalIdentity {
  const guestId = useMemo(() => getGuestId(), []);
  const [account, setAccount] = useState<LiminalAccountProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void loadLiminalAccount().then((profile) => {
      if (cancelled) return;
      setAccount(profile);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  return {
    loading,
    account,
    identityKey: accountIdentityKey(account, guestId),
    playerId: account ? `liminal:${account.username}` : guestId,
    displayName: account?.displayName || getGuestName(),
    pfp: account?.pfp || null,
  };
}
