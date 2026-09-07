export interface Persona {
  id: string;
  name: string;
  blurb: string;
  avatarColor: string;
  /** Voluntary put money in pot % target */
  vpip: number;
  /** Preflop raise % target */
  pfr: number;
  /** Bets+raises / calls */
  aggressionFactor: number;
  bluffFrequency: number; // 0–1
  foldToCbet: number; // 0–1
  callStationTendency: number; // 0–1 higher = calls thinner
  stackFear: number; // 0–1 risk aversion with deep/short
  timingProfile: { snapMs: [number, number]; thinkMs: [number, number]; tankMs: [number, number] };
  /** Allow open-limps */
  limps: boolean;
  /** Never fold the nuts / near-nuts */
  respectNuts: boolean;
}

export const PERSONAS: Record<string, Persona> = {
  mira: {
    id: 'mira',
    name: 'Mira',
    blurb: 'TAG — tight-aggressive, value-heavy',
    avatarColor: '#c0c0c0',
    vpip: 22, pfr: 18, aggressionFactor: 2.4,
    bluffFrequency: 0.22, foldToCbet: 0.55, callStationTendency: 0.15,
    stackFear: 0.45, limps: false, respectNuts: true,
    timingProfile: { snapMs: [400, 800], thinkMs: [900, 1800], tankMs: [2200, 4000] },
  },
  rook: {
    id: 'rook',
    name: 'Rook',
    blurb: 'Nit — waits for premiums',
    avatarColor: '#8a8a8a',
    vpip: 12, pfr: 10, aggressionFactor: 1.6,
    bluffFrequency: 0.08, foldToCbet: 0.72, callStationTendency: 0.08,
    stackFear: 0.75, limps: false, respectNuts: true,
    timingProfile: { snapMs: [300, 600], thinkMs: [1200, 2200], tankMs: [2800, 5000] },
  },
  jinx: {
    id: 'jinx',
    name: 'Jinx',
    blurb: 'LAG — wide and aggressive',
    avatarColor: '#e8e8e8',
    vpip: 38, pfr: 28, aggressionFactor: 3.2,
    bluffFrequency: 0.42, foldToCbet: 0.35, callStationTendency: 0.25,
    stackFear: 0.25, limps: false, respectNuts: true,
    timingProfile: { snapMs: [250, 500], thinkMs: [700, 1400], tankMs: [1800, 3200] },
  },
  harbor: {
    id: 'harbor',
    name: 'Harbor',
    blurb: 'Calling station — peeks too often',
    avatarColor: '#9aa0a6',
    vpip: 45, pfr: 8, aggressionFactor: 0.7,
    bluffFrequency: 0.05, foldToCbet: 0.18, callStationTendency: 0.85,
    stackFear: 0.35, limps: true, respectNuts: true,
    timingProfile: { snapMs: [500, 900], thinkMs: [1000, 2000], tankMs: [2500, 4500] },
  },
  volt: {
    id: 'volt',
    name: 'Volt',
    blurb: 'Maniac — chaos with a pulse',
    avatarColor: '#f0f0f0',
    vpip: 55, pfr: 42, aggressionFactor: 4.5,
    bluffFrequency: 0.55, foldToCbet: 0.2, callStationTendency: 0.3,
    stackFear: 0.1, limps: true, respectNuts: true,
    timingProfile: { snapMs: [200, 450], thinkMs: [500, 1100], tankMs: [1500, 2800] },
  },
  quill: {
    id: 'quill',
    name: 'Quill',
    blurb: 'GTO-lite — balanced frequencies',
    avatarColor: '#b8b8b8',
    vpip: 24, pfr: 19, aggressionFactor: 2.1,
    bluffFrequency: 0.28, foldToCbet: 0.48, callStationTendency: 0.2,
    stackFear: 0.4, limps: false, respectNuts: true,
    timingProfile: { snapMs: [450, 850], thinkMs: [1100, 2000], tankMs: [2400, 4200] },
  },
  sage: {
    id: 'sage',
    name: 'Sage',
    blurb: 'Tight-passive — solid but timid',
    avatarColor: '#7a7a7a',
    vpip: 16, pfr: 8, aggressionFactor: 0.9,
    bluffFrequency: 0.06, foldToCbet: 0.65, callStationTendency: 0.35,
    stackFear: 0.7, limps: true, respectNuts: true,
    timingProfile: { snapMs: [600, 1000], thinkMs: [1400, 2600], tankMs: [3000, 5500] },
  },
  fox: {
    id: 'fox',
    name: 'Fox',
    blurb: 'Tricky — timed bluffs and check-raises',
    avatarColor: '#d4d4d4',
    vpip: 28, pfr: 20, aggressionFactor: 2.6,
    bluffFrequency: 0.38, foldToCbet: 0.4, callStationTendency: 0.22,
    stackFear: 0.3, limps: false, respectNuts: true,
    timingProfile: { snapMs: [350, 700], thinkMs: [900, 1900], tankMs: [2600, 4800] },
  },
};

export const PERSONA_LIST = Object.values(PERSONAS);

/** Neutral first names for table display — shuffled independently from personas */
export const DISPLAY_NAMES = [
  'Alex', 'Jordan', 'Sam', 'Casey', 'Riley', 'Morgan', 'Quinn', 'Avery',
  'Blake', 'Cameron', 'Drew', 'Emery', 'Finley', 'Harper', 'Jamie', 'Kai',
  'Logan', 'Noah', 'Parker', 'Reese', 'Skyler', 'Taylor', 'Rowan', 'Sage',
  'Elliot', 'Hayden', 'Jesse', 'Kendall', 'Lane', 'Marley', 'Nico', 'Owen',
  'Peyton', 'Remy', 'Sidney', 'Toby', 'Val', 'Wren', 'Zion', 'Ash',
];

export function getPersona(id: string): Persona {
  return PERSONAS[id] ?? PERSONAS.mira;
}

/** Balanced mix for N bots (legacy helper) */
export function pickPersonas(count: number, seed = 1): Persona[] {
  const order = ['mira', 'jinx', 'harbor', 'rook', 'quill', 'fox', 'volt', 'sage'];
  const out: Persona[] = [];
  for (let i = 0; i < count; i++) {
    out.push(PERSONAS[order[(i + seed) % order.length]]);
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Shuffle persona styles and display names independently so table names
 * never reveal which AI style is seated.
 */
export function rollBotSeats(
  count: number,
  seed: number,
): { personaId: string; name: string }[] {
  const rng = mulberry32(seed >>> 0);
  const personaIds = shuffleInPlace(
    PERSONA_LIST.map((p) => p.id),
    rng,
  );
  const names = shuffleInPlace([...DISPLAY_NAMES], rng);
  const out: { personaId: string; name: string }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({
      personaId: personaIds[i % personaIds.length],
      name: names[i % names.length],
    });
  }
  return out;
}
