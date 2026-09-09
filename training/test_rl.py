#!/usr/bin/env python3
"""Sanity checks for PPO-lite. Run: python training/test_rl.py"""
from __future__ import annotations

import math
import sys
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent))
from train import (
    RECORD_DTYPE_V3,
    Batch,
    PolicyValueNet,
    approx_kl,
    clipped_surrogate,
    legal_entropy,
    normalize_advantages,
    normalized_legal_entropy,
    ppo_loss,
    ppo_ratio,
    ppo_should_stop,
    PpoStats,
)


def main() -> None:
    assert RECORD_DTYPE_V3.itemsize == 672, RECORD_DTYPE_V3.itemsize

    new_lp = torch.tensor([math.log(0.4)])
    old_lp = torch.tensor([math.log(0.2)])
    ratio = ppo_ratio(new_lp, old_lp)
    assert math.isclose(float(ratio.item()), 2.0, rel_tol=1e-5)

    adv = torch.tensor([1.0])
    clipped = clipped_surrogate(ratio, adv, 0.15)
    assert math.isclose(float(clipped.item()), 1.15, rel_tol=1e-5)
    assert math.isclose(float(clipped_surrogate(ratio, torch.tensor([-1.0]), 0.15).item()), -2.0, rel_tol=1e-5)

    norm = normalize_advantages(torch.tensor([1.0, 3.0, 5.0]))
    assert math.isclose(float(norm.mean().item()), 0.0, abs_tol=1e-6)

    masks = torch.tensor([[True, True, False, False, False]])
    probs = torch.tensor([[0.5, 0.5, 0.9, 0.0, 0.0]])
    logp = torch.log(torch.tensor([[0.5, 0.5, 1e-8, 1e-8, 1e-8]]))
    ent = legal_entropy(probs, logp, masks)
    assert math.isclose(float(ent.item()), math.log(2), rel_tol=1e-5)
    norm_ent, valid = normalized_legal_entropy(ent, masks)
    assert bool(valid.item())
    assert math.isclose(float(norm_ent.item()), 1.0, rel_tol=1e-5)
    one_legal = torch.tensor([[True, False, False, False, False]])
    _, valid_one = normalized_legal_entropy(torch.tensor([0.0]), one_legal)
    assert not bool(valid_one.item())

    kl = approx_kl(torch.tensor([math.log(0.4)]), torch.tensor([math.log(0.2)]))
    assert math.isclose(float(kl.item()), math.log(2), rel_tol=1e-5)

    ok = PpoStats(kl=0.01, norm_entropy=0.7, logit_abs_max=4, value_mae=0.2, finite=True)
    assert ppo_should_stop(ok, start_norm_entropy=0.75, start_value_mae=0.2) is None
    assert ppo_should_stop(PpoStats(kl=0.04, norm_entropy=0.7, logit_abs_max=4, value_mae=0.2, finite=True), start_norm_entropy=0.75, start_value_mae=0.2) == "kl"
    assert ppo_should_stop(PpoStats(kl=0.01, norm_entropy=0.05, logit_abs_max=4, value_mae=0.2, finite=True), start_norm_entropy=0.8, start_value_mae=0.2) == "entropy-collapse"
    assert ppo_should_stop(PpoStats(kl=0.01, norm_entropy=0.7, logit_abs_max=40, value_mae=0.2, finite=True), start_norm_entropy=0.75, start_value_mae=0.2) == "logit-explode"
    assert ppo_should_stop(PpoStats(kl=0.01, norm_entropy=0.7, logit_abs_max=4, value_mae=0.9, finite=True), start_norm_entropy=0.75, start_value_mae=0.2) == "value-mae"
    assert ppo_should_stop(PpoStats(finite=False), start_norm_entropy=0.75, start_value_mae=0.2) == "non-finite"

    model = PolicyValueNet()
    x = torch.randn(32, 160)
    actions = torch.zeros(32, dtype=torch.long)
    sizes = torch.zeros(32)
    masks = torch.zeros(32, 5, dtype=torch.bool)
    masks[:, 0] = True
    rewards = torch.tanh(torch.randn(32))
    old_logprob = torch.log(torch.full((32,), 0.2))
    old_value = torch.zeros(32)
    logits, value, size = model(x)
    batch = Batch(x, actions, sizes, masks, rewards, old_logprob, old_value)
    loss, stats = ppo_loss(
        logits, value, size, batch, clip=0.15, entropy_coef=0.02, value_coef=0.5, size_coef=0.2
    )
    for name, number in stats.__dict__.items():
        if isinstance(number, float) and name != "finite" and not math.isfinite(number):
            raise SystemExit(f"non-finite {name}: {number}")
    if not stats.finite:
        raise SystemExit("ppo stats marked non-finite")
    loss.backward()
    print("ppo loss finite, dtype v3 itemsize=672, kl/clip/entropy tests passed")


if __name__ == "__main__":
    main()
