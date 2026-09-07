import type { Card, GameState } from '../types/poker';

/** A showdown is public only when the engine awarded a named evaluated hand. */
export function isPublicShowdown(state: GameState): boolean {
  return state.street === 'complete' && Boolean(state.winners?.some((w) => w.handName));
}

/**
 * Strip all future deck information and private hole cards before a state is
 * written to the shared/public multiplayer row.
 */
export function sanitizePublicState(state: GameState): GameState {
  const reveal = isPublicShowdown(state);
  return {
    ...state,
    deck: [],
    community: [...state.community],
    history: [...state.history],
    seats: state.seats.map((seat) => ({
      ...seat,
      holeCards: reveal && !seat.folded && seat.holeCards ? [...seat.holeCards] : null,
    })),
    sidePots: state.sidePots.map((p) => ({ ...p, eligibleSeats: [...p.eligibleSeats] })),
    winners: state.winners ? state.winners.map((w) => ({ ...w })) : null,
  };
}

/** Merge only the current viewer's private cards back into the public state. */
export function mergeViewerCards(
  state: GameState,
  playerId: string,
  cards: Card[] | null,
): GameState {
  if (!cards?.length) return state;
  return {
    ...state,
    seats: state.seats.map((seat) =>
      seat.playerId === playerId ? { ...seat, holeCards: [...cards] } : seat,
    ),
  };
}
