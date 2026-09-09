#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import random
import struct
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

FEATURE_COUNT = 160
ACTION_COUNT = 5
HEADER_BYTES = 16
MAGIC = b"LPTR"
PROTECTED_NAMES = {"policy-v1.json", "policy-v1.pt"}
ACTION_NAMES = ["fold", "check", "call", "wager", "all-in"]

RECORD_DTYPE_V1 = np.dtype([
    ("features", "<f4", (FEATURE_COUNT,)),
    ("action", "u1"),
    ("size", "<f4"),
    ("mask", "u1", (ACTION_COUNT,)),
    ("reward", "<f4"),
], align=False)

RECORD_DTYPE_V2 = np.dtype({
    "names": ["features", "action", "size", "mask", "reward", "logprob", "chipDelta", "seat", "tableSize"],
    "formats": [("<f4", (FEATURE_COUNT,)), "u1", "<f4", ("u1", (ACTION_COUNT,)), "<f4", "<f4", "<f4", "u1", "u1"],
    "offsets": [0, 640, 641, 645, 650, 654, 658, 662, 663],
    "itemsize": 664,
})

RECORD_DTYPE_V3 = np.dtype({
    "names": [
        "features", "action", "size", "mask", "reward",
        "oldLogProb", "oldValue", "chipDelta", "handId", "seat", "tableSize",
    ],
    "formats": [
        ("<f4", (FEATURE_COUNT,)), "u1", "<f4", ("u1", (ACTION_COUNT,)), "<f4",
        "<f4", "<f4", "<f4", "<u4", "u1", "u1",
    ],
    "offsets": [0, 640, 641, 645, 650, 654, 658, 662, 666, 670, 671],
    "itemsize": 672,
})


@dataclass
class Shard:
    path: Path
    records: np.memmap
    version: int

    @property
    def count(self) -> int:
        return int(self.records.shape[0])


@dataclass
class Batch:
    features: torch.Tensor
    actions: torch.Tensor
    sizes: torch.Tensor
    masks: torch.Tensor
    rewards: torch.Tensor
    old_logprob: torch.Tensor | None = None
    old_value: torch.Tensor | None = None


@dataclass
class PpoStats:
    loss: float = 0.0
    policy_loss: float = 0.0
    value_loss: float = 0.0
    size_loss: float = 0.0
    entropy: float = 0.0
    norm_entropy: float = 0.0
    kl: float = 0.0
    clip_frac: float = 0.0
    ratio_mean: float = 0.0
    ratio_std: float = 0.0
    ratio_min: float = 0.0
    ratio_max: float = 0.0
    adv_mean: float = 0.0
    adv_std: float = 0.0
    value_mae: float = 0.0
    explained_var: float = 0.0
    logit_abs_mean: float = 0.0
    logit_abs_max: float = 0.0
    grad_norm: float = 0.0
    finite: bool = True


def read_header(path: Path) -> tuple[int, int, int]:
    with path.open("rb") as handle:
        header = handle.read(HEADER_BYTES)
    if len(header) != HEADER_BYTES or header[:4] != MAGIC:
        raise ValueError(f"{path}: not a Liminal Poker training shard")
    version, features, actions = struct.unpack("<III", header[4:])
    if version not in (1, 2, 3):
        raise ValueError(f"{path}: unsupported dataset version {version}")
    if features != FEATURE_COUNT or actions != ACTION_COUNT:
        raise ValueError(
            f"{path}: dataset shape is {features} features/{actions} actions; "
            f"trainer expects {FEATURE_COUNT}/{ACTION_COUNT}"
        )
    return version, features, actions


def dtype_for_version(version: int) -> np.dtype:
    if version == 1:
        return RECORD_DTYPE_V1
    if version == 2:
        return RECORD_DTYPE_V2
    return RECORD_DTYPE_V3


def load_shards(data_dir: Path) -> list[Shard]:
    files = sorted(data_dir.glob("*.bin"))
    if not files:
        raise FileNotFoundError(f"No .bin shards found in {data_dir}")

    shards: list[Shard] = []
    versions: set[int] = set()
    for path in files:
        version, _, _ = read_header(path)
        versions.add(version)
        dtype = dtype_for_version(version)
        payload = path.stat().st_size - HEADER_BYTES
        if payload < 0 or payload % dtype.itemsize:
            raise ValueError(f"{path}: corrupt payload size {payload} for v{version} itemsize {dtype.itemsize}")
        count = payload // dtype.itemsize
        if count == 0:
            continue
        records = np.memmap(path, dtype=dtype, mode="r", offset=HEADER_BYTES, shape=(count,))
        shards.append(Shard(path, records, version))
    if not shards:
        raise ValueError("All training shards were empty")
    if len(versions) != 1:
        raise ValueError(f"Mixed dataset versions in {data_dir}: {sorted(versions)}")
    return shards


def refuse_v1_overwrite(out_path: Path, allow: bool) -> None:
    names = {out_path.name, out_path.with_suffix(".pt").name, out_path.with_suffix(".json").name}
    if names & PROTECTED_NAMES and not allow:
        raise SystemExit(
            f"Refusing to overwrite frozen policy-v1 at {out_path}. "
            "Pick a different --out (for example training/out/policy-ppo.json)."
        )


def param_l2(model: nn.Module) -> float:
    total = torch.zeros((), dtype=torch.float64)
    for param in model.parameters():
        total = total + param.detach().double().pow(2).sum()
    return float(torch.sqrt(total).item())


def param_delta_l2(before: dict[str, torch.Tensor], model: nn.Module) -> float:
    total = torch.zeros((), dtype=torch.float64)
    for name, param in model.named_parameters():
        total = total + (param.detach().double() - before[name].double()).pow(2).sum()
    return float(torch.sqrt(total).item())


class PolicyValueNet(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.fc1 = nn.Linear(FEATURE_COUNT, 256)
        self.fc2 = nn.Linear(256, 256)
        self.fc3 = nn.Linear(256, 128)
        self.policy = nn.Linear(128, ACTION_COUNT)
        self.value = nn.Linear(128, 1)
        self.size = nn.Linear(128, 1)

    def trunk(self, x: torch.Tensor) -> torch.Tensor:
        x = F.relu(self.fc1(x))
        x = F.relu(self.fc2(x))
        return F.relu(self.fc3(x))

    def forward(self, x: torch.Tensor):
        h = self.trunk(x)
        return self.policy(h), torch.tanh(self.value(h)).squeeze(-1), torch.sigmoid(self.size(h)).squeeze(-1)


def choose_shard(shards: list[Shard], rng: np.random.Generator) -> Shard:
    total = sum(shard.count for shard in shards)
    roll = int(rng.integers(0, total))
    for shard in shards:
        if roll < shard.count:
            return shard
        roll -= shard.count
    return shards[-1]


def sample_batch(shards: list[Shard], batch_size: int, rng: np.random.Generator) -> Batch:
    shard = choose_shard(shards, rng)
    idx = rng.integers(0, shard.count, size=batch_size)
    rows = shard.records[idx]
    names = set(rows.dtype.names or [])
    batch = Batch(
        features=torch.from_numpy(np.array(rows["features"], dtype=np.float32, copy=True)),
        actions=torch.from_numpy(np.array(rows["action"], dtype=np.int64, copy=True)),
        sizes=torch.from_numpy(np.array(rows["size"], dtype=np.float32, copy=True)),
        masks=torch.from_numpy(np.array(rows["mask"], dtype=np.bool_, copy=True)),
        rewards=torch.from_numpy(np.array(rows["reward"], dtype=np.float32, copy=True)),
    )
    if "oldLogProb" in names:
        batch.old_logprob = torch.from_numpy(np.array(rows["oldLogProb"], dtype=np.float32, copy=True))
        batch.old_value = torch.from_numpy(np.array(rows["oldValue"], dtype=np.float32, copy=True))
    elif "logprob" in names:
        batch.old_logprob = torch.from_numpy(np.array(rows["logprob"], dtype=np.float32, copy=True))
    return batch


def masked_log_probs(logits: torch.Tensor, masks: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    masked_logits = logits.masked_fill(~masks, -1e9)
    log_probs = F.log_softmax(masked_logits, dim=1)
    probs = log_probs.exp()
    return log_probs, probs


def ppo_ratio(new_logprob: torch.Tensor, old_logprob: torch.Tensor) -> torch.Tensor:
    return torch.exp(new_logprob - old_logprob)


def normalize_advantages(adv: torch.Tensor) -> torch.Tensor:
    return (adv - adv.mean()) / (adv.std(unbiased=False) + 1e-8)


def clipped_surrogate(ratio: torch.Tensor, adv: torch.Tensor, clip: float) -> torch.Tensor:
    unclipped = ratio * adv
    clipped = ratio.clamp(1.0 - clip, 1.0 + clip) * adv
    return torch.minimum(unclipped, clipped)


def legal_entropy(probs: torch.Tensor, log_probs: torch.Tensor, masks: torch.Tensor) -> torch.Tensor:
    safe_p = torch.where(masks, probs, torch.zeros_like(probs))
    safe_logp = torch.where(masks, log_probs, torch.zeros_like(log_probs))
    return -(safe_p * safe_logp).sum(dim=1)


def normalized_legal_entropy(entropy: torch.Tensor, masks: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    n_legal = masks.sum(dim=1).to(entropy.dtype)
    valid = n_legal > 1
    out = torch.zeros_like(entropy)
    out[valid] = entropy[valid] / torch.log(n_legal[valid])
    return out, valid


def approx_kl(old_logprob: torch.Tensor, new_logprob: torch.Tensor) -> torch.Tensor:
    return (old_logprob - new_logprob).mean()


def explained_variance(returns: torch.Tensor, values: torch.Tensor) -> float:
    var_y = float(returns.var(unbiased=False).item())
    if var_y < 1e-8:
        return 0.0
    return float(1.0 - (returns - values).var(unbiased=False).item() / var_y)


def ppo_should_stop(
    stats: PpoStats,
    *,
    start_norm_entropy: float,
    start_value_mae: float,
    kl_limit: float = 0.03,
    entropy_floor: float = 0.15,
    logit_limit: float = 30.0,
) -> str | None:
    if not stats.finite:
        return "non-finite"
    if stats.kl > kl_limit:
        return "kl"
    if start_norm_entropy > 0.4 and stats.norm_entropy < entropy_floor:
        return "entropy-collapse"
    if stats.logit_abs_max > logit_limit:
        return "logit-explode"
    if start_value_mae > 0.05 and stats.value_mae > max(0.45, 2.0 * start_value_mae):
        return "value-mae"
    return None


def action_freq(indices: torch.Tensor) -> dict[str, float]:
    counts = torch.bincount(indices.detach().cpu(), minlength=ACTION_COUNT).to(torch.float32)
    total = float(counts.sum().item()) or 1.0
    return {name: float(counts[i].item()) / total for i, name in enumerate(ACTION_NAMES)}


def greedy_actions(logits: torch.Tensor, masks: torch.Tensor) -> torch.Tensor:
    return logits.masked_fill(~masks, -1e9).argmax(dim=1)


def bc_loss(logits, value, size, actions, sizes, masks, rewards):
    masked_logits = logits.masked_fill(~masks, -1e9)
    policy_loss = F.cross_entropy(masked_logits, actions)
    value_loss = F.smooth_l1_loss(value, rewards)
    wager = actions == 3
    size_loss = F.smooth_l1_loss(size[wager], sizes[wager]) if wager.any() else torch.zeros((), dtype=logits.dtype)
    entropy = torch.zeros((), dtype=logits.dtype)
    loss = policy_loss + 0.35 * value_loss + 0.20 * size_loss
    return loss, policy_loss, value_loss, size_loss, entropy


def ppo_loss(
    logits: torch.Tensor,
    value: torch.Tensor,
    size: torch.Tensor,
    batch: Batch,
    *,
    clip: float,
    entropy_coef: float,
    value_coef: float,
    size_coef: float,
) -> tuple[torch.Tensor, PpoStats]:
    assert batch.old_logprob is not None and batch.old_value is not None
    log_probs, probs = masked_log_probs(logits, batch.masks)
    new_logprob = log_probs.gather(1, batch.actions.unsqueeze(1)).squeeze(1)
    ratio = ppo_ratio(new_logprob, batch.old_logprob)
    raw_adv = batch.rewards - batch.old_value
    adv = normalize_advantages(raw_adv)

    policy_loss = -clipped_surrogate(ratio, adv, clip).mean()
    value_clipped = batch.old_value + (value - batch.old_value).clamp(-clip, clip)
    value_unclipped = F.smooth_l1_loss(value, batch.rewards, reduction="none")
    value_clipped_loss = F.smooth_l1_loss(value_clipped, batch.rewards, reduction="none")
    value_loss = torch.maximum(value_unclipped, value_clipped_loss).mean()

    wager = batch.actions == 3
    size_loss = F.smooth_l1_loss(size[wager], batch.sizes[wager]) if wager.any() else torch.zeros((), dtype=logits.dtype)

    entropy = legal_entropy(probs, log_probs, batch.masks)
    norm_ent, valid = normalized_legal_entropy(entropy, batch.masks)
    entropy_mean = entropy.mean()
    norm_mean = norm_ent[valid].mean() if bool(valid.any()) else torch.zeros((), dtype=logits.dtype)

    loss = policy_loss + value_coef * value_loss + size_coef * size_loss - entropy_coef * entropy_mean

    legal_logits = logits.masked_fill(~batch.masks, 0.0)
    legal_abs = legal_logits.abs().masked_fill(~batch.masks, 0.0)
    finite = bool(
        math.isfinite(float(loss.item()))
        and math.isfinite(float(policy_loss.item()))
        and math.isfinite(float(value_loss.item()))
        and torch.isfinite(ratio).all().item()
        and torch.isfinite(logits).all().item()
    )
    stats = PpoStats(
        loss=float(loss.item()),
        policy_loss=float(policy_loss.item()),
        value_loss=float(value_loss.item()),
        size_loss=float(size_loss.item()),
        entropy=float(entropy_mean.item()),
        norm_entropy=float(norm_mean.item()),
        kl=float(approx_kl(batch.old_logprob, new_logprob).item()),
        clip_frac=float(((ratio < 1.0 - clip) | (ratio > 1.0 + clip)).to(torch.float32).mean().item()),
        ratio_mean=float(ratio.mean().item()),
        ratio_std=float(ratio.std(unbiased=False).item()),
        ratio_min=float(ratio.min().item()),
        ratio_max=float(ratio.max().item()),
        adv_mean=float(raw_adv.mean().item()),
        adv_std=float(raw_adv.std(unbiased=False).item()),
        value_mae=float((value - batch.rewards).abs().mean().item()),
        explained_var=explained_variance(batch.rewards.detach(), value.detach()),
        logit_abs_mean=float(legal_abs.sum().item() / max(1.0, float(batch.masks.sum().item()))),
        logit_abs_max=float(legal_abs.max().item()),
        finite=finite,
    )
    return loss, stats


def evaluate(model: PolicyValueNet, shards: list[Shard], rng: np.random.Generator, samples: int = 16384):
    model.eval()
    remaining = samples
    correct = 0
    total = 0
    value_abs = 0.0
    size_abs = 0.0
    size_count = 0
    greedy: list[torch.Tensor] = []
    with torch.no_grad():
        while remaining > 0:
            batch_n = min(4096, remaining)
            batch = sample_batch(shards, batch_n, rng)
            logits, value, size = model(batch.features)
            pred = greedy_actions(logits, batch.masks)
            greedy.append(pred)
            correct += int((pred == batch.actions).sum().item())
            total += batch_n
            value_abs += float((value - batch.rewards).abs().sum().item())
            wager = batch.actions == 3
            if wager.any():
                size_abs += float((size[wager] - batch.sizes[wager]).abs().sum().item())
                size_count += int(wager.sum().item())
            remaining -= batch_n
    model.train()
    preds = torch.cat(greedy) if greedy else torch.zeros(0, dtype=torch.long)
    return {
        "accuracy": correct / max(1, total),
        "value_mae": value_abs / max(1, total),
        "size_mae": size_abs / max(1, size_count),
        "greedy_actions": action_freq(preds) if preds.numel() else {name: 0.0 for name in ACTION_NAMES},
    }


def export_linear(layer: nn.Linear, activation: str = "linear") -> dict:
    weight = layer.weight.detach().cpu().to(torch.float32).numpy()
    bias = layer.bias.detach().cpu().to(torch.float32).numpy()
    return {
        "input": int(layer.in_features),
        "output": int(layer.out_features),
        "weights": weight.reshape(-1).tolist(),
        "bias": bias.tolist(),
        "activation": activation,
    }


def export_model(model: PolicyValueNet, out_path: Path) -> None:
    payload = {
        "version": 1,
        "featureCount": FEATURE_COUNT,
        "actionCount": ACTION_COUNT,
        "trunk": [
            export_linear(model.fc1, "relu"),
            export_linear(model.fc2, "relu"),
            export_linear(model.fc3, "relu"),
        ],
        "policy": export_linear(model.policy),
        "value": export_linear(model.value),
        "size": export_linear(model.size),
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with out_path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))


def dataset_action_freq(shards: list[Shard], rng: np.random.Generator, samples: int = 32768) -> dict[str, float]:
    remaining = min(samples, sum(shard.count for shard in shards))
    counts = torch.zeros(ACTION_COUNT, dtype=torch.float64)
    while remaining > 0:
        take = min(4096, remaining)
        batch = sample_batch(shards, take, rng)
        counts += torch.bincount(batch.actions, minlength=ACTION_COUNT).to(torch.float64)
        remaining -= take
    total = float(counts.sum().item()) or 1.0
    return {name: float(counts[i].item()) / total for i, name in enumerate(ACTION_NAMES)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Train Liminal Poker's tiny CPU policy/value network")
    parser.add_argument("--data", type=Path, default=Path("training/data/bootstrap"))
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--epochs", type=int, default=None)
    parser.add_argument("--batch", type=int, default=4096)
    parser.add_argument("--lr", type=float, default=None)
    parser.add_argument("--seed", type=int, default=1337)
    parser.add_argument("--threads", type=int, default=max(1, min(12, (os.cpu_count() or 4) - 2)))
    parser.add_argument("--resume", type=Path, default=None)
    parser.add_argument("--mode", choices=["auto", "bc", "rl"], default="auto")
    parser.add_argument("--entropy", type=float, default=None)
    parser.add_argument("--value-coef", type=float, default=0.5)
    parser.add_argument("--size-coef", type=float, default=0.2)
    parser.add_argument("--clip", type=float, default=0.15)
    parser.add_argument("--kl-stop", type=float, default=0.03)
    parser.add_argument("--entropy-floor", type=float, default=0.15)
    parser.add_argument("--logit-limit", type=float, default=30.0)
    parser.add_argument("--grad-clip", type=float, default=None)
    parser.add_argument("--allow-overwrite-v1", action="store_true")
    parser.add_argument(
        "--export-checkpoint",
        type=Path,
        default=None,
        help="Load a .pt state dict, export JSON weights to --out, and exit without training",
    )
    args = parser.parse_args()

    if args.export_checkpoint:
        out_path = args.out or Path("training/out/policy-export.json")
        refuse_v1_overwrite(out_path, args.allow_overwrite_v1)
        model = PolicyValueNet()
        state = torch.load(args.export_checkpoint, map_location="cpu", weights_only=True)
        model.load_state_dict(state)
        export_model(model, out_path)
        print(f"Exported checkpoint {args.export_checkpoint} -> {out_path}")
        return

    shards = load_shards(args.data)
    dataset_version = shards[0].version
    mode = args.mode
    if mode == "auto":
        mode = "rl" if dataset_version >= 2 else "bc"
    if mode == "rl" and dataset_version < 3:
        raise SystemExit(
            "PPO mode needs self-play v3 shards with oldLogProb and oldValue. "
            "Regenerate with npm run selfplay:data; do not reconstruct old log-probs."
        )
    if mode == "bc" and dataset_version != 1:
        print("warning: behavioral cloning on self-play labels (sampled explore actions, not a teacher)")

    out_path = args.out or (
        Path("training/out/policy-ppo.json") if mode == "rl" else Path("training/out/policy-v1.json")
    )
    refuse_v1_overwrite(out_path, args.allow_overwrite_v1)
    epochs = args.epochs if args.epochs is not None else (1 if mode == "rl" else 8)
    lr = args.lr if args.lr is not None else (5e-5 if mode == "rl" else 3e-4)
    entropy_coef = args.entropy if args.entropy is not None else (0.02 if mode == "rl" else 0.0)
    grad_clip = args.grad_clip if args.grad_clip is not None else (1.0 if mode == "rl" else 2.0)

    if mode == "rl" and not args.resume:
        raise SystemExit("RL training must --resume from a frozen checkpoint (training/out/policy-v1.pt)")

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, args.threads))
    try:
        torch.set_num_interop_threads(max(1, min(4, args.threads // 2)))
    except RuntimeError:
        pass

    total_records = sum(shard.count for shard in shards)
    print(f"Loaded {len(shards)} shards, {total_records:,} decisions, dataset v{dataset_version}, mode={mode}")
    print(f"PyTorch CPU threads: {torch.get_num_threads()}")
    print("Network: 160 -> 256 -> 256 -> 128 -> policy(5) + value(1) + size(1)")
    if mode == "rl":
        print(
            f"PPO-lite: clip={args.clip} lr={lr} entropy={entropy_coef} value_coef={args.value_coef} "
            f"size_coef={args.size_coef} grad_clip={grad_clip} kl_stop={args.kl_stop}"
        )
        print("policyLoss = -mean(min(ratio*A, clamp(ratio, 1-clip, 1+clip)*A))")
        print("A = normalize(return - oldValue); return = clamp(chipDelta/startStack, -1, 1)")
        print("valueLoss = max(smoothL1(V,R), smoothL1(oldV + clamp(V-oldV, -clip, clip), R))")

    model = PolicyValueNet()
    if args.resume:
        state = torch.load(args.resume, map_location="cpu", weights_only=True)
        model.load_state_dict(state)
        print(f"Resumed weights from {args.resume}")

    snapshot = {name: param.detach().cpu().clone() for name, param in model.named_parameters()}
    start_l2 = param_l2(model)

    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-5)
    rng = np.random.default_rng(args.seed)
    steps_per_epoch = max(1, math.ceil(total_records / args.batch))

    data_actions = dataset_action_freq(shards, rng)
    start_eval = evaluate(model, shards, rng)
    start_norm_entropy = 0.0
    start_value_mae = start_eval["value_mae"]
    if mode == "rl":
        with torch.no_grad():
            probe = sample_batch(shards, min(args.batch, total_records), rng)
            logits, value, _ = model(probe.features)
            loss, probe_stats = ppo_loss(
                logits, value, torch.zeros_like(value), probe,
                clip=args.clip, entropy_coef=entropy_coef,
                value_coef=args.value_coef, size_coef=args.size_coef,
            )
            start_norm_entropy = probe_stats.norm_entropy
            print(
                f"start: greedy={start_eval['greedy_actions']} data={data_actions} "
                f"H={probe_stats.entropy:.3f} Hnorm={probe_stats.norm_entropy:.3f} "
                f"value_mae={start_eval['value_mae']:.3f}"
            )

    history: list[dict] = []
    stop_reason = None
    last_stats = PpoStats()
    grad_norms: list[float] = []

    for epoch in range(1, epochs + 1):
        running = PpoStats()
        steps_done = 0
        for step in range(1, steps_per_epoch + 1):
            batch = sample_batch(shards, args.batch, rng)
            logits, value, size = model(batch.features)
            if mode == "rl":
                loss, stats = ppo_loss(
                    logits, value, size, batch,
                    clip=args.clip,
                    entropy_coef=entropy_coef,
                    value_coef=args.value_coef,
                    size_coef=args.size_coef,
                )
            else:
                policy_loss, value_loss, size_loss = None, None, None
                bc = bc_loss(logits, value, size, batch.actions, batch.sizes, batch.masks, batch.rewards)
                loss, policy_loss, value_loss, size_loss, entropy = bc
                stats = PpoStats(
                    loss=float(loss.item()),
                    policy_loss=float(policy_loss.item()),
                    value_loss=float(value_loss.item()),
                    size_loss=float(size_loss.item()),
                    entropy=float(entropy.item()),
                    finite=math.isfinite(float(loss.item())),
                )

            if not stats.finite:
                raise SystemExit(f"Non-finite loss at epoch {epoch} step {step}: {stats.loss}")

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            grad_norm = float(torch.nn.utils.clip_grad_norm_(model.parameters(), grad_clip))
            stats.grad_norm = grad_norm
            optimizer.step()

            steps_done += 1
            last_stats = stats
            grad_norms.append(grad_norm)
            running.loss += stats.loss
            running.policy_loss += stats.policy_loss
            running.value_loss += stats.value_loss
            running.size_loss += stats.size_loss
            running.entropy += stats.entropy
            running.norm_entropy += stats.norm_entropy
            running.kl += stats.kl
            running.clip_frac += stats.clip_frac
            running.ratio_mean += stats.ratio_mean
            running.value_mae += stats.value_mae
            running.explained_var += stats.explained_var
            running.logit_abs_max = max(running.logit_abs_max, stats.logit_abs_max)

            if step % max(1, steps_per_epoch // 10) == 0 or step == steps_per_epoch:
                n = steps_done
                print(
                    f"epoch {epoch}/{epochs} step {step}/{steps_per_epoch} "
                    f"loss={running.loss / n:.4f} policy={running.policy_loss / n:.4f} "
                    f"value={running.value_loss / n:.4f} size={running.size_loss / n:.4f} "
                    f"H={running.entropy / n:.3f} Hnorm={running.norm_entropy / n:.3f} "
                    f"kl={running.kl / n:.4f} clip={running.clip_frac / n:.3f} "
                    f"ratio={running.ratio_mean / n:.3f} vmae={running.value_mae / n:.3f} "
                    f"grad={grad_norm:.3f} |logit|max={stats.logit_abs_max:.2f}"
                )

            if mode == "rl":
                reason = ppo_should_stop(
                    stats,
                    start_norm_entropy=start_norm_entropy,
                    start_value_mae=start_value_mae,
                    kl_limit=args.kl_stop,
                    entropy_floor=args.entropy_floor,
                    logit_limit=args.logit_limit,
                )
                if reason:
                    stop_reason = reason
                    print(f"early-stop ({reason}) at epoch {epoch} step {step}: kl={stats.kl:.4f} "
                          f"Hnorm={stats.norm_entropy:.3f} |logit|max={stats.logit_abs_max:.2f} "
                          f"vmae={stats.value_mae:.3f}")
                    break
        if stop_reason:
            break

        metrics = evaluate(model, shards, rng)
        n = max(1, steps_done)
        epoch_row = {
            "epoch": epoch,
            "steps": steps_done,
            "loss": running.loss / n,
            "policy_loss": running.policy_loss / n,
            "value_loss": running.value_loss / n,
            "size_loss": running.size_loss / n,
            "entropy": running.entropy / n,
            "norm_entropy": running.norm_entropy / n,
            "kl": running.kl / n,
            "clip_frac": running.clip_frac / n,
            "ratio_mean": running.ratio_mean / n,
            "value_mae": metrics["value_mae"],
            "explained_var": running.explained_var / n,
            "greedy_actions": metrics["greedy_actions"],
            "stop_reason": stop_reason,
        }
        history.append(epoch_row)
        print(
            f"epoch {epoch} eval: action_acc={metrics['accuracy']:.3f} "
            f"value_mae={metrics['value_mae']:.3f} size_mae={metrics['size_mae']:.3f} "
            f"greedy={metrics['greedy_actions']}"
        )

        checkpoint = out_path.with_suffix(f".epoch-{epoch}.pt")
        checkpoint.parent.mkdir(parents=True, exist_ok=True)
        torch.save(model.state_dict(), checkpoint)

    export_model(model, out_path)
    final_checkpoint = out_path.with_suffix(".pt")
    torch.save(model.state_dict(), final_checkpoint)
    delta_l2 = param_delta_l2(snapshot, model)
    end_eval = evaluate(model, shards, rng)
    print(f"Exported browser weights: {out_path}")
    print(f"Saved PyTorch checkpoint: {final_checkpoint}")
    print(f"Weight L2 start={start_l2:.6f} delta={delta_l2:.6f} changed={delta_l2 > 1e-8}")
    print(f"actions data={data_actions}")
    print(f"actions greedy start={start_eval['greedy_actions']}")
    print(f"actions greedy end={end_eval['greedy_actions']}")
    if delta_l2 <= 1e-8:
        raise SystemExit("Training finished but weights did not change")

    metrics_path = out_path.with_name(out_path.stem + ".metrics.json")
    payload = {
        "mode": mode,
        "clip": args.clip,
        "lr": lr,
        "entropy_coef": entropy_coef,
        "kl_stop": args.kl_stop,
        "grad_clip": grad_clip,
        "epochs_requested": epochs,
        "stop_reason": stop_reason,
        "weight_l2_start": start_l2,
        "weight_l2_delta": delta_l2,
        "grad_norm_mean": sum(grad_norms) / max(1, len(grad_norms)),
        "grad_norm_max": max(grad_norms) if grad_norms else 0.0,
        "last": last_stats.__dict__,
        "data_actions": data_actions,
        "greedy_start": start_eval["greedy_actions"],
        "greedy_end": end_eval["greedy_actions"],
        "value_mae_start": start_eval["value_mae"],
        "value_mae_end": end_eval["value_mae"],
        "history": history,
    }
    metrics_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote diagnostics: {metrics_path}")

    if mode == "rl":
        end_mix = end_eval["greedy_actions"]
        passive = end_mix.get("fold", 0) + end_mix.get("check", 0) + end_mix.get("call", 0)
        aggressive = end_mix.get("wager", 0) + end_mix.get("all-in", 0)
        if passive < 0.15 or aggressive > 0.92:
            raise SystemExit(
                f"Action collapse after PPO: greedy={end_mix}. Refusing to treat this as a healthy candidate."
            )


if __name__ == "__main__":
    main()
