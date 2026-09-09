import fs from 'node:fs';
import path from 'node:path';
import {
  aggregateResults,
  createHeuristicAgent,
  createMlAgent,
  runPairedMatchupSlice,
  type EvalSummary,
  type HandRecord,
} from './harness';
import type { ExportedPolicyModel as PolicyModel } from '../src/bots/ml/model';

export interface EvalRunConfig {
  gamesPerTable: number;
  seed: number;
  modelPath: string;
  checkpointPath?: string;
  vsModelPath?: string;
  skipHeuristic?: boolean;
  tableSizes: number[];
  stack: number;
  worker: number;
  workers: number;
  outPath: string;
}

function loadModel(modelPath: string): PolicyModel {
  const raw = fs.readFileSync(modelPath, 'utf8');
  return JSON.parse(raw) as PolicyModel;
}

function slice(total: number, worker: number, workers: number): { start: number; count: number } {
  const base = Math.floor(total / workers);
  const rem = total % workers;
  const count = base + (worker < rem ? 1 : 0);
  const start = worker * base + Math.min(worker, rem);
  return { start, count };
}

export function parseEvalConfig(env: NodeJS.ProcessEnv = process.env): EvalRunConfig {
  const tableSizes = (env.EVAL_SEATS || '2,3,6')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => value >= 2 && value <= 9);
  return {
    gamesPerTable: Math.max(1, Number(env.EVAL_GAMES || 100)),
    seed: Math.max(1, Number(env.EVAL_SEED || 1337)),
    modelPath: env.EVAL_MODEL || path.join('training', 'out', 'policy-v1.json'),
    checkpointPath: env.EVAL_CHECKPOINT || '',
    vsModelPath: env.EVAL_VS_MODEL || '',
    skipHeuristic: env.EVAL_SKIP_HEURISTIC === '1' || env.EVAL_SKIP_HEURISTIC === 'true',
    tableSizes: tableSizes.length ? tableSizes : [2, 3, 6],
    stack: Math.max(20, Number(env.EVAL_STACK || 400)),
    worker: Math.max(0, Number(env.EVAL_WORKER || 0)),
    workers: Math.max(1, Number(env.EVAL_WORKERS || 1)),
    outPath: env.EVAL_OUT || path.join('training', 'out', 'eval-report.json'),
  };
}

export function runEvaluation(config: EvalRunConfig): { records: HandRecord[]; summary: EvalSummary } {
  const model = loadModel(config.modelPath);
  const mlAgent = createMlAgent(model, 'ml-v1');
  const heuristic = createHeuristicAgent('quill');
  const records: HandRecord[] = [];

  if (!config.skipHeuristic) {
    for (const tableSize of config.tableSizes) {
      const { start, count } = slice(config.gamesPerTable, config.worker, config.workers);
      if (count <= 0) continue;
      console.log(`[eval] worker ${config.worker}: ML vs heuristic ${tableSize}-max, games ${start}..${start + count - 1}`);
      records.push(...runPairedMatchupSlice({
        tableSize,
        totalGames: config.gamesPerTable,
        seed: config.seed + tableSize * 1_000_003,
        sliceStart: start,
        sliceCount: count,
        mlAgent,
        otherAgent: heuristic,
        opponent: 'heuristic',
        startStack: config.stack,
      }));
    }
  }

  if (config.vsModelPath && fs.existsSync(config.vsModelPath)) {
    const vsModel = loadModel(config.vsModelPath);
    const other = createMlAgent(vsModel, 'ml-vs');
    for (const tableSize of config.tableSizes) {
      const { start, count } = slice(config.gamesPerTable, config.worker, config.workers);
      if (count <= 0) continue;
      console.log(`[eval] worker ${config.worker}: ML vs model ${tableSize}-max, games ${start}..${start + count - 1}`);
      records.push(...runPairedMatchupSlice({
        tableSize,
        totalGames: config.gamesPerTable,
        seed: config.seed + 4_000_031 + tableSize * 1_000_003,
        sliceStart: start,
        sliceCount: count,
        mlAgent,
        otherAgent: other,
        opponent: 'model',
        startStack: config.stack,
      }));
    }
  }

  if (config.checkpointPath && fs.existsSync(config.checkpointPath)) {
    const checkpoint = loadModel(config.checkpointPath);
    const older = createMlAgent(checkpoint, 'ml-epoch-1');
    const checkpointGames = Math.min(config.gamesPerTable, config.tableSizes.includes(2) ? config.gamesPerTable : 100);
    const { start, count } = slice(checkpointGames, config.worker, config.workers);
    if (count > 0) {
      console.log(`[eval] worker ${config.worker}: ML vs checkpoint heads-up games ${start}..${start + count - 1}`);
      records.push(...runPairedMatchupSlice({
        tableSize: 2,
        totalGames: checkpointGames,
        seed: config.seed + 97,
        sliceStart: start,
        sliceCount: count,
        mlAgent,
        otherAgent: older,
        opponent: 'checkpoint',
        startStack: config.stack,
      }));
    }
  }

  return { records, summary: aggregateResults(records) };
}

export function formatSummary(summary: EvalSummary): string {
  const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
  const lines = [
    `games=${summary.games} wins=${summary.wins} losses=${summary.losses} ties=${summary.ties} winRate=${pct(summary.winRate)}`,
    `avgDelta=${summary.avgDelta.toFixed(2)} ci95=[${summary.deltaCI.lo.toFixed(2)}, ${summary.deltaCI.hi.toFixed(2)}] avgEndStack=${summary.avgEndStack.toFixed(2)} bustRate=${pct(summary.bustRate)} handsSurvived=${summary.avgHandsSurvived.toFixed(3)}`,
    `actions fold=${pct(summary.actionFreq.fold)} check=${pct(summary.actionFreq.check)} call=${pct(summary.actionFreq.call)} wager=${pct(summary.actionFreq.wager)} allin=${pct(summary.actionFreq['all-in'])} avgWager=${summary.avgWagerSize.toFixed(2)}`,
    `fallbackRate=${pct(summary.fallbackRate)} illegalPrevented=${summary.illegalPrevented} infer avg=${summary.inference.avgMs.toFixed(3)}ms p50=${summary.inference.p50Ms.toFixed(3)}ms p95=${summary.inference.p95Ms.toFixed(3)}ms`,
  ];
  for (const [size, row] of Object.entries(summary.byTableSize)) {
    lines.push(`  table ${size}: games=${row.games} winRate=${pct(row.winRate)} avgDelta=${row.avgDelta.toFixed(2)} ci95=[${row.deltaCI.lo.toFixed(2)}, ${row.deltaCI.hi.toFixed(2)}] bustRate=${pct(row.bustRate)}`);
  }
  for (const [pos, row] of Object.entries(summary.byPosition)) {
    lines.push(`  pos ${pos}: games=${row.games} winRate=${pct(row.winRate)} avgDelta=${row.avgDelta.toFixed(2)}`);
  }
  for (const [opp, row] of Object.entries(summary.byOpponent)) {
    lines.push(`  vs ${opp}: games=${row.games} winRate=${pct(row.winRate)} avgDelta=${row.avgDelta.toFixed(2)} ci95=[${row.deltaCI.lo.toFixed(2)}, ${row.deltaCI.hi.toFixed(2)}]`);
  }
  return lines.join('\n');
}

export function writeEvalOutput(outPath: string, records: HandRecord[], summary: EvalSummary): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ summary, records }, null, 2));
}

export function mergeEvalParts(partDir: string, outPath: string): { records: HandRecord[]; summary: EvalSummary } {
  const records: HandRecord[] = [];
  for (const file of fs.readdirSync(partDir).filter((name) => name.endsWith('.json')).sort()) {
    const payload = JSON.parse(fs.readFileSync(path.join(partDir, file), 'utf8')) as { records?: HandRecord[] };
    records.push(...(payload.records ?? []));
  }
  const summary = aggregateResults(records);
  writeEvalOutput(outPath, records, summary);
  return { records, summary };
}
