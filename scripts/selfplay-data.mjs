import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value == null) throw new Error(`Missing value for --${name}`);
  return value;
}

const hands = Math.max(1, Number(arg('hands', '2000')));
const workers = Math.max(1, Math.min(16, Number(arg('workers', '4'))));
const seed = Math.max(1, Number(arg('seed', '1337')));
const model = path.resolve(arg('model', 'training/out/policy-v1.json'));
const pool = arg('pool', '');
const primaryShare = arg('primary-share', '1');
const outDir = path.resolve(arg('out', 'training/data/selfplay'));
const temperature = arg('temperature', '1.2');
const epsilon = arg('epsilon', '0.05');
const sizeJitter = arg('size-jitter', '0.08');
const require = createRequire(import.meta.url);
const vitestCli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');

if (!fs.existsSync(model)) throw new Error(`Missing self-play policy: ${model}`);
if (path.basename(outDir).startsWith('bootstrap')) {
  throw new Error(`Refusing to wipe teacher bootstrap dir ${outDir}`);
}

fs.mkdirSync(outDir, { recursive: true });
for (const file of fs.readdirSync(outDir)) {
  if (file.endsWith('.bin') || file.endsWith('.stats.json')) fs.rmSync(path.join(outDir, file));
}

const perWorker = Math.floor(hands / workers);
let remainder = hands % workers;
const started = Date.now();

function runWorker(worker) {
  const workerHands = perWorker + (remainder-- > 0 ? 1 : 0);
  if (workerHands <= 0) return Promise.resolve();
  const out = path.join(outDir, `part-${worker}.bin`);
  console.log(`[selfplay] worker ${worker}: ${workerHands} hands -> ${out}`);

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [vitestCli, 'run', 'training/selfplay/generateDataset.test.ts', '--maxWorkers=1', '--fileParallelism=false', '--no-cache'],
      {
        stdio: 'inherit',
        env: {
          ...process.env,
          SELFPLAY_GENERATE: '1',
          SELFPLAY_HANDS: String(workerHands),
          SELFPLAY_WORKER: String(worker),
          SELFPLAY_SEED: String(seed),
          SELFPLAY_OUT: out,
          SELFPLAY_MODEL: model,
          SELFPLAY_POOL: pool,
          SELFPLAY_PRIMARY_SHARE: String(primaryShare),
          SELFPLAY_TEMPERATURE: String(temperature),
          SELFPLAY_EPSILON: String(epsilon),
          SELFPLAY_SIZE_JITTER: String(sizeJitter),
        },
      },
    );
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`worker ${worker} exited ${code}`))));
  });
}

await Promise.all(Array.from({ length: workers }, (_, worker) => runWorker(worker)));

const elapsedSec = (Date.now() - started) / 1000;
let decisions = 0;
let fallback = 0;
const actionCounts = { fold: 0, check: 0, call: 0, wager: 0, 'all-in': 0 };
const tableCounts = { '2': 0, '3': 0, '6': 0 };
let bytes = 0;
for (const file of fs.readdirSync(outDir)) {
  const full = path.join(outDir, file);
  if (file.endsWith('.bin')) bytes += fs.statSync(full).size;
  if (!file.endsWith('.stats.json')) continue;
  const stats = JSON.parse(fs.readFileSync(full, 'utf8'));
  decisions += stats.decisions ?? 0;
  fallback += stats.fallback ?? 0;
  for (const key of Object.keys(actionCounts)) actionCounts[key] += stats.actionCounts?.[key] ?? 0;
  for (const key of Object.keys(tableCounts)) tableCounts[key] += stats.tableCounts?.[key] ?? 0;
}

const handsPerSec = hands / Math.max(0.001, elapsedSec);
const decisionsPerSec = decisions / Math.max(0.001, elapsedSec);
const summary = {
  hands,
  workers,
  seed,
  model,
  outDir,
  elapsedSec,
  handsPerSec,
  decisionsPerSec,
  decisions,
  fallback,
  bytes,
  tableCounts,
  actionCounts,
  explore: { temperature: Number(temperature), epsilon: Number(epsilon), sizeJitter: Number(sizeJitter) },
  teacherHandsPerSec: 11.81,
  speedupVsTeacher: handsPerSec / 11.81,
};
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));

console.log(`\n[selfplay] finished ${hands} hands in ${elapsedSec.toFixed(1)}s`);
console.log(`[selfplay] ${handsPerSec.toFixed(2)} hands/sec, ${decisionsPerSec.toFixed(1)} decisions/sec`);
console.log(`[selfplay] speedup vs teacher 11.81 h/s: ${summary.speedupVsTeacher.toFixed(1)}x`);
console.log(`[selfplay] tables`, tableCounts, 'actions', actionCounts, 'fallback', fallback);
console.log(`[selfplay] shards: ${outDir} (${(bytes / 1e6).toFixed(1)} MB)`);
console.log('[selfplay] next: npm run selfplay:train');
