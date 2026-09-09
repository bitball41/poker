import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SELFPLAY_EXPLORE,
  behaviorLogProb,
  behaviorProbabilities,
  maskedSoftmax,
  mixEpsilon,
} from './model';

describe('self-play behavior distribution', () => {
  it('mixes tempered softmax with uniform over legal actions', () => {
    const logits = new Float32Array([2, 0.5, -1, 4, 0]);
    const mask = new Uint8Array([1, 1, 1, 0, 1]);
    const explore = { temperature: 1.2, epsilon: 0.05, sizeJitter: 0.08 };
    const probs = behaviorProbabilities(logits, mask, explore);

    const legal = [0, 1, 2, 4];
    const scaled = legal.map((i) => logits[i]! / explore.temperature);
    const max = Math.max(...scaled);
    const exps = scaled.map((value) => Math.exp(value - max));
    const total = exps.reduce((sum, value) => sum + value, 0);
    const softmax = new Map(legal.map((i, idx) => [i, exps[idx]! / total]));
    const uniform = 1 / legal.length;

    expect(probs[3]).toBe(0);
    let mass = 0;
    for (const i of legal) {
      const expected = (1 - explore.epsilon) * (softmax.get(i) ?? 0) + explore.epsilon * uniform;
      expect(probs[i]).toBeCloseTo(expected, 6);
      mass += probs[i]!;
    }
    expect(mass).toBeCloseTo(1, 6);
  });

  it('differs from T=1 softmax when temperature and epsilon are on', () => {
    const logits = new Float32Array([6, 0, 0, 0, 0]);
    const mask = new Uint8Array([1, 1, 1, 0, 0]);
    const base = maskedSoftmax(logits, mask, 1);
    const explore = behaviorProbabilities(logits, mask, DEFAULT_SELFPLAY_EXPLORE);
    expect(explore[0]).toBeLessThan(base[0]!);
    expect(explore[1]).toBeGreaterThan(base[1]!);
    expect(behaviorLogProb(logits, mask, 0)).toBeCloseTo(Math.log(explore[0]!), 6);
  });

  it('matches mixEpsilon(maskedSoftmax(/T)) exactly', () => {
    const logits = new Float32Array([1.2, -0.4, 0.8, 0, 2.2]);
    const mask = new Uint8Array([1, 0, 1, 1, 1]);
    const explore = DEFAULT_SELFPLAY_EXPLORE;
    const expected = mixEpsilon(maskedSoftmax(logits, mask, explore.temperature), mask, explore.epsilon);
    expect(Array.from(behaviorProbabilities(logits, mask, explore))).toEqual(Array.from(expected));
  });
});
