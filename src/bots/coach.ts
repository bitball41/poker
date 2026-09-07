import type { BotDecision } from '../types/poker';

/** Soften decision text so style labels never leak to the player */
function softReason(decision: BotDecision): string {
  if (decision.reason) {
    const r = decision.reason
      .replace(/\s*\(eq[^)]*\)/gi, '')
      .replace(/\s*\(equity[^)]*\)/gi, '')
      .replace(/Eq\s+[\d.]+%\s*<\s*price\s+[\d.]+%/gi, 'price looked steep')
      .replace(/Fold weak.*/i, 'folded')
      .trim();
    if (r.length > 0 && r.length < 80) return r;
  }
  const amount = decision.amount != null ? ` ${decision.amount}` : '';
  switch (decision.type) {
    case 'fold':
      return 'folded';
    case 'check':
      return 'checked';
    case 'call':
      return `called${amount}`;
    case 'bet':
      return `bet${amount}`;
    case 'raise':
      return `raised to${amount}`;
    case 'all-in':
      return 'went all-in';
    default:
      return `${decision.type}${amount}`;
  }
}

/**
 * Short beginner-friendly explanation of a bot action.
 * Never include persona id, style labels (TAG/nit/etc.), or internal names.
 */
export function explainDecision(
  _personaId: string,
  decision: BotDecision,
  extras?: {
    equity?: number;
    potOdds?: number;
    handName?: string;
    /** Table display name only — never a persona id */
    actorName?: string;
  },
): string {
  const who = extras?.actorName?.trim();
  const line = softReason(decision);
  if (who) return `${who} ${line}.`;
  return line.charAt(0).toUpperCase() + line.slice(1) + '.';
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
