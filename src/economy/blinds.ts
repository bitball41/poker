import type { GameState } from '../types/poker';

export interface BlindPressure {
  hand: number;
  smallBlind: number;
  bigBlind: number;
  targetHand: number;
  targetChips: number;
}

/**
 * Tournament-style fake-chip pressure. The target is informational; the rising
 * blinds are what create the pressure instead of an arbitrary hard elimination.
 */
export function blindPressureForHand(hand: number): BlindPressure {
  const h = Math.max(1, Math.floor(hand));
  if (h <= 4) return { hand: h, smallBlind: 2, bigBlind: 4, targetHand: 5, targetChips: 300 };
  if (h <= 9) return { hand: h, smallBlind: 4, bigBlind: 8, targetHand: 10, targetChips: 400 };
  if (h <= 14) return { hand: h, smallBlind: 8, bigBlind: 16, targetHand: 15, targetChips: 550 };
  if (h <= 19) return { hand: h, smallBlind: 12, bigBlind: 24, targetHand: 20, targetChips: 750 };

  const extraLevel = Math.floor((h - 20) / 5);
  return {
    hand: h,
    smallBlind: 20 + extraLevel * 5,
    bigBlind: 40 + extraLevel * 10,
    targetHand: 25 + extraLevel * 5,
    targetChips: 1000 + extraLevel * 250,
  };
}

export function withBlindPressure(state: GameState, nextHand: number): GameState {
  const level = blindPressureForHand(nextHand);
  return {
    ...state,
    config: {
      ...state.config,
      smallBlind: level.smallBlind,
      bigBlind: level.bigBlind,
    },
  };
}
