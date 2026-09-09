import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getGuestName, setGuestName } from '../lib/guest';
import { useLiminalIdentity } from '../hooks/useLiminalIdentity';
import {
  loginLiminalAccount,
  signupLiminalAccount,
  signOutLiminalAccount,
} from '../lib/liminalAccount';
import { loadProgress, rankName } from '../economy/progress';
import { SoundToggle } from '../components/SoundToggle';
import { playSfx } from '../lib/sound';
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

  const who = identity.account ? identity.displayName : name;
  const initial = (who || '?').slice(0, 1).toUpperCase();
  const broke = progress.chips <= 0;
  const fresh = !broke && progress.gamesPlayed === 0 && progress.chips === 400;

  return (
    <div className={styles.home}>
      <header className={styles.homeBar}>
        <div className={styles.homeBrand}>
          <span className={styles.liminalSm}>Liminal</span>
          <span className={styles.homeBrandSub}>Poker</span>
        </div>
        <div className={styles.homeBarRight}>
          <div className={styles.homeWho}>
            {identity.pfp ? (
              <img className={styles.homeAvatar} src={identity.pfp} alt="" />
            ) : (
              <div className={styles.homeAvatar}>{initial}</div>
            )}
            <div className={styles.homeWhoText}>
              <div className={styles.homeName}>{identity.loading ? '…' : who}</div>
              <div className={styles.homeMeta}>{identity.account ? `@${identity.account.username}` : 'Guest'}</div>
            </div>
          </div>
          <SoundToggle className={styles.homeGhost} />
        </div>
      </header>

      <motion.div
        className={styles.homeShell}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
      >
        <section className={styles.homeMain}>
          <h1 className={styles.homeMark}>Sit down</h1>
          <p className={styles.homeLead}>Hold&apos;em vs bots. Fake chips. Nothing to cash out.</p>

          <div className={styles.homeStats}>
            <div>
              <b>{broke ? '0' : progress.chips}</b>
              <span>chips</span>
            </div>
            <div>
              <b>{rankName(progress.rankPoints)}</b>
              <span>{progress.gamesPlayed === 0 ? `${progress.rankPoints} pts` : `${progress.wins}–${progress.losses}`}</span>
            </div>
          </div>

          {broke && <div className={styles.homeEmpty}>Empty stack. Sit down to refill 200.</div>}
          {fresh && <div className={styles.homeEmpty}>No games yet. First sit is 400 chips.</div>}

          <div className={styles.homePlayRow}>
            <label className={styles.field}>
              Table
              <select value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
                {[2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                  <option key={n} value={n}>{n}-max</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={styles.homePlay}
              disabled={identity.loading}
              onClick={() => {
                saveName();
                playSfx('tap');
                nav(`/play?seats=${seats}`);
              }}
            >
              Sit down
            </button>
          </div>
        </section>

        <aside className={styles.homeSide}>
          <div className={styles.homePanel}>
            <h2>Friends</h2>
            <p className={styles.muted}>Private lobby. Empty seats can fill with bots.</p>
            <label className={styles.checkboxField}>
              <input type="checkbox" checked={fillBots} onChange={(e) => setFillBots(e.target.checked)} />
              Fill empty seats with bots
            </label>
            <button
              type="button"
              className={styles.secondary}
              disabled={identity.loading}
              onClick={() => {
                saveName();
                playSfx('tap');
                nav(`/lobby/${makeLobbyCode()}?host=1&seats=${seats}&buyIn=400&bots=${fillBots ? 1 : 0}`);
              }}
            >
              Create room
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
                aria-label="Lobby code"
              />
              <button
                className={styles.secondary}
                disabled={code.length !== 6 || identity.loading}
                onClick={() => {
                  saveName();
                  playSfx('tap');
                  nav(`/lobby/${code}`);
                }}
              >
                Join
              </button>
            </div>
            {code.length === 0 ? (
              <p className={styles.emptyHint}>No code yet.</p>
            ) : code.length < 6 ? (
              <p className={styles.emptyHint}>{6 - code.length} left</p>
            ) : null}
          </div>

          <div className={styles.homePanel}>
            <h2>Blackjack</h2>
            <p className={styles.muted}>Hit, stand, double. Same fake chips.</p>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                playSfx('tap');
                nav('/blackjack');
              }}
            >
              Open blackjack
            </button>
          </div>

          <div className={styles.homePanel}>
            <h2>Account</h2>
            {identity.loading ? (
              <p className={styles.muted}>Checking account…</p>
            ) : identity.account ? (
              <>
                <p className={styles.muted}>Signed in as @{identity.account.username}.</p>
                <button type="button" className={styles.secondary} onClick={() => void signOut()}>
                  Sign out
                </button>
              </>
            ) : (
              <>
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
                    {authBusy ? 'Working…' : authMode === 'signup' ? 'Create account' : 'Log in'}
                  </button>
                </form>
                <label className={styles.field}>
                  Guest name
                  <input
                    className={styles.textInput}
                    placeholder="Name"
                    value={name}
                    maxLength={20}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={saveName}
                  />
                </label>
              </>
            )}
          </div>
        </aside>
      </motion.div>

      <p className={styles.homeFine}>No purchases, cash-outs, or real-world value.</p>
    </div>
  );
}
