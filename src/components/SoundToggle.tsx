import { useState } from 'react';
import { playSfx, setSfxEnabled, sfxEnabled } from '../lib/sound';

export function SoundToggle({ className }: { className?: string }) {
  const [on, setOn] = useState(() => sfxEnabled());

  return (
    <button
      type="button"
      className={className}
      aria-pressed={on}
      aria-label={on ? 'Mute sounds' : 'Unmute sounds'}
      onClick={() => {
        const next = !on;
        setSfxEnabled(next);
        setOn(next);
        if (next) playSfx('tap');
      }}
    >
      {on ? 'Sound on' : 'Sound off'}
    </button>
  );
}
