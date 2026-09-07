import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import styles from './pages.module.css';

export function Landing() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [seats, setSeats] = useState(6);
  const [buyIn, setBuyIn] = useState(10000);

  return (
    <div className={styles.page}>
      <motion.header
        className={styles.hero}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45 }}
      >
        <h1 className={styles.wordmark}>
          <span className={styles.liminal}>Liminal</span>{' '}
          <span className={styles.poker}>Poker</span>
        </h1>
        <p className={styles.tagline}>
          Practice No-Limit Hold&apos;em with smart bots. Also Blackjack. Fake chips only.
        </p>
      </motion.header>

      <motion.section
        className={styles.actions}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
      >
        <div className={styles.card}>
          <h2>Hold&apos;em vs Bots</h2>
          <p className={styles.muted}>Primary mode. Works offline. Fresh opponents every hand.</p>
          <label className={styles.field}>
            Table size
            <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
              {[2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>{n}-max</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Buy-in (practice chips)
            <select value={buyIn} onChange={(e) => setBuyIn(Number(e.target.value))}>
              {[5000, 10000, 20000].map((n) => (
                <option key={n} value={n}>{n.toLocaleString()}</option>
              ))}
            </select>
          </label>
          <button
            className={styles.primary}
            onClick={() => nav(`/play?seats=${seats}&buyIn=${buyIn}`)}
          >
            Sit &amp; Play
          </button>
        </div>

        <div className={styles.card}>
          <h2>Private Lobby</h2>
          <p className={styles.muted}>6-char code · optional bot fill · Supabase sync</p>
          <button
            className={styles.secondary}
            onClick={() => {
              const c = Math.random().toString(36).slice(2, 8).toUpperCase();
              nav(`/lobby/${c}?host=1&seats=${seats}&buyIn=${buyIn}&bots=1`);
            }}
          >
            Create Lobby
          </button>
          <div className={styles.joinRow}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="CODE"
              maxLength={6}
            />
            <button
              className={styles.secondary}
              disabled={code.length !== 6}
              onClick={() => nav(`/lobby/${code}`)}
            >
              Join
            </button>
          </div>
        </div>

        <div className={styles.card}>
          <h2>Blackjack</h2>
          <p className={styles.muted}>
            Mode 2 — dealer bot (stand all 17s) + optional basic-strategy coach.
          </p>
          <button className={styles.secondary} onClick={() => nav('/blackjack')}>
            Play Blackjack
          </button>
        </div>
      </motion.section>

      <footer className={styles.footer}>
        <Link to="/play">Hold&apos;em</Link>
        <span>·</span>
        <Link to="/blackjack">Blackjack</Link>
        <span>·</span>
        <span>No real money. Practice chips only.</span>
      </footer>
    </div>
  );
}
