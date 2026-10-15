"""B line: a goal asked in chat makes the companion's own body act, and a stop said in chat ends it.

Goals are DSH's own (create_goal / update_goal); the body is reached through the mod's game endpoint. The judgement
is what the companion said, the mod's SMAPI lines, the companion's tile from world_state, and screenshots taken
while the goal runs - the screenshots are the evidence that the body really worked, never the log alone."""
import time

import pytest

from conftest import require_dsh

pytestmark = pytest.mark.bline

GOAL_START_S = 90
GOAL_WORK_S = 5
STILL_S = 8


def _tile(world):
    b = world.state()["body"]
    return b["location"], b["x"], b["y"]


def test_goal_from_chat_runs_and_stops_on_request(world, hello, art):
    require_dsh(hello)
    ex = world.send_chat("帮我把门口附近的杂草清一清", until_said=True)
    assert ex.outcome in ("speaking", "completed"), ex.error or ex.stop_reason
    assert ex.reply, "the companion said nothing about the goal"
    mark = len(world.smapi.lines)
    start = _tile(world)
    world.shot("bline_goal_start")
    deadline = time.monotonic() + GOAL_START_S  # the companion may look around before it sets off
    while (working := _tile(world)) == start and time.monotonic() < deadline:
        time.sleep(1)
    time.sleep(GOAL_WORK_S)  # let the hands work a little
    world.shot("bline_goal_working")
    world.smapi.poll()
    during = [ln for _, ln in world.smapi.lines[mark:]]
    stop = world.send_chat("好了，先停下吧，别清了", until_said=True)
    stopped = _tile(world)
    time.sleep(STILL_S)
    still = _tile(world)
    world.shot("bline_goal_stopped")
    art.record("bline_goal", reply=ex.reply, stop_reply=stop.reply, start=start, working=working, stopped=stopped, still=still,
               during=[ln for ln in during if "Player2" in ln][-40:])
    errors = [ln for ln in during if "Player2 DSH_" in ln or "Player2 body could" in ln]
    assert not errors, errors
    assert working != start, f"the companion did not move while it worked: {start}"
    assert stop.reply, stop.error or stop.stop_reason
    assert still == stopped, f"the companion kept moving after the stop: {stopped} -> {still}"
