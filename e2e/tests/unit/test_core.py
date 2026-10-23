"""Game-free self-tests of the gamepilot core. These run anywhere pytest does (no game, no display input)."""
import time

import numpy as np
from PIL import Image

import gamepilot as gp
from gamepilot import vision


def test_template_match_finds_planted_patch():
    rng = np.random.default_rng(7)
    frame = rng.integers(0, 255, (240, 320, 3), dtype=np.uint8)
    patch = frame[90:130, 150:200].copy()
    score, (x, y) = vision.find_template(Image.fromarray(frame), Image.fromarray(patch), stride=1)
    assert (x, y) == (150, 90) and score > 0.99


def test_template_match_rejects_absent_patch():
    rng = np.random.default_rng(8)
    frame = Image.fromarray(rng.integers(0, 255, (160, 200, 3), dtype=np.uint8))
    other = Image.fromarray(np.random.default_rng(9).integers(0, 255, (20, 20, 3), dtype=np.uint8))
    score, _ = vision.find_template(frame, other, stride=1)
    assert score < 0.6


def test_diff_and_color_fraction():
    a = Image.new("RGB", (100, 100), (10, 10, 10))
    b = a.copy()
    b.paste((250, 0, 0), (0, 0, 50, 100))
    assert abs(vision.diff_fraction(a, b) - 0.5) < 1e-6
    assert vision.diff_fraction(a, b, region=(0.5, 0, 1, 1)) == 0.0
    assert abs(vision.color_fraction(b, (250, 0, 0), tol=5) - 0.5) < 1e-6


def test_text_tail_survives_truncation(tmp_path):
    p = tmp_path / "smapi.txt"
    p.write_text("x" * 50 + "\n", encoding="utf-8")
    tail = gp.TextTail(p)
    p.write_text("[21:52:29 INFO  DSH Player2 Companion] hello\n", encoding="utf-8")  # relaunch truncates
    assert tail.wait_for(r"Player2 Companion\] hello", timeout=1)


def test_timeline_and_summary():
    t = gp.Timeline()
    t.mark("a")
    time.sleep(0.02)
    t.mark("b")
    assert 15 < t.ms("a", "b") < 200
    s = gp.summarize([100, 200, 300, 400, 1000])
    assert s["p50"] == 300 and s["max"] == 1000


def test_goal_metrics_math():
    from gamepilot.metrics import GoalMetrics

    m = GoalMetrics(world=None)
    t0 = time.time() - 60
    # 20 half-second samples, one turn in flight throughout: tasks in 0-5, a
    # 3.5 s no-task standstill in 6-12 (one stuck event, one 3.5 s skill gap),
    # tasks again 13-15, then 16-19 idle but moving (idle for G1, not stuck).
    def sample(i, task, moving=True):
        return {"t": t0 + i * 0.5, "paused": False, "day": 1, "clock": 600 + i * 10,
                "task": task, "moving": moving}
    m.samples = [sample(i, 11 if i < 6 else (12 if 13 <= i <= 15 else None),
                        moving=not (6 <= i <= 12)) for i in range(20)]
    m.turns = [(t0 - 1, t0 + 11)]
    out = m.summary()
    assert out["n_samples"] == 20
    assert out["g1_idle_ratio"] == round(11 * 0.5 / (20 * 0.5), 3)  # no-task samples while the turn ran
    assert out["g2_skill_gap_ms"] == {"n": 1, "p50": 3500, "p95": 3500, "max": 3500}
    assert out["g3_stuck"]["events"] == 1
    assert out["g3_stuck"]["detail"][0]["recovery_ms"] == 3000  # first idle sample to acting again
    assert out["g3_stuck"]["per_game_hour"] == round(1 / (19 * 10 / 10 / 60), 2)
