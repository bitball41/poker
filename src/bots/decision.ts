import type { BotDecision, GameState, LegalAction } from '../types/poker';
import { decideTournamentAction } from './tournamentPolicy';
import { legalizeBotDecision } from './legalize';
import { decideMlAction, type ExportedPolicyModel } from './ml/model';
import { getShippedPolicy } from './ml/runtime';

export interface DecisionContext {
  legal: LegalAction[];
  toCall: number;
  pot: number;
  canCheck: boolean;
}

export interface DecideActionOptions {
  /** Inject a model in tests. `null` skips ML and uses the heuristic fallback. */
  model?: ExportedPolicyModel | null;
}

/**
 * Practice / friend-room bot entry point.
 *
 * Production uses greedy policy-v1 (no temperature, no epsilon). Personas still
 * reroll once per game for names, timing, and coach lines — they do not pick
 * the strategy. If the shipped model is missing or inference blows up, we fall
 * back to the tournament heuristic and still legalize before the engine.
 */
export function decideAction(
  state: GameState,
  seatIndex: number,
  personaId: string,
  legalActions: LegalAction[],
  options?: DecideActionOptions,
): BotDecision {
  const seat = state.seats[seatIndex];
  const stack = seat?.stack ?? 0;
  const model = options?.model === undefined ? getShippedPolicy() : options.model;
  if (model) {
    try {
      const proposed = decideMlAction(model, state, seatIndex, legalActions);
      return legalizeBotDecision(proposed, legalActions, stack);
    } catch {
      // Load/inference failure: heuristic below.
    }
  }
  const proposed = decideTournamentAction(state, seatIndex, personaId, legalActions);
  return legalizeBotDecision(proposed, legalActions, stack);
}
