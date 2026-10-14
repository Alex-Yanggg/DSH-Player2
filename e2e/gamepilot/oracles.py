"""Observation channels that need no cooperation from the game's API: tail a text log, tail a JSONL log,
watch a directory for transient files. Each is positioned at "now" on construction, so a test only ever
sees what happened after it started looking."""
from __future__ import annotations

import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterator


def parse_iso(value: str) -> float:
    """ISO-8601 with 7 fractional digits (.NET) -> epoch seconds."""
    value = re.sub(r"(\.\d{6})\d+", r"\1", value.replace("Z", "+00:00"))
    return datetime.fromisoformat(value).astimezone(timezone.utc).timestamp()


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


class JsonlTail(_Tail):
    def __init__(self, path: Path):
        super().__init__(path)
        self.records: list[tuple[float, dict]] = []

    def poll(self) -> list[dict]:
        out = []
        for ln in self._read_new().splitlines():
            try:
                out.append(json.loads(ln))
            except json.JSONDecodeError:
                continue
        now = time.perf_counter()
        self.records += [(now, r) for r in out]
        return out

    def wait_for(self, pred: Callable[[dict], bool], timeout: float, since: int = 0) -> tuple[float, dict] | None:
        deadline = time.monotonic() + timeout
        while True:
            self.poll()
            for seen, rec in self.records[since:]:
                if pred(rec):
                    return seen, rec
            if time.monotonic() >= deadline:
                return None
            time.sleep(0.05)

    def with_code(self, code: str) -> list[tuple[float, dict]]:
        self.poll()
        return [(t, r) for t, r in self.records if r.get("code") == code]


class DirWatch:
    """Polls a directory and keeps a copy of every file it ever sees - for lanes (like the social inbox)
    whose files are deleted the moment they are consumed."""

    def __init__(self, directory: Path, pattern: str = "*"):
        """`pattern` is a glob under `directory`, so a lane whose parent directories appear later is followed."""
        self.dir = Path(directory)
        self.pattern = pattern
        self.seen: dict[str, tuple[float, bytes]] = {}

    def poll(self) -> list[str]:
        new = []
        if self.dir.exists():
            for p in self.dir.glob(self.pattern):
                key = str(p)
                if p.is_file() and key not in self.seen:
                    try:
                        self.seen[key] = (time.perf_counter(), p.read_bytes())
                        new.append(key)
                    except OSError:
                        pass  # being written or already consumed; next poll
        return new

    def json_files(self) -> Iterator[tuple[float, dict]]:
        for t, raw in self.seen.values():
            try:
                yield t, json.loads(raw.decode("utf-8-sig"))
            except (json.JSONDecodeError, UnicodeDecodeError):
                continue


def find_key(obj, key: str):
    """First value of `key` anywhere in a nested JSON structure (schemas drift; the oracle shouldn't)."""
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            r = find_key(v, key)
            if r is not None:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = find_key(v, key)
            if r is not None:
                return r
    return None
