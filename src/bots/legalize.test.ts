import { describe, expect, it } from 'vitest';
import type { BotDecision, LegalAction } from '../types/poker';
import { legalizeBotDecision } from './legalize';

function d(type: BotDecision['type'], amount?: number): BotDecision {
  return { type, amount, reason: 'test proposal', confidence: 0.5 };
}

describe('bot legal-action firewall', () => {
  it('clamps a zero bet to the legal minimum', () => {
    const legal: LegalAction[] = [
      { type: 'fold' },
      { type: 'check' },
      { type: 'bet', min: 1, max: 1000 },
      { type: 'all-in', min: 1000, max: 1000 },
    ];
    const out = legalizeBotDecision(d('bet', 0), legal, 1000);
    expect(out.type).toBe('bet');
    expect(out.amount).toBe(1);
  });

  it('cannot check while facing a bet', () => {
    const legal: LegalAction[] = [
      { type: 'fold' },
      { type: 'call', callAmount: 100, min: 100, max: 100 },
      { type: 'raise', min: 200, max: 1000 },
      { type: 'all-in', min: 1000, max: 1000 },
    ];
    const out = legalizeBotDecision(d('check'), legal, 1000);
    expect(out.type).toBe('fold');
  });

  it('uses the engine call amount rather than trusting the bot amount', () => {
    const legal: LegalAction[] = [
      { type: 'fold' },
      { type: 'call', callAmount: 125, min: 125, max: 125 },
    ];
    const out = legalizeBotDecision(d('call', 9999), legal, 1000);
    expect(out.type).toBe('call');
    expect(out.amount).toBe(125);
  });

  it('clamps oversized raises to the legal ceiling', () => {
    const legal: LegalAction[] = [
      { type: 'fold' },
      { type: 'call', callAmount: 50, min: 50, max: 50 },
      { type: 'raise', min: 150, max: 700 },
      { type: 'all-in', min: 1000, max: 1000 },
    ];
    const out = legalizeBotDecision(d('raise', 99999), legal, 1000);
    expect(out.type).toBe('raise');
    expect(out.amount).toBe(700);
  });
});
