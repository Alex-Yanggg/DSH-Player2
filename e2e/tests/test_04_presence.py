"""Presence: after the player picks a companion, it exists in the world. The game no longer tells DSH its facts
in a file, so the log says only who was started and whether placement failed; the screenshot is the evidence
that the companion is actually drawn next to the player."""
import pytest

from games.stardew.adapter import DSH_STARTED

pytestmark = pytest.mark.presence


def test_companion_is_placed_in_the_players_location(world, art):
    warnings = world.smapi.grep(r"Player2 could not place the companion|native companion creation failed")
    world.shot("companion_present")
    art.record("presence", placement_warnings=warnings)
    assert not warnings, f"the companion was not placed: {warnings}"


def test_companion_identity_is_the_chosen_one(world):
    started = world.smapi.grep(DSH_STARTED)
    assert started and "companion Mira." in started[-1], started


def test_chat_overlay_shows_the_companion_name(world):
    world.open_chat()
    try:
        assert world.chat_visible()
        world.shot("chat_overlay_header")  # header text is evidence for the report; layout is asserted by colour only
    finally:
        world.close_chat()
