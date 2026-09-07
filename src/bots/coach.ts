import type { BotDecision } from '../types/poker';
import { getPersona } from './personas';

/** Short beginner-friendly explanation of a bot action */
export function explainDecision(
  personaId: string,
  decision: BotDecision,
  extras?: { equity?: number; potOdds?: number; handName?: string },
): string {
  const p = getPersona(personaId);
  const parts: string[] = [`${p.name}:`];

  if (decision.reason) {
    parts.push(decision.reason);
  } else {
    parts.push(`${decision.type}${decision.amount != null ? ` ${decision.amount}` : ''}`);
  }

  if (extras?.equity != null && extras?.potOdds != null) {
    parts.push(
      `(equity ~${(extras.equity * 100).toFixed(0)}% vs need ${(extras.potOdds * 100).toFixed(0)}%)`,
    );
  }
  if (extras?.handName) {
    parts.push(`[${extras.handName}]`);
  }

  return parts.join(' ');
}

export function tipForBeginner(street: string): string {
  const tips: Record<string, string> = {
    preflop: 'Position matters: open wider on the button, tighter under the gun.',
    flop: 'Pot odds = call size ÷ (pot + call). Call when your equity clears that price.',
    turn: 'SPR (stack-to-pot) under ~3 often means commit-or-fold with strong hands.',
    river: 'No more cards — bet for value or as a bluff; calling needs showdown worthiness.',
  };
  return tips[street] ?? 'Practice chips only — focus on decisions, not results.';
}
