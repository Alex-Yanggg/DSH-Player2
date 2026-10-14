"""Game-free self-tests of the gamepilot core. These run anywhere pytest does (no game, no display input)."""
import json
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


def test_jsonl_tail_sees_only_new_records(tmp_path):
    p = tmp_path / "log.jsonl"
    p.write_text(json.dumps({"code": "OLD"}) + "\n", encoding="utf-8")
    tail = gp.JsonlTail(p)
    with open(p, "a", encoding="utf-8") as f:
        f.write(json.dumps({"code": "NEW", "at": "2026-09-08T11:54:48.9891860+00:00"}) + "\n")
    hit = tail.wait_for(lambda r: r.get("code") == "NEW", timeout=1)
    assert hit and not tail.with_code("OLD")
    assert abs(gp.parse_iso("2026-09-08T11:54:48.9891860+00:00") - 1788868488.989186) < 1e-3


def test_text_tail_survives_truncation(tmp_path):
    p = tmp_path / "smapi.txt"
    p.write_text("x" * 50 + "\n", encoding="utf-8")
    tail = gp.TextTail(p)
    p.write_text("[21:52:29 INFO  DSH Player2 Companion] hello\n", encoding="utf-8")  # relaunch truncates
    assert tail.wait_for(r"Player2 Companion\] hello", timeout=1)


def test_dirwatch_keeps_transient_files(tmp_path):
    w = gp.DirWatch(tmp_path)
    f = tmp_path / "turn.json"
    f.write_text(json.dumps({"a": {"companion": {"distance": 3.5}}}), encoding="utf-8")
    w.poll()
    f.unlink()  # consumed by the other side
    (_, doc), = list(w.json_files())
    assert gp.find_key(doc, "distance") == 3.5


def test_timeline_and_summary():
    t = gp.Timeline()
    t.mark("a")
    time.sleep(0.02)
    t.mark("b")
    assert 15 < t.ms("a", "b") < 200
    s = gp.summarize([100, 200, 300, 400, 1000])
    assert s["p50"] == 300 and s["max"] == 1000
