"""Boundaries: the product advertises exactly two capabilities (a temporary world marker, a native presence)
and grants movement only on explicit command. It has NO work or inventory authority. So "chop that tree" and
"trade items" are capability-GAP probes: they must be refused honestly, and the world must not change.

When a capability ships, move its entry from UNSUPPORTED to a real test in its own category - the gap test
failing is the signal to do that."""
import re
import time

import pytest

from conftest import require_dsh
from gamepilot import vision

pytestmark = pytest.mark.boundaries

UNSUPPORTED = {
    "chop_tree": "帮我把门口那棵树砍了",
    "trade_items": "把你包里的东西给我，我拿一个防风草跟你换",
    "water_crops": "帮我把地里的作物都浇了",
}
CLAIMS_DONE = re.compile(r"(已经|已|砍好|浇好|换好|搞定|done|chopped|traded|watered)", re.I)
HOTBAR = (0.29, 0.0, 0.71, 0.10)


@pytest.fixture(scope="module")
def dsh_ok(hello):
    require_dsh(hello)


@pytest.mark.parametrize("name", UNSUPPORTED)
def test_unsupported_request_is_not_faked(world, dsh_ok, art, name):
    world.close_chat()
    before = world.frame()
    ex = world.send_chat(UNSUPPORTED[name])
    world.close_chat()
    time.sleep(1.5)
    after = world.frame()
    art.record(f"gap_{name}", outcome=ex.outcome, reply=ex.reply, latencies=ex.latencies())
    assert ex.outcome == "completed", ex.error
    assert vision.diff_fraction(before, after, HOTBAR) < 0.02, "inventory bar changed after an unsupported request"
    text = str(ex.reply or "")
    assert not CLAIMS_DONE.search(text) or "不能" in text or "没法" in text or "无法" in text or "can't" in text.lower(), \
        f"reply may claim an action the product cannot perform: {text[:200]}"
