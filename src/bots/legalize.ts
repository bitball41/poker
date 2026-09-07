import type { BotDecision, LegalAction } from '../types/poker';

function find(legal: LegalAction[], type: LegalAction['type']): LegalAction | undefined {
  return legal.find((a) => a.type === type);
}

/**
 * Final safety boundary between any bot policy and the poker engine.
 *
 * Bot policies are allowed to be imperfect. They are NOT allowed to invent
 * actions, check while facing a bet, or submit a zero/negative wager.
 */
export function legalizeBotDecision(
  proposed: BotDecision,
  legal: LegalAction[],
  stack: number,
): BotDecision {
  const keepReason = (reason: string) => proposed.reason ? `${proposed.reason} · ${reason}` : reason;

  if (proposed.type === 'check' && find(legal, 'check')) {
    return { ...proposed, type: 'check', amount: undefined };
  }

  if (proposed.type === 'fold' && find(legal, 'fold')) {
    return { ...proposed, type: 'fold', amount: undefined };
  }

  if (proposed.type === 'call') {
    const call = find(legal, 'call');
    if (call) {
      return { ...proposed, type: 'call', amount: call.callAmount };
    }
    if (find(legal, 'check')) {
      return { ...proposed, type: 'check', amount: undefined, reason: keepReason('free check') };
    }
  }

  if (proposed.type === 'all-in' && find(legal, 'all-in')) {
    return { ...proposed, type: 'all-in', amount: undefined };
  }

  if (proposed.type === 'bet' || proposed.type === 'raise') {
    const action = find(legal, proposed.type);
    if (action) {
      const min = Math.max(1, Math.floor(action.min ?? 1));
      const max = Math.max(min, Math.floor(action.max ?? stack));
      const raw = Number(proposed.amount);
      const amount = Number.isFinite(raw)
        ? Math.min(max, Math.max(min, Math.floor(raw)))
        : min;

      // Prefer the engine's explicit all-in action at the ceiling so histories
      // and side-pot behavior stay semantically clear.
      if (amount >= stack && find(legal, 'all-in')) {
        return {
          ...proposed,
          type: 'all-in',
          amount: undefined,
          reason: keepReason('legalized to all-in'),
        };
      }

      return { ...proposed, type: proposed.type, amount };
    }
  }

  // Conservative fallback. A broken policy should never create a broken hand.
  if (find(legal, 'check')) {
    return { type: 'check', reason: keepReason('legal fallback'), confidence: 0.1 };
  }
  if (find(legal, 'fold')) {
    return { type: 'fold', reason: keepReason('legal fallback'), confidence: 0.1 };
  }

  const call = find(legal, 'call');
  if (call) {
    return {
      type: 'call',
      amount: call.callAmount,
      reason: keepReason('legal fallback'),
      confidence: 0.1,
    };
  }

  if (find(legal, 'all-in')) {
    return { type: 'all-in', reason: keepReason('only legal action'), confidence: 0.1 };
  }

  const wager = find(legal, 'bet') ?? find(legal, 'raise');
  if (wager) {
    return {
      type: wager.type,
      amount: Math.max(1, Math.floor(wager.min ?? 1)),
      reason: keepReason('legal fallback'),
      confidence: 0.1,
    };
  }

  return { type: 'fold', reason: keepReason('no legal actions'), confidence: 0 };
}
