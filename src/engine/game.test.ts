import { describe, expect, it } from 'vitest';
import { createGame, getLegalActions, sitPlayer, startHand, applyAction } from './game';

function seated(stacks: number[], smallBlind = 0, bigBlind = 0) {
  let g = createGame({ maxSeats: stacks.length, smallBlind, bigBlind, seed: 12345 });
  stacks.forEach((stack, i) => {
    g = sitPlayer(g, i, { playerId: `p${i}`, name: `P${i}`, stack });
  });
  return startHand(g, 7);
}

describe('Holdem engine regressions', () => {
  it('uses a non-zero minimum opening bet when blinds are disabled', () => {
    const g = seated([1000, 1000, 1000]);
    expect(g.currentBet).toBe(0);
    const bet = getLegalActions(g).find((a) => a.type === 'bet');
    expect(bet?.min).toBe(1);
    expect(() => applyAction(g, 'bet', 0)).toThrow(/Illegal action/);
  });

  it('starts blindless action left of the dealer instead of a phantom big blind', () => {
    const g = seated([1000, 1000, 1000]);
    expect(g.button).toBe(0);
    expect(g.currentSeat).toBe(1);
  });

  it('advances immediately after everyone checks a no-bet street', () => {
    let g = seated([1000, 1000, 1000]);
    expect(g.street).toBe('preflop');
    g = applyAction(g, 'check'); // P1
    g = applyAction(g, 'check'); // P2
    g = applyAction(g, 'check'); // P0
    expect(g.street).toBe('flop');
    expect(g.community).toHaveLength(3);
    expect(g.currentBet).toBe(0);
  });

  it('never offers check while chips are owed and advances after all calls', () => {
    let g = seated([1000, 1000, 1000]);
    expect(g.currentSeat).toBe(1);

    g = applyAction(g, 'bet', 100); // P1 opens.
    expect(g.currentSeat).toBe(2);
    expect(getLegalActions(g).some((a) => a.type === 'check')).toBe(false);
    expect(getLegalActions(g).find((a) => a.type === 'call')?.callAmount).toBe(100);

    g = applyAction(g, 'call'); // P2 matches.
    expect(g.currentSeat).toBe(0);
    expect(getLegalActions(g).some((a) => a.type === 'check')).toBe(false);
    expect(getLegalActions(g).find((a) => a.type === 'call')?.callAmount).toBe(100);

    g = applyAction(g, 'call'); // P0 matches; round is over.
    expect(g.street).toBe('flop');
    expect(g.community).toHaveLength(3);
    expect(g.currentBet).toBe(0);
  });

  it('keeps the full big-blind bring-in when the BB is all-in short', () => {
    // First hand has button 0, SB 1, BB 2.
    const g = seated([1000, 1000, 30], 50, 100);
    expect(g.bbSeat).toBe(2);
    expect(g.seats[2].allIn).toBe(true);
    expect(g.seats[2].bet).toBe(30);
    expect(g.currentBet).toBe(100);
    const posted = g.history.find((a) => a.seat === 2 && a.type === 'bet');
    expect(posted?.amount).toBe(30);
  });

  it('does not reopen raising to a player after a short all-in raise', () => {
    let g = seated([1000, 1000, 125]);
    // Blindless: P1 acts first.
    g = applyAction(g, 'bet', 100);
    expect(g.currentSeat).toBe(2);
    g = applyAction(g, 'all-in'); // P2 raises only 25, below the 100 min raise.
    expect(g.currentSeat).toBe(0);
    expect(getLegalActions(g).some((a) => a.type === 'raise')).toBe(true); // P0 had not acted yet.

    g = applyAction(g, 'call'); // P0 calls 125.
    expect(g.currentSeat).toBe(1);
    const legal = getLegalActions(g);
    expect(legal.some((a) => a.type === 'call')).toBe(true);
    expect(legal.some((a) => a.type === 'raise')).toBe(false);
    expect(legal.some((a) => a.type === 'all-in')).toBe(false);
  });

  it('sanitizes invalid table configuration at the engine boundary', () => {
    const g = createGame({
      maxSeats: Number.NaN,
      smallBlind: 500,
      bigBlind: -10,
      seed: Number.NaN,
    });
    expect(g.config.maxSeats).toBe(6);
    expect(g.config.bigBlind).toBe(0);
    expect(g.config.smallBlind).toBe(0);
    expect(g.config.seed).toBeUndefined();
  });
});
