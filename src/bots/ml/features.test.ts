import { describe, expect, it } from 'vitest';
import { applyAction, createGame, getLegalActions, sitPlayer, startHand } from '../../engine/game';
import { decisionToTrainingTarget, encodeBotFeatures, legalActionMask, ML_FEATURE_COUNT } from './features';

describe('ML feature encoder', () => {
  it('uses a fixed-size feature vector', () => {
    let game = createGame({ smallBlind: 2, bigBlind: 4, maxSeats: 3, seed: 7 });
    game = sitPlayer(game, 0, { playerId: 'a', name: 'A', stack: 400 });
    game = sitPlayer(game, 1, { playerId: 'b', name: 'B', stack: 400 });
    game = sitPlayer(game, 2, { playerId: 'c', name: 'C', stack: 400 });
    game = startHand(game, 11);
    expect(encodeBotFeatures(game, game.currentSeat!)).toHaveLength(ML_FEATURE_COUNT);
  });

  it('does not leak opponent hole cards or deck state', () => {
    let game = createGame({ smallBlind: 2, bigBlind: 4, maxSeats: 3, seed: 9 });
    game = sitPlayer(game, 0, { playerId: 'a', name: 'A', stack: 400 });
    game = sitPlayer(game, 1, { playerId: 'b', name: 'B', stack: 400 });
    game = sitPlayer(game, 2, { playerId: 'c', name: 'C', stack: 400 });
    game = startHand(game, 13);
    const actor = game.currentSeat!;
    const before = Array.from(encodeBotFeatures(game, actor));

    const mutated = {
      ...game,
      deck: [...game.deck].reverse(),
      seats: game.seats.map((seat) => ({ ...seat, holeCards: seat.holeCards ? [...seat.holeCards] : null })),
    };
    const opponent = mutated.seats.find((seat) => seat.seatIndex !== actor && seat.holeCards?.length === 2)!;
    opponent.holeCards = [{ rank: 14, suit: 's' }, { rank: 14, suit: 'h' }];

    expect(Array.from(encodeBotFeatures(mutated, actor))).toEqual(before);
  });

  it('leaves unused seat slots zero on short-handed tables', () => {
    let game = createGame({ smallBlind: 2, bigBlind: 4, maxSeats: 2, seed: 21 });
    game = sitPlayer(game, 0, { playerId: 'a', name: 'A', stack: 400 });
    game = sitPlayer(game, 1, { playerId: 'b', name: 'B', stack: 400 });
    game = startHand(game, 23);
    const features = encodeBotFeatures(game, game.currentSeat!);
    // Seat-ring data starts at 124. On a heads-up table only the first two
    // four-value seat blocks may be occupied; blocks 2..8 must remain empty.
    expect(Array.from(features.slice(132))).toEqual(Array(28).fill(0));
  });

  it('maps legal engine actions to the compact ML mask', () => {
    let game = createGame({ smallBlind: 2, bigBlind: 4, maxSeats: 2, seed: 5 });
    game = sitPlayer(game, 0, { playerId: 'a', name: 'A', stack: 400 });
    game = sitPlayer(game, 1, { playerId: 'b', name: 'B', stack: 400 });
    game = startHand(game, 17);
    const legal = getLegalActions(game);
    const mask = Array.from(legalActionMask(legal));
    expect(mask).toHaveLength(5);
    expect(mask[0]).toBe(1);
    expect(mask.some(Boolean)).toBe(true);
  });

  it('normalizes wager sizes against the current legal range', () => {
    let game = createGame({ smallBlind: 0, bigBlind: 0, maxSeats: 2, seed: 3 });
    game = sitPlayer(game, 0, { playerId: 'a', name: 'A', stack: 100 });
    game = sitPlayer(game, 1, { playerId: 'b', name: 'B', stack: 100 });
    game = startHand(game, 19);
    const legal = getLegalActions(game);
    const bet = legal.find((action) => action.type === 'bet')!;
    const target = decisionToTrainingTarget(
      { type: 'bet', amount: bet.min, reason: 'test', confidence: 1 },
      legal,
    );
    expect(target.action).toBe(3);
    expect(target.size).toBe(0);

    // Smoke the engine once so this test also verifies the target came from a legal action.
    expect(() => applyAction(game, 'bet', bet.min)).not.toThrow();
  });
});
