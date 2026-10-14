"""B line: a goal asked in chat makes the companion's own body act, and the player's `/stay` takes it back.

Goals are DSH's own (create_goal / update_goal); the body is reached through the mod's game endpoint, so neither
leaves a file to read. The judgement is what the companion said, the mod's SMAPI lines, and screenshots taken
while the goal runs - the screenshots are the evidence that the body really worked, never the log alone."""
import time

import pytest

from conftest import require_dsh

pytestmark = pytest.mark.bline

GOAL_WORK_S = 15


def test_goal_from_chat_runs_and_stays_on_command(world, hello, art):
    require_dsh(hello)
    ex = world.send_chat("帮我把门口附近的杂草清一清")
    world.close_chat()  # the open chat pauses the world; the goal runs only with it closed
    assert ex.outcome == "completed", ex.error or ex.stop_reason
    assert ex.reply, "the companion said nothing about the goal"
    mark = len(world.smapi.lines)
    world.shot("bline_goal_start")
    time.sleep(GOAL_WORK_S)  # let the hands work a little
    world.shot("bline_goal_working")
    world.smapi.poll()
    during = [ln for _, ln in world.smapi.lines[mark:]]
    stay = world.send_chat("/stay", reply=False, wait_movement=2, close_after_enter=True)
    world.shot("bline_goal_stopped")
    art.record("bline_goal", reply=ex.reply, during=[ln for ln in during if "Player2" in ln][-40:], stay=stay.movement)
    errors = [ln for ln in during if "Player2 DSH_" in ln or "Player2 body input" in ln]
    assert not errors, errors
    assert ("completed", "stopped") in stay.movement, stay.movement
