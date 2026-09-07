import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getGuestName, setGuestName } from '../lib/guest';
import { useLiminalIdentity } from '../hooks/useLiminalIdentity';
import {
  loginLiminalAccount,
  signupLiminalAccount,
  signOutLiminalAccount,
} from '../lib/liminalAccount';
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
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authConfirm, setAuthConfirm] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const progress = useMemo(() => loadProgress(identity.identityKey), [identity.identityKey]);

  const saveName = () => {
    if (!identity.account) setGuestName(name);
  };

  const switchAuthMode = (mode: 'login' | 'signup') => {
    setAuthMode(mode);
    setAuthError(null);
    setAuthPassword('');
    setAuthConfirm('');
  };

  const handleAuth = async (event: FormEvent) => {
    event.preventDefault();
    if (authBusy) return;
    setAuthError(null);
    setAuthBusy(true);
    try {
      if (authMode === 'signup') {
        if (authPassword !== authConfirm) throw new Error('Passwords do not match.');
        await signupLiminalAccount(authUsername, authDisplayName, authPassword);
      } else {
        await loginLiminalAccount(authUsername, authPassword);
      }
      setAuthPassword('');
      setAuthConfirm('');
      await identity.refresh();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    signOutLiminalAccount();
    await identity.refresh();
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
          <h2>Your Liminal account</h2>
          {identity.loading ? (
            <p className={styles.muted}>Checking Liminal account…</p>
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
              <div className={economy.accountActions}>
                <button type="button" className={styles.secondary} onClick={() => void signOut()}>
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <p className={styles.muted}>
                Sign in here with the same Liminal account Chat uses, or create one without leaving Poker.
              </p>
              <div className={economy.authTabs}>
                <button
                  type="button"
                  className={`${economy.authTab} ${authMode === 'login' ? economy.authTabActive : ''}`}
                  onClick={() => switchAuthMode('login')}
                >
                  Log in
                </button>
                <button
                  type="button"
                  className={`${economy.authTab} ${authMode === 'signup' ? economy.authTabActive : ''}`}
                  onClick={() => switchAuthMode('signup')}
                >
                  Sign up
                </button>
              </div>
              <form className={economy.authForm} onSubmit={handleAuth}>
                {authMode === 'signup' && (
                  <label className={styles.field}>
                    Display name
                    <input
                      className={styles.textInput}
                      value={authDisplayName}
                      maxLength={40}
                      autoComplete="name"
                      onChange={(e) => setAuthDisplayName(e.target.value)}
                    />
                  </label>
                )}
                <label className={styles.field}>
                  Username
                  <input
                    className={styles.textInput}
                    value={authUsername}
                    maxLength={20}
                    autoCapitalize="none"
                    autoCorrect="off"
                    autoComplete="username"
                    spellCheck={false}
                    onChange={(e) => setAuthUsername(e.target.value)}
                  />
                </label>
                <label className={styles.field}>
                  Password
                  <input
                    className={styles.textInput}
                    type="password"
                    value={authPassword}
                    minLength={authMode === 'signup' ? 6 : undefined}
                    autoComplete={authMode === 'signup' ? 'new-password' : 'current-password'}
                    onChange={(e) => setAuthPassword(e.target.value)}
                  />
                </label>
                {authMode === 'signup' && (
                  <label className={styles.field}>
                    Confirm password
                    <input
                      className={styles.textInput}
                      type="password"
                      value={authConfirm}
                      minLength={6}
                      autoComplete="new-password"
                      onChange={(e) => setAuthConfirm(e.target.value)}
                    />
                  </label>
                )}
                {authError && <p className={economy.authError}>{authError}</p>}
                <button className={styles.primary} type="submit" disabled={authBusy}>
                  {authBusy ? 'Working…' : authMode === 'signup' ? 'Create Liminal account' : 'Log in'}
                </button>
              </form>
              <p className={economy.accountNote}>
                Guest play still works on this browser, but Liminal identity, name, PFP, and future account economy features use the account above.
              </p>
              <label className={styles.field}>
                Guest display name
                <input
                  className={styles.textInput}
                  value={name}
                  maxLength={20}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={saveName}
                />
              </label>
              <div className={economy.identityStats}>
                <span><b>{progress.chips}</b> guest chips</span>
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
