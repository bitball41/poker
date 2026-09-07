import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionType, GameState } from '../types/poker';
import {
  createGame, sitPlayer, startHand, applyAction, getLegalActions,
} from '../engine/game';
import { decideAction, thinkDelay, delay, explainDecision, estimateEquity, pickPersonas } from '../bots';
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
  const [equity, setEquity] = useState<number | null>(null);
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
    const bots = pickPersonas(opts.seats - 1, Date.now() % 8);
    let botIdx = 0;
    for (let i = 0; i < opts.seats; i++) {
      if (i === heroSeat) continue;
      const p = bots[botIdx++];
      g = sitPlayer(g, i, {
        playerId: `bot-${p.id}-${i}`,
        name: p.name,
        stack: opts.buyIn,
        isBot: true,
        botPersona: p.id,
      });
    }
    g = startHand(g);
    sync(g);
    setCoachLine('Practice chips only. Good luck.');
    setEquity(null);
  }, [opts.seats, opts.buyIn, opts.smallBlind, opts.bigBlind, heroSeat, sync]);

  const updateEquity = useCallback((s: GameState) => {
    const hero = s.seats[heroSeat];
    if (!hero?.holeCards || hero.folded || s.street === 'complete') {
      setEquity(null);
      return;
    }
    const opps = s.seats.filter(
      (x) => x.seatIndex !== heroSeat && !x.folded && !x.sittingOut,
    ).length;
    if (opps === 0) {
      setEquity(1);
      return;
    }
    // Async-ish: compute on main thread with modest sims
    const result = estimateEquity(hero.holeCards, s.community, opps, 280, s.handNo);
    setEquity(result.equity);
  }, [heroSeat]);

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
        const decision = decideAction(s, seat.seatIndex, persona, legal);
        const ms = thinkDelay(persona, decision);
        await delay(ms);
        s = applyAction(s, decision.type, decision.amount);
        sync(s);
        setCoachLine(explainDecision(persona, decision));
      }
      setActingBot(null);
      updateEquity(s);

      // Auto next hand after short pause on complete
      if (s.street === 'complete') {
        await delay(2200);
        const alive = s.seats.filter((x) => !x.sittingOut && x.stack > 0);
        if (alive.length >= 2 && alive.some((x) => x.seatIndex === heroSeat)) {
          s = startHand(s);
          sync(s);
          setCoachLine('New hand dealt.');
          updateEquity(s);
          // Continue bots if they act first
          lock.current = false;
          setBusy(false);
          if (s.currentSeat != null && s.seats[s.currentSeat]?.isBot) {
            void runBots(s);
          }
          return;
        } else {
          setCoachLine('Hand over — not enough stacks to continue. Restart from setup.');
        }
      } else if (s.currentSeat != null && s.seats[s.currentSeat]?.isBot) {
        // rare re-entry
      }
    } finally {
      lock.current = false;
      setBusy(false);
      setActingBot(null);
    }
  }, [sync, updateEquity, heroSeat]);

  const heroAct = useCallback(
    (type: ActionType, amount?: number) => {
      const s = stateRef.current;
      if (!s || s.currentSeat !== heroSeat || lock.current) return;
      try {
        const next = applyAction(s, type, amount);
        sync(next);
        setCoachLine(null);
        updateEquity(next);
        void runBots(next);
      } catch (e) {
        console.error(e);
        setCoachLine(String(e));
      }
    },
    [heroSeat, sync, runBots, updateEquity],
  );

  useEffect(() => {
    init();
  }, [init]);

  useEffect(() => {
    if (!state) return;
    if (state.currentSeat != null && state.seats[state.currentSeat]?.isBot && !lock.current) {
      void runBots(state);
    } else if (state.currentSeat === heroSeat) {
      updateEquity(state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.handNo, state?.street, state?.currentSeat]);

  return {
    state,
    coachLine,
    equity,
    actingBot,
    busy,
    heroSeat,
    heroAct,
    restart: init,
  };
}
