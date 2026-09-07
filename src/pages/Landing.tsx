import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getGuestName, setGuestName } from '../lib/guest';
import styles from './pages.module.css';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeLobbyCode(): string {
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export function Landing() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [seats, setSeats] = useState(6);
  const [buyIn, setBuyIn] = useState(10000);
  const [fillBots, setFillBots] = useState(true);
  const [name, setName] = useState(() => getGuestName());

  const saveName = () => setGuestName(name);

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
          Practice No-Limit Hold&apos;em with smart bots or friends. Also Blackjack. Fake chips only.
        </p>
      </motion.header>

      <motion.section
        className={styles.actions}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
      >
        <div className={styles.card}>
          <h2>Your table identity</h2>
          <p className={styles.muted}>Used in bot practice and private lobbies.</p>
          <label className={styles.field}>
            Display name
            <input
              className={styles.textInput}
              value={name}
              maxLength={20}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
            />
          </label>
        </div>

        <div className={styles.card}>
          <h2>Hold&apos;em vs Bots</h2>
          <p className={styles.muted}>Primary practice mode. Works offline. Opponents stay the same for the whole game.</p>
          <label className={styles.field}>
            Table size
            <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
              {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
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
            onClick={() => {
              saveName();
              nav(`/play?seats=${seats}&buyIn=${buyIn}`);
            }}
          >
            Sit &amp; Play
          </button>
        </div>

        <div className={styles.card}>
          <h2>Private Lobby</h2>
          <p className={styles.muted}>Invite-code friends mode with a real waiting room and reconnect support.</p>
          <label className={styles.checkboxField}>
            <input type="checkbox" checked={fillBots} onChange={(e) => setFillBots(e.target.checked)} />
            Fill empty seats with bots when the host starts
          </label>
          <button
            className={styles.secondary}
            onClick={() => {
              saveName();
              nav(`/lobby/${makeLobbyCode()}?host=1&seats=${seats}&buyIn=${buyIn}&bots=${fillBots ? 1 : 0}`);
            }}
          >
            Create Lobby
          </button>
          <div className={styles.joinRow}>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="CODE"
              maxLength={6}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
            />
            <button
              className={styles.secondary}
              disabled={code.length !== 6}
              onClick={() => {
                saveName();
                nav(`/lobby/${code}`);
              }}
            >
              Join
            </button>
          </div>
        </div>

        <div className={styles.card}>
          <h2>Blackjack</h2>
          <p className={styles.muted}>
            Dealer bot (stand all 17s) + optional basic-strategy coach.
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
