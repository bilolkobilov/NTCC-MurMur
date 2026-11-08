"""Training a murmur head and measuring it — shared by experiment.py, train_head.py and evaluate.py.

Screening metrics (one decision per recording; owner 2026-11-08: catch more murmurs, ~80 % sensitivity):
  flagged     = P(present) ≥ threshold  → the doctor sees "Murmur detected"
  sensitivity = flagged among true present recordings
  specificity = NOT flagged among true absent recordings (a "too poor to judge" answer is not a false alarm)
  no answer   = 3-class heads only: not flagged and "unknown" beats "absent"
"""

import random
from dataclasses import asdict, dataclass

import circor  # also puts backend/ on sys.path for `app`
import numpy as np
import torch

from app.services.ai import cardiophon

TARGET_SENSITIVITY = 0.80
FOLDS = 5


@dataclass(frozen=True)
class Config:
    name: str
    window_s: float | None  # None = one embedding for the whole recording
    classes: tuple[str, ...] = cardiophon.CLASSES  # ("present", "absent") drops CirCor's "unknown" recordings
    arch: str = "mlp"
    epochs: int = 20
    lr: float = 1e-4
    weight_decay: float = 0.0
    batch: int = 32
    step_lr: bool = True  # CardioPHON's StepLR(6, 0.1)

    def as_dict(self) -> dict:
        return asdict(self)


def training_rows(cfg: Config, recs, vectors) -> tuple[torch.Tensor, torch.Tensor]:
    """One row per recording (or per window) with its recording's label; labels outside cfg.classes left out."""
    xs, ys = [], []
    for rec in recs:
        if rec.label not in cfg.classes:
            continue
        rows = np.atleast_2d(vectors[rec.file.name]).astype(np.float32)
        xs.append(rows)
        ys.extend([cfg.classes.index(rec.label)] * len(rows))
    return torch.from_numpy(np.concatenate(xs)), torch.tensor(ys)


def fit(cfg: Config, x: torch.Tensor, y: torch.Tensor, seed: int, log=None) -> torch.nn.Sequential:
    torch.manual_seed(seed)
    head = cardiophon.murmur_head(cfg.arch, len(cfg.classes))
    head[0].mean.copy_(x.mean(0))  # statistics of the training rows only
    head[0].std.copy_(x.std(0).clamp_min(1e-6))
    counts = torch.bincount(y, minlength=len(cfg.classes)).float()
    loss_fn = torch.nn.CrossEntropyLoss(weight=counts.sum() / (len(counts) * counts.clamp_min(1)))
    optimizer = torch.optim.Adam(head.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    scheduler = torch.optim.lr_scheduler.StepLR(optimizer, step_size=6, gamma=0.1) if cfg.step_lr else None
    generator = torch.Generator().manual_seed(seed)
    for epoch in range(1, cfg.epochs + 1):
        head.train()
        order = torch.randperm(len(y), generator=generator)
        total = 0.0
        for start in range(0, len(y), cfg.batch):
            idx = order[start : start + cfg.batch]
            optimizer.zero_grad()
            loss = loss_fn(head(x[idx]), y[idx])
            loss.backward()
            optimizer.step()
            total += loss.item() * len(idx)
        if scheduler:
            scheduler.step()
        if log:
            log(f"epoch {epoch:2d}  loss {total / len(y):.3f}")
    head.eval()
    return head


@torch.inference_mode()
def recording_probs(head: torch.nn.Sequential, recs, vectors) -> np.ndarray:
    """Class probabilities per recording: the average over its windows."""
    out = []
    for rec in recs:
        rows = torch.from_numpy(np.atleast_2d(vectors[rec.file.name]).astype(np.float32))
        out.append(head(rows).softmax(1).mean(0).numpy())
    return np.stack(out)


def auc(scores: np.ndarray, positive: np.ndarray) -> float:
    """Area under the ROC curve (probability that a random murmur recording scores above a random normal one)."""
    pos, neg = scores[positive], scores[~positive]
    ranks = np.argsort(np.argsort(np.concatenate([pos, neg]))) + 1.0
    return float((ranks[: len(pos)].sum() - len(pos) * (len(pos) + 1) / 2) / (len(pos) * len(neg)))


def threshold_for(p_present: np.ndarray, truth: list[str], sensitivity: float = TARGET_SENSITIVITY) -> float:
    """The highest threshold that still flags at least `sensitivity` of the true murmur recordings."""
    scores = np.sort(p_present[np.array(truth) == "present"])[::-1]
    return float(scores[max(0, int(np.ceil(sensitivity * len(scores))) - 1)])


def screening(classes, probs: np.ndarray, truth: list[str], threshold: float | None) -> dict:
    """threshold None = the most likely answer wins (argmax), as in 1.0.0."""
    truth_a = np.array(truth)
    p_present = probs[:, classes.index("present")]
    flagged = probs.argmax(1) == classes.index("present") if threshold is None else p_present >= threshold
    no_answer = np.zeros(len(truth), bool)
    if "unknown" in classes:
        no_answer = ~flagged & (probs[:, classes.index("unknown")] > probs[:, classes.index("absent")])
    present, absent = truth_a == "present", truth_a == "absent"
    return {
        "sensitivity": float(flagged[present].mean()),
        "specificity": float((~flagged[absent]).mean()),
        "no_answer": float(no_answer[present | absent].mean()),
        "auc": auc(p_present[present | absent], present[present | absent]),
        "threshold": threshold,
        "n_present": int(present.sum()),
        "n_absent": int(absent.sum()),
    }


def folds(train_recs) -> dict[str, int]:
    """Patient → fold 0..4, balanced per patient label, seeded."""
    by_label: dict[str, list[str]] = {}
    for patient, label in sorted(circor.patient_label(train_recs).items()):
        by_label.setdefault(label, []).append(patient)
    rng, fold_of = random.Random(circor.SEED + 1), {}
    for patients in by_label.values():
        rng.shuffle(patients)
        fold_of.update({p: i % FOLDS for i, p in enumerate(patients)})
    return fold_of


def cross_validate(cfg: Config, train_recs, fold_of) -> dict:
    """Out-of-fold probabilities for every training recording, and the screening numbers they give."""
    vectors = circor.embeddings(train_recs, cfg.window_s)
    probs = np.zeros((len(train_recs), len(cfg.classes)))
    for k in range(FOLDS):
        fit_recs = [r for r in train_recs if fold_of[r.patient] != k]
        held = [i for i, r in enumerate(train_recs) if fold_of[r.patient] == k]
        head = fit(cfg, *training_rows(cfg, fit_recs, vectors), seed=circor.SEED + k)
        probs[held] = recording_probs(head, [train_recs[i] for i in held], vectors)
    truth = [r.label for r in train_recs]
    default = screening(cfg.classes, probs, truth, None)
    t80 = threshold_for(probs[:, cfg.classes.index("present")], truth)
    return {"probs": probs, "default": default, "at80": screening(cfg.classes, probs, truth, t80)}
