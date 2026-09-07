import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionType, GameState } from '../types/poker';
import {
  createGame, sitPlayer, startHand, applyAction, getLegalActions,
} from '../engine/game';
import {
  decideTournamentAction, legalizeBotDecision, thinkDelay, delay, explainDecision, rollBotSeats,
} from '../bots';
import { getGuestId, getGuestName } from '../lib/guest';

export interface BotGameOptions {
  seats: number;
  buyIn: number;
  smallBlind: number;
  bigBlind: number;
  heroSeat?: number;
}

export function useBotGame(opts: BotGameOptions) {
  const heroSeat = opts.heroSeat ?? 0;
  const [state, setState] = useState<GameState | null>(null);
  const [coachLine, setCoachLine] = useState<string | null>(null);
  const [actingBot, setActingBot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const stateRef = useRef<GameState | null>(null);

  const sync = useCallback((s: GameState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const init = useCallback(() => {
    let g = createGame({
      smallBlind: opts.smallBlind,
      bigBlind: opts.bigBlind,
      maxSeats: opts.seats,
      seed: Date.now(),
    });
    const guestId = getGuestId();
    const guestName = getGuestName();
    g = sitPlayer(g, heroSeat, {
      playerId: guestId,
      name: guestName,
      stack: opts.buyIn,
      isBot: false,
    });

    // Roll opponents once per game. Their identities stay stable across hands.
    const bots = rollBotSeats(opts.seats - 1, Date.now() ^ (opts.seats * 997));
    let botIdx = 0;
    for (let i = 0; i < opts.seats; i++) {
      if (i === heroSeat) continue;
      const b = bots[botIdx++];
      g = sitPlayer(g, i, {
        playerId: `bot-seat-${i}`,
        name: b.name,
        stack: opts.buyIn,
        isBot: true,
        botPersona: b.personaId,
      });
    }
    g = startHand(g);
    sync(g);
    setCoachLine('Practice chips only. Good luck.');
  }, [opts.seats, opts.buyIn, opts.smallBlind, opts.bigBlind, heroSeat, sync]);

  const runBots = useCallback(async (start: GameState) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    let s = start;
    try {
      while (
        s.currentSeat != null &&
        s.street !== 'complete' &&
        s.seats[s.currentSeat]?.isBot
      ) {
        const seat = s.seats[s.currentSeat];
        const persona = seat.botPersona ?? 'mira';
        const legal = getLegalActions(s);
        if (!legal.length) break;
        setActingBot(seat.name);
        const proposed = decideTournamentAction(s, seat.seatIndex, persona, legal);
        const decision = legalizeBotDecision(proposed, legal, seat.stack);
        await delay(thinkDelay(persona, decision));
        s = applyAction(s, decision.type, decision.amount);
        sync(s);
        setCoachLine(explainDecision(persona, decision, { actorName: seat.name }));
      }
      setActingBot(null);

      if (s.street === 'complete') {
        const alive = s.seats.filter((x) => !x.sittingOut && x.stack > 0);
        if (alive.length >= 2 && alive.some((x) => x.seatIndex === heroSeat)) {
          setCoachLine('Hand over. Review it, then deal the next hand when ready.');
        } else if (!alive.some((x) => x.seatIndex === heroSeat)) {
          setCoachLine('You are out of chips. Restart to begin a new game.');
        } else {
          setCoachLine('Game over. Restart to begin a new game.');
        }
      }
    } finally {
      lock.current = false;
      setBusy(false);
      setActingBot(null);
    }
  }, [sync, heroSeat]);

  const heroAct = useCallback(
    (type: ActionType, amount?: number) => {
      const s = stateRef.current;
      if (!s || s.currentSeat !== heroSeat || lock.current) return;
      try {
        const next = applyAction(s, type, amount);
        sync(next);
        setCoachLine(null);
        void runBots(next);
      } catch (e) {
        console.error(e);
        setCoachLine(String(e));
      }
    },
    [heroSeat, sync, runBots],
  );

  const nextHand = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.street !== 'complete' || lock.current) return;
    const alive = s.seats.filter((x) => !x.sittingOut && x.stack > 0);
    if (alive.length < 2 || !alive.some((x) => x.seatIndex === heroSeat)) return;
    const next = startHand(s);
    sync(next);
    setCoachLine('New hand dealt.');
    if (next.currentSeat != null && next.seats[next.currentSeat]?.isBot) {
      void runBots(next);
    }
  }, [heroSeat, runBots, sync]);

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!state) return;
    if (state.currentSeat != null && state.seats[state.currentSeat]?.isBot && !lock.current) {
      void runBots(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.handNo, state?.street, state?.currentSeat]);

  return {
    state,
    coachLine,
    actingBot,
    busy,
    heroSeat,
    heroAct,
    nextHand,
    restart: init,
  };
}
