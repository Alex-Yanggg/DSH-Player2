"""A run's event timeline. Marks are monotonic-clock stamps; latencies are differences between marks, so the
"feel" numbers (key -> reply, command -> first step) come from one clock and never from log wall-clocks."""
from __future__ import annotations

import statistics
import time
from dataclasses import dataclass, field


@dataclass
class Timeline:
    marks: dict[str, float] = field(default_factory=dict)
    order: list[str] = field(default_factory=list)

    def mark(self, name: str, at: float | None = None) -> float:
        t = time.perf_counter() if at is None else at
        self.marks[name] = t
        self.order.append(name)
        return t

    def ms(self, start: str, end: str) -> float:
        return (self.marks[end] - self.marks[start]) * 1000.0

    def as_dict(self) -> dict:
        if not self.order:
            return {}
        t0 = self.marks[self.order[0]]
        return {n: round((self.marks[n] - t0) * 1000.0, 1) for n in self.order}


def summarize(samples_ms: list[float]) -> dict:
    s = sorted(samples_ms)
    if not s:
        return {"n": 0}

    def pct(p: float) -> float:
        return s[min(len(s) - 1, int(round(p * (len(s) - 1))))]

    return {"n": len(s), "min": round(s[0]), "p50": round(pct(0.5)), "p95": round(pct(0.95)), "max": round(s[-1]),
            "mean": round(statistics.fmean(s))}
