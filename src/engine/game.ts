import type { GameConfig, GameState, SeatState, ActionType } from '../types/poker';
import { makeDeck } from './cards';
import { createRng, createSecureRng, shuffleInPlace } from './rng';
import { getLegalActions, isActionLegal } from './actions';
import { computeSidePots, totalPot } from './pots';
import { evaluateHand } from '../bots/handStrength';

export { getLegalActions, isActionLegal };

function safeInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export function normalizeGameConfig(config: GameConfig): GameConfig {
  const maxSeats = safeInt(config.maxSeats, 6, 2, 9);
  const bigBlind = safeInt(config.bigBlind, 0, 0, 1_000_000_000);
  const requestedSmall = safeInt(config.smallBlind, 0, 0, 1_000_000_000);
  const smallBlind = bigBlind === 0 ? 0 : Math.min(requestedSmall, bigBlind);
  const seed = config.seed != null && Number.isFinite(config.seed)
    ? Math.floor(config.seed)
    : undefined;
  return { smallBlind, bigBlind, maxSeats, ...(seed == null ? {} : { seed }) };
}

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
    raiseLocked: false,
    lastAction: null,
  };
}

export function createGame(config: GameConfig): GameState {
  const normalized = normalizeGameConfig(config);
  const seats: SeatState[] = [];
  for (let i = 0; i < normalized.maxSeats; i++) seats.push(emptySeat(i));
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
    minRaise: Math.max(1, normalized.bigBlind || 1),
    lastAggressor: null,
    winners: null,
    config: normalized,
    history: [],
    started: false,
  };
}

export function sitPlayer(
  state: GameState,
  seatIndex: number,
  opts: { playerId: string; name: string; stack: number; isBot?: boolean; botPersona?: string },
): GameState {
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex >= state.seats.length) {
    throw new Error(`Invalid seat index: ${seatIndex}`);
  }
  const stack = safeInt(opts.stack, 0, 0, Number.MAX_SAFE_INTEGER);
  const seats = state.seats.map((s) => ({ ...s }));
  seats[seatIndex] = {
    ...seats[seatIndex],
    playerId: opts.playerId,
    name: opts.name.trim().slice(0, 20) || `Seat ${seatIndex + 1}`,
    stack,
    isBot: !!opts.isBot,
    botPersona: opts.botPersona,
    sittingOut: false,
    folded: false,
    allIn: false,
    bet: 0,
    totalBet: 0,
    holeCards: null,
    hasActed: false,
    raiseLocked: false,
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

function postBlind(state: GameState, seat: number, amount: number): number {
  const s = state.seats[seat];
  const pay = Math.min(s.stack, Math.max(0, amount));
  s.stack -= pay;
  s.bet += pay;
  s.totalBet += pay;
  if (s.stack === 0) s.allIn = true;
  return pay;
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
      raiseLocked: false,
      lastAction: null,
    })),
    deck: [],
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

  const n = next.seats.length;
  const buttonFrom = state.handNo === 0 ? (state.button - 1 + n) % n : state.button;
  next.button = nextOccupied(next, buttonFrom, (s) => s.stack > 0) ?? state.button;

  const rng = seed != null
    ? createRng(seed)
    : state.config.seed != null
      ? createRng(state.config.seed + next.handNo * 997)
      : createSecureRng();
  const deck = makeDeck();
  shuffleInPlace(deck, rng);
  next.deck = deck;

  const isHu = eligible.length === 2;
  let sb: number;
  let bb: number;
  if (isHu) {
    sb = next.button;
    bb = nextOccupied(next, sb, (s) => s.stack > 0)!;
  } else {
    sb = nextOccupied(next, next.button, (s) => s.stack > 0)!;
    bb = nextOccupied(next, sb, (s) => s.stack > 0)!;
  }
  next.sbSeat = sb;
  next.bbSeat = bb;

  const sbAmt = next.config.smallBlind;
  const bbAmt = next.config.bigBlind;
  if (sbAmt > 0) {
    const posted = postBlind(next, sb, sbAmt);
    next.seats[sb].lastAction = { type: 'bet', amount: posted };
    next.history.push({ type: 'bet', amount: posted, seat: sb, street: 'preflop' });
  }
  if (bbAmt > 0) {
    const posted = postBlind(next, bb, bbAmt);
    next.seats[bb].lastAction = { type: 'bet', amount: posted };
    next.history.push({ type: 'bet', amount: posted, seat: bb, street: 'preflop' });
  }

  next.currentBet = bbAmt > 0 ? bbAmt : 0;
  next.minRaise = Math.max(1, bbAmt || 1);
  next.pot = totalPot(next.seats);

  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < next.seats.length; i++) {
      const seatIdx = (next.button + 1 + i) % next.seats.length;
      const s = next.seats[seatIdx];
      if (s.sittingOut || s.folded) continue;
      const card = next.deck.pop();
      if (!card) throw new Error('Deck exhausted while dealing hole cards');
      s.holeCards = s.holeCards ? [...s.holeCards, card] : [card];
    }
  }

  if (bbAmt === 0) {
    next.currentSeat = nextOccupied(next, next.button, (s) => !s.folded && !s.allIn && s.stack > 0);
  } else if (isHu) {
    next.currentSeat = next.seats[sb].allIn
      ? nextOccupied(next, sb, (s) => !s.folded && !s.allIn)
      : sb;
  } else {
    next.currentSeat = nextOccupied(next, bb, (s) => !s.folded && !s.allIn);
  }

  for (const s of next.seats) {
    s.hasActed = false;
    s.raiseLocked = false;
  }

  if (next.currentSeat == null) return runout(next);
  return next;
}

function commitChips(state: GameState, seatIdx: number, add: number): number {
  const s = state.seats[seatIdx];
  const pay = Math.min(s.stack, Math.max(0, add));
  s.stack -= pay;
  s.bet += pay;
  s.totalBet += pay;
  if (s.stack === 0) s.allIn = true;
  return pay;
}

function bettingRoundComplete(state: GameState): boolean {
  const active = state.seats.filter((s) => !s.sittingOut && !s.folded && !s.allIn);
  if (active.length === 0) return true;
  return active.every((s) => s.hasActed && s.bet === state.currentBet);
}

function playersLeftToAct(state: GameState): SeatState[] {
  return state.seats.filter((s) => !s.sittingOut && !s.folded && !s.allIn);
}

function takeCard(state: GameState): import('../types/poker').Card {
  const card = state.deck.pop();
  if (!card) throw new Error('Deck exhausted');
  return card;
}

function advanceStreet(state: GameState): GameState {
  const next: GameState = {
    ...state,
    seats: state.seats.map((s) => ({
      ...s,
      bet: 0,
      hasActed: false,
      raiseLocked: false,
      lastAction: null,
    })),
    currentBet: 0,
    minRaise: Math.max(1, state.config.bigBlind || 1),
    lastAggressor: null,
  };
  next.pot = totalPot(next.seats);
  next.sidePots = computeSidePots(next.seats);

  const contenders = next.seats.filter((s) => !s.folded && !s.sittingOut);
  if (contenders.length <= 1) return finishFoldWin(next);

  if (next.street === 'preflop') {
    next.street = 'flop';
    takeCard(next);
    next.community = [takeCard(next), takeCard(next), takeCard(next)];
  } else if (next.street === 'flop') {
    next.street = 'turn';
    takeCard(next);
    next.community = [...next.community, takeCard(next)];
  } else if (next.street === 'turn') {
    next.street = 'river';
    takeCard(next);
    next.community = [...next.community, takeCard(next)];
  } else if (next.street === 'river') {
    return showdown(next);
  }

  if (playersLeftToAct(next).length <= 1 && contenders.length > 1) return runout(next);

  next.currentSeat = nextOccupied(next, next.button, (s) => !s.folded && !s.allIn);
  if (next.currentSeat == null) return showdown(next);
  return next;
}

function runout(state: GameState): GameState {
  let next: GameState = {
    ...state,
    seats: state.seats.map((s) => ({ ...s })),
    community: [...state.community],
    deck: [...state.deck],
  };
  while (next.community.length < 5) {
    if (next.community.length === 0) {
      takeCard(next);
      next.community = [takeCard(next), takeCard(next), takeCard(next)];
      next.street = 'flop';
    } else if (next.community.length === 3) {
      takeCard(next);
      next.community = [...next.community, takeCard(next)];
      next.street = 'turn';
    } else if (next.community.length === 4) {
      takeCard(next);
      next.community = [...next.community, takeCard(next)];
      next.street = 'river';
    } else {
      break;
    }
  }
  return showdown(next);
}

function finishFoldWin(state: GameState): GameState {
  const winner = state.seats.find((s) => !s.folded && !s.sittingOut);
  const pot = totalPot(state.seats);
  const seats = state.seats.map((s) => ({ ...s, bet: 0, totalBet: 0 }));
  if (winner) seats[winner.seatIndex].stack += pot;
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

function oddChipOrder(button: number, seat: number, seatCount: number): number {
  const distance = (seat - button + seatCount) % seatCount;
  return distance === 0 ? seatCount : distance;
}

function showdown(state: GameState): GameState {
  const seats = state.seats.map((s) => ({ ...s, bet: 0 }));
  const pots = computeSidePots(seats);
  const values = new Map<number, ReturnType<typeof evaluateHand>>();
  const awarded = new Map<number, { amount: number; handName?: string }>();

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
      const score = values.get(i)!.score;
      if (score > bestScore) {
        bestScore = score;
        bestSeats = [i];
      } else if (score === bestScore) {
        bestSeats.push(i);
      }
    }

    bestSeats.sort(
      (a, b) => oddChipOrder(state.button, a, seats.length) - oddChipOrder(state.button, b, seats.length),
    );
    const share = Math.floor(pot.amount / bestSeats.length);
    let remainder = pot.amount - share * bestSeats.length;
    for (const i of bestSeats) {
      const add = share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;
      seats[i].stack += add;
      const old = awarded.get(i);
      awarded.set(i, {
        amount: (old?.amount ?? 0) + add,
        handName: values.get(i)?.name,
      });
    }
  }

  for (const s of seats) s.totalBet = 0;
  const winners = [...awarded.entries()].map(([seat, win]) => ({ seat, ...win }));

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

function resetForFullRaise(state: GameState, actor: number): void {
  for (const s of state.seats) {
    if (s.seatIndex === actor || s.sittingOut || s.folded || s.allIn) continue;
    s.hasActed = false;
    s.raiseLocked = false;
  }
}

export function applyAction(state: GameState, type: ActionType, amount?: number): GameState {
  if (state.currentSeat == null) throw new Error('No current seat');
  if (!isActionLegal(state, type, amount)) {
    throw new Error(`Illegal action: ${type} ${amount ?? ''}`);
  }

  const next: GameState = {
    ...state,
    seats: state.seats.map((s) => ({ ...s })),
    history: [...state.history],
  };
  const seatIdx = next.currentSeat;
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
    const paid = commitChips(next, seatIdx, toCall);
    seat.hasActed = true;
    record('call', paid);
  } else if (type === 'bet') {
    commitChips(next, seatIdx, amount!);
    next.minRaise = seat.bet;
    next.currentBet = seat.bet;
    next.lastAggressor = seatIdx;
    resetForFullRaise(next, seatIdx);
    seat.hasActed = true;
    seat.raiseLocked = false;
    record('bet', seat.bet);
  } else if (type === 'raise') {
    const previousBet = next.currentBet;
    commitChips(next, seatIdx, amount!);
    const raiseSize = seat.bet - previousBet;
    next.minRaise = raiseSize;
    next.currentBet = seat.bet;
    next.lastAggressor = seatIdx;
    resetForFullRaise(next, seatIdx);
    seat.hasActed = true;
    seat.raiseLocked = false;
    record('raise', seat.bet);
  } else if (type === 'all-in') {
    const previousBet = next.currentBet;
    const chips = seat.stack;
    commitChips(next, seatIdx, chips);

    if (seat.bet > previousBet) {
      const raiseSize = seat.bet - previousBet;
      const fullRaise = raiseSize >= next.minRaise;
      next.currentBet = seat.bet;
      next.lastAggressor = seatIdx;

      if (previousBet === 0) {
        if (fullRaise) next.minRaise = raiseSize;
        resetForFullRaise(next, seatIdx);
      } else if (fullRaise) {
        next.minRaise = raiseSize;
        resetForFullRaise(next, seatIdx);
      } else {
        for (const s of next.seats) {
          if (s.seatIndex === seatIdx || s.sittingOut || s.folded || s.allIn) continue;
          if (s.hasActed) s.raiseLocked = true;
        }
      }
    }

    seat.hasActed = true;
    seat.raiseLocked = false;
    record('all-in', seat.bet);
  }

  next.pot = totalPot(next.seats);

  const alive = next.seats.filter((s) => !s.folded && !s.sittingOut);
  if (alive.length === 1) return finishFoldWin(next);
  if (bettingRoundComplete(next)) return advanceStreet(next);

  const nxt = nextOccupied(next, seatIdx, (s) => !s.folded && !s.allIn);
  next.currentSeat = nxt;
  if (nxt == null) return advanceStreet(next);
  return next;
}

export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}
