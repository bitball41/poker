const KEY = 'liminal_sfx';

export type Sfx = 'tap' | 'fold' | 'check' | 'call' | 'raise' | 'deal' | 'win' | 'lose' | 'bust';

export function sfxEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0';
  } catch {
    return true;
  }
}

export function setSfxEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  const AC = globalThis.AudioContext ?? (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(
  ac: AudioContext,
  freq: number,
  when: number,
  dur: number,
  type: OscillatorType,
  vol: number,
): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, when);
  gain.gain.setValueAtTime(Math.max(0.0001, vol), when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  osc.connect(gain);
  gain.connect(ac.destination);
  osc.start(when);
  osc.stop(when + dur + 0.02);
}

export function playSfx(kind: Sfx): void {
  if (!sfxEnabled()) return;
  try {
    const ac = audio();
    if (!ac) return;
    const t = ac.currentTime;
    switch (kind) {
      case 'tap':
        tone(ac, 540, t, 0.05, 'sine', 0.05);
        break;
      case 'fold':
        tone(ac, 196, t, 0.14, 'triangle', 0.05);
        break;
      case 'check':
        tone(ac, 440, t, 0.07, 'sine', 0.045);
        break;
      case 'call':
        tone(ac, 392, t, 0.08, 'sine', 0.05);
        break;
      case 'raise':
        tone(ac, 587, t, 0.08, 'square', 0.03);
        tone(ac, 784, t + 0.07, 0.1, 'square', 0.028);
        break;
      case 'deal':
        tone(ac, 880, t, 0.04, 'sine', 0.035);
        break;
      case 'win':
        tone(ac, 523, t, 0.11, 'sine', 0.06);
        tone(ac, 659, t + 0.1, 0.11, 'sine', 0.06);
        tone(ac, 784, t + 0.2, 0.16, 'sine', 0.07);
        break;
      case 'lose':
        tone(ac, 220, t, 0.18, 'sine', 0.045);
        tone(ac, 174, t + 0.08, 0.2, 'triangle', 0.04);
        break;
      case 'bust':
        tone(ac, 130, t, 0.22, 'triangle', 0.05);
        break;
      default:
        break;
    }
  } catch {
    /* autoplay / missing Web Audio */
  }
}

export function sfxForAction(type: string): Sfx {
  if (type === 'fold') return 'fold';
  if (type === 'check') return 'check';
  if (type === 'call') return 'call';
  if (type === 'bet' || type === 'raise' || type === 'all-in') return 'raise';
  return 'tap';
}
