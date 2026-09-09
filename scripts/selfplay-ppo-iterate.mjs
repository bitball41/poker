import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value == null) throw new Error(`Missing value for --${name}`);
  return value;
}

function findPython() {
  const candidates = [
    process.env.PYTHON,
    path.join(process.env.USERPROFILE || '', '.pyenv', 'pyenv-win', 'versions', '3.13.3', 'python.exe'),
    path.join(process.env.USERPROFILE || '', '.pyenv', 'pyenv-win', 'shims', 'python.bat'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && !candidate.includes('WindowsApps')) return candidate;
  }
  return 'python';
}

function run(cmd, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      env: { ...process.env, ...extraEnv },
      shell: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

const rounds = Math.max(1, Number(arg('rounds', '5')));
const hands = Math.max(1000, Number(arg('hands', '10000')));
const workers = Math.max(1, Number(arg('workers', '4')));
const evalGames = Math.max(100, Number(arg('eval-games', '500')));
const champion = path.resolve(arg('champion', 'training/out/policy-v1.json'));
const championPt = path.resolve(arg('champion-pt', 'training/out/policy-v1.pt'));
const startResume = path.resolve(arg('resume', championPt));
const seed0 = Math.max(1, Number(arg('seed', '2001')));
const python = findPython();

if (!fs.existsSync(champion) || !fs.existsSync(championPt)) {
  throw new Error('Champion policy-v1 json/pt missing');
}

let resume = startResume;
let behaviorJson = champion;
const log = [];

for (let round = 1; round <= rounds; round++) {
  const seed = seed0 + (round - 1) * 10007;
  const dataDir = path.resolve(`training/data/selfplay-ppo-r${round}`);
  const outJson = path.resolve(`training/out/policy-ppo-r${round}.json`);
  const evalOut = path.resolve(`training/out/eval-ppo-r${round}.json`);
  const primaryShare = round === 1 ? '1' : '0.4';
  const pool = round === 1 ? '' : champion;
  const started = Date.now();
  console.log(`\n======== PPO ROUND ${round}/${rounds} seed=${seed} share=${primaryShare} ========`);

  await run(process.execPath, [
    'scripts/selfplay-data.mjs',
    '--hands', String(hands),
    '--workers', String(workers),
    '--seed', String(seed),
    '--out', dataDir,
    '--model', behaviorJson,
    '--pool', pool,
    '--primary-share', primaryShare,
  ]);

  await run(python, [
    'training/train.py',
    '--mode', 'rl',
    '--data', dataDir,
    '--resume', resume,
    '--out', outJson,
    '--lr', '5e-5',
    '--epochs', '1',
    '--entropy', '0.02',
    '--clip', '0.15',
    '--grad-clip', '1.0',
    '--seed', String(seed),
    '--threads', '12',
  ]);

  await run(process.execPath, [
    'scripts/eval-model.mjs',
    '--model', outJson,
    '--vs-model', champion,
    '--skip-heuristic',
    '--games', String(evalGames),
    '--workers', String(workers),
    '--seed', String(seed),
    '--out', evalOut,
  ]);

  const metrics = JSON.parse(fs.readFileSync(outJson.replace(/\.json$/i, '.metrics.json'), 'utf8'));
  const evalSummary = JSON.parse(fs.readFileSync(evalOut, 'utf8')).summary;
  const byTable = {};
  for (const [size, row] of Object.entries(evalSummary.byTableSize || {})) {
    byTable[size] = { avgDelta: row.avgDelta, winRate: row.winRate, ci: row.deltaCI };
  }
  const row = {
    round,
    seed,
    seconds: (Date.now() - started) / 1000,
    hands,
    stop_reason: metrics.stop_reason,
    policy_loss: metrics.history?.[0]?.policy_loss ?? metrics.last?.policy_loss,
    value_loss: metrics.history?.[0]?.value_loss ?? metrics.last?.value_loss,
    entropy: metrics.history?.[0]?.entropy ?? metrics.last?.entropy,
    kl: metrics.history?.[0]?.kl ?? metrics.last?.kl,
    clip_frac: metrics.history?.[0]?.clip_frac ?? metrics.last?.clip_frac,
    weight_delta: metrics.weight_l2_delta,
    greedy_end: metrics.greedy_end,
    vs_v1: {
      avgDelta: evalSummary.avgDelta,
      ci: evalSummary.deltaCI,
      winRate: evalSummary.winRate,
      actions: evalSummary.actionFreq,
      avgWager: evalSummary.avgWagerSize,
      byTable,
    },
  };
  log.push(row);
  console.log(`[round ${round}] vs v1 avgDelta=${evalSummary.avgDelta.toFixed(2)} ci=[${evalSummary.deltaCI.lo.toFixed(2)}, ${evalSummary.deltaCI.hi.toFixed(2)}] greedy=`, metrics.greedy_end);

  resume = outJson.replace(/\.json$/i, '.pt');
  behaviorJson = outJson;
}

const summaryPath = path.resolve('training/out/ppo-rounds.json');
fs.writeFileSync(summaryPath, JSON.stringify(log, null, 2));
console.log(`\n[ppo] wrote ${summaryPath}`);
