"""Conversation: F2 opens a chat; a message reaches DSH as `[chat day=N] <text>`; the turn ends with what the
companion said or an honest error code - never silence."""
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


def test_message_is_sent_to_dsh_promptly(hello):
    assert "published" in hello.timeline.marks, "the typed message never became a `Player2 sent: [chat ...]` line"
    assert hello.latencies()["enter_to_publish_ms"] <= budgets.ENTER_TO_PUBLISH_MS


def test_every_message_is_answered_or_fails(hello):
    assert hello.outcome in ("completed", "speaking", "failed"), "no answer and no error: the player would wait forever"


def test_failure_carries_an_error_code(hello):
    if hello.outcome != "failed":
        pytest.skip("turn succeeded; the failure path is not exercised by this exchange")
    assert hello.error or (hello.stop_reason or "").startswith("error"), "a failed turn reports no error to the player"


def test_reply_round_trip_completes(hello):
    assert hello.outcome in ("completed", "speaking"), f"DSH turn failed: {hello.error or hello.stop_reason}"
    # the `hello_after` screenshot shows the line in the open chat's transcript
    assert hello.reply, f"turn ended ({hello.stop_reason}) but the companion said nothing"
