import type {
  GameConfig, GameState, SeatState, ActionType,
} from '../types/poker';
import { makeDeck } from './cards';
import { createRng, shuffleInPlace } from './rng';
import { getLegalActions, isActionLegal } from './actions';
import { computeSidePots, totalPot } from './pots';
import { evaluateHand } from '../bots/handStrength';

export { getLegalActions, isActionLegal };

function emptySeat(i: number, stack = 0): SeatState {
  return {
    seatIndex: i,
    playerId: null,
    name: `Seat ${i + 1}`,
    isBot: false,
    stack,
    bet: 0,
    totalBet: 0,
    holeCards: null,
    folded: false,
    allIn: false,
    sittingOut: true,
    hasActed: false,
    lastAction: null,
  };
}

export function createGame(config: GameConfig): GameState {
  const seats: SeatState[] = [];
  for (let i = 0; i < config.maxSeats; i++) seats.push(emptySeat(i));
  return {
    handNo: 0,
    street: 'complete',
    deck: [],
    community: [],
    seats,
    pot: 0,
    sidePots: [],
    button: 0,
    sbSeat: 0,
    bbSeat: 0,
    currentSeat: null,
    currentBet: 0,
    minRaise: Math.max(1, config.bigBlind || 1),
    lastAggressor: null,
    winners: null,
    config,
    history: [],
    started: false,
  };
}

export function sitPlayer(
  state: GameState,
  seatIndex: number,
  opts: {
    playerId: string;
    name: string;
    stack: number;
    isBot?: boolean;
    botPersona?: string;
  },
): GameState {
  const seats = state.seats.map((s) => ({ ...s }));
  seats[seatIndex] = {
    ...seats[seatIndex],
    playerId: opts.playerId,
    name: opts.name,
    stack: opts.stack,
    isBot: !!opts.isBot,
    botPersona: opts.botPersona,
    sittingOut: false,
    folded: false,
    allIn: false,
    bet: 0,
    totalBet: 0,
    holeCards: null,
    hasActed: false,
    lastAction: null,
  };
  return { ...state, seats };
}

function livingSeats(state: GameState): SeatState[] {
  return state.seats.filter((s) => !s.sittingOut && s.stack > 0);
}

function nextOccupied(state: GameState, from: number, pred?: (s: SeatState) => boolean): number | null {
  const n = state.seats.length;
  for (let i = 1; i <= n; i++) {
    const idx = (from + i) % n;
    const s = state.seats[idx];
    if (s.sittingOut) continue;
    if (pred && !pred(s)) continue;
    return idx;
  }
  return null;
}

function postBlind(state: GameState, seat: number, amount: number): void {
  const s = state.seats[seat];
  const pay = Math.min(s.stack, amount);
  s.stack -= pay;
  s.bet += pay;
  s.totalBet += pay;
  if (s.stack === 0) s.allIn = true;
}

export function startHand(state: GameState, seed?: number): GameState {
  const next: GameState = {
    ...state,
    seats: state.seats.map((s) => ({
      ...s,
      bet: 0,
      totalBet: 0,
      holeCards: null,
      folded: s.sittingOut || s.stack <= 0,
      allIn: false,
      hasActed: false,
      lastAction: null,
      stack: s.stack,
    })),
    community: [],
    pot: 0,
    sidePots: [],
    winners: null,
    history: [],
    street: 'preflop',
    currentBet: 0,
    minRaise: Math.max(1, state.config.bigBlind || 1),
    lastAggressor: null,
    handNo: state.handNo + 1,
    started: true,
  };

  const eligible = livingSeats(next);
  if (eligible.length < 2) {
    return { ...next, street: 'complete', currentSeat: null, started: false };
  }

  // Advance button
  const btn = nextOccupied(next, next.button, (s) => !s.sittingOut && s.stack > 0) ?? next.button;
  next.button = btn;

  const rng = createRng(seed ?? (state.config.seed ?? Date.now()) + next.handNo * 997);
  const deck = makeDeck();
  shuffleInPlace(deck, rng);
  next.deck = deck;

  // Blinds — HU special: button posts SB
  const isHu = eligible.length === 2;
  let sb: number;
  let bb: number;
  if (isHu) {
    sb = next.button;
    bb = nextOccupied(next, sb, (s) => !s.sittingOut && s.stack > 0)!;
  } else {
    sb = nextOccupied(next, next.button, (s) => !s.sittingOut && s.stack > 0)!;
    bb = nextOccupied(next, sb, (s) => !s.sittingOut && s.stack > 0)!;
  }
  next.sbSeat = sb;
  next.bbSeat = bb;

  const sbAmt = next.config.smallBlind;
  const bbAmt = next.config.bigBlind;
  if (sbAmt > 0) {
    postBlind(next, sb, sbAmt);
    next.seats[sb].lastAction = { type: 'bet', amount: sbAmt };
    next.history.push({ type: 'bet', amount: sbAmt, seat: sb, street: 'preflop' });
  }
  if (bbAmt > 0) {
    postBlind(next, bb, bbAmt);
    next.seats[bb].lastAction = { type: 'bet', amount: bbAmt };
    next.history.push({ type: 'bet', amount: bbAmt, seat: bb, street: 'preflop' });
  }
  next.currentBet = Math.max(next.seats[sb].bet, next.seats[bb].bet);
  next.minRaise = Math.max(1, bbAmt || 1);
  next.pot = totalPot(next.seats);

  // Deal hole cards
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < next.seats.length; i++) {
      const seatIdx = (next.button + 1 + i) % next.seats.length;
      const s = next.seats[seatIdx];
      if (s.sittingOut || s.folded) continue;
      const card = next.deck.pop()!;
      s.holeCards = s.holeCards ? [...s.holeCards, card] : [card];
    }
  }

  // First to act preflop: left of BB (UTG), or SB in HU (button)
  if (isHu) {
    next.currentSeat = sb;
  } else {
    next.currentSeat = nextOccupied(next, bb, (s) => !s.folded && !s.allIn && !s.sittingOut);
  }

  // Reset hasActed for betting round (blinds haven't "acted" voluntarily)
  for (const s of next.seats) s.hasActed = false;

  return next;
}

function commitChips(state: GameState, seatIdx: number, add: number): void {
  const s = state.seats[seatIdx];
  const pay = Math.min(s.stack, add);
  s.stack -= pay;
  s.bet += pay;
  s.totalBet += pay;
  if (s.stack === 0) s.allIn = true;
}

function bettingRoundComplete(state: GameState): boolean {
  const active = state.seats.filter((s) => !s.sittingOut && !s.folded && !s.allIn);
  if (active.length === 0) return true;
  // Everyone who can act has acted and matched currentBet
  return active.every((s) => s.hasActed && s.bet === state.currentBet);
}

function playersLeftToAct(state: GameState): SeatState[] {
  return state.seats.filter((s) => !s.sittingOut && !s.folded && !s.allIn);
}

function advanceStreet(state: GameState): GameState {
  const next: GameState = {
    ...state,
    seats: state.seats.map((s) => ({ ...s, bet: 0, hasActed: false, lastAction: null })),
    currentBet: 0,
    minRaise: Math.max(1, state.config.bigBlind || 1),
    lastAggressor: null,
  };
  next.pot = totalPot(next.seats);
  next.sidePots = computeSidePots(next.seats);

  const contenders = next.seats.filter((s) => !s.folded && !s.sittingOut);
  if (contenders.length <= 1) {
    return finishFoldWin(next);
  }

  // Deal community
  if (next.street === 'preflop') {
    next.street = 'flop';
    next.deck.pop(); // burn
    next.community = [next.deck.pop()!, next.deck.pop()!, next.deck.pop()!];
  } else if (next.street === 'flop') {
    next.street = 'turn';
    next.deck.pop();
    next.community = [...next.community, next.deck.pop()!];
  } else if (next.street === 'turn') {
    next.street = 'river';
    next.deck.pop();
    next.community = [...next.community, next.deck.pop()!];
  } else if (next.street === 'river') {
    return showdown(next);
  }

  // If only one player can act (others all-in), run out
  if (playersLeftToAct(next).length <= 1 && contenders.filter((s) => !s.folded).length > 1) {
    // Skip betting — run remaining streets
    return runout(next);
  }

  // First to act: left of button
  next.currentSeat = nextOccupied(next, next.button, (s) => !s.folded && !s.allIn && !s.sittingOut);
  if (next.currentSeat == null) return showdown(next);
  return next;
}

function runout(state: GameState): GameState {
  let next = { ...state, seats: state.seats.map((s) => ({ ...s })), community: [...state.community], deck: [...state.deck] };
  while (next.community.length < 5) {
    if (next.community.length === 0) {
      next.deck.pop();
      next.community = [next.deck.pop()!, next.deck.pop()!, next.deck.pop()!];
      next.street = 'flop';
    } else if (next.community.length === 3) {
      next.deck.pop();
      next.community = [...next.community, next.deck.pop()!];
      next.street = 'turn';
    } else {
      next.deck.pop();
      next.community = [...next.community, next.deck.pop()!];
      next.street = 'river';
    }
  }
  return showdown(next);
}

function finishFoldWin(state: GameState): GameState {
  const winner = state.seats.find((s) => !s.folded && !s.sittingOut);
  const pot = totalPot(state.seats);
  const seats = state.seats.map((s) => ({ ...s, bet: 0 }));
  if (winner) {
    seats[winner.seatIndex] = {
      ...seats[winner.seatIndex],
      stack: seats[winner.seatIndex].stack + pot,
      totalBet: 0,
    };
  }
  // Clear totals
  for (const s of seats) s.totalBet = 0;
  return {
    ...state,
    seats,
    pot: 0,
    sidePots: [],
    street: 'complete',
    currentSeat: null,
    winners: winner ? [{ seat: winner.seatIndex, amount: pot }] : [],
  };
}

function showdown(state: GameState): GameState {
  const seats = state.seats.map((s) => ({ ...s, bet: 0 }));
  const pots = computeSidePots(seats);
  const winners: { seat: number; amount: number; handName?: string }[] = [];

  const values = new Map<number, ReturnType<typeof evaluateHand>>();
  for (const s of seats) {
    if (s.folded || s.sittingOut || !s.holeCards) continue;
    values.set(s.seatIndex, evaluateHand([...s.holeCards, ...state.community]));
  }

  for (const pot of pots) {
    const eligible = pot.eligibleSeats.filter((i) => values.has(i));
    if (eligible.length === 0) continue;
    let bestScore = -1;
    let bestSeats: number[] = [];
    for (const i of eligible) {
      const v = values.get(i)!;
      if (v.score > bestScore) {
        bestScore = v.score;
        bestSeats = [i];
      } else if (v.score === bestScore) {
        bestSeats.push(i);
      }
    }
    const share = Math.floor(pot.amount / bestSeats.length);
    let remainder = pot.amount - share * bestSeats.length;
    for (const i of bestSeats) {
      const add = share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      seats[i] = { ...seats[i], stack: seats[i].stack + add };
      winners.push({
        seat: i,
        amount: add,
        handName: values.get(i)?.name,
      });
    }
  }

  for (const s of seats) s.totalBet = 0;

  return {
    ...state,
    seats,
    pot: 0,
    sidePots: pots,
    street: 'complete',
    currentSeat: null,
    winners,
  };
}

export function applyAction(
  state: GameState,
  type: ActionType,
  amount?: number,
): GameState {
  if (state.currentSeat == null) throw new Error('No current seat');
  if (!isActionLegal(state, type, amount)) {
    throw new Error(`Illegal action: ${type} ${amount ?? ''}`);
  }

  const next: GameState = {
    ...state,
    seats: state.seats.map((s) => ({ ...s })),
    history: [...state.history],
  };
  const seatIdx = next.currentSeat!;
  const seat = next.seats[seatIdx];
  const toCall = Math.max(0, next.currentBet - seat.bet);

  const record = (t: ActionType, amt?: number) => {
    next.history.push({ type: t, amount: amt, seat: seatIdx, street: next.street });
    seat.lastAction = { type: t, amount: amt };
  };

  if (type === 'fold') {
    seat.folded = true;
    seat.hasActed = true;
    record('fold');
  } else if (type === 'check') {
    seat.hasActed = true;
    record('check');
  } else if (type === 'call') {
    commitChips(next, seatIdx, toCall);
    seat.hasActed = true;
    record('call', toCall);
  } else if (type === 'bet') {
    const add = amount!;
    commitChips(next, seatIdx, add);
    next.minRaise = add; // bet size becomes min raise unit
    next.currentBet = seat.bet;
    next.lastAggressor = seatIdx;
    // Others need to act again
    for (const s of next.seats) {
      if (s.seatIndex !== seatIdx && !s.folded && !s.allIn) s.hasActed = false;
    }
    seat.hasActed = true;
    record('bet', seat.bet);
  } else if (type === 'raise') {
    const add = amount!;
    const prevBet = next.currentBet;
    commitChips(next, seatIdx, add);
    const raiseSize = seat.bet - prevBet;
    if (raiseSize > next.minRaise) next.minRaise = raiseSize;
    next.currentBet = seat.bet;
    next.lastAggressor = seatIdx;
    for (const s of next.seats) {
      if (s.seatIndex !== seatIdx && !s.folded && !s.allIn) s.hasActed = false;
    }
    seat.hasActed = true;
    record('raise', seat.bet);
  } else if (type === 'all-in') {
    const add = seat.stack;
    const prevBet = next.currentBet;
    commitChips(next, seatIdx, add);
    if (seat.bet > next.currentBet) {
      const raiseSize = seat.bet - prevBet;
      if (raiseSize >= next.minRaise) next.minRaise = raiseSize;
      next.currentBet = seat.bet;
      next.lastAggressor = seatIdx;
      for (const s of next.seats) {
        if (s.seatIndex !== seatIdx && !s.folded && !s.allIn) s.hasActed = false;
      }
    }
    seat.hasActed = true;
    record('all-in', add);
  }

  next.pot = totalPot(next.seats);

  // Only one player left
  const alive = next.seats.filter((s) => !s.folded && !s.sittingOut);
  if (alive.length === 1) {
    return finishFoldWin(next);
  }

  if (bettingRoundComplete(next)) {
    return advanceStreet(next);
  }

  // Next seat
  const nxt = nextOccupied(next, seatIdx, (s) => !s.folded && !s.allIn && !s.sittingOut);
  next.currentSeat = nxt;
  if (nxt == null) return advanceStreet(next);
  return next;
}

export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
