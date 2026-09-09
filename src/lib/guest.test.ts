import { describe, expect, it, beforeEach } from 'vitest';
import { getChipBank, setChipBank } from './guest';
import { formatChips } from './format';
import { opponentSeatStyle } from './seatLayout';

function mockStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: localStorage, configurable: true });
}

describe('formatChips', () => {
  it('formats integers and treats garbage as zero', () => {
    expect(formatChips(1234)).toBe('1,234');
    expect(formatChips(Number.NaN)).toBe('0');
  });
});

describe('opponentSeatStyle', () => {
  it('keeps a solo opponent near the top of the oval', () => {
    const pos = opponentSeatStyle(0, 1);
    expect(Number.parseFloat(pos.left)).toBeCloseTo(50, 0);
    expect(Number.parseFloat(pos.top)).toBeLessThan(20);
  });

  it('spreads many opponents left to right', () => {
    const a = opponentSeatStyle(0, 5);
    const b = opponentSeatStyle(4, 5);
    expect(Number.parseFloat(a.left)).toBeLessThan(Number.parseFloat(b.left));
  });
});

describe('blackjack chip bank', () => {
  beforeEach(() => {
    mockStorage();
  });

  it('does not revive a busted 0-chip bank as 10000', () => {
    setChipBank(0);
    expect(getChipBank()).toBe(0);
  });
});
