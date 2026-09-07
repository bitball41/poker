import { describe, expect, it } from 'vitest';
import { createGame, sitPlayer, startHand } from '../engine/game';
import { mergeViewerCards, sanitizePublicState } from './state';

function dealtGame() {
  let game = createGame({ maxSeats: 3, smallBlind: 0, bigBlind: 0, seed: 42 });
  for (let i = 0; i < 3; i++) {
    game = sitPlayer(game, i, { playerId: `p${i}`, name: `P${i}`, stack: 1000 });
  }
  return startHand(game, 99);
}

describe('multiplayer state privacy', () => {
  it('never puts the future deck into public state', () => {
    const game = dealtGame();
    expect(game.deck.length).toBeGreaterThan(0);
    const publicState = sanitizePublicState(game);
    expect(publicState.deck).toEqual([]);
  });

  it('removes every private hole-card pair from an in-progress public state', () => {
    const game = dealtGame();
    expect(game.seats.every((s) => s.holeCards?.length === 2)).toBe(true);
    const publicState = sanitizePublicState(game);
    expect(publicState.seats.every((s) => s.holeCards == null)).toBe(true);
  });

  it('merges only the viewer cards back into their local rendering state', () => {
    const game = dealtGame();
    const publicState = sanitizePublicState(game);
    const own = game.seats[1].holeCards!;
    const viewer = mergeViewerCards(publicState, 'p1', own);
    expect(viewer.seats[1].holeCards).toEqual(own);
    expect(viewer.seats[0].holeCards).toBeNull();
    expect(viewer.seats[2].holeCards).toBeNull();
  });
});
