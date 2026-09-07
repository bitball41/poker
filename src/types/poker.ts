export type Suit = 'h' | 'd' | 'c' | 's';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown' | 'complete';

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'all-in';

export interface PlayerAction {
  type: ActionType;
  amount?: number;
  seat: number;
}

export interface SeatState {
  seatIndex: number;
  playerId: string | null;
  name: string;
  isBot: boolean;
  botPersona?: string;
  stack: number;
  bet: number;
  totalBet: number;
  holeCards: Card[] | null;
  folded: boolean;
  allIn: boolean;
  sittingOut: boolean;
  hasActed: boolean;
  /** Cleared each street — UI label over avatar */
  lastAction: { type: ActionType; amount?: number } | null;
}

export interface SidePot {
  amount: number;
  eligibleSeats: number[];
}

export interface GameConfig {
  smallBlind: number;
  bigBlind: number;
  maxSeats: number;
  seed?: number;
}

export interface GameState {
  handNo: number;
  street: Street;
  deck: Card[];
  community: Card[];
  seats: SeatState[];
  pot: number;
  sidePots: SidePot[];
  button: number;
  sbSeat: number;
  bbSeat: number;
  currentSeat: number | null;
  currentBet: number;
  minRaise: number;
  lastAggressor: number | null;
  winners: { seat: number; amount: number; handName?: string }[] | null;
  config: GameConfig;
  history: PlayerAction[];
  started: boolean;
}

export interface LegalAction {
  type: ActionType;
  min?: number;
  max?: number;
  callAmount?: number;
}

export interface BotDecision {
  type: ActionType;
  amount?: number;
  reason: string;
  confidence: number;
}
