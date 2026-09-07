/** Mulberry32 seeded PRNG for deterministic tests. */
export function createRng(seed = Date.now()): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random source for normal live games. Seeded RNG is still available for tests/replays. */
export function createSecureRng(): () => number {
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.getRandomValues) return Math.random;
  const buf = new Uint32Array(1);
  return () => {
    cryptoObj.getRandomValues(buf);
    return buf[0] / 4294967296;
  };
}

export function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
