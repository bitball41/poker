import type { Card } from '../types/poker';
import { makeDeck, cardEquals, removeCards } from '../engine/cards';
import { createRng, shuffleInPlace } from '../engine/rng';
import { evaluateHand, compareHands } from './handStrength';

export interface EquityResult {
  win: number;
  tie: number;
  lose: number;
  equity: number; // win + tie/2
  sims: number;
}

/**
 * Monte Carlo equity for hero hole cards vs N random opponents given board.
 * sims: 200–800 recommended for UI.
 */
export function estimateEquity(
  hero: Card[],
  board: Card[],
  numOpponents: number,
  sims = 400,
  seed?: number,
): EquityResult {
  if (hero.length !== 2) throw new Error('Hero needs 2 cards');
  const known = [...hero, ...board];
  const baseDeck = removeCards(makeDeck(), known);
  const cardsNeeded = 5 - board.length + numOpponents * 2;
  if (baseDeck.length < cardsNeeded) {
    return { win: 0, tie: 0, lose: 1, equity: 0, sims: 0 };
  }

  const rng = createRng(seed ?? Date.now() ^ (sims * 997));
  let wins = 0;
  let ties = 0;
  let losses = 0;

  for (let i = 0; i < sims; i++) {
    const deck = [...baseDeck];
    shuffleInPlace(deck, rng);
    let idx = 0;
    const fullBoard = [...board];
    while (fullBoard.length < 5) fullBoard.push(deck[idx++]);

    const heroValue = evaluateHand([...hero, ...fullBoard]);
    let heroWins = true;
    let tied = false;

    for (let o = 0; o < numOpponents; o++) {
      const opp = [deck[idx++], deck[idx++]];
      const oppValue = evaluateHand([...opp, ...fullBoard]);
      const cmp = compareHands(heroValue, oppValue);
      if (cmp < 0) {
        heroWins = false;
        tied = false;
        break;
      }
      if (cmp === 0) {
        tied = true;
      }
    }

    if (!heroWins) losses++;
    else if (tied) ties++;
    else wins++;
  }

  const total = wins + ties + losses;
  const equity = total === 0 ? 0 : (wins + ties * 0.5) / total;
  return {
    win: wins / total,
    tie: ties / total,
    lose: losses / total,
    equity,
    sims: total,
  };
}

/** Fast rough equity using fewer sims for bot decisions mid-hand */
export function quickEquity(
  hero: Card[],
  board: Card[],
  numOpponents: number,
  seed?: number,
): number {
  const sims = board.length === 0 ? 200 : board.length >= 4 ? 300 : 250;
  return estimateEquity(hero, board, Math.max(1, numOpponents), sims, seed).equity;
}

export function cardsUsed(...groups: Card[][]): Card[] {
  const out: Card[] = [];
  for (const g of groups) {
    for (const c of g) {
      if (!out.some((x) => cardEquals(x, c))) out.push(c);
    }
  }
  return out;
}
