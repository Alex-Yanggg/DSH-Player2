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


def test_goal_metrics_math(tmp_path):
    from gamepilot.metrics import GoalMetrics

    t0 = time.time() - 60
    # 20 half-second unpaused samples: tasks in 0-5, a 3.5 s no-task standstill in 6-12
    # (one stuck event, one 3.5 s skill gap), a task again at 13, then 14-19 inside the
    # excluded night window (t0+7.0..t0+10.0).
    def sample(i, task, moving=True):
        return {"t": t0 + i * 0.5, "paused": False, "day": 1, "clock": 600 + i * 10,
                "task": task, "moving": moving, "location": "Farm"}
    with GoalMetrics(world=None, art_dir=tmp_path) as m:
        m.samples = [sample(i, 11 if i < 6 else (12 if 13 <= i <= 15 else None),
                            moving=not (6 <= i <= 12)) for i in range(20)]
        m.nights = [(t0 + 7.0, t0 + 10.0)]
        out = m.summary()
    assert out["n_samples"] == 20
    assert out["g1_idle_ratio"] == 0.5  # 7 no-task samples over the 14 unpaused active ones
    assert out["g2_skill_gap_ms"] == {"n": 1, "p50": 3500, "p95": 3500, "max": 3500}
    assert out["g3_stuck"]["events"] == 1
    assert out["g3_stuck"]["detail"][0]["recovery_ms"] == 3000  # first idle sample to acting again
    assert out["g3_stuck"]["game_minutes"] == 13.0  # 13 one-minute clock steps across the active samples
    assert (tmp_path / "metrics-samples.json").exists()


def test_strip_farm_stones_removes_stones_only_from_the_farm(tmp_path, monkeypatch):
    """The Hill-Top farm ships and regrows quarry stones: the strip takes every Stone object out of the
    Farm block, leaves the rest of the farm and every other location alone, and reports the count."""
    from games.stardew import Paths, strip_farm_stones

    saves = tmp_path / "Saves"
    save = saves / "E2E_991234567"
    save.mkdir(parents=True)
    xml = (
        '<locations><GameLocation xsi:type="Farm"><objects>'
        '<item><key><Vector2><X>5</X><Y>21</Y></Vector2></key><value><Object><name>Stone</name><itemId>343</itemId></Object></value></item>'
        '<item><key><Vector2><X>6</X><Y>21</Y></Vector2></key><value><Object><name>Weeds</name><itemId>675</itemId></Object></value></item>'
        "</objects></GameLocation>"
        '<GameLocation xsi:type="UndergroundMine1"><objects>'
        '<item><key><Vector2><X>1</X><Y>1</Y></Vector2></key><value><Object><name>Stone</name><itemId>343</itemId></Object></value></item>'
        "</objects></GameLocation></locations>"
    )
    (save / "E2E_991234567").write_text(xml, encoding="utf-8")
    paths = Paths()
    monkeypatch.setattr(paths, "saves", saves)
    removed = strip_farm_stones(paths, 991234567)
    assert removed == 1
    after = (save / "E2E_991234567").read_text(encoding="utf-8")
    farm = after.split('xsi:type="Farm"')[1].split("</GameLocation>")[0]
    mine = after.split('xsi:type="UndergroundMine1"')[1]
    assert "Stone" not in farm and "Weeds" in farm
    assert "<name>Stone</name>" in mine  # mine floors keep their stones


def test_a_template_without_a_cabin_is_refused(tmp_path, monkeypatch):
    """The companion is seated in a farm cabin; a template without one would load single-player with no body."""
    import pytest
    from games.stardew import Paths, build_test_save

    saves = tmp_path / "Saves"
    (saves / "t_1").mkdir(parents=True)
    (saves / "t_1" / "t_1").write_text('<locations><GameLocation xsi:type="Farm" /></locations>', encoding="utf-8")
    paths = Paths()
    monkeypatch.setattr(paths, "saves", saves)
    with pytest.raises(RuntimeError, match="no cabin"):
        build_test_save(paths, "t_1")


def test_bedtime_answers_only_a_question_on_screen():
    """Y without the sleep question opens the emote wheel, which then swallows the walk back into bed:
    the host retries the bed and taps Y only once the question is on screen."""
    from games.stardew import StardewGame

    class Keys:
        def __init__(self): self.log = []
        def hold(self, key, _s): self.log.append(key)
        def tap(self, key, **_): self.log.append(key)

    class Log:
        lines = []
        def poll(self): pass
        def wait_for(self, _pattern, _timeout, since=0): return "y" in keys.log

    keys = Keys()
    game = StardewGame.__new__(StardewGame)
    game.kb, game.smapi = keys, Log()
    game.refocus = lambda: None
    game.shot = lambda _name: None
    questions = iter([False, False, True])
    game._wait_dialog = lambda _t: next(questions)
    game._wait_night_end = lambda _mark: False
    try:
        game.sleep_night(4)
    except TimeoutError as stop:
        assert "night never ended" in str(stop)  # past the bed: the host did get in
    assert keys.log == ["a", "d", "a", "d", "a", "d", "y"]


def test_grab_tries_the_front_first_and_tags_a_printwindow_frame(monkeypatch):
    """PrintWindow can return an old frame of the game: grab brings the game forward and reads DXGI first, and a
    frame that still had to come from PrintWindow says so."""
    from gamepilot import capture

    foreground = {"hwnd": 1}
    focused = []
    monkeypatch.setattr(capture.user32, "GetForegroundWindow", lambda: foreground["hwnd"], raising=False)
    monkeypatch.setattr(capture, "focus", lambda hwnd, attempts=8: focused.append(hwnd) or False)
    monkeypatch.setattr(capture, "_dxgi", lambda rect: Image.new("RGB", (2, 2), "red"))
    monkeypatch.setattr(capture, "print_window", lambda hwnd, rect: Image.new("RGB", (2, 2), "blue"))

    stale = capture.grab(gp.Rect(0, 0, 2, 2), hwnd=7)
    assert focused == [7] and stale.info.get("backend") == "printwindow"

    foreground["hwnd"] = 7
    fresh = capture.grab(gp.Rect(0, 0, 2, 2), hwnd=7)
    assert focused == [7] and "backend" not in fresh.info


def test_a_possibly_stale_shot_is_named_with_its_game_time(tmp_path):
    from games.stardew import StardewGame

    game = StardewGame.__new__(StardewGame)
    game.art = gp.RunArtifacts(tmp_path, "run")
    frame = Image.new("RGB", (2, 2))
    frame.info["backend"] = "printwindow"
    game.frame = lambda: frame
    game.state = lambda: {"time": {"dayOfMonth": 5, "timeOfDay": 650}}
    game.shot("parsnips_day5")
    assert (tmp_path / "run" / "parsnips_day5_possibly-stale_day5-0650.png").exists()
    assert "parsnips_day5_possibly-stale_day5-0650" in game.art.results["possibly_stale_shots"]
