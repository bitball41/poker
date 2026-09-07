import type { GameState } from '../types/poker';

export const INITIAL_CHIPS = 400;
export const REFILL_CHIPS = 200;
export const STARTING_RANK_POINTS = 1000;

export interface PlayerProgress {
  version: 1;
  chips: number;
  rankPoints: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  ownedCosmetics: string[];
}

const PREFIX = 'liminal_poker_progress:';
const SESSION_PREFIX = 'liminal_poker_game:';

export function defaultProgress(): PlayerProgress {
  return {
    version: 1,
    chips: INITIAL_CHIPS,
    rankPoints: STARTING_RANK_POINTS,
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    ownedCosmetics: [],
  };
}

function saneInt(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
}

export function loadProgress(identityKey: string): PlayerProgress {
  try {
    const raw = localStorage.getItem(PREFIX + identityKey);
    if (!raw) {
      const created = defaultProgress();
      saveProgress(identityKey, created);
      return created;
    }
    const parsed = JSON.parse(raw) as Partial<PlayerProgress>;
    return {
      version: 1,
      chips: saneInt(parsed.chips, INITIAL_CHIPS),
      rankPoints: saneInt(parsed.rankPoints, STARTING_RANK_POINTS),
      gamesPlayed: saneInt(parsed.gamesPlayed, 0),
      wins: saneInt(parsed.wins, 0),
      losses: saneInt(parsed.losses, 0),
      ownedCosmetics: Array.isArray(parsed.ownedCosmetics)
        ? parsed.ownedCosmetics.filter((x): x is string => typeof x === 'string')
        : [],
    };
  } catch {
    return defaultProgress();
  }
}

export function saveProgress(identityKey: string, progress: PlayerProgress): void {
  try {
    localStorage.setItem(PREFIX + identityKey, JSON.stringify(progress));
  } catch {
    // Storage can be unavailable in locked-down embeds. The game still works in-memory.
  }
}

export function updateProgress(
  identityKey: string,
  updater: (current: PlayerProgress) => PlayerProgress,
): PlayerProgress {
  const next = updater(loadProgress(identityKey));
  saveProgress(identityKey, next);
  return next;
}

export function requestRefill(identityKey: string): PlayerProgress {
  return updateProgress(identityKey, (current) => current.chips > 0
    ? current
    : { ...current, chips: REFILL_CHIPS });
}

export function settleGameRank(
  identityKey: string,
  result: 'win' | 'loss',
  chips: number,
): PlayerProgress {
  return updateProgress(identityKey, (current) => ({
    ...current,
    chips: Math.max(0, Math.floor(chips)),
    rankPoints: Math.max(0, current.rankPoints + (result === 'win' ? 35 : -20)),
    gamesPlayed: current.gamesPlayed + 1,
    wins: current.wins + (result === 'win' ? 1 : 0),
    losses: current.losses + (result === 'loss' ? 1 : 0),
  }));
}

export function settleHandChips(identityKey: string, chips: number): PlayerProgress {
  return updateProgress(identityKey, (current) => ({
    ...current,
    chips: Math.max(0, Math.floor(chips)),
  }));
}

export function rankName(points: number): string {
  if (points >= 1400) return 'Diamond';
  if (points >= 1200) return 'Platinum';
  if (points >= 1050) return 'Gold';
  if (points >= 900) return 'Silver';
  return 'Bronze';
}

/** Persist the in-progress local table so refreshing cannot undo an active hand. */
export function saveLocalGame(identityKey: string, state: GameState): void {
  try {
    localStorage.setItem(SESSION_PREFIX + identityKey, JSON.stringify(state));
  } catch {
    // Optional resilience only.
  }
}

export function loadLocalGame(identityKey: string): GameState | null {
  try {
    const raw = localStorage.getItem(SESSION_PREFIX + identityKey);
    return raw ? JSON.parse(raw) as GameState : null;
  } catch {
    return null;
  }
}

export function clearLocalGame(identityKey: string): void {
  try {
    localStorage.removeItem(SESSION_PREFIX + identityKey);
  } catch {
    // Optional resilience only.
  }
}
