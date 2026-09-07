import type { BotDecision, GameState, LegalAction } from '../types/poker';
import { decideTournamentAction } from './tournamentPolicy';
import { legalizeBotDecision } from './legalize';

export interface DecisionContext {
  legal: LegalAction[];
  toCall: number;
  pot: number;
  canCheck: boolean;
}

/**
 * Compatibility entry point used by practice mode and bot-filled friend rooms.
 *
 * The old bespoke decision tree was intentionally retired. All callers now use
 * the JsPoker-derived tournament policy, then pass the proposal through the
 * shared legal-action boundary before it can reach the rules engine.
 */
export function decideAction(
  state: GameState,
  seatIndex: number,
  personaId: string,
  legalActions: LegalAction[],
): BotDecision {
  const seat = state.seats[seatIndex];
  const proposed = decideTournamentAction(state, seatIndex, personaId, legalActions);
  return legalizeBotDecision(proposed, legalActions, seat?.stack ?? 0);
}
