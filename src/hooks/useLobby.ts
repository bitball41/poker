import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActionType, Card, GameState } from '../types/poker';
import { supabase, supabaseConfigured, ensureSupabaseUser } from '../lib/supabase';
import { getGuestName } from '../lib/guest';
import {
  createGame, sitPlayer, startHand, applyAction, getLegalActions,
} from '../engine/game';
import { decideAction, thinkDelay, delay, pickPersonas } from '../bots';
import { mergeViewerCards, sanitizePublicState } from '../multiplayer/state';

export interface LobbyMeta {
  id: string;
  code: string;
  hostId: string | null;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  buyIn: number;
  fillWithBots: boolean;
  status: 'waiting' | 'playing' | 'closed';
}

export interface LobbySeatMeta {
  seatIndex: number;
  playerId: string | null;
  displayName: string;
  isBot: boolean;
  stack: number;
  sittingOut: boolean;
  ready: boolean;
  lastSeen: string;
}

interface CreateOptions {
  maxSeats: number;
  buyIn: number;
  smallBlind: number;
  bigBlind: number;
  fillWithBots: boolean;
}

interface LobbySnapshot {
  meta: LobbyMeta;
  seats: LobbySeatMeta[];
  isHost: boolean;
}

function mapLobby(row: any): LobbyMeta {
  return {
    id: row.id,
    code: row.code,
    hostId: row.host_id,
    maxSeats: row.max_seats,
    smallBlind: row.small_blind,
    bigBlind: row.big_blind,
    buyIn: row.buy_in,
    fillWithBots: row.fill_with_bots,
    status: row.status,
  };
}

function mapSeat(row: any): LobbySeatMeta {
  return {
    seatIndex: row.seat_index,
    playerId: row.player_id,
    displayName: row.display_name || `Seat ${row.seat_index + 1}`,
    isBot: !!row.is_bot,
    stack: row.stack,
    sittingOut: !!row.sitting_out,
    ready: !!row.ready,
    lastSeen: row.last_seen,
  };
}

function rowOne(data: any): any {
  return Array.isArray(data) ? data[0] : data;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'message' in error) return String((error as any).message);
  return String(error);
}

function check(result: any): void {
  if (result?.error) throw result.error;
}

function fresh(lastSeen: string, maxAgeMs = 60_000): boolean {
  const t = Date.parse(lastSeen);
  return Number.isFinite(t) && Date.now() - t < maxAgeMs;
}

export function useLobby(code: string = '', isHostCreate?: CreateOptions) {
  const [meta, setMeta] = useState<LobbyMeta | null>(null);
  const [seats, setSeats] = useState<LobbySeatMeta[]>([]);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [heroSeat, setHeroSeat] = useState(-1);
  const [revision, setRevision] = useState(0);
  const [pendingAction, setPendingAction] = useState(false);
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting' | 'offline'>('connecting');

  const createRef = useRef(isHostCreate);
  const metaRef = useRef<LobbyMeta | null>(null);
  const seatsRef = useRef<LobbySeatMeta[]>([]);
  const stateRef = useRef<GameState | null>(null);
  const fullStateRef = useRef<GameState | null>(null);
  const userIdRef = useRef<string | null>(null);
  const lobbyIdRef = useRef<string | null>(null);
  const isHostRef = useRef(false);
  const revisionRef = useRef(0);
  const channelRef = useRef<any>(null);
  const hostQueueRef = useRef<Promise<void>>(Promise.resolve());
  const initializingRef = useRef(false);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setRenderState = useCallback((next: GameState | null) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const renderHostState = useCallback((full: GameState) => {
    const uid = userIdRef.current;
    let visible = sanitizePublicState(full);
    if (uid) {
      const own = full.seats.find((s) => s.playerId === uid)?.holeCards ?? null;
      visible = mergeViewerCards(visible, uid, own);
    }
    setRenderState(visible);
  }, [setRenderState]);

  const loadPrivateCards = useCallback(async (lobbyId: string, handNo: number, uid: string): Promise<Card[] | null> => {
    const result = await supabase
      .from('hole_cards')
      .select('cards')
      .eq('lobby_id', lobbyId)
      .eq('hand_no', handNo)
      .eq('player_id', uid)
      .maybeSingle();
    check(result);
    return (result.data?.cards as Card[] | undefined) ?? null;
  }, []);

  const applyPublicRow = useCallback(async (row: any) => {
    if (!row?.state) return;
    const uid = userIdRef.current;
    const lobbyId = lobbyIdRef.current;
    let visible = row.state as GameState;
    if (uid && lobbyId) {
      try {
        const cards = await loadPrivateCards(lobbyId, row.hand_no, uid);
        visible = mergeViewerCards(visible, uid, cards);
      } catch (e) {
        console.warn('Private cards not ready yet', e);
      }
    }
    revisionRef.current = Number(row.revision ?? 0);
    setRevision(revisionRef.current);
    setPendingAction(false);
    if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
    setRenderState(visible);
  }, [loadPrivateCards, setRenderState]);

  const loadLatestPublic = useCallback(async () => {
    const lobbyId = lobbyIdRef.current;
    if (!lobbyId) return;
    const result = await supabase
      .from('hand_public')
      .select('hand_no,revision,state')
      .eq('lobby_id', lobbyId)
      .maybeSingle();
    check(result);
    if (result.data) await applyPublicRow(result.data);
  }, [applyPublicRow]);

  const persistHostState = useCallback(async (full: GameState, nextRevision: number) => {
    const lobbyId = lobbyIdRef.current;
    const uid = userIdRef.current;
    if (!lobbyId || !uid || !isHostRef.current) throw new Error('Host state cannot be persisted without an active host lobby.');

    const privateWrite = await supabase.from('hands').upsert({
      lobby_id: lobbyId,
      hand_no: full.handNo,
      revision: nextRevision,
      state: full,
    }, { onConflict: 'lobby_id,hand_no' });
    check(privateWrite);

    const cardRows = full.seats
      .filter((s) => !s.isBot && s.playerId && s.holeCards?.length === 2)
      .map((s) => ({
        lobby_id: lobbyId,
        hand_no: full.handNo,
        player_id: s.playerId,
        cards: s.holeCards,
        updated_at: new Date().toISOString(),
      }));
    if (cardRows.length) {
      const cardsWrite = await supabase.from('hole_cards').upsert(cardRows, {
        onConflict: 'lobby_id,hand_no,player_id',
      });
      check(cardsWrite);
    }

    const publicState = sanitizePublicState(full);
    const publicWrite = await supabase.from('hand_public').upsert({
      lobby_id: lobbyId,
      hand_no: full.handNo,
      revision: nextRevision,
      state: publicState,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'lobby_id' });
    check(publicWrite);

    fullStateRef.current = full;
    revisionRef.current = nextRevision;
    setRevision(nextRevision);
    renderHostState(full);
  }, [renderHostState]);

  const refreshLobbyData = useCallback(async (): Promise<LobbySnapshot | null> => {
    const lobbyId = lobbyIdRef.current;
    const uid = userIdRef.current;
    if (!lobbyId || !uid) return null;

    const [lobbyResult, seatsResult] = await Promise.all([
      supabase.from('lobbies').select('*').eq('id', lobbyId).maybeSingle(),
      supabase
        .from('lobby_seats')
        .select('seat_index,player_id,is_bot,stack,sitting_out,display_name,ready,last_seen')
        .eq('lobby_id', lobbyId)
        .order('seat_index'),
    ]);
    check(lobbyResult);
    check(seatsResult);
    if (!lobbyResult.data) {
      setConnection('offline');
      setError('This lobby was closed.');
      return null;
    }

    const nextMeta = mapLobby(lobbyResult.data);
    const nextSeats: LobbySeatMeta[] = (seatsResult.data ?? []).map(mapSeat);
    const nowHost = nextMeta.hostId === uid;
    const wasHost = isHostRef.current;

    metaRef.current = nextMeta;
    seatsRef.current = nextSeats;
    isHostRef.current = nowHost;
    setMeta(nextMeta);
    setSeats(nextSeats);
    setIsHost(nowHost);

    const mine = nextSeats.find((s) => s.playerId === uid);
    if (mine) setHeroSeat(mine.seatIndex);

    if (wasHost && !nowHost) fullStateRef.current = null;
    return { meta: nextMeta, seats: nextSeats, isHost: nowHost };
  }, []);

  const recoverHostState = useCallback(async (): Promise<boolean> => {
    const lobbyId = lobbyIdRef.current;
    if (!lobbyId || !isHostRef.current) return false;
    const result = await supabase
      .from('hands')
      .select('hand_no,revision,state')
      .eq('lobby_id', lobbyId)
      .order('hand_no', { ascending: false })
      .limit(1)
      .maybeSingle();
    check(result);
    if (!result.data?.state) return false;
    const full = result.data.state as GameState;
    fullStateRef.current = full;
    revisionRef.current = Number(result.data.revision ?? 0);
    setRevision(revisionRef.current);
    renderHostState(full);
    return true;
  }, [renderHostState]);

  const initializeHostGame = useCallback(async () => {
    if (initializingRef.current || !isHostRef.current) return;
    const currentMeta = metaRef.current;
    if (!currentMeta || currentMeta.status !== 'playing') return;
    initializingRef.current = true;
    try {
      let game = createGame({
        maxSeats: currentMeta.maxSeats,
        smallBlind: currentMeta.smallBlind,
        bigBlind: currentMeta.bigBlind,
      });
      const occupied = new Set<number>();
      for (const seat of seatsRef.current.filter((s) => !s.isBot && s.playerId)) {
        occupied.add(seat.seatIndex);
        game = sitPlayer(game, seat.seatIndex, {
          playerId: seat.playerId!,
          name: seat.displayName,
          stack: currentMeta.buyIn,
        });
      }

      if (currentMeta.fillWithBots) {
        const empty: number[] = [];
        for (let i = 0; i < currentMeta.maxSeats; i++) if (!occupied.has(i)) empty.push(i);
        const bots = pickPersonas(empty.length);
        empty.forEach((seatIndex, i) => {
          const bot = bots[i];
          game = sitPlayer(game, seatIndex, {
            playerId: `bot-${seatIndex}-${bot.id}`,
            name: bot.name,
            stack: currentMeta.buyIn,
            isBot: true,
            botPersona: bot.id,
          });
        });
      }

      if (game.seats.filter((s) => !s.sittingOut && s.stack > 0).length < 2) {
        throw new Error('Not enough players to start the table.');
      }
      game = startHand(game);
      await persistHostState(game, 1);
    } finally {
      initializingRef.current = false;
    }
  }, [persistHostState]);

  const ensureGameLoaded = useCallback(async (snapshot?: LobbySnapshot | null) => {
    const snap = snapshot ?? await refreshLobbyData();
    if (!snap || snap.meta.status !== 'playing') return;
    if (snap.isHost) {
      if (!fullStateRef.current) {
        const recovered = await recoverHostState();
        if (!recovered) await initializeHostGame();
      }
    } else {
      await loadLatestPublic();
    }
  }, [initializeHostGame, loadLatestPublic, recoverHostState, refreshLobbyData]);

  const runHostBots = useCallback(async (start: GameState, startRevision: number) => {
    let game = start;
    let rev = startRevision;
    while (
      isHostRef.current &&
      game.currentSeat != null &&
      game.street !== 'complete' &&
      game.seats[game.currentSeat]?.isBot
    ) {
      const seat = game.seats[game.currentSeat];
      const legal = getLegalActions(game);
      if (!legal.length) break;
      const decision = decideAction(game, seat.seatIndex, seat.botPersona ?? 'mira', legal);
      await delay(thinkDelay(seat.botPersona ?? 'mira', decision));
      if (!isHostRef.current) return;
      game = applyAction(game, decision.type, decision.amount);
      rev += 1;
      await persistHostState(game, rev);
    }
  }, [persistHostState]);

  const processHostAction = useCallback(async (
    playerId: string,
    type: ActionType,
    amount: number | undefined,
    expectedRevision: number,
  ) => {
    const game = fullStateRef.current;
    if (!game || !isHostRef.current) return;
    if (expectedRevision !== revisionRef.current) return;
    if (game.currentSeat == null) return;
    const acting = game.seats[game.currentSeat];
    if (acting.playerId !== playerId || acting.isBot) return;

    let next = applyAction(game, type, amount);
    let rev = revisionRef.current + 1;
    await persistHostState(next, rev);
    await runHostBots(next, rev);
  }, [persistHostState, runHostBots]);

  const queueHost = useCallback((task: () => Promise<void>) => {
    hostQueueRef.current = hostQueueRef.current
      .then(task)
      .catch((e) => {
        console.error(e);
        setError(messageOf(e));
      });
  }, []);

  const processActionRequest = useCallback((request: any) => {
    if (!isHostRef.current) return;
    queueHost(async () => {
      try {
        await processHostAction(
          request.player_id,
          request.action_type as ActionType,
          request.amount == null ? undefined : Number(request.amount),
          Number(request.revision),
        );
      } finally {
        const del = await supabase.from('action_requests').delete().eq('id', request.id);
        if (del.error) console.warn('Could not clear action request', del.error);
      }
    });
  }, [processHostAction, queueHost]);

  const setupRealtime = useCallback((lobbyId: string) => {
    if (channelRef.current) void supabase.removeChannel(channelRef.current);
    const channel = supabase
      .channel(`poker:${lobbyId}:${userIdRef.current}`)
      .on('postgres_changes', {
        event: '*', schema: 'poker', table: 'lobbies', filter: `id=eq.${lobbyId}`,
      }, async () => {
        try {
          const snap = await refreshLobbyData();
          await ensureGameLoaded(snap);
        } catch (e) {
          setError(messageOf(e));
        }
      })
      .on('postgres_changes', {
        event: '*', schema: 'poker', table: 'lobby_seats', filter: `lobby_id=eq.${lobbyId}`,
      }, async () => {
        try { await refreshLobbyData(); } catch (e) { setError(messageOf(e)); }
      })
      .on('postgres_changes', {
        event: '*', schema: 'poker', table: 'hand_public', filter: `lobby_id=eq.${lobbyId}`,
      }, async ({ new: row }: any) => {
        if (isHostRef.current || !row?.state) return;
        try { await applyPublicRow(row); } catch (e) { setError(messageOf(e)); }
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'poker', table: 'action_requests', filter: `lobby_id=eq.${lobbyId}`,
      }, ({ new: request }: any) => processActionRequest(request))
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') setConnection('connected');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setConnection('reconnecting');
        else if (status === 'CLOSED') setConnection('offline');
      });
    channelRef.current = channel;
  }, [applyPublicRow, ensureGameLoaded, processActionRequest, refreshLobbyData]);

  const setReady = useCallback(async (ready: boolean) => {
    const lobbyId = lobbyIdRef.current;
    if (!lobbyId) return;
    const result = await supabase.rpc('set_lobby_ready', { p_lobby_id: lobbyId, p_ready: ready });
    check(result);
    await refreshLobbyData();
  }, [refreshLobbyData]);

  const kickPlayer = useCallback(async (playerId: string) => {
    const lobbyId = lobbyIdRef.current;
    if (!lobbyId || !isHostRef.current) return;
    const result = await supabase.rpc('kick_lobby_player', {
      p_lobby_id: lobbyId,
      p_player_id: playerId,
    });
    check(result);
    await refreshLobbyData();
  }, [refreshLobbyData]);

  const startGame = useCallback(async () => {
    const lobbyId = lobbyIdRef.current;
    if (!lobbyId || !isHostRef.current) return;
    setError(null);
    const result = await supabase.rpc('start_lobby', { p_lobby_id: lobbyId });
    check(result);
    const snap = await refreshLobbyData();
    await ensureGameLoaded(snap);
    const full = fullStateRef.current;
    if (full) queueHost(async () => runHostBots(full, revisionRef.current));
  }, [ensureGameLoaded, queueHost, refreshLobbyData, runHostBots]);

  const nextHand = useCallback(() => {
    if (!isHostRef.current) return;
    queueHost(async () => {
      const full = fullStateRef.current;
      if (!full || full.street !== 'complete') return;
      const activeHumans = new Set(
        seatsRef.current
          .filter((s) => !s.isBot && s.playerId && fresh(s.lastSeen))
          .map((s) => s.playerId!),
      );
      const prepared: GameState = {
        ...full,
        seats: full.seats.map((s) => {
          if (s.isBot || !s.playerId) return { ...s };
          return { ...s, sittingOut: !activeHumans.has(s.playerId) || s.stack <= 0 };
        }),
      };
      if (prepared.seats.filter((s) => !s.sittingOut && s.stack > 0).length < 2) return;
      const next = startHand(prepared);
      const rev = revisionRef.current + 1;
      await persistHostState(next, rev);
      await runHostBots(next, rev);
    });
  }, [persistHostState, queueHost, runHostBots]);

  const leaveLobby = useCallback(async () => {
    const lobbyId = lobbyIdRef.current;
    if (!lobbyId || !supabase) return;
    try {
      const result = await supabase.rpc('leave_lobby', { p_lobby_id: lobbyId });
      check(result);
    } finally {
      if (channelRef.current) {
        await supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      setConnection('offline');
    }
  }, []);

  const heroAct = useCallback((type: ActionType, amount?: number) => {
    const visible = stateRef.current;
    const uid = userIdRef.current;
    const lobbyId = lobbyIdRef.current;
    if (!visible || !uid || !lobbyId || heroSeat < 0 || pendingAction) return;
    if (visible.currentSeat !== heroSeat || visible.street === 'complete') return;

    setPendingAction(true);
    if (isHostRef.current) {
      queueHost(async () => {
        try {
          await processHostAction(uid, type, amount, revisionRef.current);
        } finally {
          setPendingAction(false);
        }
      });
      return;
    }

    void (async () => {
      try {
        const result = await supabase.from('action_requests').insert({
          lobby_id: lobbyId,
          player_id: uid,
          hand_no: visible.handNo,
          revision: revisionRef.current,
          action_type: type,
          amount: amount == null ? null : Math.floor(amount),
        });
        check(result);
        pendingTimerRef.current = setTimeout(() => setPendingAction(false), 8000);
      } catch (e) {
        setPendingAction(false);
        setError(messageOf(e));
      }
    })();
  }, [heroSeat, pendingAction, processHostAction, queueHost]);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;

    async function boot() {
      if (!supabaseConfigured || !supabase) {
        setConnection('offline');
        setError('Multiplayer requires Supabase. Practice vs bots still works offline.');
        return;
      }
      try {
        const uid = await ensureSupabaseUser();
        if (cancelled) return;
        userIdRef.current = uid;
        const cleanCode = code.toUpperCase().trim();
        const create = createRef.current;
        const rpcResult = create
          ? await supabase.rpc('create_lobby', {
              p_code: cleanCode,
              p_max_seats: create.maxSeats,
              p_small_blind: create.smallBlind,
              p_big_blind: create.bigBlind,
              p_buy_in: create.buyIn,
              p_fill_with_bots: create.fillWithBots,
              p_display_name: getGuestName(),
            })
          : await supabase.rpc('join_lobby', {
              p_code: cleanCode,
              p_display_name: getGuestName(),
            });
        check(rpcResult);
        const joined = rowOne(rpcResult.data);
        if (!joined?.lobby_id) throw new Error('Lobby did not return a room id.');
        lobbyIdRef.current = joined.lobby_id;
        setHeroSeat(Number(joined.seat_index));

        const snap = await refreshLobbyData();
        if (cancelled) return;
        setupRealtime(joined.lobby_id);
        await ensureGameLoaded(snap);

        heartbeat = setInterval(() => {
          void (async () => {
            try {
              const lobbyId = lobbyIdRef.current;
              if (!lobbyId) return;
              check(await supabase.rpc('touch_lobby', { p_lobby_id: lobbyId }));
              let latest = await refreshLobbyData();
              if (!latest) return;

              if (!latest.isHost) {
                const claim = await supabase.rpc('claim_lobby_host', { p_lobby_id: lobbyId });
                check(claim);
                if (claim.data === true) {
                  latest = await refreshLobbyData();
                  await ensureGameLoaded(latest);
                }
              } else if (latest.meta.status === 'playing') {
                const full = fullStateRef.current;
                if (full?.currentSeat != null) {
                  const acting = full.seats[full.currentSeat];
                  if (!acting.isBot && acting.playerId) {
                    const row = latest.seats.find((s) => s.playerId === acting.playerId);
                    if (row && !fresh(row.lastSeen, 45_000)) {
                      queueHost(async () => {
                        const current = fullStateRef.current;
                        if (!current || current.currentSeat == null || current.seats[current.currentSeat].playerId !== acting.playerId) return;
                        const legal = getLegalActions(current);
                        const auto = legal.find((a) => a.type === 'check') ?? legal.find((a) => a.type === 'fold');
                        if (!auto) return;
                        let next = applyAction(current, auto.type);
                        let rev = revisionRef.current + 1;
                        await persistHostState(next, rev);
                        await runHostBots(next, rev);
                      });
                    }
                  }
                }
              }
            } catch (e) {
              console.warn('Lobby heartbeat failed', e);
              setConnection('reconnecting');
            }
          })();
        }, 15_000);
      } catch (e) {
        console.error(e);
        setConnection('offline');
        setError(messageOf(e));
      }
    }

    void boot();
    return () => {
      cancelled = true;
      if (heartbeat) clearInterval(heartbeat);
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      if (channelRef.current && supabase) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [code, ensureGameLoaded, persistHostState, queueHost, refreshLobbyData, runHostBots, setupRealtime]);

  const mySeat = seats.find((s) => s.seatIndex === heroSeat);
  const everyoneReady = seats
    .filter((s) => !s.isBot && s.playerId && s.playerId !== meta?.hostId)
    .every((s) => s.ready);

  return {
    meta,
    seats,
    state,
    error,
    isHost,
    heroSeat,
    heroAct,
    revision,
    pendingAction,
    connection,
    ready: mySeat?.ready ?? false,
    everyoneReady,
    setReady,
    kickPlayer,
    startGame,
    nextHand,
    leaveLobby,
    supabaseConfigured,
  };
}
