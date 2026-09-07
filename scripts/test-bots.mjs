/**
 * Simple Node test script for hand ranking + a few decision cases.
 * Run: node scripts/test-bots.mjs
 * (Uses dynamic import of compiled-ish TS via vite-node if available, else inline checks)
 */

import { createRequire } from 'module';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

// Prefer vitest if configured; otherwise run tsx/vite-node, else transpile-free duplicate asserts via npx tsx
function run() {
  // Try npx tsx on a TS test file
  const tsTest = path.join(root, 'scripts/test-bots.ts');
  if (!fs.existsSync(tsTest)) {
    console.error('Missing scripts/test-bots.ts');
    process.exit(1);
  }
  const r = spawnSync('npx', ['--yes', 'tsx', tsTest], { cwd: root, stdio: 'inherit', shell: false });
  process.exit(r.status ?? 1);
}

run();
