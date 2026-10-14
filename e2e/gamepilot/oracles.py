"""Observation channels that need no cooperation from the game's API: tail a text log. A tail is positioned at
"now" on construction, so a test only ever sees what happened after it started looking."""
from __future__ import annotations

import re
import time
from pathlib import Path


class _Tail:
    def __init__(self, path: Path, from_start: bool = False):
        self.path = Path(path)
        self._pos = 0 if from_start or not self.path.exists() else self.path.stat().st_size

    def _read_new(self) -> str:
        if not self.path.exists():
            return ""
        size = self.path.stat().st_size
        if size < self._pos:  # rotated / truncated by a relaunch
            self._pos = 0
        with open(self.path, "rb") as f:
            f.seek(self._pos)
            data = f.read()
            self._pos = f.tell()
        return data.decode("utf-8", errors="replace")


class TextTail(_Tail):
    def __init__(self, path: Path, from_start: bool = False):
        super().__init__(path, from_start)
        self.lines: list[tuple[float, str]] = []  # (monotonic when we saw it, text)

    def poll(self) -> list[str]:
        new = [ln for ln in self._read_new().splitlines() if ln.strip()]
        now = time.perf_counter()
        self.lines += [(now, ln) for ln in new]
        return new

    def wait_for(self, pattern: str, timeout: float, since: int = 0) -> tuple[float, str] | None:
        rx = re.compile(pattern)
        deadline = time.monotonic() + timeout
        while True:
            self.poll()
            for seen, ln in self.lines[since:]:
                if rx.search(ln):
                    return seen, ln
            if time.monotonic() >= deadline:
                return None
            time.sleep(0.05)

    def grep(self, pattern: str) -> list[str]:
        self.poll()
        rx = re.compile(pattern)
        return [ln for _, ln in self.lines if rx.search(ln)]
