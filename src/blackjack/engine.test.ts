import { describe, expect, it } from 'vitest';
import { createBJ, isBlackjack, placeBet, type BJState } from './engine';
import { makeDeck } from '../engine/cards';
import type { Card } from '../types/poker';

function stacked(endFirst: Card[]): Card[] {
  const rest = makeDeck().filter(
    (c) => !endFirst.some((x) => x.rank === c.rank && x.suit === c.suit),
  );
  return [...rest, ...endFirst];
}

describe('blackjack engine', () => {
  it('rejects NaN bets instead of corrupting the bank', () => {
    const s = createBJ(500, 1);
    const next = placeBet(s, Number.NaN);
    expect(next.phase).toBe('betting');
    expect(next.bank).toBe(500);
    expect(next.message).toMatch(/Invalid/);
  });

  it('peeks dealer blackjack so the player cannot hit into a natural', () => {
    const dealerUp: Card = { rank: 14, suit: 's' };
    const dealerHole: Card = { rank: 13, suit: 's' };
    const player1: Card = { rank: 9, suit: 'h' };
    const player2: Card = { rank: 7, suit: 'd' };
    // draw() pops from the end: player, player, dealer, dealer
    const s: BJState = {
      ...createBJ(200, 99),
      deck: stacked([dealerHole, dealerUp, player2, player1]),
    };
    const next = placeBet(s, 50);
    expect(isBlackjack(next.dealer)).toBe(true);
    expect(isBlackjack(next.player.cards)).toBe(false);
    expect(next.phase).toBe('settle');
    expect(next.lastResult).toBe('lose');
    expect(next.bank).toBe(150);
  });
});
