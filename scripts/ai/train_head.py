"""Train the murmur head on CirCor training patients (80 %). The test patients (20 %) are never touched here.

Run from backend/:  uv run --group ai python ../scripts/ai/train_head.py
Writes models/cardiophon/{murmur_head.pt, murmur_head.json, split.json, embeddings.npz}.
Recipe = CardioPHON's `train_mlp` (Adam 1e-4, StepLR 6/0.1, 20 epochs, batch 32), except class weights: inverse
class frequency, because CirCor has far more "absent" than "present" recordings.
"""

import hashlib
from datetime import UTC, datetime

import circor
import numpy as np
import torch

from app.services.ai import cardiophon

MODEL_VERSION = "1.0.0"  # bump on every retrain: stored with every AI result
EPOCHS, BATCH, LR = 20, 32, 1e-4


def main() -> None:
    recs = circor.recordings()
    test = circor.test_patients(recs)
    train = [r for r in recs if r.patient not in test]
    print(
        f"recordings {len(recs)} · train {len(train)} ({len({r.patient for r in train})} patients) · "
        f"test patients {len(test)}"
    )

    vectors = circor.embeddings(recs)
    x = torch.from_numpy(np.stack([vectors[r.file.name] for r in train]))
    y = torch.tensor([cardiophon.CLASSES.index(r.label) for r in train])
    counts = torch.bincount(y, minlength=len(cardiophon.CLASSES)).float()
    weights = counts.sum() / (len(counts) * counts)
    print("train per class:", dict(zip(cardiophon.CLASSES, counts.int().tolist(), strict=True)))

    torch.manual_seed(circor.SEED)
    head = cardiophon.murmur_head()
    head[0].mean.copy_(x.mean(0))  # statistics of the training patients only
    head[0].std.copy_(x.std(0).clamp_min(1e-6))
    loss_fn = torch.nn.CrossEntropyLoss(weight=weights)
    optimizer = torch.optim.Adam(head.parameters(), lr=LR)
    scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=6, gamma=0.1)
    generator = torch.Generator().manual_seed(circor.SEED)
    for epoch in range(1, EPOCHS + 1):
        head.train()
        order = torch.randperm(len(y), generator=generator)
        total, correct = 0.0, 0
        for start in range(0, len(y), BATCH):
            idx = order[start : start + BATCH]
            optimizer.zero_grad()
            out = head(x[idx])
            loss = loss_fn(out, y[idx])
            loss.backward()
            optimizer.step()
            total += loss.item() * len(idx)
            correct += (out.argmax(1) == y[idx]).sum().item()
        scheduler.step()
        print(f"epoch {epoch:2d}  loss {total / len(y):.3f}  train accuracy {correct / len(y):.1%}")

    circor.OUT.mkdir(parents=True, exist_ok=True)
    torch.save(head.state_dict(), circor.OUT / cardiophon.HEAD_FILE)
    split = sorted(test)
    circor.save_json(circor.OUT / "split.json", {"seed": circor.SEED, "test_patients": split})
    circor.save_json(
        circor.OUT / "murmur_head.json",
        {
            "model_name": "cardiophon-murmur",
            "model_version": MODEL_VERSION,
            "classes": list(cardiophon.CLASSES),
            "trained_at": datetime.now(UTC).isoformat(timespec="seconds"),
            "train_recordings": len(train),
            "train_per_class": dict(zip(cardiophon.CLASSES, counts.int().tolist(), strict=True)),
            "split_sha256": hashlib.sha256(",".join(split).encode()).hexdigest(),
            "recipe": {"epochs": EPOCHS, "batch": BATCH, "lr": LR, "class_weights": weights.tolist()},
        },
    )
    print("saved", circor.OUT / cardiophon.HEAD_FILE)


if __name__ == "__main__":
    main()
