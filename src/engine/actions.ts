import type { GameState, LegalAction, ActionType } from '../types/poker';

export function getLegalActions(state: GameState): LegalAction[] {
  if (state.currentSeat == null || state.street === 'showdown' || state.street === 'complete') {
    return [];
  }
  const seat = state.seats[state.currentSeat];
  if (!seat || seat.folded || seat.allIn || seat.sittingOut) return [];

  const toCall = Math.max(0, state.currentBet - seat.bet);
  const actions: LegalAction[] = [];

  if (toCall > 0) {
    actions.push({ type: 'fold' });
  }

  if (toCall === 0) {
    actions.push({ type: 'check' });
  } else if (toCall >= seat.stack) {
    actions.push({ type: 'all-in', min: seat.stack, max: seat.stack, callAmount: seat.stack });
    return actions;
  } else {
    actions.push({ type: 'call', callAmount: toCall, min: toCall, max: toCall });
  }

  // Bet / raise
  const minRaiseTotal = state.currentBet + state.minRaise;

  if (state.currentBet === 0) {
    // Bet at least BB
    const minBet = Math.min(seat.stack, state.config.bigBlind);
    if (seat.stack > 0) {
      if (seat.stack <= minBet) {
        actions.push({ type: 'all-in', min: seat.stack, max: seat.stack });
      } else {
        actions.push({ type: 'bet', min: minBet, max: seat.stack });
        actions.push({ type: 'all-in', min: seat.stack, max: seat.stack });
      }
    }
  } else {
    // Raise: amount is total chips to put in this street (absolute bet level), or chips to add?
    // We use: amount = total bet for this street (the new currentBet target contribution from this player... )
    // Convention: amount = chips ADDED this action for bet/raise/call/all-in
    const minAdd = Math.min(seat.stack, minRaiseTotal - seat.bet);
    if (seat.stack > toCall) {
      if (minAdd >= seat.stack) {
        actions.push({ type: 'all-in', min: seat.stack, max: seat.stack });
      } else {
        actions.push({
          type: 'raise',
          min: minRaiseTotal - seat.bet, // chips to add to reach min raise
          max: seat.stack,
        });
        actions.push({ type: 'all-in', min: seat.stack, max: seat.stack });
      }
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
    if (amount == null) return false;
    return amount >= (match.min ?? 0) && amount <= (match.max ?? Infinity);
  }
  if (type === 'all-in') return true;
  if (type === 'call') return true;
  return true;
}
