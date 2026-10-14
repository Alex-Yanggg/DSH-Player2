"""Conversation: F2 opens a chat; a message reaches DSH; the player gets a validated reply or an honest,
traceable error - never silence and never a local fabrication."""
import pytest

import budgets

pytestmark = pytest.mark.conversation


def test_f2_opens_and_escape_closes_the_overlay(world):
    world.close_chat()
    assert not world.chat_visible()
    world.open_chat()
    assert world.chat_visible()
    world.close_chat()
    assert not world.chat_visible(), "Esc did not close the chat overlay"


def test_message_is_published_to_dsh_promptly(hello):
    assert "published" in hello.timeline.marks, "the typed message never became a published turn"
    assert hello.latencies()["enter_to_publish_ms"] <= budgets.ENTER_TO_PUBLISH_MS


def test_every_turn_ends_in_a_terminal_state(hello):
    assert hello.outcome in ("completed", "failed"), "turn neither completed nor failed: the player would wait forever"


def test_failure_is_traceable_and_has_no_local_fallback(hello):
    if hello.outcome == "completed":
        pytest.skip("turn succeeded; the failure path is not exercised by this exchange")
    assert hello.trace_id, "a failed turn carries no trace id for the player to report"
    assert hello.reply is None, f"a local reply was produced for a failed DSH turn: {hello.reply}"


def test_reply_round_trip_completes(hello):
    assert hello.outcome == "completed", f"DSH round trip failed: {hello.error}"
    assert hello.reply, "turn completed but no reply payload was captured from the outbox lane"
