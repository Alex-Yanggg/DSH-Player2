"""Consent: each game day DSH proposes one small action and the player is asked natively. Both answers must be
honoured and leave a settled receipt: decline -> nothing happens; agree -> the companion appears.
A same-day F6 retry re-opens a day that was not completed, which lets one run exercise both answers."""
import re

import pytest

pytestmark = pytest.mark.consent


def test_proposal_arrives_as_a_native_dialogue(bare_world, art):
    seconds = bare_world.wait_proposal(timeout=120)
    art.record("consent", proposal_after_publish_s=seconds)
    assert seconds is not None, "DSH never produced a proposal for the day"
    assert bare_world.dialog_visible()
    bare_world.shot("proposal_dialogue")


def test_decline_is_honoured_and_settles_without_a_grant(bare_world, art):
    status = bare_world.answer_proposal(1)  # PROPOSAL_DECLINE
    art.record("consent", decline_status=status)
    assert status == "declined", status
    last = bare_world.smapi.grep(r"settled DSH decision sequence")[-1]
    assert "granted: False" in last, last


def test_same_day_retry_reopens_a_declined_day(bare_world, art):
    assert bare_world.retry_day(), "F6 did not re-open the declined day"
    seconds = bare_world.wait_proposal(timeout=120)
    art.record("consent", retry_proposal_after_publish_s=seconds)
    assert seconds is not None, "the retried day produced no new proposal"


def test_agree_is_honoured_and_the_companion_is_granted(bare_world, art):
    status = bare_world.answer_proposal(0)  # PROPOSAL_AGREE
    art.record("consent", agree_status=status)
    assert status == "completed", status
    last = bare_world.smapi.grep(r"settled DSH decision sequence")[-1]
    assert re.search(r"granted: True", last), last
    bare_world.shot("after_agree")
