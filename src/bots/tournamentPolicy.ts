import type { BotDecision, GameState, LegalAction } from '../types/poker';
import { createRng } from '../engine/rng';
import { comboStrength, holeToCombo } from './ranges';
import { detectDraws, evaluateHand, CATEGORY_RANK } from './handStrength';
import { quickEquity } from './equity';
import { getPosition } from './position';
import { getPersona } from './personas';
import { potOdds } from './potOdds';

/**
 * Tournament policy adapted from the strategy shape of status3Bot from
 * mdp/JsPoker (MIT): separate raised/limped/unopened preflop decisions,
 * position-sensitive ranges, and made-hand-driven postflop sizing.
 *
 * This is a clean TypeScript reimplementation against our own engine and
 * evaluator. No JsPoker game-state code is used here.
 */

function pick(legal: LegalAction[], type: LegalAction['type']): LegalAction | undefined {
  return legal.find((a) => a.type === type);
}

function activeSeats(state: GameState): number[] {
  return state.seats
    .filter((s) => !s.sittingOut && !s.folded && (s.stack > 0 || s.bet > 0))
    .map((s) => s.seatIndex);
}

function wager(
  legal: LegalAction[],
  type: 'bet' | 'raise',
  target: number,
  stack: number,
): BotDecision | null {
  const action = pick(legal, type);
  if (!action) return null;
  const min = Math.max(1, Math.floor(action.min ?? 1));
  const max = Math.max(min, Math.floor(action.max ?? stack));
  const amount = Math.min(max, Math.max(min, Math.floor(target)));
  return {
    type,
    amount,
    reason: 'Tournament policy',
    confidence: 0.72,
  };
}

function valueBet(
  legal: LegalAction[],
  pot: number,
  stack: number,
  fraction: number,
  facingBet: boolean,
): BotDecision | null {
  const type = facingBet ? 'raise' : 'bet';
  const base = Math.max(1, pot);
  return wager(legal, type, Math.round(base * fraction), stack);
}

const OPEN_THRESHOLD: Record<string, number> = {
  UTG: 80,
  MP: 72,
  CO: 61,
  BTN: 52,
  SB: 58,
  BB: 0,
};

const CALL_THRESHOLD: Record<string, number> = {
  UTG: 82,
  MP: 76,
  CO: 68,
  BTN: 61,
  SB: 66,
  BB: 55,
};

export function decideTournamentAction(
  state: GameState,
  seatIndex: number,
  personaId: string,
  legal: LegalAction[],
): BotDecision {
  const seat = state.seats[seatIndex];
  const hole = seat?.holeCards;
  if (!seat || !hole || hole.length !== 2) {
    return { type: 'fold', reason: 'No playable hand state', confidence: 1 };
  }

  const persona = getPersona(personaId);
  const stack = seat.stack;
  const toCall = Math.max(0, state.currentBet - seat.bet);
  const facingBet = toCall > 0;
  const pot = Math.max(0, state.pot);
  const bb = Math.max(1, state.config.bigBlind || 1);
  const actives = activeSeats(state);
  const position = getPosition(seatIndex, state.button, actives);
  const rng = createRng(
    (state.handNo * 104729 + seatIndex * 4099 + state.history.length * 131 + state.community.length * 17) >>> 0,
  );

  const opponents = Math.max(1, actives.length - 1);
  const equity = quickEquity(hole, state.community, opponents, state.handNo * 271 + seatIndex * 13);

  if (state.street === 'preflop') {
    const combo = holeToCombo(hole);
    const strength = comboStrength(combo);
    const looseShift = Math.round((persona.vpip - 22) * 0.45);
    const aggressiveShift = Math.round((persona.pfr - 18) * 0.35);
    const openThreshold = Math.max(30, (OPEN_THRESHOLD[position] ?? 70) - looseShift - aggressiveShift);
    const callThreshold = Math.max(35, (CALL_THRESHOLD[position] ?? 72) - looseShift);
    const threeBetThreshold = Math.max(74, 90 - aggressiveShift);

    const preflopActions = state.history.filter((a) => a.street === 'preflop');
    const aggressionSeen = preflopActions.some((a) => a.type === 'raise' || a.type === 'bet' || a.type === 'all-in');
    const callers = preflopActions.filter((a) => a.type === 'call').length;

    if (!facingBet) {
      if (strength >= openThreshold) {
        const raise = pick(legal, 'raise');
        const bet = pick(legal, 'bet');
        const type = raise ? 'raise' : bet ? 'bet' : null;
        if (type) {
          const target = Math.max(bb * (callers > 0 ? 3.5 : 2.5), pot * 0.65, 1);
          const d = wager(legal, type, target, stack);
          if (d) return { ...d, reason: `Open ${combo} from ${position}`, confidence: 0.8 };
        }
      }
      if (pick(legal, 'check')) return { type: 'check', reason: `Decline open ${combo}`, confidence: 0.8 };
      return { type: 'fold', reason: `Pass ${combo} from ${position}`, confidence: 0.78 };
    }

    if (strength >= threeBetThreshold && pick(legal, 'raise')) {
      const target = Math.max(state.currentBet * (aggressionSeen ? 2.6 : 3), bb * 4);
      const d = wager(legal, 'raise', target, stack);
      if (d) return { ...d, reason: `Re-raise ${combo}`, confidence: 0.86 };
    }

    const required = potOdds(pot, toCall);
    const priceHelp = Math.max(0, required - equity) < 0.035;
    if (strength >= callThreshold || priceHelp || (position === 'BB' && toCall <= bb && strength >= callThreshold - 8)) {
      const call = pick(legal, 'call');
      if (call) return { type: 'call', amount: call.callAmount, reason: `Continue ${combo}`, confidence: 0.76 };
    }

    if (pick(legal, 'fold')) return { type: 'fold', reason: `Fold ${combo} versus action`, confidence: 0.82 };
    if (pick(legal, 'check')) return { type: 'check', reason: 'Free option', confidence: 0.9 };
  }

  const made = evaluateHand([...hole, ...state.community]);
  const category = CATEGORY_RANK[made.category];
  const draws = detectDraws(hole, state.community);
  const required = potOdds(pot, toCall);
  const drawBoost = Math.min(0.18, draws.outs * 0.018);
  const effectiveEquity = Math.min(0.99, equity + drawBoost);
  const bluffiness = persona.bluffFrequency;

  if (facingBet) {
    // status3Bot's postflop structure was strongly made-hand driven. Keep that
    // shape, but use our exact evaluator/equity instead of its old hand parser.
    if (category >= 6 || (category >= 4 && effectiveEquity > 0.72)) {
      const d = valueBet(legal, pot + toCall, stack, category >= 6 ? 0.9 : 0.68, true);
      if (d) return { ...d, reason: `Strong ${made.name}`, confidence: 0.9 };
    }

    if (category >= 2 || effectiveEquity >= required + 0.055 || (draws.outs >= 8 && effectiveEquity >= required - 0.01)) {
      if (pick(legal, 'raise') && effectiveEquity > 0.66 && rng() < 0.18 + persona.aggressionFactor * 0.08) {
        const d = valueBet(legal, pot + toCall, stack, 0.62, true);
        if (d) return { ...d, reason: `Pressure with ${made.name}`, confidence: 0.68 };
      }
      const call = pick(legal, 'call');
      if (call) return { type: 'call', amount: call.callAmount, reason: `Continue with ${made.name}`, confidence: 0.78 };
    }

    if (pick(legal, 'fold')) return { type: 'fold', reason: `Release ${made.name}`, confidence: 0.84 };
  } else {
    if (category >= 4) {
      const d = valueBet(legal, pot, stack, category >= 6 ? 0.82 : 0.62, false);
      if (d) return { ...d, reason: `Value ${made.name}`, confidence: 0.9 };
    }

    if (category >= 2 || (category === 1 && effectiveEquity > 0.56)) {
      if (rng() < 0.62 + Math.min(0.2, persona.aggressionFactor * 0.04)) {
        const d = valueBet(legal, pot, stack, 0.48, false);
        if (d) return { ...d, reason: `Value/protection ${made.name}`, confidence: 0.72 };
      }
    }

    if (draws.outs >= 8 && rng() < 0.22 + bluffiness * 0.55) {
      const d = valueBet(legal, pot, stack, 0.42, false);
      if (d) return { ...d, reason: 'Semi-bluff draw', confidence: 0.58 };
    }

    if (category === 0 && equity < 0.42 && rng() < bluffiness * 0.32) {
      const d = valueBet(legal, pot, stack, 0.36, false);
      if (d) return { ...d, reason: 'Tournament-policy bluff', confidence: 0.38 };
    }

    if (pick(legal, 'check')) return { type: 'check', reason: 'Take free card/showdown', confidence: 0.76 };
  }

  if (pick(legal, 'check')) return { type: 'check', reason: 'Fallback check', confidence: 0.4 };
  if (pick(legal, 'fold')) return { type: 'fold', reason: 'Fallback fold', confidence: 0.4 };
  const call = pick(legal, 'call');
  if (call) return { type: 'call', amount: call.callAmount, reason: 'Fallback call', confidence: 0.3 };
  if (pick(legal, 'all-in')) return { type: 'all-in', reason: 'Only action left', confidence: 0.2 };
  return { type: 'fold', reason: 'No usable action', confidence: 0 };
}
