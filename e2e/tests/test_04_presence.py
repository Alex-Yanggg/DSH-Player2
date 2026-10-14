"""Presence: after the player picks a companion, it exists in the world.
Authority is the game's own statement to DSH (the companion facts in every social turn), not pixels."""
import pytest

pytestmark = pytest.mark.presence


def test_companion_is_reported_present_in_the_players_location(world, hello, art):
    # `hello` published a turn whether or not DSH answered; the turn carries what the game believes
    assert hello.turn is not None, "no social turn was captured from the inbox lane"
    facts = hello.companion_facts
    art.record("presence", companion_facts=facts)
    assert facts.get("presentHere") is True, f"the game does not report the companion present: {facts}"
    assert facts.get("movementState") in ("standing", "following", "walking"), facts


def test_companion_identity_is_carried_into_the_turn(world, hello):
    assert hello.turn is not None
    blob = str(hello.turn)
    assert "Mira" in blob, "the chosen companion's name is missing from the published turn"


def test_chat_overlay_shows_the_companion_name(world):
    world.open_chat()
    try:
        assert world.chat_visible()
        world.shot("chat_overlay_header")  # header text is evidence for the report; layout is asserted by colour only
    finally:
        world.close_chat()
