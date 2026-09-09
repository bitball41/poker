import { useEffect } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useLobby } from '../hooks/useLobby';
import { useLiminalIdentity } from '../hooks/useLiminalIdentity';
import { setGuestName } from '../lib/guest';
import { SoundToggle } from '../components/SoundToggle';
import { PokerTable } from '../components/Table/PokerTable';
import styles from './pages.module.css';

function finiteInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function Lobby() {
  const { code } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const identity = useLiminalIdentity();
  const isCreate = params.get('host') === '1';
  const seatsWanted = finiteInt(params.get('seats'), 6, 2, 9);
  const buyIn = finiteInt(params.get('buyIn'), 400, 100, 1_000_000);
  const fillBots = params.get('bots') !== '0';

  // useLobby already sends the guest display name to the secure RPCs. Mirror the
  // verified Liminal display name into that compatibility slot before joining.
  useEffect(() => {
    if (!identity.loading) setGuestName(identity.displayName);
  }, [identity.displayName, identity.loading]);

  const lobby = useLobby(
    identity.loading ? '' : code?.toUpperCase(),
    isCreate
      ? {
          maxSeats: seatsWanted,
          buyIn,
          smallBlind: 2,
          bigBlind: 4,
          fillWithBots: fillBots,
        }
      : undefined,
  );

  const leave = async () => {
    await lobby.leaveLobby();
    navigate('/');
  };

  const copyCode = async () => {
    const value = lobby.meta?.code ?? code ?? '';
    try { await navigator.clipboard.writeText(value); } catch { /* clipboard may be unavailable */ }
  };

  const humanSeats = lobby.seats.filter((s) => !s.isBot && s.playerId);
  const canStart = Boolean(
    lobby.isHost &&
    lobby.meta?.status === 'waiting' &&
    lobby.everyoneReady &&
    (humanSeats.length >= 2 || lobby.meta?.fillWithBots),
  );

  return (
    <motion.div className={styles.page} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <nav className={styles.topNav}>
        <button type="button" className={styles.brandButton} onClick={() => void leave()}>
          <span className={styles.liminalSm}>Liminal</span> Poker
        </button>
        <div className={styles.topActions}>
          <SoundToggle className={styles.ghost} />
          <button type="button" className={styles.codeBadgeButton} onClick={() => void copyCode()} title="Copy lobby code">
            {lobby.meta?.code ?? code}
          </button>
          <span className={styles.connectionBadge}>{identity.loading ? 'identity' : lobby.connection}</span>
          <button type="button" className={styles.ghost} onClick={() => void leave()}>Leave</button>
        </div>
      </nav>

      {lobby.error && <div className={styles.banner}>{lobby.error}</div>}
      {!lobby.supabaseConfigured && (
        <div className={styles.banner}>Friends mode needs Supabase. Bot practice still works offline.</div>
      )}

      {identity.loading ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>One second</div>
          <p className={styles.muted}>Loading your name.</p>
        </div>
      ) : !lobby.supabaseConfigured ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>Friends mode is empty</div>
          <p className={styles.muted}>This build has no Supabase. Bot practice on the home screen still works.</p>
        </div>
      ) : !lobby.meta ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>Empty lobby</div>
          <p className={styles.muted}>Connecting…</p>
        </div>
      ) : lobby.meta.status === 'waiting' ? (
        <section className={styles.waitingRoom}>
          <div className={styles.waitingHeader}>
            <div>
              <h1>Waiting room</h1>
              <p className={styles.muted}>
                {lobby.meta.maxSeats}-max · {lobby.meta.smallBlind}/{lobby.meta.bigBlind} blinds · {lobby.meta.buyIn.toLocaleString()} fake chips
              </p>
            </div>
            <button type="button" className={styles.secondary} onClick={() => void copyCode()}>
              Copy {lobby.meta.code}
            </button>
          </div>

          <div className={styles.playerList}>
            {Array.from({ length: lobby.meta.maxSeats }, (_, seatIndex) => {
              const seat = lobby.seats.find((s) => s.seatIndex === seatIndex);
              if (!seat) {
                return (
                  <div key={seatIndex} className={`${styles.playerRow} ${styles.emptySeat}`}>
                    <span>Empty seat {seatIndex + 1}</span>
                    <span>{lobby.meta?.fillWithBots ? 'bot later' : 'open'}</span>
                  </div>
                );
              }
              const host = seat.playerId === lobby.meta?.hostId;
              const me = seat.seatIndex === lobby.heroSeat;
              return (
                <div key={seatIndex} className={styles.playerRow}>
                  <div>
                    <strong>{seat.displayName}{me ? ' (you)' : ''}</strong>
                    <span className={styles.seatMeta}>Seat {seatIndex + 1}{host ? ' · Host' : ''}</span>
                  </div>
                  <div className={styles.playerRowActions}>
                    <span className={seat.ready || host ? styles.ready : styles.notReady}>
                      {seat.ready || host ? 'Ready' : 'Not ready'}
                    </span>
                    {lobby.isHost && !host && seat.playerId && (
                      <button type="button" className={styles.kickButton} onClick={() => void lobby.kickPlayer(seat.playerId!)}>
                        Kick
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className={styles.waitingActions}>
            {!lobby.isHost && (
              <button type="button" className={styles.primary} onClick={() => void lobby.setReady(!lobby.ready)}>
                {lobby.ready ? 'Unready' : 'Ready up'}
              </button>
            )}
            {lobby.isHost && (
              <button type="button" className={styles.primary} disabled={!canStart} onClick={() => void lobby.startGame()}>
                Start game
              </button>
            )}
            {lobby.isHost && !lobby.everyoneReady && humanSeats.length > 1 && (
              <span className={styles.muted}>Waiting for everyone to ready up.</span>
            )}
          </div>
        </section>
      ) : !lobby.state ? (
        <div className={styles.empty}>
          <div className={styles.emptyTitle}>Waiting on the table</div>
          <p className={styles.muted}>No cards yet.</p>
        </div>
      ) : (
        <>
          <PokerTable
            state={lobby.state}
            heroSeat={lobby.heroSeat}
            heroAvatarUrl={identity.pfp}
            coachLine={`Lobby ${lobby.meta.code} · revision ${lobby.revision}${lobby.pendingAction ? ' · sending action…' : ''}`}
            onAct={lobby.heroAct}
          />
          {lobby.state.street === 'complete' && (
            <div className={styles.afterHandActions}>
              {lobby.isHost ? (
                <button type="button" className={styles.primary} onClick={lobby.nextHand}>Next hand</button>
              ) : (
                <span className={styles.muted}>Waiting for the host to deal the next hand.</span>
              )}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
