import type { Card } from '../types/poker';
import { makeDeck } from '../engine/cards';
import { createRng, shuffleInPlace } from '../engine/rng';

export type BJPhase = 'betting' | 'player' | 'dealer' | 'settle';

export interface BJHand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  stood: boolean;
  busted: boolean;
}

export interface BJState {
  phase: BJPhase;
  deck: Card[];
  player: BJHand;
  dealer: Card[];
  bank: number;
  message: string;
  lastResult?: 'win' | 'lose' | 'push' | 'blackjack';
  seed: number;
}

export function handTotal(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.rank === 14) {
      aces++;
      total += 11;
    } else if (c.rank >= 10) {
      total += 10;
    } else {
      total += c.rank;
    }
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces--;
  }
  const soft = aces > 0 && total <= 21;
  return { total, soft };
}

export function isBlackjack(cards: Card[]): boolean {
  return cards.length === 2 && handTotal(cards).total === 21;
}

export function createBJ(bank = 10000, seed = Date.now()): BJState {
  return {
    phase: 'betting',
    deck: [],
    player: { cards: [], bet: 0, doubled: false, stood: false, busted: false },
    dealer: [],
    bank,
    message: 'Place a practice-chip bet.',
    seed,
  };
}

function draw(state: BJState): Card {
  if (state.deck.length < 15) {
    const deck = makeDeck().concat(makeDeck(), makeDeck(), makeDeck());
    const rng = createRng(state.seed + state.deck.length + state.bank);
    shuffleInPlace(deck, rng);
    state.deck = deck;
  }
  return state.deck.pop()!;
}

export function placeBet(state: BJState, bet: number): BJState {
  if (state.phase !== 'betting') return state;
  const amount = Math.max(10, Math.min(state.bank, Math.floor(bet)));
  if (!Number.isFinite(amount) || amount > state.bank || amount <= 0) {
    return { ...state, message: 'Invalid bet.' };
  }
  const next: BJState = {
    ...state,
    bank: state.bank - amount,
    player: { cards: [], bet: amount, doubled: false, stood: false, busted: false },
    dealer: [],
    lastResult: undefined,
    seed: state.seed + 1,
    deck: [...state.deck],
  };
  next.player.cards = [draw(next), draw(next)];
  next.dealer = [draw(next), draw(next)];

  if (isBlackjack(next.player.cards)) {
    return settlePlayerBJ(next);
  }
  if (isBlackjack(next.dealer)) {
    return {
      ...next,
      phase: 'settle',
      lastResult: 'lose',
      message: 'Dealer blackjack.',
    };
  }
  return {
    ...next,
    phase: 'player',
    message: 'Your turn — Hit, Stand, or Double.',
  };
}

function settlePlayerBJ(state: BJState): BJState {
  if (isBlackjack(state.dealer)) {
    return {
      ...state,
      phase: 'settle',
      bank: state.bank + state.player.bet,
      lastResult: 'push',
      message: 'Both blackjack — push.',
    };
  }
  const payout = Math.floor(state.player.bet * 2.5);
  return {
    ...state,
    phase: 'settle',
    bank: state.bank + payout,
    lastResult: 'blackjack',
    message: `Blackjack! +${payout - state.player.bet} practice chips (3:2).`,
  };
}

export function hit(state: BJState): BJState {
  if (state.phase !== 'player') return state;
  const next: BJState = {
    ...state,
    deck: [...state.deck],
    player: { ...state.player, cards: [...state.player.cards] },
    dealer: [...state.dealer],
  };
  next.player.cards.push(draw(next));
  const { total } = handTotal(next.player.cards);
  if (total > 21) {
    next.player.busted = true;
    return {
      ...next,
      phase: 'settle',
      lastResult: 'lose',
      message: `Bust (${total}). Dealer wins.`,
    };
  }
  if (next.player.doubled) {
    return stand({ ...next, phase: 'player' });
  }
  return { ...next, message: `Total ${total}. Hit or Stand?` };
}

export function stand(state: BJState): BJState {
  if (state.phase !== 'player') return state;
  const next: BJState = {
    ...state,
    phase: 'dealer',
    deck: [...state.deck],
    player: { ...state.player, stood: true, cards: [...state.player.cards] },
    dealer: [...state.dealer],
    message: 'Dealer plays…',
  };
  // Dealer hits soft/hard totals under 17; stands on all 17s (S17)
  while (handTotal(next.dealer).total < 17) {
    next.dealer = [...next.dealer, draw(next)];
  }
  return settle(next);
}

export function doubleDown(state: BJState): BJState {
  if (state.phase !== 'player') return state;
  if (state.player.cards.length !== 2) return { ...state, message: 'Double only on first two cards.' };
  if (state.bank < state.player.bet) return { ...state, message: 'Not enough chips to double.' };
  const next: BJState = {
    ...state,
    bank: state.bank - state.player.bet,
    player: {
      ...state.player,
      bet: state.player.bet * 2,
      doubled: true,
      cards: [...state.player.cards],
    },
    deck: [...state.deck],
    dealer: [...state.dealer],
  };
  return hit(next);
}

function settle(state: BJState): BJState {
  const p = handTotal(state.player.cards).total;
  const d = handTotal(state.dealer).total;
  if (d > 21) {
    return {
      ...state,
      phase: 'settle',
      bank: state.bank + state.player.bet * 2,
      lastResult: 'win',
      message: `Dealer busts (${d}). You win +${state.player.bet}.`,
    };
  }
  if (p > d) {
    return {
      ...state,
      phase: 'settle',
      bank: state.bank + state.player.bet * 2,
      lastResult: 'win',
      message: `You ${p} vs dealer ${d}. Win +${state.player.bet}.`,
    };
  }
  if (p < d) {
    return {
      ...state,
      phase: 'settle',
      lastResult: 'lose',
      message: `You ${p} vs dealer ${d}. Dealer wins.`,
    };
  }
  return {
    ...state,
    phase: 'settle',
    bank: state.bank + state.player.bet,
    lastResult: 'push',
    message: `Push (${p}). Bet returned.`,
  };
}

export function nextRound(state: BJState): BJState {
  return {
    ...state,
    phase: 'betting',
    player: { cards: [], bet: 0, doubled: false, stood: false, busted: false },
    dealer: [],
    message: 'Place a practice-chip bet.',
    lastResult: undefined,
  };
}
