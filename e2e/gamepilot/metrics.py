"""Run metrics for delegated goal work (P2-0019 G1-G3), measured from the two channels the harness
already owns: the mod's read-only world_state export (polled on a side thread) and the run's own
exclusion windows. No new request logs are produced anywhere.

- G1 idle ratio: of unpaused active time, the fraction the body had no active input task
  (the bench's idle ratio: the body stands while the mind thinks). Target: at most 0.10.
- G2 skill gap: between one body task ending and the next starting (world running), the P95 in ms.
  Target: at most 200 ms.
- G3 stuck: stretches where the body had no task and was not moving while the world ran, for at
  least STUCK_S seconds; counted per active game hour with the recovery time (until it acts or
  moves again). Target: at most 1 per game hour, recovered within 5 s.

Nights are not work: the test wraps every sleep_night call (and similar non-work waits) in
`with metrics.night():`, and those windows are excluded from every metric. Samples are persisted
so a run's numbers can be recomputed without re-running the game.
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path

STUCK_S = 3.0
POLL_S = 0.5


class GoalMetrics:
    """`with GoalMetrics(world, dir) as m:` around the goal wait; `m.summary()` for results.json."""

    def __init__(self, world, art_dir: Path | None = None):
        self.world = world
        self.art_dir = Path(art_dir) if art_dir is not None else None
        self.samples: list[dict] = []          # one per world_state poll
        self.nights: list[tuple[float, float]] = []  # excluded windows (wall time)
        self._night_since: float | None = None
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def __enter__(self) -> "GoalMetrics":
        self._thread = threading.Thread(target=self._run, name="goal-metrics", daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        self._persist()

    def night(self) -> "_NightWindow":
        return _NightWindow(self)

    def _persist(self) -> None:
        if self.art_dir is None:
            return
        try:
            (self.art_dir / "metrics-samples.json").write_text(json.dumps({
                "samples": self.samples, "nights": self.nights,
            }, ensure_ascii=False), encoding="utf-8")
        except OSError:
            pass

    def _run(self) -> None:
        while not self._stop.wait(POLL_S):
            try:
                s = self.world.state()
            except Exception:
                continue  # the endpoint answers only while the save is loaded; skip the tick
            body = s.get("body") or {}
            self.samples.append({
                "t": round(time.time(), 3), "paused": bool(s.get("paused")), "day": s["time"]["day"],
                "clock": s["time"]["timeOfDay"], "task": body.get("activeTask"), "moving": body.get("moving"),
                "location": body.get("location"),
            })

    # -- metrics, from the recorded samples only
    def summary(self) -> dict:
        out = {"g1_idle_ratio": None, "g2_skill_gap_ms": None, "g3_stuck": None,
               "n_samples": len(self.samples), "excluded_night_s": round(sum(b - a for a, b in self.nights), 1)}
        active = [s for s in self.samples if not any(a <= s["t"] <= b for a, b in self.nights)]
        if len(active) < 4:
            return out
        unpaused = [s for s in active if not s["paused"]]
        if unpaused:
            out["g1_idle_ratio"] = round(sum(1 for s in unpaused if s["task"] is None) / len(unpaused), 3)
        gaps: list[float] = []
        stuck: list[dict] = []
        run: list[dict] = []
        for s in unpaused:
            idle_now = s["task"] is None and not s["moving"]
            if idle_now:
                run.append(s)
                continue
            if run:
                self._close_run(run, gaps, stuck)
                run = []
        if run:
            self._close_run(run, gaps, stuck)
        if gaps:
            ordered = sorted(gaps)
            p95 = ordered[min(len(ordered) - 1, round(0.95 * (len(ordered) - 1)))]
            out["g2_skill_gap_ms"] = {"n": len(ordered), "p50": round(ordered[len(ordered) // 2]),
                                      "p95": round(p95), "max": round(ordered[-1])}
        hours = self._game_minutes(unpaused) / 60
        out["g3_stuck"] = {
            "events": len(stuck), "per_game_hour": round(len(stuck) / hours, 2) if hours > 0 else None,
            "mean_recovery_ms": round(sum(e["recovery_ms"] for e in stuck) / len(stuck)) if stuck else 0,
            "worst_recovery_ms": max((e["recovery_ms"] for e in stuck), default=0),
            "game_minutes": round(self._game_minutes(unpaused), 1), "detail": stuck[:20],
        }
        return out

    def _close_run(self, run: list[dict], gaps: list[float], events: list[dict]) -> None:
        # One idle run both closes a skill gap (time with no task between actions) and, if it
        # lasted, is a stuck event whose recovery is the time from its start to the body acting.
        gaps.append((run[-1]["t"] - run[0]["t"]) * 1000 + POLL_S * 1000)
        held = run[-1]["t"] - run[0]["t"]
        if held >= STUCK_S:
            events.append({"at": time.strftime("%H:%M:%S", time.localtime(run[0]["t"])),
                           "day": run[0]["day"], "clock": run[0]["clock"], "location": run[0].get("location"),
                           "held_ms": round(held * 1000), "recovery_ms": round(held * 1000)})

    @staticmethod
    def _game_minutes(samples: list[dict]) -> float:
        """Elapsed game time across samples: clock deltas per day, plus whole days between them."""
        minutes = 0.0
        last: dict | None = None
        for s in samples:
            if last is not None:
                if s["day"] == last["day"]:
                    minutes += max(0, s["clock"] - last["clock"]) / 10
                else:
                    minutes += (2400 - last["clock"]) / 10 + (s["clock"] - 600) / 10  # through 2:00, then from 6:00
            last = s
        return minutes


class _NightWindow:
    """Excludes the wrapped wall-time window from every metric (the nightly sleep, not work)."""

    def __init__(self, metrics: GoalMetrics):
        self.metrics = metrics

    def __enter__(self) -> None:
        self.metrics._night_since = time.time()

    def __exit__(self, *exc) -> None:
        if self.metrics._night_since is not None:
            self.metrics.nights.append((self.metrics._night_since, time.time()))
            self.metrics._night_since = None
