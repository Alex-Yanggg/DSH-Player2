"""Movement: explicit come / follow / stay. A command typed in chat is the player's own grant and is issued the
moment Enter is pressed - it does not wait for DSH, so these tests run even while the conversation is broken.
The open chat is a menu and pauses the world (owner-confirmed feature, 2026-10-14), so each command closes the
chat after Enter and the walk happens with the chat closed. Oracles: the mod's `Player2 companion movement
<status>: <detail>.` lines, plus a screenshot after each command as evidence of what the player saw."""
import time

import pytest

import budgets

pytestmark = pytest.mark.movement


def _failed(ex):
    return [m for m in ex.movement if m[0] == "failed"]


@pytest.fixture(scope="module")
def come(world, art):
    ex = world.send_chat("/come", reply=False, wait_movement=budgets.MOVEMENT_ARRIVAL_S, close_after_enter=True)
    art.record("movement_come", movement=ex.movement)
    world.shot("movement_come")
    return ex


def test_come_walks_the_companion_to_the_player(come):
    assert not _failed(come), come.movement
    assert ("completed", "arrived") in come.movement, f"companion never reported arrival: {come.movement}"


def test_negated_command_moves_nothing(world, art):
    ex = world.send_chat("不要来我面前", reply=False, wait_movement=budgets.NEGATIVE_COMMAND_WATCH_S)
    world.close_chat()
    art.record("movement_negated", movement=ex.movement)
    assert ex.movement == [], f"a negated phrase moved the companion: {ex.movement}"


def test_follow_keeps_up_while_the_player_walks(world, art):
    ex = world.send_chat("/follow", reply=False, wait_movement=3, close_after_enter=True)
    assert ("started", "follow") in ex.movement, ex.movement
    mark = len(world.smapi.lines)
    world.kb.hold("a", 2.0)    # the player walks away (left: the FarmHouse bed is to the right, and touching it opens "sleep?")
    time.sleep(1.5)            # the companion re-paths once it is >3 tiles behind; let it catch up
    after = world.movement_since(mark)
    world.shot("movement_follow")  # evidence: the companion should be drawn next to the player
    art.record("movement_follow", movement=ex.movement + after)
    assert not _failed(ex) and not [m for m in after if m[0] == "failed"], after


def test_stay_stops_following(world, art):
    ex = world.send_chat("/stay", reply=False, wait_movement=2, close_after_enter=True)
    assert ("completed", "stopped") in ex.movement, ex.movement
    mark = len(world.smapi.lines)
    world.kb.hold("w", 1.5)    # never toward the bed (right/down), whose "sleep?" prompt would block every later test
    time.sleep(1)
    after = world.movement_since(mark)
    world.shot("movement_stay")  # evidence: the companion stays behind
    art.record("movement_stay", movement=ex.movement + after)
    assert not [m for m in after if m[0] == "started"], f"the companion moved after /stay: {after}"
