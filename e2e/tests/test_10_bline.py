"""B line (P2-0021): the companion's body lane and goals started from chat.

Oracles are files the mod and DSH write themselves: the body declaration/state/status frames, the host-owned goal
record, and the host trace. The raw-input probe writes one task file the way the DSH plugin does; it is protocol
input, not an in-process hook, and the mod treats it exactly like a plugin's task."""
import json
import time
import uuid
from datetime import datetime, timezone

import pytest

pytestmark = pytest.mark.bline

SEMANTIC = ("walk", "goto", "move_to", "chop", "harvest", "farm", "attack", "buy")


def _session(world):
    dirs = world.paths.session_dirs()
    assert dirs, "no bridge session for the test save"
    return dirs[0]


def _read(path, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            time.sleep(0.2)
    raise AssertionError(f"{path} never became readable")


def _wait_terminal(path, timeout=20.0):
    end = time.time() + timeout
    while time.time() < end:
        if path.exists():
            status = json.loads(path.read_text(encoding="utf-8"))
            if status["status"] in ("done", "interrupted", "failed", "cancelled"):
                return status
        time.sleep(0.2)
    raise AssertionError(f"task never ended: {path}")


def test_body_lane_declares_only_raw_inputs(world, art):
    body = _session(world) / "body"
    declaration = _read(body / "declaration.json")
    ids = [i["id"] for i in declaration["inputs"]]
    art.record("bline_declaration", inputs=ids, limits=declaration["limits"])
    assert {"MoveUp", "MoveRight", "MoveDown", "MoveLeft", "UseTool", "Action"} <= set(ids)
    assert not [i for i in ids if any(word in i.lower() for word in SEMANTIC)], ids
    state = _read(body / "state.json")
    art.record("bline_state", bytes=(body / "state.json").stat().st_size, objects=len(state["objects"]))
    assert state["body"] is not None and state["body"]["present"], "the companion body is not exported"
    assert state["map"]["rows"], "no walkability grid"


def test_raw_input_moves_the_body(world, art):
    world.close_chat()
    body = _session(world) / "body"
    before = _read(body / "state.json")
    me = before["body"]
    rows = before["map"]["rows"]
    moves = {"MoveRight": (1, 0), "MoveLeft": (-1, 0), "MoveDown": (0, 1), "MoveUp": (0, -1)}
    button = next((b for b, (dx, dy) in moves.items()
                   if all(rows[me["y"] + dy * k][me["x"] + dx * k] == "." for k in (1, 2))), None)
    if button is None:
        pytest.skip("the companion has no two free tiles in a straight line")
    seq = int(time.time()) - 1_700_000_000 + 1000
    task = {"version": "0.1", "taskId": str(uuid.uuid4()), "seq": seq,
            "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "steps": [{"hold": [button], "ms": 533}]}
    (body / "input").mkdir(parents=True, exist_ok=True)
    (body / "input" / f"task-{seq}.json").write_text(json.dumps(task), encoding="utf-8")
    status = _wait_terminal(body / "status" / f"task-{seq}.json")
    time.sleep(1.0)
    after = _read(body / "state.json")["body"]
    art.record("bline_raw_input", button=button, status=status, before=(me["x"], me["y"]), after=(after["x"], after["y"]))
    assert status["status"] == "done", status
    assert (after["x"], after["y"]) != (me["x"], me["y"]), "the body did not move"


def test_goal_from_chat_starts_and_stops(world, art):
    session = _session(world)
    ex = world.send_chat("帮我把门口附近的杂草清一清")
    world.close_chat()
    art.record("bline_goal_set", outcome=ex.outcome, reply=ex.reply)
    assert ex.outcome == "completed", ex.error
    record = _read(session / "goal" / "current.json", timeout=20.0)
    assert record["status"] in ("active", "done", "failed"), record
    time.sleep(15)  # let the hands work a little
    ex = world.send_chat("/stay", reply=False, wait_movement=2, close_after_enter=True)
    end = time.time() + 20
    while time.time() < end:
        record = _read(session / "goal" / "current.json")
        if record["status"] != "active":
            break
        time.sleep(0.5)
    art.record("bline_goal_stop", record=record)
    assert record["status"] in ("stopped", "done", "failed"), record
    dice = session / "goal" / "dice.jsonl"
    assert dice.exists() and dice.read_text(encoding="utf-8").strip(), "no dice were logged for the goal"
