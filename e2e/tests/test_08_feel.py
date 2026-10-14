"""Feel: how responsive the loop is, measured on one monotonic clock. Publish latency is the mod's own and is
asserted against a budget; the DSH/LLM leg is recorded and reported, with a soft ceiling."""
import pytest

import budgets
import gamepilot as gp

pytestmark = pytest.mark.feel

N = 3


@pytest.fixture(scope="module")
def samples(world, art):
    out = []
    for i in range(N):
        world.close_chat()
        out.append(world.send_chat(f"测试第{i + 1}句", timeout=90))
    stats = {k: gp.summarize([e.latencies()[k] for e in out if k in e.latencies()])
             for k in ("enter_to_publish_ms", "dsh_roundtrip_ms", "enter_to_result_ms", "key_to_first_token_ms", "agent_ready_ms")}
    art.record("feel", samples=[{"outcome": e.outcome, **e.latencies()} for e in out], summary=stats)
    return out, stats


def test_enter_to_publish_stays_within_budget(samples):
    _, stats = samples
    assert stats["enter_to_publish_ms"]["n"] == N, "some messages were never published"
    assert stats["enter_to_publish_ms"]["p95"] <= budgets.ENTER_TO_PUBLISH_MS, stats["enter_to_publish_ms"]


def test_time_to_result_is_bounded(samples):
    out, stats = samples
    assert all(e.outcome in ("completed", "failed") for e in out), [e.outcome for e in out]
    assert stats["enter_to_result_ms"]["p95"] <= budgets.ENTER_TO_RESULT_MS, stats["enter_to_result_ms"]
