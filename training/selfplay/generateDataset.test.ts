import { test } from 'vitest';
import { generateSelfPlayFromEnv } from './generate';

const enabled = process.env.SELFPLAY_GENERATE === '1';

test.skipIf(!enabled)(
  'generate self-play poker training records',
  () => {
    generateSelfPlayFromEnv();
  },
  24 * 60 * 60 * 1000,
);
