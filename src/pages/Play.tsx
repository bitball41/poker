import { Link, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useBotGame } from '../hooks/useBotGame';
import { useLiminalIdentity } from '../hooks/useLiminalIdentity';
import { PokerTable } from '../components/Table/PokerTable';
import styles from './pages.module.css';
import economy from './economy.module.css';

function finiteInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

export function Play() {
  const [params] = useSearchParams();
  const seats = finiteInt(params.get('seats'), 6, 2, 9);
  const identity = useLiminalIdentity();
  const {
    state,
    progress,
    rank,
    pressure,
    coachLine,
    actingBot,
    heroSeat,
    heroAct,
    nextHand,
    refill,
    restart,
  } = useBotGame({
    seats,
    identityKey: identity.identityKey,
    playerId: identity.playerId,
    playerName: identity.displayName,
    enabled: !identity.loading,
  });

  const heroAlive = state?.seats[heroSeat]?.stack > 0;
  const playersAlive = state?.seats.filter((s) => !s.sittingOut && s.stack > 0).length ?? 0;
  const canRefill = !identity.loading && progress.chips <= 0 && (!state || !heroAlive);

  return (
    <motion.div
      className={`${styles.page} ${styles.playPage}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <nav className={styles.playNav}>
        <Link to="/" className={styles.backChevron} aria-label="Back">
          ‹
        </Link>
        <button
          type="button"
          className={styles.restartTiny}
          disabled={!state || state.street !== 'complete' || progress.chips <= 0}
          onClick={() => {
            if (window.confirm('Start a fresh table with your current persistent chip balance?')) restart();
          }}
        >
          New table
        </button>
      </nav>

      {identity.loading ? (
        <div className={styles.empty}>Loading Liminal account…</div>
      ) : !state ? (
        <div className={economy.bankruptCard}>
          <div className={economy.bankruptTitle}>You&apos;re out of chips.</div>
          <div className={styles.muted}>Your original balance was 400. Refills are 200 fake chips.</div>
          <button type="button" className={styles.primary} disabled={!canRefill} onClick={refill}>
            Refill 200
          </button>
        </div>
      ) : (
        <>
          <PokerTable
            state={state}
            heroSeat={heroSeat}
            coachLine={coachLine}
            actingBot={actingBot}
            heroAvatarUrl={identity.pfp}
            rankLabel={`${rank} · ${progress.rankPoints}`}
            pressure={pressure}
            onAct={heroAct}
          />
          {state.street === 'complete' && heroAlive && playersAlive >= 2 && (
            <div className={styles.afterHandActions}>
              <button type="button" className={styles.primary} onClick={nextHand}>
                Next hand
              </button>
            </div>
          )}
          {state.street === 'complete' && !heroAlive && (
            <div className={styles.afterHandActions}>
              <button type="button" className={styles.primary} disabled={!canRefill} onClick={refill}>
                Refill 200
              </button>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
