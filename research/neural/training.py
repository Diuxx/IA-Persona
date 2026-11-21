"""Train only on designated train windows; separate memorization sanity check."""
import random
from time import perf_counter

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset, Subset

from neural.model import INPUT_KEYS, MotionForecaster, motion_loss


def seed_everything(seed):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


class LearningWindows(Dataset):
    def __init__(self, source):
        self.source = source

    def __len__(self):
        return len(self.source)

    def __getitem__(self, index):
        sample = self.source[index]
        observed = {key: torch.from_numpy(sample["inputs"][key]) for key in INPUT_KEYS}
        expected = torch.from_numpy(sample["targets"]["rasters"])
        return observed, expected


def move_batch(batch, device):
    observed, expected = batch
    return {key: value.to(device) for key, value in observed.items()}, expected.to(device)


def batch_loss(model, batch, device):
    observed, expected = move_batch(batch, device)
    return motion_loss(model(observed), expected, observed["rasters"][:, -1])


def train_step(model, optimizer, batch, device):
    model.train()
    optimizer.zero_grad(set_to_none=True)
    loss = batch_loss(model, batch, device)
    if not torch.isfinite(loss).item():
        raise RuntimeError("Nonfinite training loss")
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0, error_if_nonfinite=True)
    optimizer.step()
    return float(loss.detach())


def sanity_check(source, device, seed, width, learning_rate, steps):
    """Memorize two fixed training windows with an isolated disposable model."""
    seed_everything(seed)
    chosen = sorted(set((0, len(source)//2)))
    batch = next(iter(DataLoader(Subset(source, chosen), batch_size=len(chosen), num_workers=0)))
    model = MotionForecaster(width).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
    model.eval()
    with torch.no_grad():
        initial = float(batch_loss(model, batch, device))
    losses = [train_step(model, optimizer, batch, device) for _ in range(steps)]
    model.eval()
    with torch.no_grad():
        final = float(batch_loss(model, batch, device))
    return {"windowIndices": chosen, "steps": steps, "initialLoss": initial, "finalLoss": final,
            "lossDecreased": final < initial, "losses": losses}


def train(source, device, seed, width, learning_rate, epochs, batch_size):
    seed_everything(seed)
    model = MotionForecaster(width).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
    loader = DataLoader(source, batch_size=batch_size, shuffle=True, num_workers=0,
                        generator=torch.Generator().manual_seed(seed))
    history = []
    for epoch in range(1, epochs+1):
        start = perf_counter()
        total, count = 0., 0
        for batch in loader:
            size = len(batch[1])
            total += train_step(model, optimizer, batch, device)*size
            count += size
        result = {"epoch": epoch, "loss": total/count, "seconds": perf_counter()-start}
        history.append(result)
        print(f"epoch {epoch}/{epochs}: train loss={result['loss']:.6f}", flush=True)
    return model, history
