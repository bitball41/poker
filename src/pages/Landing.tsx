import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getGuestName, setGuestName } from '../lib/guest';
import { useLiminalIdentity } from '../hooks/useLiminalIdentity';
import { loadProgress, rankName } from '../economy/progress';
import styles from './pages.module.css';
import economy from './economy.module.css';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeLobbyCode(): string {
  const bytes = new Uint8Array(6);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export function Landing() {
  const nav = useNavigate();
  const identity = useLiminalIdentity();
  const [code, setCode] = useState('');
  const [seats, setSeats] = useState(6);
  const [fillBots, setFillBots] = useState(true);
  const [name, setName] = useState(() => getGuestName());
  const progress = useMemo(() => loadProgress(identity.identityKey), [identity.identityKey]);

  const saveName = () => {
    if (!identity.account) setGuestName(name);
  };

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
          No-Limit Hold&apos;em with persistent fake chips, ranked progress, smart bots, or friends. No real money.
        </p>
      </motion.header>

      <motion.section
        className={styles.actions}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
      >
        <div className={styles.card}>
          <h2>Your Liminal identity</h2>
          {identity.loading ? (
            <p className={styles.muted}>Checking Liminal Chat account…</p>
          ) : identity.account ? (
            <>
              <div className={economy.identityLine}>
                {identity.pfp ? (
                  <img className={economy.identityAvatar} src={identity.pfp} alt="" />
                ) : (
                  <div className={economy.identityAvatarFallback}>{identity.displayName.slice(0, 1).toUpperCase()}</div>
                )}
                <div>
                  <strong>{identity.displayName}</strong>
                  <div className={styles.muted}>@{identity.account.username} · Liminal account</div>
                </div>
              </div>
              <div className={economy.identityStats}>
                <span><b>{progress.chips}</b> chips</span>
                <span><b>{rankName(progress.rankPoints)}</b> · {progress.rankPoints}</span>
              </div>
            </>
          ) : (
            <>
              <p className={styles.muted}>No Liminal Chat session found. Standalone guest mode still works.</p>
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
              <div className={economy.identityStats}>
                <span><b>{progress.chips}</b> chips</span>
                <span><b>{rankName(progress.rankPoints)}</b> · {progress.rankPoints}</span>
              </div>
            </>
          )}
        </div>

        <div className={styles.card}>
          <h2>Hold&apos;em vs Bots</h2>
          <p className={styles.muted}>
            First balance is 400 fake chips. Busting unlocks a 200-chip refill. Blinds rise every few hands and your stack persists.
          </p>
          <label className={styles.field}>
            Table size
            <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
              {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                <option key={n} value={n}>{n}-max</option>
              ))}
            </select>
          </label>
          <div className={economy.fixedStack}>Your stack: <b>{progress.chips}</b> chips</div>
          <button
            className={styles.primary}
            disabled={identity.loading}
            onClick={() => {
              saveName();
              nav(`/play?seats=${seats}`);
            }}
          >
            Sit &amp; Play
          </button>
        </div>

        <div className={styles.card}>
          <h2>Private Lobby</h2>
          <p className={styles.muted}>Invite-code friends mode with a waiting room and reconnect support.</p>
          <label className={styles.checkboxField}>
            <input type="checkbox" checked={fillBots} onChange={(e) => setFillBots(e.target.checked)} />
            Fill empty seats with bots when the host starts
          </label>
          <button
            className={styles.secondary}
            disabled={identity.loading}
            onClick={() => {
              saveName();
              nav(`/lobby/${makeLobbyCode()}?host=1&seats=${seats}&buyIn=400&bots=${fillBots ? 1 : 0}`);
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
              disabled={code.length !== 6 || identity.loading}
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
          <p className={styles.muted}>Dealer bot + optional basic-strategy coach. Fake chips only.</p>
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
        <span>No purchases, cash-outs, or real-world value.</span>
      </footer>
    </div>
  );
}
