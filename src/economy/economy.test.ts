import { describe, expect, it } from 'vitest';
import { blindPressureForHand } from './blinds';
import { MIN_COSMETIC_PRICE, validateCosmetic } from './cosmetics';
import { INITIAL_CHIPS, REFILL_CHIPS, rankName } from './progress';

describe('fake-chip economy', () => {
  it('starts at 400 and refills at 200', () => {
    expect(INITIAL_CHIPS).toBe(400);
    expect(REFILL_CHIPS).toBe(200);
  });

  it('escalates blinds and pressure targets across hands', () => {
    expect(blindPressureForHand(1)).toMatchObject({ smallBlind: 2, bigBlind: 4, targetHand: 5, targetChips: 300 });
    expect(blindPressureForHand(5)).toMatchObject({ smallBlind: 4, bigBlind: 8, targetHand: 10, targetChips: 400 });
    expect(blindPressureForHand(10)).toMatchObject({ smallBlind: 8, bigBlind: 16, targetHand: 15, targetChips: 550 });
    expect(blindPressureForHand(20)).toMatchObject({ smallBlind: 20, bigBlind: 40, targetHand: 25, targetChips: 1000 });
  });

  it('has deterministic rank bands', () => {
    expect(rankName(899)).toBe('Bronze');
    expect(rankName(900)).toBe('Silver');
    expect(rankName(1050)).toBe('Gold');
    expect(rankName(1200)).toBe('Platinum');
    expect(rankName(1400)).toBe('Diamond');
  });

  it('refuses cosmetic prices below 201', () => {
    expect(MIN_COSMETIC_PRICE).toBe(201);
    expect(() => validateCosmetic({ id: 'cheap', name: 'Cheap', category: 'ring', price: 200 })).toThrow();
    expect(validateCosmetic({ id: 'valid', name: 'Valid', category: 'ring', price: 201 }).price).toBe(201);
  });
});
