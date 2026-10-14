"""Per-run artifact directory: screenshots, timelines and a machine-readable results file."""
from __future__ import annotations

import json
import time
from pathlib import Path

from PIL import Image


class RunArtifacts:
    def __init__(self, root: Path, run_id: str | None = None):
        self.run_id = run_id or time.strftime("%Y%m%d-%H%M%S")
        self.dir = Path(root) / self.run_id
        self.dir.mkdir(parents=True, exist_ok=True)
        self.results: dict[str, dict] = {}

    def shot(self, name: str, img: Image.Image) -> Path:
        p = self.dir / f"{name}.png"
        img.save(p)
        return p

    def record(self, test: str, **data) -> None:
        self.results.setdefault(test, {}).update(data)
        (self.dir / "results.json").write_text(
            json.dumps(self.results, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
