import type { Card, GameState, LegalAction, BotDecision } from '../../types/poker';

export const ML_FEATURE_COUNT = 160;
export const ML_ACTIONS = ['fold', 'check', 'call', 'wager', 'all-in'] as const;
export type MlAction = (typeof ML_ACTIONS)[number];

const SUITS: Record<Card['suit'], number> = { h: 0, d: 1, c: 2, s: 3 };

function cardIndex(card: Card): number {
  return (card.rank - 2) * 4 + SUITS[card.suit];
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function normChip(value: number, scale: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(4, value / Math.max(1, scale)) / 4;
}

function occupiedSeats(state: GameState) {
  return state.seats.filter((seat) => !seat.sittingOut && seat.playerId != null);
}

function averageTableStack(state: GameState): number {
  const occupied = occupiedSeats(state);
  if (!occupied.length) return 1;
  const chips = occupied.reduce((sum, seat) => sum + seat.stack + seat.totalBet, 0);
  return Math.max(1, chips / occupied.length);
}

/**
 * Encode exactly what a real player at seatIndex is allowed to know.
 * Opponent hole cards and the undealt deck are deliberately ignored.
 */
export function encodeBotFeatures(state: GameState, seatIndex: number): Float32Array {
  const seat = state.seats[seatIndex];
  if (!seat) throw new Error(`Missing seat ${seatIndex}`);

  const out = new Float32Array(ML_FEATURE_COUNT);

  // 0..51: acting player's hole cards.
  for (const card of seat.holeCards ?? []) out[cardIndex(card)] = 1;

  // 52..103: public board cards.
  for (const card of state.community) out[52 + cardIndex(card)] = 1;

  // 104..107: street one-hot.
  const streetIndex = state.street === 'preflop'
    ? 0
    : state.street === 'flop'
      ? 1
      : state.street === 'turn'
        ? 2
        : state.street === 'river'
          ? 3
          : -1;
  if (streetIndex >= 0) out[104 + streetIndex] = 1;

  const scale = averageTableStack(state);
  const toCall = Math.max(0, state.currentBet - seat.bet);
  const active = state.seats.filter((s) => !s.sittingOut && !s.folded && !s.allIn).length;
  const contenders = state.seats.filter((s) => !s.sittingOut && !s.folded).length;
  const buttonDistance = state.seats.length > 1
    ? ((seatIndex - state.button + state.seats.length) % state.seats.length) / (state.seats.length - 1)
    : 0;

  // 108..123: compact global/actor state.
  const globals = [
    normChip(state.pot, scale),
    normChip(state.currentBet, scale),
    normChip(state.minRaise, scale),
    normChip(toCall, scale),
    normChip(seat.stack, scale),
    normChip(seat.bet, scale),
    normChip(state.config.smallBlind, scale),
    normChip(state.config.bigBlind, scale),
    clamp01(active / 9),
    clamp01(contenders / 9),
    clamp01(buttonDistance),
    seatIndex === state.button ? 1 : 0,
    seatIndex === state.sbSeat ? 1 : 0,
    seatIndex === state.bbSeat ? 1 : 0,
    seat.hasActed ? 1 : 0,
    seat.raiseLocked ? 1 : 0,
  ];
  globals.forEach((value, i) => { out[108 + i] = value; });

  // 124..159: nine seats, clockwise from the actor, four public features each.
  // Layout per seat: occupied, stack, current-street bet, status scalar.
  for (let offset = 0; offset < 9; offset++) {
    const idx = (seatIndex + offset) % state.seats.length;
    const other = state.seats[idx];
    const base = 124 + offset * 4;
    if (!other || other.sittingOut || other.playerId == null) continue;
    out[base] = 1;
    out[base + 1] = normChip(other.stack, scale);
    out[base + 2] = normChip(other.bet, scale);
    out[base + 3] = other.folded ? -1 : other.allIn ? 1 : 0;
  }

  return out;
}

export function legalActionMask(legal: LegalAction[]): Uint8Array {
  const mask = new Uint8Array(ML_ACTIONS.length);
  const has = (type: LegalAction['type']) => legal.some((action) => action.type === type);
  mask[0] = has('fold') ? 1 : 0;
  mask[1] = has('check') ? 1 : 0;
  mask[2] = has('call') ? 1 : 0;
  mask[3] = has('bet') || has('raise') ? 1 : 0;
  mask[4] = has('all-in') ? 1 : 0;
  return mask;
}

export function decisionToTrainingTarget(
  decision: BotDecision,
  legal: LegalAction[],
): { action: number; size: number } {
  let action: number;
  if (decision.type === 'fold') action = 0;
  else if (decision.type === 'check') action = 1;
  else if (decision.type === 'call') action = 2;
  else if (decision.type === 'bet' || decision.type === 'raise') action = 3;
  else action = 4;

  if (action !== 3) return { action, size: 0 };

  const wager = legal.find((item) => item.type === decision.type);
  const min = Math.max(1, wager?.min ?? 1);
  const max = Math.max(min, wager?.max ?? min);
  const amount = Math.min(max, Math.max(min, decision.amount ?? min));
  const size = max === min ? 0 : clamp01((amount - min) / (max - min));
  return { action, size };
}
