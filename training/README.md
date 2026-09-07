# Liminal Poker ML training

This folder trains the tiny in-app fake-chip poker NPC policy. Training is CPU-only by default and does not require a GPU or a hosted inference service.

## Architecture

The first model is a compact multi-head MLP:

- 160 public-state input features
- 256 -> 256 -> 128 hidden layers
- 5-way action head: fold / check / call / wager / all-in
- wager-size head
- hand-value head

The feature encoder deliberately excludes opponent hole cards and the undealt deck.

## 1. Install training dependencies

From the repository root:

```bash
python -m pip install -r training/requirements.txt
npm ci
```

PyTorch runs on CPU. The trainer defaults to at most 12 CPU threads and can be changed with `--threads`.

## 2. Generate bootstrap data

Start small to verify the pipeline:

```bash
npm run train:data -- --hands 1000 --workers 4
```

Then generate a real bootstrap set:

```bash
npm run train:data -- --hands 50000 --workers 8
```

Useful options:

```text
--hands N      total simulated hands
--workers N    parallel simulator processes
--seed N       deterministic base seed
--seats N      force a table size from 2-9; omit to randomize
--out PATH     output shard directory
```

The generator uses the real TypeScript game engine and the current balanced heuristic policy as the first teacher. Each worker writes a fixed-width binary shard under `training/data/bootstrap/`.

Do not start with millions of teacher hands. The heuristic teacher performs Monte Carlo equity estimates and is intentionally much slower than the neural policy will be. The target is roughly 50k-200k teacher hands, then model self-play becomes the large-scale data source.

## 3. Train the first model

```bash
python training/train.py --data training/data/bootstrap --out training/out/policy-v1.json
```

Defaults:

- 8 epochs
- batch size 4096
- learning rate 3e-4
- CPU only
- memory-mapped dataset shards

Example tuned for an 8-core / 16-thread desktop CPU:

```bash
python training/train.py --data training/data/bootstrap --out training/out/policy-v1.json --threads 12 --batch 4096 --epochs 10
```

The trainer emits:

- `training/out/policy-v1.json` for the TypeScript inference runtime
- `training/out/policy-v1.pt` final PyTorch checkpoint
- per-epoch `.pt` checkpoints

Generated datasets and checkpoints are gitignored.

## 4. What comes next

The bootstrap network is not the final bot. The next training phase is model-vs-model self-play with exploration and outcome learning. That phase can generate millions of hands much faster because inference is only a small matrix network instead of hundreds of Monte Carlo simulations per decision.

The game engine remains authoritative. ML output is always passed through the legal-action mask / engine validation before an action is applied.
