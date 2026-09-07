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
RECORD_DTYPE = np.dtype([
    ("features", "<f4", (FEATURE_COUNT,)),
    ("action", "u1"),
    ("size", "<f4"),
    ("mask", "u1", (ACTION_COUNT,)),
    ("reward", "<f4"),
], align=False)


@dataclass
class Shard:
    path: Path
    records: np.memmap

    @property
    def count(self) -> int:
        return int(self.records.shape[0])


def read_header(path: Path) -> None:
    with path.open("rb") as handle:
        header = handle.read(HEADER_BYTES)
    if len(header) != HEADER_BYTES or header[:4] != MAGIC:
        raise ValueError(f"{path}: not a Liminal Poker training shard")
    version, features, actions = struct.unpack("<III", header[4:])
    if version != 1:
        raise ValueError(f"{path}: unsupported dataset version {version}")
    if features != FEATURE_COUNT or actions != ACTION_COUNT:
        raise ValueError(
            f"{path}: dataset shape is {features} features/{actions} actions; "
            f"trainer expects {FEATURE_COUNT}/{ACTION_COUNT}"
        )


def load_shards(data_dir: Path) -> list[Shard]:
    files = sorted(data_dir.glob("*.bin"))
    if not files:
        raise FileNotFoundError(f"No .bin shards found in {data_dir}")

    shards: list[Shard] = []
    for path in files:
        read_header(path)
        payload = path.stat().st_size - HEADER_BYTES
        if payload < 0 or payload % RECORD_DTYPE.itemsize:
            raise ValueError(f"{path}: corrupt payload size {payload}")
        count = payload // RECORD_DTYPE.itemsize
        if count == 0:
            continue
        records = np.memmap(path, dtype=RECORD_DTYPE, mode="r", offset=HEADER_BYTES, shape=(count,))
        shards.append(Shard(path, records))
    if not shards:
        raise ValueError("All training shards were empty")
    return shards


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


def sample_batch(shards: list[Shard], batch_size: int, rng: np.random.Generator):
    shard = choose_shard(shards, rng)
    idx = rng.integers(0, shard.count, size=batch_size)
    rows = shard.records[idx]

    # Copies are intentional. np.memmap slices may be read-only/non-contiguous,
    # while PyTorch's CPU kernels want compact writable arrays.
    features = torch.from_numpy(np.array(rows["features"], dtype=np.float32, copy=True))
    actions = torch.from_numpy(np.array(rows["action"], dtype=np.int64, copy=True))
    sizes = torch.from_numpy(np.array(rows["size"], dtype=np.float32, copy=True))
    masks = torch.from_numpy(np.array(rows["mask"], dtype=np.bool_, copy=True))
    rewards = torch.from_numpy(np.array(rows["reward"], dtype=np.float32, copy=True))
    return features, actions, sizes, masks, rewards


def evaluate(model: PolicyValueNet, shards: list[Shard], rng: np.random.Generator, samples: int = 16384):
    model.eval()
    remaining = samples
    correct = 0
    total = 0
    value_abs = 0.0
    size_abs = 0.0
    size_count = 0
    with torch.no_grad():
        while remaining > 0:
            batch = min(4096, remaining)
            x, actions, sizes, masks, rewards = sample_batch(shards, batch, rng)
            logits, value, size = model(x)
            masked_logits = logits.masked_fill(~masks, -1e9)
            pred = masked_logits.argmax(dim=1)
            correct += int((pred == actions).sum().item())
            total += batch
            value_abs += float((value - rewards).abs().sum().item())
            wager = actions == 3
            if wager.any():
                size_abs += float((size[wager] - sizes[wager]).abs().sum().item())
                size_count += int(wager.sum().item())
            remaining -= batch
    model.train()
    return {
        "accuracy": correct / max(1, total),
        "value_mae": value_abs / max(1, total),
        "size_mae": size_abs / max(1, size_count),
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Train Liminal Poker's tiny CPU policy/value network")
    parser.add_argument("--data", type=Path, default=Path("training/data/bootstrap"))
    parser.add_argument("--out", type=Path, default=Path("training/out/policy-v1.json"))
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch", type=int, default=4096)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--seed", type=int, default=1337)
    parser.add_argument("--threads", type=int, default=max(1, min(12, (os.cpu_count() or 4) - 2)))
    parser.add_argument("--resume", type=Path, default=None)
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, args.threads))
    try:
        torch.set_num_interop_threads(max(1, min(4, args.threads // 2)))
    except RuntimeError:
        pass

    shards = load_shards(args.data)
    total_records = sum(shard.count for shard in shards)
    print(f"Loaded {len(shards)} shards, {total_records:,} decisions")
    print(f"PyTorch CPU threads: {torch.get_num_threads()}")
    print("Network: 160 -> 256 -> 256 -> 128 -> policy(5) + value(1) + size(1)")

    model = PolicyValueNet()
    if args.resume:
        state = torch.load(args.resume, map_location="cpu", weights_only=True)
        model.load_state_dict(state)
        print(f"Resumed weights from {args.resume}")

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-5)
    rng = np.random.default_rng(args.seed)
    steps_per_epoch = max(1, math.ceil(total_records / args.batch))

    for epoch in range(1, args.epochs + 1):
        running = 0.0
        running_policy = 0.0
        running_value = 0.0
        running_size = 0.0

        for step in range(1, steps_per_epoch + 1):
            x, actions, sizes, masks, rewards = sample_batch(shards, args.batch, rng)
            logits, value, size = model(x)
            masked_logits = logits.masked_fill(~masks, -1e9)

            policy_loss = F.cross_entropy(masked_logits, actions)
            value_loss = F.smooth_l1_loss(value, rewards)
            wager = actions == 3
            size_loss = F.smooth_l1_loss(size[wager], sizes[wager]) if wager.any() else torch.zeros((), dtype=x.dtype)
            loss = policy_loss + 0.35 * value_loss + 0.20 * size_loss

            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 2.0)
            optimizer.step()

            running += float(loss.item())
            running_policy += float(policy_loss.item())
            running_value += float(value_loss.item())
            running_size += float(size_loss.item())

            if step % max(1, steps_per_epoch // 10) == 0 or step == steps_per_epoch:
                print(
                    f"epoch {epoch}/{args.epochs} step {step}/{steps_per_epoch} "
                    f"loss={running / step:.4f} policy={running_policy / step:.4f} "
                    f"value={running_value / step:.4f} size={running_size / step:.4f}"
                )

        metrics = evaluate(model, shards, rng)
        print(
            f"epoch {epoch} eval: action_acc={metrics['accuracy']:.3f} "
            f"value_mae={metrics['value_mae']:.3f} size_mae={metrics['size_mae']:.3f}"
        )

        checkpoint = args.out.with_suffix(f".epoch-{epoch}.pt")
        checkpoint.parent.mkdir(parents=True, exist_ok=True)
        torch.save(model.state_dict(), checkpoint)

    export_model(model, args.out)
    final_checkpoint = args.out.with_suffix(".pt")
    torch.save(model.state_dict(), final_checkpoint)
    print(f"Exported browser weights: {args.out}")
    print(f"Saved PyTorch checkpoint: {final_checkpoint}")


if __name__ == "__main__":
    main()
