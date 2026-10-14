"""W0 baseline (P2-0015): the loop the player feels, measured where the current build can show it.

Covered now: the day's first line arrives as a tool-free DSH turn (or a traced error, never local text); every
chat turn carries the W0 memory envelope; the DSH social lane is pre-warmed (graded readiness); the same-clock
latency trace joins mod and host stages for a real turn.
Not yet covered (needs a second in-game day or arranged damage; see the plan doc): a reply that cites yesterday's
receipt-backed outcome, damaged receipts counted as skipped, path-blocked commands."""
import pytest

import budgets

pytestmark = pytest.mark.w0

SOCIAL_STAGES = ("key-enter", "published", "host-picked", "agent-ready", "model-done", "written", "mod-picked", "rendered")


@pytest.fixture(scope="module")
def first_line(bare_world, art):
    line = bare_world.day_start_line(timeout=90)
    art.record("w0_day_start", **line)
    return line


def test_day_start_line_reaches_a_terminal_state(first_line):
    assert first_line["outcome"] in ("completed", "failed"), \
        f"day-start line {first_line['outcome']}: is the W0 (P2-0015) mod build deployed and DSH ready?"


def test_day_start_failure_is_traced_and_shows_no_local_text(bare_world, first_line):
    if first_line["outcome"] != "failed":
        pytest.skip("the day-start line succeeded; the failure path is not exercised")
    assert first_line.get("trace_id"), "a failed day-start line carries no trace id"
    bare_world.modlog.poll()
    shown = [r for _, r in bare_world.modlog.records
             if first_line["id"] in str(r.get("traceId", "")) and r.get("code") == "DSH_SOCIAL_TURN_COMPLETED"]
    assert not shown, f"a day-start line was presented despite the failure: {shown}"


def test_day_start_line_latency(first_line, art):
    if first_line["outcome"] != "completed":
        pytest.skip(f"no completed day-start line to time ({first_line['outcome']})")
    st = first_line["stages"]
    assert "day-started" in st and "rendered" in st, f"day-start latency stages missing: {st}"
    ms = (st["rendered"] - st["day-started"]) * 1000
    art.record("w0_day_start", day_start_to_rendered_ms=round(ms), a2_target_ms=budgets.DAY_FIRST_LINE_P50_MS)
    assert ms <= budgets.DAY_FIRST_LINE_MAX_MS, f"day start -> first line took {ms:.0f} ms"


@pytest.mark.xfail(strict=False, reason="A2 is a P2-0015 target; it becomes a hard gate once the W0 baseline is frozen")
def test_day_start_line_meets_a2_target(first_line):
    st = first_line.get("stages") or {}
    if "day-started" not in st or "rendered" not in st:
        pytest.skip("no timed day-start line")
    assert (st["rendered"] - st["day-started"]) * 1000 <= budgets.DAY_FIRST_LINE_P50_MS


def test_day_start_turn_uses_no_tools(bare_world, first_line):
    """T0.4: the first line is one tool-free step on the fast social lane, not the decision tool loop."""
    if first_line["outcome"] != "completed":
        pytest.skip("no completed day-start line")
    bare_world.devlog.poll()
    recs = [r for _, r in bare_world.devlog.records
            if r.get("code") == "DSH_SOCIAL_TURN_COMPLETED" and r.get("id") == first_line["id"]]
    assert recs, "the host never recorded completing the day-start turn"
    assert recs[-1].get("occasion") == "day-start", recs[-1]


def test_mouth_lane_is_prewarmed(bare_world, art):
    hit = bare_world.smapi.wait_for(r"companion mouth lane is ready \((\w+), composed in (\d+) ms\)", 90)
    assert hit, "the DSH social lane never answered the warm-up request (graded readiness)"
    art.record("w0_readiness", line=hit[1])


def test_chat_turn_carries_the_w0_memory_envelope(hello):
    """T0.3: every chat envelope carries priorMemory / latestReceipt / growth / occasion (null on a fresh day 1)."""
    assert hello.turn is not None, "no social turn was captured from the inbox lane"
    for key in ("priorMemory", "latestReceipt", "growth", "occasion"):
        assert key in hello.turn, f"published turn lacks {key!r}: is the W0 mod build deployed?"
    assert hello.turn["occasion"] is None


def test_latency_trace_joins_mod_and_host_for_one_turn(hello, art):
    st = hello.stages
    art.record("w0_latency_hello", stages={k: round(v, 3) for k, v in st.items()}, latencies=hello.latencies())
    for stage in ("key-enter", "published", "host-picked"):
        assert stage in st, f"latency stage {stage!r} missing for turn {hello.turn and hello.turn.get('id')}: {sorted(st)}"
    seen = [s for s in SOCIAL_STAGES if s in st]
    times = [st[s] for s in seen]
    assert times == sorted(times), f"stages out of order on one clock: {list(zip(seen, times))}"
