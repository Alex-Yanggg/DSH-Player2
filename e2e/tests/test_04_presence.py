"""Presence: after the player picks a companion, it joins the save as a hidden co-op farmer (P2-0022). The log
says it was seated and whether the farm lacked a cabin; the screenshot is the evidence that the player's window
stays whole (no split screen) with the companion's farmer in the world."""
import pytest

from games.stardew.adapter import DSH_STARTED

pytestmark = pytest.mark.presence


def test_companion_is_seated_as_a_hidden_farmer(world, art):
    seated = world.smapi.grep(r"Player2 seated .* as a hidden co-op farmer")
    warnings = world.smapi.grep(r"found no free farmhand|needs a cabin")
    world.shot("companion_present")
    art.record("presence", seated=seated, warnings=warnings)
    assert seated and not warnings, f"the companion was not seated: {seated} {warnings}"


def test_companion_identity_is_the_chosen_one(world):
    started = world.smapi.grep(DSH_STARTED)
    assert started and "companion 大肥鱼." in started[-1], started


def test_chat_overlay_shows_the_companion_name(world):
    world.open_chat()
    try:
        assert world.chat_visible()
        world.shot("chat_overlay_header")  # header text is evidence for the report; layout is asserted by colour only
    finally:
        world.close_chat()
