import { test } from 'vitest';
import { parseEvalConfig, runEvaluation, writeEvalOutput, formatSummary, mergeEvalParts } from './runEval';

const enabled = process.env.EVAL_RUN === '1';
const merge = process.env.EVAL_MERGE === '1';

test.skipIf(!merge)(
  'merge evaluation shards',
  () => {
    const partDir = process.env.EVAL_PART_DIR;
    const outPath = process.env.EVAL_OUT || 'training/out/eval-report.json';
    if (!partDir) throw new Error('EVAL_PART_DIR required');
    const { records, summary } = mergeEvalParts(partDir, outPath);
    console.log(`\n[eval] merged ${records.length} games -> ${outPath}`);
    console.log(formatSummary(summary));
  },
);

test.skipIf(!enabled)(
  'run headless ML policy evaluation',
  () => {
    const config = parseEvalConfig();
    const { records, summary } = runEvaluation(config);
    writeEvalOutput(config.outPath, records, summary);
    console.log(`\n[eval] wrote ${records.length} games -> ${config.outPath}`);
    console.log(formatSummary(summary));
  },
  24 * 60 * 60 * 1000,
);
