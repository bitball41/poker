import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value == null) throw new Error(`Missing value for --${name}`);
  return value;
}

const hands = Math.max(1, Number(arg('hands', '50000')));
const workers = Math.max(1, Math.min(16, Number(arg('workers', String(Math.max(1, Math.min(8, os.cpus().length - 2)))))));
const seed = Math.max(1, Number(arg('seed', '1337')));
const seats = Number(arg('seats', '0'));
const outDir = path.resolve(arg('out', 'training/data/bootstrap'));

fs.mkdirSync(outDir, { recursive: true });
for (const file of fs.readdirSync(outDir)) {
  if (file.endsWith('.bin')) fs.rmSync(path.join(outDir, file));
}

const perWorker = Math.floor(hands / workers);
let remainder = hands % workers;
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function runWorker(worker) {
  const workerHands = perWorker + (remainder-- > 0 ? 1 : 0);
  if (workerHands <= 0) return Promise.resolve();
  const out = path.join(outDir, `part-${worker}.bin`);
  console.log(`[train] worker ${worker}: ${workerHands} hands -> ${out}`);

  return new Promise((resolve, reject) => {
    const child = spawn(
      npm,
      ['exec', '--', 'vitest', 'run', 'training/generateDataset.test.ts'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          TRAIN_GENERATE: '1',
          TRAIN_HANDS: String(workerHands),
          TRAIN_WORKER: String(worker),
          TRAIN_SEED: String(seed),
          TRAIN_OUT: out,
          ...(seats >= 2 && seats <= 9 ? { TRAIN_SEATS: String(Math.floor(seats)) } : {}),
        },
      },
    );
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`worker ${worker} exited ${code}`)));
  });
}

await Promise.all(Array.from({ length: workers }, (_, worker) => runWorker(worker)));
console.log(`\n[train] bootstrap generation finished: ${hands} hands across ${workers} CPU workers.`);
console.log(`[train] shards: ${outDir}`);
console.log('[train] next: python training/train.py --data training/data/bootstrap --out training/out/policy-v1.json');
