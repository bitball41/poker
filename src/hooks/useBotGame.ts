import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionType, GameState } from '../types/poker';
import {
  createGame, sitPlayer, startHand, applyAction, getLegalActions,
} from '../engine/game';
import { createRng } from '../engine/rng';
import {
  decideTournamentAction, legalizeBotDecision, thinkDelay, delay, explainDecision, rollBotSeats,
} from '../bots';
import {
  clearLocalGame,
  loadLocalGame,
  loadProgress,
  rankName,
  requestRefill,
  saveLocalGame,
  settleGameRank,
  settleHandChips,
  type PlayerProgress,
} from '../economy/progress';
import { blindPressureForHand, withBlindPressure } from '../economy/blinds';

export interface BotGameOptions {
  seats: number;
  identityKey: string;
  playerId: string;
  playerName: string;
  enabled?: boolean;
  heroSeat?: number;
}

function rollBotStacks(count: number, seed: number): number[] {
  const rng = createRng(seed);
  const coreCount = Math.ceil(count / 2);
  const groups: Array<'core' | 'outlier'> = Array.from(
    { length: count },
    (_, i) => i < coreCount ? 'core' : 'outlier',
  );
  for (let i = groups.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = groups[i];
    groups[i] = groups[j];
    groups[j] = tmp;
  }
  return groups.map((group) => {
    if (group === 'core') {
      const stack = 320 + Math.floor(rng() * 161); // 320–480 around the 400-chip baseline.
      return stack === 400 ? 407 : stack;
    }
    return rng() < 0.5
      ? 160 + Math.floor(rng() * 141) // low-stack outlier: 160–300
      : 520 + Math.floor(rng() * 241); // deep-stack outlier: 520–760
  });
}

export function useBotGame(opts: BotGameOptions) {
  const heroSeat = opts.heroSeat ?? 0;
  const [state, setState] = useState<GameState | null>(null);
  const [progress, setProgress] = useState<PlayerProgress>(() => loadProgress(opts.identityKey));
  const [coachLine, setCoachLine] = useState<string | null>(null);
  const [actingBot, setActingBot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const stateRef = useRef<GameState | null>(null);
  const settledHandRef = useRef(-1);
  const gameRankSettledRef = useRef(false);

  const sync = useCallback((s: GameState) => {
    stateRef.current = s;
    setState(s);
    saveLocalGame(opts.identityKey, s);

    if (s.street !== 'complete' || settledHandRef.current === s.handNo) return;
    settledHandRef.current = s.handNo;
    const hero = s.seats[heroSeat];
    if (!hero) return;
    const alive = s.seats.filter((x) => !x.sittingOut && x.stack > 0);

    let nextProgress: PlayerProgress;
    if (!gameRankSettledRef.current && hero.stack <= 0) {
      gameRankSettledRef.current = true;
      nextProgress = settleGameRank(opts.identityKey, 'loss', 0);
    } else if (!gameRankSettledRef.current && alive.length === 1 && alive[0].seatIndex === heroSeat) {
      gameRankSettledRef.current = true;
      nextProgress = settleGameRank(opts.identityKey, 'win', hero.stack);
    } else {
      nextProgress = settleHandChips(opts.identityKey, hero.stack);
    }
    setProgress(nextProgress);
  }, [heroSeat, opts.identityKey]);

  const buildNewGame = useCallback((chips: number): GameState => {
    const seed = Date.now() ^ (opts.seats * 997);
    const firstLevel = blindPressureForHand(1);
    let g = createGame({
      smallBlind: firstLevel.smallBlind,
      bigBlind: firstLevel.bigBlind,
      maxSeats: opts.seats,
      seed,
    });
    g = sitPlayer(g, heroSeat, {
      playerId: opts.playerId,
      name: opts.playerName,
      stack: chips,
      isBot: false,
    });

    // Roll identities and stacks once per game. Neither rerolls between hands.
    const bots = rollBotSeats(opts.seats - 1, seed);
    const stacks = rollBotStacks(opts.seats - 1, seed ^ 0x51f15e);
    let botIdx = 0;
    for (let i = 0; i < opts.seats; i++) {
      if (i === heroSeat) continue;
      const b = bots[botIdx];
      g = sitPlayer(g, i, {
        playerId: `bot-seat-${i}`,
        name: b.name,
        stack: stacks[botIdx],
        isBot: true,
        botPersona: b.personaId,
      });
      botIdx++;
    }
    g = withBlindPressure(g, 1);
    return startHand(g);
  }, [heroSeat, opts.playerId, opts.playerName, opts.seats]);

  const init = useCallback((forceNew = false) => {
    if (opts.enabled === false) return;
    const current = loadProgress(opts.identityKey);
    setProgress(current);
    settledHandRef.current = -1;
    gameRankSettledRef.current = false;

    if (!forceNew) {
      const saved = loadLocalGame(opts.identityKey);
      const savedHero = saved?.seats?.[heroSeat];
      if (saved && saved.seats.length === opts.seats && savedHero?.playerId === opts.playerId) {
        if (saved.street === 'complete') settledHandRef.current = saved.handNo;
        const alive = saved.seats.filter((x) => !x.sittingOut && x.stack > 0);
        gameRankSettledRef.current = savedHero.stack <= 0 || (alive.length === 1 && alive[0].seatIndex === heroSeat);
        stateRef.current = saved;
        setState(saved);
        setCoachLine(saved.street === 'complete' ? 'Hand restored. Review it or continue.' : 'Table restored.');
        return;
      }
    }

    clearLocalGame(opts.identityKey);
    if (current.chips <= 0) {
      stateRef.current = null;
      setState(null);
      setCoachLine('You are out of chips. Ask for a 200-chip refill.');
      return;
    }

    const game = buildNewGame(current.chips);
    sync(game);
    setCoachLine('Practice chips only. Your stack persists between games.');
  }, [buildNewGame, heroSeat, opts.enabled, opts.identityKey, opts.playerId, opts.seats, sync]);

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
          const nextLevel = blindPressureForHand(s.handNo + 1);
          setCoachLine(`Hand over. Next: ${nextLevel.smallBlind}/${nextLevel.bigBlind}. Target ${nextLevel.targetChips} by hand ${nextLevel.targetHand}.`);
        } else if (!alive.some((x) => x.seatIndex === heroSeat)) {
          setCoachLine('You are out of chips. Ask for a 200-chip refill.');
        } else {
          setCoachLine('You cleared the table. Rank updated.');
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
    const prepared = withBlindPressure(s, s.handNo + 1);
    const next = startHand(prepared);
    sync(next);
    const level = blindPressureForHand(next.handNo);
    setCoachLine(`Hand ${next.handNo}. Blinds ${level.smallBlind}/${level.bigBlind}. Target ${level.targetChips} by hand ${level.targetHand}.`);
    if (next.currentSeat != null && next.seats[next.currentSeat]?.isBot) {
      void runBots(next);
    }
  }, [heroSeat, runBots, sync]);

  const refill = useCallback(() => {
    const nextProgress = requestRefill(opts.identityKey);
    setProgress(nextProgress);
    clearLocalGame(opts.identityKey);
    settledHandRef.current = -1;
    gameRankSettledRef.current = false;
    const game = buildNewGame(nextProgress.chips);
    sync(game);
    setCoachLine('Refilled to 200 chips.');
  }, [buildNewGame, opts.identityKey, sync]);

  const restart = useCallback(() => {
    const s = stateRef.current;
    if (s && s.street !== 'complete') return;
    init(true);
  }, [init]);

  useEffect(() => {
    init(false);
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
    progress,
    rank: rankName(progress.rankPoints),
    pressure: blindPressureForHand(Math.max(1, state?.handNo ?? 1)),
    coachLine,
    actingBot,
    busy,
    heroSeat,
    heroAct,
    nextHand,
    refill,
    restart,
  };
}
