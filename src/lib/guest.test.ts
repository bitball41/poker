import { describe, expect, it, beforeEach } from 'vitest';
import { getChipBank, setChipBank } from './guest';
import { formatChips } from './format';
import { sfxEnabled, setSfxEnabled, sfxForAction } from './sound';

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

describe('sfx prefs', () => {
  beforeEach(() => {
    mockStorage();
  });

  it('defaults on and can mute', () => {
    expect(sfxEnabled()).toBe(true);
    setSfxEnabled(false);
    expect(sfxEnabled()).toBe(false);
  });

  it('maps actions to short cues', () => {
    expect(sfxForAction('fold')).toBe('fold');
    expect(sfxForAction('raise')).toBe('raise');
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
