"""Run metrics for delegated goal work (P2-0019 G1-G3), measured from the two channels the harness
already owns: the mod's read-only world_state export (polled on a side thread) and the mod's own
`Player2 sent:/turn ended:` oracle lines. No new request logs are produced anywhere.

- G1 idle ratio: of the wall time a DSH turn was in flight, the fraction the body had no active
  input task while the world was running. Target: at most 0.10.
- G2 skill gap: between one body task ending and the next starting (world running), the P95 in ms.
  Target: at most 200 ms.
- G3 stuck: runs where the body had no task and was not moving while the world ran, for at least
  STUCK_S seconds; counted per elapsed game hour with the recovery time (until it acts or moves
  again). Target: at most 1 per game hour, recovered within 5 s.
"""
from __future__ import annotations

import threading
import time

SENT = "Player2 sent: "
TURN_ENDED = "Player2 turn ended: "

STUCK_S = 3.0
POLL_S = 0.5


class GoalMetrics:
    """`with GoalMetrics(world) as m:` around the goal wait; then `m.summary()` for results.json."""

    def __init__(self, world):
        self.world = world
        self.samples: list[dict] = []          # one per world_state poll
        self.turns: list[tuple[float, float]] = []  # [sent, turn ended] wall windows
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._seen_line = 0

    def __enter__(self) -> "GoalMetrics":
        self._thread = threading.Thread(target=self._run, name="goal-metrics", daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)

    def _run(self) -> None:
        while not self._stop.wait(POLL_S):
            try:
                s = self.world.state()
            except Exception:
                continue  # the endpoint answers only while the save is loaded; skip the tick
            body = s.get("body") or {}
            self.samples.append({
                "t": time.time(), "paused": bool(s.get("paused")), "day": s["time"]["day"],
                "clock": s["time"]["timeOfDay"], "task": body.get("activeTask"), "moving": body.get("moving"),
            })
            self._scan_turns()

    def _scan_turns(self) -> None:
        smapi = self.world.smapi
        if smapi is None:
            return
        smapi.poll()
        lines = smapi.lines[self._seen_line:]
        self._seen_line = len(smapi.lines)
        open_at: float | None = None
        for seen, line in lines:
            if SENT in line:
                open_at = seen
            elif TURN_ENDED in line and open_at is not None:
                self.turns.append((open_at, seen))
                open_at = None

    # -- metrics, from the recorded samples only
    def summary(self) -> dict:
        out = {"g1_idle_ratio": None, "g2_skill_gap_ms": None, "g3_stuck": None, "n_samples": len(self.samples)}
        if len(self.samples) < 4:
            return out
        dt = POLL_S
        in_flight = 0.0
        idle = 0.0
        for s in self.samples:
            if any(a <= s["t"] <= b for a, b in self.turns):
                in_flight += dt
                if not s["paused"] and s["task"] is None:
                    idle += dt
        gaps: list[float] = []
        stuck_events: list[dict] = []
        idle_run: list[dict] = []
        game_minutes = self._game_minutes()
        for s in self.samples:
            stuck_now = not s["paused"] and s["task"] is None and not s["moving"]
            if stuck_now:
                idle_run.append(s)
                continue
            if idle_run:
                self._close_run(idle_run, gaps, stuck_events)
                idle_run = []
        if idle_run:
            self._close_run(idle_run, gaps, stuck_events)
        if in_flight > 0:
            out["g1_idle_ratio"] = round(idle / in_flight, 3)
        if gaps:
            ordered = sorted(gaps)
            p95 = ordered[min(len(ordered) - 1, round(0.95 * (len(ordered) - 1)))]
            out["g2_skill_gap_ms"] = {"n": len(ordered), "p50": round(ordered[len(ordered) // 2]),
                                      "p95": round(p95), "max": round(ordered[-1])}
        hours = game_minutes / 60
        out["g3_stuck"] = {
            "events": len(stuck_events), "per_game_hour": round(len(stuck_events) / hours, 2) if hours > 0 else None,
            "mean_recovery_ms": round(sum(e["recovery_ms"] for e in stuck_events) / len(stuck_events)) if stuck_events else 0,
            "worst_recovery_ms": max((e["recovery_ms"] for e in stuck_events), default=0),
            "game_minutes": round(game_minutes, 1), "detail": stuck_events[:20],
        }
        return out

    def _close_run(self, run: list[dict], gaps: list[float], events: list[dict]) -> None:
        # One idle run both closes a skill gap (time with no task between actions) and, if it
        # lasted, is a stuck event whose recovery is the time from its start to the body acting.
        gaps.append((run[-1]["t"] - run[0]["t"]) * 1000 + POLL_S * 1000)
        held = run[-1]["t"] - run[0]["t"]
        if held >= STUCK_S:
            events.append({"at": time.strftime("%H:%M:%S", time.localtime(run[0]["t"])),
                           "day": run[0]["day"], "clock": run[0]["clock"],
                           "held_ms": round(held * 1000), "recovery_ms": round(held * 1000)})

    def _game_minutes(self) -> float:
        """Elapsed game time across samples: clock deltas per day, plus whole days between them."""
        minutes = 0.0
        last: dict | None = None
        for s in self.samples:
            if last is not None:
                if s["day"] == last["day"]:
                    minutes += max(0, s["clock"] - last["clock"]) / 10
                else:
                    minutes += (2400 - last["clock"]) / 10 + (s["clock"] - 600) / 10  # through 2:00, then from 6:00
            last = s
        return minutes
