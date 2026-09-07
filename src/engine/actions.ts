import type { GameState, LegalAction, ActionType } from '../types/poker';

export function getLegalActions(state: GameState): LegalAction[] {
  if (state.currentSeat == null || state.street === 'showdown' || state.street === 'complete') {
    return [];
  }
  const seat = state.seats[state.currentSeat];
  if (!seat || seat.folded || seat.allIn || seat.sittingOut) return [];

  const toCall = Math.max(0, state.currentBet - seat.bet);
  const actions: LegalAction[] = [];

  // Folding is always legal while a player still has cards. Mobile already exposes
  // this as a gesture; desktop must get the same action explicitly.
  actions.push({ type: 'fold' });

  if (toCall === 0) {
    actions.push({ type: 'check' });
  } else if (toCall >= seat.stack) {
    actions.push({ type: 'all-in', min: seat.stack, max: seat.stack, callAmount: seat.stack });
    return actions;
  } else {
    actions.push({ type: 'call', callAmount: toCall, min: toCall, max: toCall });
  }

  if (seat.raiseLocked) return actions;

  if (state.currentBet === 0) {
    const baseMinBet = Math.max(1, state.config.bigBlind || 1);
    const minBet = Math.min(seat.stack, baseMinBet);
    if (seat.stack > 0) {
      if (seat.stack <= minBet) {
        actions.push({ type: 'all-in', min: seat.stack, max: seat.stack });
      } else {
        actions.push({ type: 'bet', min: minBet, max: seat.stack });
        actions.push({ type: 'all-in', min: seat.stack, max: seat.stack });
      }
    }
    return actions;
  }

  const minRaiseTotal = state.currentBet + state.minRaise;
  const minAdd = Math.min(seat.stack, minRaiseTotal - seat.bet);
  if (seat.stack > toCall) {
    if (minAdd >= seat.stack) {
      actions.push({ type: 'all-in', min: seat.stack, max: seat.stack });
    } else {
      actions.push({
        type: 'raise',
        min: minRaiseTotal - seat.bet,
        max: seat.stack,
      });
      actions.push({ type: 'all-in', min: seat.stack, max: seat.stack });
    }
  }

  return actions;
}

export function isActionLegal(
  state: GameState,
  type: ActionType,
  amount?: number,
): boolean {
  const legal = getLegalActions(state);
  const match = legal.find((a) => a.type === type);
  if (!match) return false;
  if (type === 'bet' || type === 'raise') {
    if (amount == null || !Number.isFinite(amount) || amount <= 0) return false;
    return amount >= Math.max(1, match.min ?? 1) && amount <= (match.max ?? Infinity);
  }
  return true;
}
