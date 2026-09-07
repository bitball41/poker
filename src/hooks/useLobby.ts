import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameState } from '../types/poker';
import { supabase, supabaseConfigured, supabaseRealtime } from '../lib/supabase';
import { getGuestId, getGuestName } from '../lib/guest';
import {
  createGame, sitPlayer, startHand, applyAction, getLegalActions,
} from '../engine/game';
import { decideAction, thinkDelay, delay, pickPersonas } from '../bots';
import type { ActionType } from '../types/poker';

function randomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export interface LobbyMeta {
  code: string;
  hostId: string;
  maxSeats: number;
  smallBlind: number;
  bigBlind: number;
  buyIn: number;
  fillWithBots: boolean;
  status: string;
}

/**
 * Private lobby: host-authoritative. State synced via Realtime broadcast
 * and optionally persisted to poker.hands.state jsonb.
 * Falls back to local-only if Supabase is unreachable.
 */
export function useLobby(code: string | undefined, isHostCreate?: {
  maxSeats: number;
  buyIn: number;
  smallBlind: number;
  bigBlind: number;
  fillWithBots: boolean;
}) {
  const [meta, setMeta] = useState<LobbyMeta | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabaseRealtime>['channel']> | null>(null);
  const stateRef = useRef<GameState | null>(null);
  const lock = useRef(false);

  const broadcast = useCallback((s: GameState, m?: LobbyMeta) => {
    stateRef.current = s;
    setState(s);
    const ch = channelRef.current;
    if (ch) {
      void ch.send({
        type: 'broadcast',
        event: 'game',
        payload: { state: s, meta: m ?? meta },
      });
    }
  }, [meta]);

  const setupLocal = useCallback((c: string, host: boolean, cfg: {
    maxSeats: number; buyIn: number; smallBlind: number; bigBlind: number; fillWithBots: boolean;
  }) => {
    const guestId = getGuestId();
    const m: LobbyMeta = {
      code: c,
      hostId: guestId,
      maxSeats: cfg.maxSeats,
      smallBlind: cfg.smallBlind,
      bigBlind: cfg.bigBlind,
      buyIn: cfg.buyIn,
      fillWithBots: cfg.fillWithBots,
      status: 'playing',
    };
    setMeta(m);
    setIsHost(host);
    let g = createGame({
      smallBlind: cfg.smallBlind,
      bigBlind: cfg.bigBlind,
      maxSeats: cfg.maxSeats,
    });
    g = sitPlayer(g, 0, {
      playerId: guestId,
      name: getGuestName(),
      stack: cfg.buyIn,
    });
    if (cfg.fillWithBots) {
      const bots = pickPersonas(cfg.maxSeats - 1);
      for (let i = 1; i < cfg.maxSeats; i++) {
        const p = bots[i - 1];
        g = sitPlayer(g, i, {
          playerId: `bot-${p.id}`,
          name: p.name,
          stack: cfg.buyIn,
          isBot: true,
          botPersona: p.id,
        });
      }
    }
    g = startHand(g);
    broadcast(g, m);
  }, [broadcast]);

  useEffect(() => {
    if (!code && !isHostCreate) return;
    const c = (code ?? randomCode()).toUpperCase();
    const cfg = isHostCreate ?? {
      maxSeats: 6, buyIn: 10000, smallBlind: 50, bigBlind: 100, fillWithBots: true,
    };

    let cancelled = false;

    async function boot() {
      if (!supabaseConfigured || !supabase || !supabaseRealtime) {
        setupLocal(c, true, cfg);
        setError('Supabase not configured — playing local lobby with bots.');
        return;
      }

      try {
        // Ensure player row
        const guestId = getGuestId();
        await supabase.from('players').upsert({
          id: guestId,
          display_name: getGuestName(),
        });

        if (isHostCreate) {
          const { data: lobby, error: lobErr } = await supabase
            .from('lobbies')
            .insert({
              code: c,
              host_id: guestId,
              status: 'waiting',
              max_seats: cfg.maxSeats,
              small_blind: cfg.smallBlind,
              big_blind: cfg.bigBlind,
              buy_in: cfg.buyIn,
              fill_with_bots: cfg.fillWithBots,
            })
            .select()
            .single();
          if (lobErr) throw lobErr;

          // seats
          const seats = [];
          seats.push({
            lobby_id: lobby.id,
            seat_index: 0,
            player_id: guestId,
            is_bot: false,
            stack: cfg.buyIn,
          });
          if (cfg.fillWithBots) {
            const bots = pickPersonas(cfg.maxSeats - 1);
            for (let i = 1; i < cfg.maxSeats; i++) {
              seats.push({
                lobby_id: lobby.id,
                seat_index: i,
                player_id: null,
                is_bot: true,
                bot_persona: bots[i - 1].id,
                stack: cfg.buyIn,
              });
            }
          }
          await supabase.from('lobby_seats').insert(seats);
          if (cancelled) return;
          setIsHost(true);
          setupLocal(c, true, cfg);
        } else {
          const { data: lobby, error: findErr } = await supabase
            .from('lobbies')
            .select('*')
            .eq('code', c)
            .maybeSingle();
          if (findErr) throw findErr;
          if (!lobby) {
            setError(`Lobby ${c} not found. Starting local practice table instead.`);
            setupLocal(c, true, cfg);
            return;
          }
          setIsHost(lobby.host_id === guestId);
          setMeta({
            code: lobby.code,
            hostId: lobby.host_id,
            maxSeats: lobby.max_seats,
            smallBlind: lobby.small_blind,
            bigBlind: lobby.big_blind,
            buyIn: lobby.buy_in,
            fillWithBots: lobby.fill_with_bots,
            status: lobby.status,
          });
          // Join empty human seat if any
          const { data: seats } = await supabase
            .from('lobby_seats')
            .select('*')
            .eq('lobby_id', lobby.id);
          const empty = seats?.find((s: any) => !s.is_bot && !s.player_id);
          if (empty) {
            await supabase.from('lobby_seats').update({ player_id: guestId, stack: lobby.buy_in }).eq('lobby_id', lobby.id).eq('seat_index', empty.seat_index);
          }
          setupLocal(c, lobby.host_id === guestId, {
            maxSeats: lobby.max_seats,
            buyIn: lobby.buy_in,
            smallBlind: lobby.small_blind,
            bigBlind: lobby.big_blind,
            fillWithBots: lobby.fill_with_bots,
          });
        }

        const ch = supabaseRealtime.channel(`lobby:${c}`);
        ch.on('broadcast', { event: 'game' }, ({ payload }: any) => {
          if (payload?.state) {
            stateRef.current = payload.state as GameState;
            setState(payload.state as GameState);
          }
          if (payload?.meta) setMeta(payload.meta as LobbyMeta);
        });
        await ch.subscribe();
        channelRef.current = ch;
      } catch (e) {
        console.warn(e);
        setError(`Realtime/DB issue — local host mode. (${String(e)})`);
        setupLocal(c, true, cfg);
      }
    }

    void boot();
    return () => {
      cancelled = true;
      if (channelRef.current && supabaseRealtime) {
        void supabaseRealtime.removeChannel(channelRef.current);
      }
    };
  }, [code]); // intentionally sparse deps

  const runHostBots = useCallback(async (start: GameState) => {
    if (!isHost || lock.current) return;
    lock.current = true;
    let s = start;
    try {
      while (s.currentSeat != null && s.street !== 'complete' && s.seats[s.currentSeat]?.isBot) {
        const seat = s.seats[s.currentSeat];
        const legal = getLegalActions(s);
        if (!legal.length) break;
        const decision = decideAction(s, seat.seatIndex, seat.botPersona ?? 'mira', legal);
        await delay(thinkDelay(seat.botPersona ?? 'mira', decision));
        s = applyAction(s, decision.type, decision.amount);
        broadcast(s);
      }
      if (s.street === 'complete') {
        await delay(2000);
        if (s.seats.filter((x) => x.stack > 0 && !x.sittingOut).length >= 2) {
          s = startHand(s);
          broadcast(s);
          lock.current = false;
          void runHostBots(s);
          return;
        }
      }
    } finally {
      lock.current = false;
    }
  }, [isHost, broadcast]);

  useEffect(() => {
    if (!state || !isHost) return;
    if (state.currentSeat != null && state.seats[state.currentSeat]?.isBot) {
      void runHostBots(state);
    }
  }, [state?.currentSeat, state?.handNo, isHost]);

  const heroSeat = 0;
  const heroAct = useCallback((type: ActionType, amount?: number) => {
    const s = stateRef.current;
    if (!s || s.currentSeat !== heroSeat) return;
    try {
      const next = applyAction(s, type, amount);
      broadcast(next);
      void runHostBots(next);
    } catch (e) {
      setError(String(e));
    }
  }, [broadcast, runHostBots]);

  return { meta, state, error, isHost, heroSeat, heroAct, supabaseConfigured };
}
