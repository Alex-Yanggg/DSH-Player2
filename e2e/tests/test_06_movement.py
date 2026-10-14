"""Movement: explicit come / follow / stay. Since P2-0015 (W0, T0.2) a command typed in chat is the player's own
grant and is issued the moment Enter is pressed - it no longer waits for the DSH reply, so these tests run
even while the conversation round trip is broken. The open chat is a menu and pauses the world (owner-confirmed
feature, 2026-10-14), so each command closes the chat after Enter and the walk happens with the chat closed. Oracles: the mod's COMPANION_MOVEMENT_* records, the mod's
same-clock latency trace (command lane), and the companion facts the game puts in the next published turn."""
import time

import pytest

import budgets

pytestmark = pytest.mark.movement


def _codes(ex):
    return [m["code"] for m in ex.movement]


@pytest.fixture(scope="module")
def come(world, art):
    world.wait_social_idle()
    ex = world.send_chat("/come", reply=False, wait_movement=budgets.MOVEMENT_ARRIVAL_S, close_after_enter=True)
    art.record("movement_come", movement=ex.movement, command_stages=ex.command_stages, latencies=ex.latencies())
    return ex


def test_come_walks_the_companion_to_the_player(come):
    assert "COMPANION_MOVEMENT_FAILED" not in _codes(come), come.movement
    assert "COMPANION_MOVEMENT_COMPLETED" in _codes(come), f"companion never reported arrival: {come.movement}"


def test_command_starts_moving_within_a1_budget(come):
    """A1: Enter -> command issued (path assigned) on the mod's own clock; the first step waits for the chat to close.
    An already-adjacent companion arrives at once; that counts."""
    st = come.command_stages
    assert "key-enter" in st, "no command latency trace: is the W0 (P2-0015) mod build deployed?"
    moved = st.get("motion-started", st.get("arrived"))
    assert moved is not None, f"command never reached motion: {st}"
    ms = (moved - st["key-enter"]) * 1000
    assert ms <= budgets.COMMAND_TO_MOTION_MS, f"Enter -> motion took {ms:.0f} ms"


def test_negated_command_moves_nothing(world, art):
    world.wait_social_idle()
    ex = world.send_chat("不要来我面前", reply=False, wait_movement=budgets.NEGATIVE_COMMAND_WATCH_S)
    world.close_chat()
    art.record("movement_negated", movement=ex.movement, command_stages=ex.command_stages)
    assert ex.movement == [], f"a negated phrase moved the companion: {ex.movement}"
    assert not ex.command_stages, f"a negated phrase was traced as a command: {ex.command_stages}"


def test_follow_keeps_the_companion_near_while_the_player_walks(world, art):
    world.wait_social_idle()
    ex = world.send_chat("/follow", reply=False, wait_movement=3, close_after_enter=True)
    assert "COMPANION_MOVEMENT_FAILED" not in _codes(ex), ex.movement
    world.wait_social_idle()   # the reply to "/follow" must land before the probe can be published
    world.kb.hold("a", 2.0)    # the player walks away (left: the FarmHouse bed is to the right, and touching it opens "sleep?")
    time.sleep(1.5)            # the player stops; the companion re-paths once it is >3 tiles behind, so let it catch up
                               # before the probe opens the chat (which pauses the world)
    probe = world.send_chat("在吗")
    facts = probe.companion_facts
    art.record("movement_follow", facts=facts, movement=ex.movement)
    assert facts["movementState"] in ("following", "walking"), facts
    assert facts["distance"] is not None and facts["distance"] <= budgets.FOLLOW_MAX_TILES, facts


def test_stay_stops_following(world, art):
    world.wait_social_idle()
    ex = world.send_chat("/stay", reply=False, wait_movement=2, close_after_enter=True)
    assert "COMPANION_MOVEMENT_FAILED" not in _codes(ex), ex.movement
    world.wait_social_idle()
    world.kb.hold("w", 1.5)    # never toward the bed (right/down), whose "sleep?" prompt would block every later test
    time.sleep(1)
    facts = world.send_chat("还在吗").companion_facts
    art.record("movement_stay", facts=facts)
    assert facts["movementState"] == "standing", facts
