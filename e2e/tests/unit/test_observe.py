"""The after-run observer reads a DSH session log and the body samples the way a real run leaves them."""
import json

from gamepilot import observe


def _log(tmp_path):
    t = 1_000_000_000
    rows, seq = [{"type": "session", "version": 4}], 0

    def ev(type_, data, dt=0):
        nonlocal seq, t
        seq, t = seq + 1, t + dt
        rows.append({"type": type_, "seq": seq, "time": t, "data": data})

    def user(text, kind="user"):
        ev("user/message", {"role": "user", "content": [{"type": "text", "text": text}], "source": {"kind": kind}})

    user("[day-start day=1]")
    ev("step/start", {"turn": 1, "step": 1})
    ev("assistant/message", {"turn": 1, "step": 1, "usage": {"inputTokens": 100, "cacheReadTokens": 900, "outputTokens": 10},
                             "message": {"content": [{"type": "text", "text": "走了啊。"}]}}, dt=2000)
    ev("tool/call", {"turn": 1, "step": 1, "callId": "a", "name": "plan_set",
                     "arguments": json.dumps({"steps": [{"tool": "body_walk_to"}]})})
    ev("tool/result", {"turn": 1, "step": 1, "message": {"toolCallId": "a", "isError": False}})
    ev("step/end", {"turn": 1, "step": 1})
    user("Plan finished.\nPlan, 出门: OK: arrived.\nPlan, 往东: NOT REACHED: walled off.", kind="player2")
    user("[day-start day=2]")
    ev("step/start", {"turn": 2, "step": 1}, dt=10_000)
    ev("assistant/message", {"turn": 2, "step": 1, "usage": {"inputTokens": 50, "cacheReadTokens": 2000, "outputTokens": 5},
                             "message": {"content": [{"type": "text", "text": "（慢慢往家走）"}]}}, dt=4000)
    ev("tool/call", {"turn": 2, "step": 1, "callId": "b", "name": "world_observe", "arguments": "{}"})
    ev("tool/result", {"turn": 2, "step": 1, "message": {"toolCallId": "b", "isError": True}})
    ev("step/end", {"turn": 2, "step": 1})
    user("You are repeating the exact same tool call", kind="repeat-tool-reminder")
    p = tmp_path / "session.v4.jsonl"
    p.write_text("\n".join(map(json.dumps, rows)), encoding="utf-8")
    return p, t / 1000


def test_observe_joins_mind_and_body_per_day(tmp_path):
    session, end = _log(tmp_path)
    run = tmp_path / "run"
    run.mkdir()
    (run / "results.json").write_text(json.dumps({"mine": {"metrics": {"g1_idle_ratio": 0.5}, "days": [{"day": 1, "copper": 2}]}}))
    idle = {"paused": False, "task": None, "moving": False, "location": "Farm"}
    samples = [{"t": 1_000_001.0, "day": 1, **idle},                          # inside day 1's model step: thinking
               {"t": 1_000_005.0, "day": 1, **idle, "task": "walk"},          # working
               {"t": end + 60, "day": 2, **idle}]                             # nobody working
    (run / "metrics-samples.json").write_text(json.dumps({"samples": samples, "nights": []}))

    o = observe.write(run, session=session)
    m = o["mind"]
    assert m["model_calls"] == 2 and m["tokens"] == {"input": 150, "cached": 2900, "output": 15}
    assert m["context_tokens"]["max"] == 2050 and m["step_ms"]["max"] == 4000
    assert m["tool_error_rate"] == 0.5 and m["tool_errors"] == {"world_observe": 1}
    assert m["repeat_reminders"] == 1 and m["plan_outcomes"] == {"OK": 1, "NOT REACHED": 1}
    assert m["plan_steps"]["one_step_share"] == 1.0
    assert m["speech"]["stage_direction_share"] == 0.5
    assert m["days"][1]["plan_ok"] == 1 and m["days"][2]["repeats"] == 1
    assert o["body"]["days"][1] == {"idle": 0.5, "idle_dead": 0.0, "idle_thinking": 0.5, "where": [("Farm", 1.0)]}
    assert o["body"]["days"][2]["idle_dead"] == 1.0
    assert (run / "observe.md").read_text(encoding="utf-8").startswith("# Companion observation")
