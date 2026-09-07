import { Link, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useLobby } from '../hooks/useLobby';
import { PokerTable } from '../components/Table/PokerTable';
import styles from './pages.module.css';

export function Lobby() {
  const { code } = useParams();
  const [params] = useSearchParams();
  const isCreate = params.get('host') === '1';
  const seats = Math.min(6, Math.max(2, Number(params.get('seats') ?? 6)));
  const buyIn = Number(params.get('buyIn') ?? 10000);
  const fillBots = params.get('bots') !== '0';

  const { meta, state, error, heroSeat, heroAct, supabaseConfigured } = useLobby(
    code?.toUpperCase(),
    isCreate
      ? {
          maxSeats: seats,
          buyIn,
          smallBlind: Math.max(25, Math.round(buyIn / 200)),
          bigBlind: Math.max(50, Math.round(buyIn / 100)),
          fillWithBots: fillBots,
        }
      : undefined,
  );

  return (
    <motion.div className={styles.page} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <nav className={styles.topNav}>
        <Link to="/" className={styles.brand}>
          <span className={styles.liminalSm}>Liminal</span> Poker
        </Link>
        <div className={styles.topActions}>
          <span className={styles.codeBadge}>{meta?.code ?? code}</span>
          <Link to="/" className={styles.ghostLink}>Home</Link>
        </div>
      </nav>

      {error && <div className={styles.banner}>{error}</div>}
      {!supabaseConfigured && (
        <div className={styles.banner}>Local mode — Supabase env missing or unreachable.</div>
      )}

      {!state ? (
        <div className={styles.empty}>Connecting lobby…</div>
      ) : (
        <PokerTable
          state={state}
          heroSeat={heroSeat}
          coachLine={`Lobby ${meta?.code ?? code} · practice chips`}
          onAct={heroAct}
        />
      )}
    </motion.div>
  );
}
