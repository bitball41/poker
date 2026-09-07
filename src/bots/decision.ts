import type { GameState, BotDecision, ActionType, LegalAction, Card } from '../types/poker';
import { getPersona, type Persona } from './personas';
import { holeToCombo, getRange, inRange, comboStrength } from './ranges';
import { getPosition, type PositionLabel } from './position';
import { quickEquity } from './equity';
import { potOdds, shouldCallByOdds, spr } from './potOdds';
import { evaluateHand, detectDraws, CATEGORY_RANK, type HandValue } from './handStrength';
import { createRng } from '../engine/rng';

export interface DecisionContext {
  legal: LegalAction[];
  toCall: number;
  pot: number;
  canCheck: boolean;
}

function activeSeats(state: GameState): number[] {
  return state.seats
    .filter((s) => !s.sittingOut && s.stack + s.bet > 0)
    .map((s) => s.seatIndex);
}

function opponentsInHand(state: GameState, heroSeat: number): number {
  return state.seats.filter(
    (s) => s.seatIndex !== heroSeat && !s.folded && !s.sittingOut && (s.stack > 0 || s.bet > 0),
  ).length;
}

function boardTexture(board: Card[]): { wet: boolean; paired: boolean; monotone: boolean } {
  if (board.length < 3) return { wet: false, paired: false, monotone: false };
  const suits = new Map<string, number>();
  const ranks = new Map<number, number>();
  for (const c of board) {
    suits.set(c.suit, (suits.get(c.suit) ?? 0) + 1);
    ranks.set(c.rank, (ranks.get(c.rank) ?? 0) + 1);
  }
  const monotone = [...suits.values()].some((n) => n >= 3);
  const paired = [...ranks.values()].some((n) => n >= 2);
  const sorted = [...new Set(board.map((c) => c.rank))].sort((a, b) => a - b);
  let connected = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] <= 2) connected++;
  }
  const wet = monotone || connected >= 2 || (paired && connected >= 1);
  return { wet, paired, monotone };
}

function pickLegal(legal: LegalAction[], type: ActionType): LegalAction | undefined {
  return legal.find((a) => a.type === type);
}

function sizeBet(
  pot: number,
  stack: number,
  fraction: number,
  legal: LegalAction[],
  preferRaise: boolean,
): { type: ActionType; amount: number } | null {
  const bet = pickLegal(legal, preferRaise ? 'raise' : 'bet')
    ?? pickLegal(legal, 'bet')
    ?? pickLegal(legal, 'raise')
    ?? pickLegal(legal, 'all-in');
  if (!bet) return null;
  if (bet.type === 'all-in') return { type: 'all-in', amount: stack };

  const min = bet.min ?? 0;
  const max = bet.max ?? stack;
  let amount = Math.round(pot * fraction);
  amount = Math.max(min, Math.min(max, amount));
  // Round to sensible chips
  if (amount >= max * 0.9) return { type: amount >= stack ? 'all-in' : bet.type, amount: max };
  return { type: bet.type, amount };
}

export function decideAction(
  state: GameState,
  heroSeat: number,
  personaId: string,
  legalActions: LegalAction[],
): BotDecision {
  const persona = getPersona(personaId);
  const seat = state.seats[heroSeat];
  const hole = seat.holeCards;
  if (!hole || hole.length !== 2) {
    return { type: 'fold', reason: 'No cards', confidence: 1 };
  }

  const rng = createRng(
    (state.handNo * 10007 + heroSeat * 97 + state.community.length * 13 + seat.stack) >>> 0,
  );

  const toCall = Math.max(0, state.currentBet - seat.bet);
  const pot = state.pot;
  const canCheck = toCall === 0 && !!pickLegal(legalActions, 'check');
  const combo = holeToCombo(hole);
  const strength = comboStrength(combo);
  const actives = activeSeats(state);
  const pos = getPosition(heroSeat, state.button, actives);
  const nOpp = opponentsInHand(state, heroSeat);
  const equity = quickEquity(hole, state.community, Math.max(1, nOpp), state.handNo * 31 + heroSeat);
  const required = potOdds(pot, toCall);
  const stack = seat.stack;
  const oppStacks = state.seats.filter((s) => !s.folded && s.seatIndex !== heroSeat).map((s) => s.stack + s.bet);
  const effSpr = spr(Math.min(stack, ...(oppStacks.length ? oppStacks : [stack])), pot || state.config.bigBlind);
  const texture = boardTexture(state.community);

  // Strong made hand on board
  let made: HandValue | null = null;
  if (state.community.length >= 3) {
    made = evaluateHand([...hole, ...state.community]);
  }
  const draws = detectDraws(hole, state.community);
  const isNutsish = made && CATEGORY_RANK[made.category] >= 6; // FH+
  const isStrong = made && CATEGORY_RANK[made.category] >= 4; // straight+
  const isPairPlus = made && CATEGORY_RANK[made.category] >= 1;

  // === NEVER fold nuts ===
  if (persona.respectNuts && isNutsish && toCall > 0) {
    // Low SPR → prefer commit
    void effSpr;
    const allIn = pickLegal(legalActions, 'all-in');
    const call = pickLegal(legalActions, 'call');
    const raise = sizeBet(pot, stack, 0.75, legalActions, true);
    if (raise && rng() < 0.55) {
      return { type: raise.type, amount: raise.amount, reason: `Near nuts (${made!.name}) — value`, confidence: 0.95 };
    }
    if (call) return { type: 'call', amount: call.callAmount, reason: `Nuts/near-nuts (${made!.name}) — call`, confidence: 0.98 };
    if (allIn) return { type: 'all-in', amount: stack, reason: 'Commit with monster', confidence: 0.9 };
  }

  // === PREFLOP ===
  if (state.street === 'preflop') {
    return decidePreflop({
      state, persona, combo, strength, pos, toCall, pot, canCheck, legalActions, stack, equity, required, rng, seatBet: seat.bet,
    });
  }

  // === POSTFLOP ===
  // Fold frequency vs cbet for weak hands
  const isFacingBet = toCall > 0;
  const bluffRoll = rng();
  const callPad = (persona.callStationTendency - 0.2) * 0.15 - persona.stackFear * 0.05;

  // Strong hands → value
  if (isStrong || (made && made.category === 'trips') || (made && made.category === 'two-pair' && !texture.paired)) {
    const frac = persona.aggressionFactor > 2 ? 0.7 : 0.55;
    if (!isFacingBet) {
      const bet = sizeBet(pot, stack, texture.wet ? 0.66 : frac, legalActions, false);
      if (bet && rng() < 0.75 + persona.aggressionFactor * 0.05) {
        return { type: bet.type, amount: bet.amount, reason: `Value ${made!.name}`, confidence: 0.85 };
      }
      if (canCheck) return { type: 'check', reason: `Slowplay ${made!.name}`, confidence: 0.6 };
    } else {
      // Raise for value sometimes
      if (rng() < 0.35 + persona.aggressionFactor * 0.08) {
        const raise = sizeBet(pot + toCall, stack, 0.7, legalActions, true);
        if (raise) return { type: raise.type, amount: raise.amount, reason: `Raise value ${made!.name}`, confidence: 0.8 };
      }
      const call = pickLegal(legalActions, 'call');
      if (call) return { type: 'call', amount: call.callAmount, reason: `Call with ${made!.name}`, confidence: 0.85 };
    }
  }

  // Draws
  const drawEquityBoost = draws.outs * 0.02;
  const effEq = Math.min(0.95, equity + drawEquityBoost * 0.5);

  if (draws.outs >= 8 && !isFacingBet) {
    const cbetFreq = texture.wet ? 0.45 : 0.55;
    if (rng() < cbetFreq * (0.5 + persona.bluffFrequency)) {
      const bet = sizeBet(pot, stack, 0.5, legalActions, false);
      if (bet) return { type: bet.type, amount: bet.amount, reason: `Semi-bluff (${draws.outs} outs)`, confidence: 0.55 };
    }
  }

  if (isFacingBet) {
    // Fold to cbet tendency for weak holdings
    const weak = !isPairPlus && draws.outs < 6;
    if (weak && rng() < persona.foldToCbet * (1 - persona.callStationTendency * 0.5)) {
      if (pickLegal(legalActions, 'fold')) {
        return {
          type: 'fold',
          reason: `Fold weak (eq ${(equity * 100).toFixed(0)}%, need ${(required * 100).toFixed(0)}%)`,
          confidence: 0.7,
        };
      }
    }

    if (shouldCallByOdds(effEq, pot, toCall, stack - toCall, callPad)) {
      // Sometimes raise as bluff (Fox / Jinx / Volt)
      if (rng() < persona.bluffFrequency * 0.25 && pickLegal(legalActions, 'raise')) {
        const raise = sizeBet(pot + toCall, stack, 0.66, legalActions, true);
        if (raise) return { type: raise.type, amount: raise.amount, reason: 'Bluff-raise', confidence: 0.4 };
      }
      const call = pickLegal(legalActions, 'call');
      if (call) {
        return {
          type: 'call',
          amount: call.callAmount,
          reason: `Pot odds ${(1 / Math.max(0.01, required)).toFixed(1)}:1, eq ~${(effEq * 100).toFixed(0)}%`,
          confidence: 0.65,
        };
      }
    }

    // Call station override
    if (persona.callStationTendency > 0.6 && equity > required * 0.7 && pickLegal(legalActions, 'call')) {
      const call = pickLegal(legalActions, 'call')!;
      return { type: 'call', amount: call.callAmount, reason: 'Station call (thin)', confidence: 0.45 };
    }

    if (pickLegal(legalActions, 'fold')) {
      return {
        type: 'fold',
        reason: `Eq ${(equity * 100).toFixed(0)}% < price ${(required * 100).toFixed(0)}%`,
        confidence: 0.75,
      };
    }
  }

  // Check / bet when checked to
  if (canCheck) {
    // C-bet as aggressor feel — use last aggressor approx
    const cbetChance =
      (texture.wet ? 0.35 : 0.55) * (0.4 + persona.aggressionFactor * 0.15) * (0.5 + persona.bluffFrequency);
    const hasShowdown = isPairPlus || equity > 0.45;
    if (!hasShowdown && bluffRoll < cbetChance) {
      const bet = sizeBet(pot, stack, texture.wet ? 0.33 : 0.5, legalActions, false);
      if (bet) return { type: bet.type, amount: bet.amount, reason: 'Bluff / c-bet', confidence: 0.4 };
    }
    if (hasShowdown && rng() < 0.4 * persona.aggressionFactor / 2) {
      const bet = sizeBet(pot, stack, 0.5, legalActions, false);
      if (bet) return { type: bet.type, amount: bet.amount, reason: 'Thin value', confidence: 0.5 };
    }
    return { type: 'check', reason: 'Check control', confidence: 0.55 };
  }

  // Fallback
  if (canCheck) return { type: 'check', reason: 'Fallback check', confidence: 0.3 };
  if (pickLegal(legalActions, 'call') && equity >= required - 0.05) {
    const call = pickLegal(legalActions, 'call')!;
    return { type: 'call', amount: call.callAmount, reason: 'Fallback call', confidence: 0.35 };
  }
  if (pickLegal(legalActions, 'fold')) return { type: 'fold', reason: 'Fallback fold', confidence: 0.4 };
  if (pickLegal(legalActions, 'check')) return { type: 'check', reason: 'Fallback', confidence: 0.2 };
  const allIn = pickLegal(legalActions, 'all-in');
  if (allIn) return { type: 'all-in', amount: stack, reason: 'Only all-in left', confidence: 0.2 };
  return { type: 'fold', reason: 'No legal action', confidence: 0.1 };
}

function decidePreflop(args: {
  state: GameState;
  persona: Persona;
  combo: string;
  strength: number;
  pos: PositionLabel;
  toCall: number;
  pot: number;
  canCheck: boolean;
  legalActions: LegalAction[];
  stack: number;
  equity: number;
  required: number;
  rng: () => number;
  seatBet: number;
}): BotDecision {
  const {
    persona, combo, strength, pos, toCall, pot, canCheck, legalActions,
    stack, equity, required, rng, state,
  } = args;

  const openRange = getRange(pos, 'open', persona.vpip, persona.pfr);
  const callRange = getRange(pos, 'call', persona.vpip, persona.pfr);
  const threeBetRange = getRange(pos, '3bet', persona.vpip, persona.pfr);
  const bb = state.config.bigBlind;
  const raiseSeen = state.currentBet > bb;
  const isPremium = strength >= 90; // JJ+, AQ+
  const isStrong = strength >= 78;

  // Maniac: still hand-aware — don't shove 72o every hand
  if (persona.id === 'volt') {
    if (strength < 28 && toCall > bb * 2) {
      if (pickLegal(legalActions, 'fold')) {
        return { type: 'fold', reason: 'Even Volt folds trash vs raise', confidence: 0.7 };
      }
    }
  }

  if (toCall === 0 || (canCheck && toCall === 0)) {
    // Open or limp
    if (inRange(combo, openRange) || isPremium) {
      const frac = persona.aggressionFactor > 3 ? 3.5 : persona.aggressionFactor > 2 ? 2.7 : 2.5;
      // size in BB
      const betAct = pickLegal(legalActions, 'raise') ?? pickLegal(legalActions, 'bet');
      if (betAct) {
        const min = betAct.min ?? bb * 2;
        const max = betAct.max ?? stack;
        let amount = Math.round(bb * frac);
        if (pos === 'BTN' || pos === 'CO') amount = Math.round(bb * (frac - 0.3));
        amount = Math.max(min, Math.min(max, amount));
        return { type: betAct.type, amount, reason: `Open ${combo} from ${pos}`, confidence: 0.75 };
      }
    }
    if (persona.limps && inRange(combo, callRange) && strength > 40) {
      // limp = check if BB, else we can't limp easily without a limp action — treat as call 0 / check
      if (canCheck) return { type: 'check', reason: `Limp/check ${combo}`, confidence: 0.5 };
    }
    // GTO/TAG never open-limp — fold or raise only
    if (!persona.limps && canCheck && pos === 'BB') {
      return { type: 'check', reason: 'BB check', confidence: 0.8 };
    }
    if (canCheck) return { type: 'check', reason: `Decline open ${combo}`, confidence: 0.7 };
    if (pickLegal(legalActions, 'fold')) return { type: 'fold', reason: `Fold ${combo} ${pos}`, confidence: 0.7 };
  }

  // Facing a raise
  if (raiseSeen || toCall > 0) {
    // Trash: tight personas fold unless BB discount
    if (strength < 35 && persona.vpip < 30 && !(pos === 'BB' && toCall <= bb) && pickLegal(legalActions, 'fold')) {
      return { type: 'fold', reason: `Fold trash ${combo}`, confidence: 0.8 };
    }
    if (inRange(combo, threeBetRange) || isPremium) {
      const raise = pickLegal(legalActions, 'raise');
      if (raise && (isPremium || rng() < 0.55 + persona.aggressionFactor * 0.05)) {
        const min = raise.min ?? toCall * 2;
        const max = raise.max ?? stack;
        const amount = Math.max(min, Math.min(max, Math.round(state.currentBet * 2.5 + pot * 0.1)));
        return { type: 'raise', amount, reason: `3-bet ${combo}`, confidence: 0.8 };
      }
    }
    if (inRange(combo, callRange) || isStrong || shouldCallByOdds(equity, pot, toCall, stack - toCall, persona.callStationTendency * 0.1)) {
      // Nit folds more
      if (persona.vpip < 15 && strength < 85 && toCall > bb * 3 && rng() < 0.6) {
        if (pickLegal(legalActions, 'fold')) {
          return { type: 'fold', reason: `Nit fold ${combo}`, confidence: 0.65 };
        }
      }
      const call = pickLegal(legalActions, 'call');
      if (call) return { type: 'call', amount: call.callAmount, reason: `Call ${combo} (eq ${(equity * 100).toFixed(0)}%)`, confidence: 0.7 };
    }
    // Station calls wider
    if (persona.callStationTendency > 0.5 && strength > 35) {
      const call = pickLegal(legalActions, 'call');
      if (call && toCall <= stack) {
        return { type: 'call', amount: call.callAmount, reason: `Station flats ${combo}`, confidence: 0.5 };
      }
    }
    // Bluffy 3-bet (Fox / Jinx)
    if (rng() < persona.bluffFrequency * 0.15 && strength > 45 && pickLegal(legalActions, 'raise')) {
      const raise = pickLegal(legalActions, 'raise')!;
      const amount = Math.max(raise.min ?? 0, Math.min(raise.max ?? stack, Math.round(state.currentBet * 2.8)));
      return { type: 'raise', amount, reason: `Light 3-bet ${combo}`, confidence: 0.35 };
    }
    if (canCheck) return { type: 'check', reason: 'Check', confidence: 0.5 };
    if (pickLegal(legalActions, 'fold')) {
      return { type: 'fold', reason: `Fold ${combo} vs raise (need ${(required * 100).toFixed(0)}%)`, confidence: 0.7 };
    }
  }

  if (canCheck) return { type: 'check', reason: 'Preflop check', confidence: 0.5 };
  if (pickLegal(legalActions, 'fold')) return { type: 'fold', reason: `Fold ${combo}`, confidence: 0.6 };
  return { type: 'check', reason: 'Default', confidence: 0.2 };
}
