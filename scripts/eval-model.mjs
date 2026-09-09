import os from 'node:os';
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

function runVitest(env) {
  const require = createRequire(import.meta.url);
  const vitestCli = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [vitestCli, 'run', 'eval/runEval.test.ts', '--maxWorkers=1', '--fileParallelism=false'],
      { stdio: 'inherit', env: { ...process.env, ...env } },
    );
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`eval process exited ${code}`))));
  });
}

const games = Math.max(1, Number(arg('games', '100')));
const workers = Math.max(1, Math.min(8, Number(arg('workers', String(Math.max(1, Math.min(4, os.cpus().length - 2)))))));
const seed = Math.max(1, Number(arg('seed', '1337')));
const model = path.resolve(arg('model', 'training/out/policy-v1.json'));
const vsModelRaw = arg('vs-model', '');
const hasVsModel = process.argv.includes('--vs-model');
const checkpointRaw = arg('checkpoint', hasVsModel ? '' : 'training/out/policy-epoch-1.json');
const checkpoint = checkpointRaw ? path.resolve(checkpointRaw) : '';
const vsModel = vsModelRaw ? path.resolve(vsModelRaw) : '';
const skipHeuristic = process.argv.includes('--skip-heuristic');
const seats = arg('seats', '2,3,6');
const stack = arg('stack', '400');
const outPath = path.resolve(arg('out', 'training/out/eval-report.json'));
const outDir = path.dirname(outPath);
const partDir = path.join(outDir, 'eval-parts');

if (!fs.existsSync(model)) throw new Error(`Missing ML weights: ${model}`);

fs.mkdirSync(partDir, { recursive: true });
for (const file of fs.readdirSync(partDir)) {
  if (file.endsWith('.json')) fs.rmSync(path.join(partDir, file));
}

console.log(`[eval] games/table=${games} workers=${workers} seats=${seats} model=${model}`);
if (vsModel && fs.existsSync(vsModel)) console.log(`[eval] vs-model opponent=${vsModel}`);
if (checkpoint && fs.existsSync(checkpoint)) console.log(`[eval] checkpoint opponent=${checkpoint}`);

await Promise.all(Array.from({ length: workers }, (_, worker) => {
  console.log(`[eval] worker ${worker}/${workers}`);
  return runVitest({
    EVAL_RUN: '1',
    EVAL_GAMES: String(games),
    EVAL_WORKER: String(worker),
    EVAL_WORKERS: String(workers),
    EVAL_SEED: String(seed),
    EVAL_MODEL: model,
    EVAL_CHECKPOINT: checkpoint && fs.existsSync(checkpoint) ? checkpoint : '',
    EVAL_VS_MODEL: vsModel && fs.existsSync(vsModel) ? vsModel : '',
    EVAL_SKIP_HEURISTIC: skipHeuristic ? '1' : '',
    EVAL_SEATS: seats,
    EVAL_STACK: stack,
    EVAL_OUT: path.join(partDir, `part-${worker}.json`),
  });
}));

await runVitest({
  EVAL_MERGE: '1',
  EVAL_PART_DIR: partDir,
  EVAL_OUT: outPath,
});

console.log(`[eval] finished -> ${outPath}`);
