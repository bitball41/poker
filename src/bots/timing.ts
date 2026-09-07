import type { BotDecision } from '../types/poker';
import { getPersona } from './personas';

function lerpRand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

/**
 * Human-like delay based on decision difficulty + persona timing profile.
 */
export function thinkDelay(personaId: string, decision: BotDecision): number {
  const p = getPersona(personaId);
  const { snapMs, thinkMs, tankMs } = p.timingProfile;

  // Confidence high + simple action → snap
  const simple =
    (decision.type === 'fold' && decision.confidence > 0.7) ||
    (decision.type === 'check' && decision.confidence > 0.65) ||
    (decision.type === 'call' && decision.confidence > 0.85);

  const hard =
    decision.confidence < 0.45 ||
    decision.type === 'raise' ||
    decision.type === 'all-in' ||
    (decision.type === 'bet' && decision.confidence < 0.55);

  let ms: number;
  if (simple && Math.random() < 0.55) {
    ms = lerpRand(snapMs[0], snapMs[1]);
  } else if (hard && Math.random() < 0.4) {
    ms = lerpRand(tankMs[0], tankMs[1]);
  } else {
    ms = lerpRand(thinkMs[0], thinkMs[1]);
  }

  // Cap for UX
  return Math.min(5500, Math.max(280, Math.round(ms)));
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
