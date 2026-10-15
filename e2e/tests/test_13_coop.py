"""S13: the companion is a hidden co-op farmer. Its location, tile, inventory and the clock come from the mod's game
endpoint (world_state); the turn order from the SMAPI `Player2 ...` lines; screenshots are the evidence. The run
starts on spring 1 (a Monday, so Pierre's opens at 9:00) with the save's own gold, which co-op farmers share. The
errand (b, c) runs first, while the shop is open; the trip to the player (a) can take most of a day's afternoon."""
import re
import subprocess
import threading
import time

import pytest

from conftest import require_dsh
from gamepilot import win
from games.stardew.adapter import DSH_STARTED, SENT

pytestmark = pytest.mark.coop

UNFOCUSED_S = 30
PARSNIP_SEEDS = "472"


class Track(threading.Thread):
    """Samples world_state in the background: (perf_counter, body location, x, y, active task)."""

    def __init__(self, world):
        super().__init__(daemon=True)
        self.world, self.samples, self.stop = world, [], threading.Event()

    def run(self):
        while not self.stop.is_set():
            s = self.world.state()
            b = s["body"]
            self.samples.append((time.perf_counter(), b["location"], b["x"], b["y"], b["activeTask"], s["player"]))
            time.sleep(0.25)

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, *_):
        self.stop.set()
        self.join()


def _near(s, tiles=3):
    b, p = s["body"], s["player"]
    return b["location"] == p["location"] and max(abs(b["x"] - p["x"]), abs(b["y"] - p["y"])) <= tiles


def _seeds(s):
    return sum(i["stack"] for i in s["body"]["items"] if i["id"].endswith(PARSNIP_SEEDS))


def _wait(predicate, timeout, every=1.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(every)
    return False


@pytest.fixture(scope="module")
def errand(world, hello):
    """Asks for parsnip seeds once Pierre's is open; the companion then walks to town."""
    require_dsh(hello)
    t = world.state()["time"]
    assert t["dayOfMonth"] % 7 != 3, f"Pierre's is closed on Wednesdays: {t}"
    assert _wait(lambda: world.state()["time"]["timeOfDay"] >= 900, 300), "the clock never reached 9:00"
    before = _seeds(world.state())
    ex = world.send_chat("帮我去皮埃尔的店买几包防风草种子吧", until_said=True)
    world.close_chat()
    assert ex.outcome in ("speaking", "completed") and ex.reply, ex.error or ex.stop_reason
    return before, ex


def _tile(world):
    b = world.state()["body"]
    return b["location"], b["x"], b["y"]


def test_b_keeps_playing_while_another_window_is_in_front(world, errand, art):
    first = _tile(world)
    assert _wait(lambda: _tile(world) != first, 180), "the companion never set off on the errand"
    other = subprocess.Popen(["notepad.exe"])
    try:
        hwnd = win.wait_for_window(("notepad.exe",), None, 10)
        assert win.focus(hwnd), "could not put another window in front"
        clock, tiles = world.state()["time"]["timeOfDay"], []
        for _ in range(UNFOCUSED_S):
            tiles.append(_tile(world))
            time.sleep(1)
        in_front, clock_after = win.is_foreground(hwnd), world.state()["time"]["timeOfDay"]
    finally:
        other.kill()
    world.refocus()
    world.shot("coop_b_after_unfocus")
    art.record("coop_b", tiles=tiles, clock=(clock, clock_after))
    assert in_front, "the other window lost the foreground during the check"
    assert clock_after > clock, f"the clock stopped while unfocused: {clock}"
    # A frozen seat does not move at all; a playing one may still stop to think.
    assert len(set(tiles)) >= 5, f"the companion stopped while unfocused: {tiles}"


def test_c_buys_parsnip_seeds(world, errand, art):
    before, ex = errand
    menus = set()

    def bought():
        s = world.state()
        if s["body"].get("menu"):
            menus.add(s["body"]["menu"]["kind"])
        return _seeds(s) > before

    ok = _wait(bought, 480, every=2)
    s = world.state()
    world.shot("coop_c_after_errand")
    art.record("coop_c", reply=ex.reply, before=before, after=_seeds(s), menus=sorted(menus), clock=s["time"],
               body=(s["body"]["location"], s["body"]["x"], s["body"]["y"]))
    assert ok, f"no parsnip seeds in the companion's inventory (menus seen: {sorted(menus)})"


def test_a_speaks_before_it_comes_to_the_player(world, hello, art):
    require_dsh(hello)
    with Track(world) as track:
        time.sleep(1)
        ex = world.send_chat("过来找我", until_said=True)
        world.close_chat()
        came = _wait(lambda: _near(world.state()), 300)  # day-1 debris can mean a long way round
    world.shot("coop_a_came")
    first, enter = track.samples[0], ex.timeline.marks["enter"]
    # The first body input of this turn is a body task newer than any running before Enter (an earlier turn's
    # input may still be finishing when the message stops it).
    before = max((task or 0 for t, *_, task, _ in track.samples if t < enter), default=0)
    moved = next((t for t, *_, task, _ in track.samples if t > enter and (task or 0) > before), None)
    art.record("coop_a", reply=ex.reply, latencies=ex.latencies(), start=first[1:4], end=track.samples[-1][1:4],
               player=first[5], first_input_after_enter_ms=moved and round((moved - enter) * 1000))
    assert ex.reply, ex.error or ex.stop_reason
    assert moved, "the companion's body never got an input"
    assert ex.timeline.marks["said"] < moved, "the companion acted before it said anything"
    assert came, f"the companion did not reach the player: {track.samples[-1][1:4]} vs {world.state()['player']}"


def test_d_sleeps_with_the_host_and_rejoins_after_reload(world, art):
    world.close_chat()
    s = world.state()
    day, host = s["time"]["day"], s["player"]
    assert host["location"] == "FarmHouse", f"the host is not at home: {host}"
    in_bed = re.compile(rf"{re.escape(SENT)}\[world day={day}\] .* went to bed")
    world.smapi.poll()
    mark = len(world.smapi.lines)
    for _ in range(3):  # step out of bed and back in; the game asks only after the farmer has moved
        world.refocus()
        world.kb.hold("a", 0.4)
        world.kb.hold("d", 0.5)
        if _wait(world.dialog_visible, 3, every=0.3):
            world.kb.tap("y")  # the sleep question's Yes
            if world.smapi.wait_for(in_bed.pattern, 5, since=mark):
                break
    world.shot("coop_d_host_in_bed")
    assert world.smapi.wait_for(in_bed.pattern, 0, since=mark), "the host never got into bed"
    saving = world.smapi.wait_for(r"screen_0 SMAPI\] Context: before save", 720, since=mark)
    assert saving, "the night never ended: the companion did not go to bed"
    lines = [ln for _, ln in world.smapi.lines]
    start = max(i for i, ln in enumerate(lines) if "Context: before save" in ln)
    assert world.smapi.wait_for(rf"Player2 sent: \[day-start day={day + 1}\]", 120, since=start), "the next day never started"
    world.shot("coop_d_next_morning")

    world.quit()
    world.launch()
    world.load_test_save()
    assert world.smapi.wait_for(DSH_STARTED, 60), "the companion's day never started after the reload"
    seated = world.smapi.wait_for(r"Player2 seated .* as a hidden co-op farmer", 60)
    warnings = world.smapi.grep(r"found no free farmhand|needs a cabin")
    # world_state is null until the seat has joined and built its first state
    assert _wait(lambda: (s := world.state()) and s["body"], 60), "world_state has no companion body after the reload"
    s = world.state()
    world.shot("coop_d_rejoined")
    art.record("coop_d", day=day, seated=seated and seated[1], warnings=warnings, after_reload=s["time"],
               body=(s["body"]["location"], s["body"]["x"], s["body"]["y"]))
    assert seated and not warnings, warnings
    assert s["time"]["day"] == day + 1, f"the reload did not land on the next day: {s['time']}"
