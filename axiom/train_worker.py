"""Isolated YOLO process keeps the WebUI responsive during CUDA training."""
import json
import sys
import time
from pathlib import Path

from .store import atomic_json


def main(config_path):
    import torch
    from ultralytics import YOLO
    cfg = json.loads(Path(config_path).read_text(encoding="utf-8"))
    s = cfg["settings"]
    run = Path(cfg["run_dir"])
    history = []
    started = time.monotonic()
    model = YOLO(s["train_model"])

    def stopping(trainer):
        if (run / "stop").exists():
            trainer.stop = True

    def batch(trainer):
        stopping(trainer)

    def epoch(trainer):
        metrics = {str(k): float(v) for k, v in trainer.metrics.items()}
        loss = trainer.tloss.detach().cpu().tolist() if trainer.tloss is not None else []
        if not isinstance(loss, list):
            loss = [loss]
        row = {"epoch": trainer.epoch + 1, "loss": sum(loss), **metrics}
        if history and history[-1]["epoch"] == row["epoch"]:
            history[-1] = row  # final validation can fire the callback again
        else:
            history.append(row)
        elapsed = time.monotonic() - started
        completed = trainer.epoch + 1
        atomic_json(run / "progress.json", {"stage": "training", "completed": completed, "total": s["epochs"],
                    "message": f"Epoch {completed}/{s['epochs']} · loss {row['loss']:.4f}", "history": history,
                    "eta": round(elapsed / completed * (s["epochs"] - completed))})
        stopping(trainer)

    model.add_callback("on_train_batch_end", batch)
    model.add_callback("on_fit_epoch_end", epoch)
    model.train(data=str(Path(cfg["dataset"]) / "data.yaml"), epochs=s["epochs"], imgsz=s["train_imgsz"],
                batch=s["train_batch"], device=0 if torch.cuda.is_available() else "cpu", workers=0,
                project=str(run), name="train", exist_ok=True, seed=s["seed"],
                cache=False, plots=False, amp=True, save=True, verbose=False)


if __name__ == "__main__":
    main(sys.argv[1])
