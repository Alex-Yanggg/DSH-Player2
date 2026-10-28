"""After-run observation of the companion from records that already exist: the run's own body samples
(metrics-samples.json), DSH's durable session log (~/.dsh/sessions/...-sessions-<saveId>--/<id>/session.v4.jsonl.zstd)
and the companion's ledger (facts.jsonl). Read-only; Player2 keeps no request log of its own.

Angles: body (G1-G3 plus where the idle time went: the mind thinking, or nobody working), mind cost (calls, tokens,
context size), mind speed, decision quality (tool errors, repeated calls, plan size and outcome, goal blocks),
speech (stage directions, leaked internals, repeats), beliefs (negative facts the companion keeps), and a per game
day timeline joining them.

    python e2e/gamepilot/observe.py e2e/artifacts/<run> [--save-id N | --session PATH] [--vs artifacts/<other run>]
"""
from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter
from pathlib import Path

DSH = Path(os.environ.get("USERPROFILE", Path.home())) / ".dsh"
DAY = re.compile(r"^\[(?:day-start|day-end|chat|world) day=(\d+)\]")
PLAN_LINE = re.compile(r"^Plan, [^\n:]*: (OK|NOT REACHED|Input done|let the world run)", re.M)
STAGE = re.compile(r"^[（(].*[）)]$")
LEAK = re.compile(r"\(\s*\d+\s*,\s*\d+\s*\)|坐标|合约|合同|\b(?:plan|tile|tool|goal|body_\w+|world_\w+)\b", re.I)
NEGATIVE = re.compile(r"不能|进不去|过不去|无路|没路|卖不掉|不连通|是空的|别再|unreachable|blocked|no walkable", re.I)


def find_session(save_id: int) -> Path:
    hits = sorted(DSH.glob(f"sessions/*-sessions-{save_id}--/*/session.v4.jsonl*"), key=lambda p: p.stat().st_mtime)
    if not hits:
        raise FileNotFoundError(f"no DSH session log for save {save_id} under {DSH / 'sessions'}")
    return hits[-1]


def read_events(path: Path) -> list[dict]:
    if path.suffix == ".zstd":
        import zstandard
        with path.open("rb") as f:
            text = zstandard.ZstdDecompressor().stream_reader(f, read_across_frames=True).read().decode("utf-8")
    else:
        text = path.read_text(encoding="utf-8")
    return [e for e in map(json.loads, text.splitlines()) if "data" in e]


def pct(xs: list[float], p: float):
    s = sorted(xs)
    return round(s[min(len(s) - 1, round(p * (len(s) - 1)))]) if s else None


def _text(msg: dict) -> str:
    return "".join(c.get("text", "") for c in msg.get("content", []) if c.get("type") == "text")


def mind(events: list[dict]) -> dict:
    """Mind angles from the DSH session log, per game day where a day marker has been seen."""
    day, days = 0, {}
    names, steps, busy, ctx, said = {}, {}, [], [], []
    tools, errors, plans, outcomes, goals, reminders = Counter(), Counter(), [], Counter(), Counter(), 0
    tokens = Counter()

    def d(key, n=1):
        days.setdefault(day, Counter())[key] += n

    for e in events:
        t, x = e["type"], e["data"]
        if t == "user/message":
            text, kind = _text(x), x.get("source", {}).get("kind")
            if kind == "user" and (m := DAY.match(text)):
                day = int(m.group(1))
            if kind == "repeat-tool-reminder":
                reminders += 1
                d("repeats")
            for o in PLAN_LINE.findall(text):
                outcomes[o] += 1
                d("plan_" + o.lower().replace(" ", "_"))
        elif t == "step/start":
            steps[(x["turn"], x["step"])] = e["time"]
        elif t == "step/end" and (start := steps.get((x["turn"], x["step"]))) is not None:
            busy.append((start / 1000, e["time"] / 1000))
        elif t == "assistant/message":
            d("calls")
            if (start := steps.get((x["turn"], x["step"]))) is not None:
                d("think_ms", e["time"] - start)
            if u := x.get("usage"):
                fresh, cached, out = u.get("inputTokens", 0), u.get("cacheReadTokens", 0), u.get("outputTokens", 0)
                tokens.update(input=fresh, cached=cached, output=out)
                ctx.append(fresh + cached)
                d("tokens", fresh + cached + out)
            if line := _text(x["message"]).strip():
                said.append(line)
                d("said")
        elif t == "tool/call":
            names[x["callId"]] = x["name"]
            tools[x["name"]] += 1
            d("tools")
            if x["name"] == "plan_set":
                try:
                    plans.append(len(json.loads(x["arguments"]).get("steps", [])))
                except (ValueError, AttributeError):
                    plans.append(0)
        elif t == "tool/result" and x["message"].get("isError"):
            errors[names.get(x["message"].get("toolCallId"), "?")] += 1
            d("tool_errors")
        elif t == "goal/change":
            goals[x["operation"]] += 1
        elif t == "compaction/end":
            goals["compaction"] += 1
    blocked = sum(_text(e["data"]).startswith("<goal_blocked>") for e in events if e["type"] == "user/message")
    think = [b - a for a, b in busy]
    calls = sum(tools.values())
    return {
        "model_calls": sum(c["calls"] for c in days.values()),
        "tokens": dict(tokens), "context_tokens": {"p50": pct(ctx, .5), "max": max(ctx, default=None)},
        "step_ms": {"p50": pct([s * 1000 for s in think], .5), "p95": pct([s * 1000 for s in think], .95),
                    "max": pct([s * 1000 for s in think], 1)},
        "tools": dict(tools.most_common()), "tool_errors": dict(errors),
        "tool_error_rate": round(sum(errors.values()) / calls, 3) if calls else None,
        "repeat_reminders": reminders,
        "observe_per_plan": round(tools["world_observe"] / tools["plan_set"], 1) if tools["plan_set"] else None,
        "plan_steps": {"n": len(plans), "one_step_share": round(plans.count(1) / len(plans), 2) if plans else None,
                       "p50": pct(plans, .5), "max": max(plans, default=None)},
        "plan_outcomes": dict(outcomes), "goals": {**goals, "blocked_rounds": blocked},
        "speech": speech(said), "busy": busy,
        "days": {k: dict(v) for k, v in sorted(days.items())},
    }


def speech(lines: list[str]) -> dict:
    if not lines:
        return {"lines": 0}
    stage = [ln for ln in lines if STAGE.match(ln)]
    leaks = [ln for ln in lines if LEAK.search(ln)]
    return {"lines": len(lines), "mean_chars": round(sum(map(len, lines)) / len(lines)),
            "stage_direction_share": round(len(stage) / len(lines), 2),
            "repeat_share": round(1 - len(set(lines)) / len(lines), 2),
            "leaks": len(leaks), "leak_examples": leaks[:5], "stage_examples": stage[:3]}


def body(samples: list[dict], nights: list, busy: list[tuple[float, float]]) -> dict:
    """Per game day: idle share, and of the idle time, how much the mind was thinking versus nobody working."""
    busy = sorted(busy)
    days: dict[int, Counter] = {}
    j = 0
    for s in samples:
        if s["paused"] or any(a <= s["t"] <= b for a, b in nights):
            continue
        c = days.setdefault(s["day"], Counter())
        c["n"] += 1
        c["@" + str(s.get("location"))] += 1
        if s["task"] is None and not s["moving"]:
            while j < len(busy) and busy[j][1] < s["t"]:
                j += 1
            c["idle_thinking" if j < len(busy) and busy[j][0] <= s["t"] else "idle_dead"] += 1
    out = {}
    for day, c in sorted(days.items()):
        n = c["n"]
        top = [(k[1:], round(v / n, 2)) for k, v in c.most_common() if k.startswith("@")][:3]
        out[day] = {"idle": round((c["idle_thinking"] + c["idle_dead"]) / n, 2), "idle_dead": round(c["idle_dead"] / n, 2),
                    "idle_thinking": round(c["idle_thinking"] / n, 2), "where": top}
    total = sum(c["n"] for c in days.values()) or 1
    return {"idle_dead_share": round(sum(c["idle_dead"] for c in days.values()) / total, 2),
            "idle_thinking_share": round(sum(c["idle_thinking"] for c in days.values()) / total, 2), "days": out}


def beliefs(facts: Path) -> dict:
    if not facts.exists():
        return {}
    rows = [json.loads(ln) for ln in facts.read_text(encoding="utf-8").splitlines() if ln.strip()]
    neg = [r for r in rows if NEGATIVE.search(r.get("text", ""))]
    return {"facts": len(rows), "negative": len(neg), "worked": sum(bool(r.get("worked")) for r in rows),
            "relearned": sum(r.get("uses", 1) > 1 for r in rows),
            "negative_examples": [f"[{r.get('topic')}] {r['text'][:80]}" for r in neg[:5]]}


def observe(run: Path, session: Path | None = None, save_id: int | None = None) -> dict:
    run = Path(run)
    results = json.loads((run / "results.json").read_text(encoding="utf-8"))
    save_id = save_id or results.get("run", {}).get("save_id")
    session = session or (find_session(save_id) if save_id else None)
    if session is None:
        raise SystemExit("no session log: pass --save-id or --session (runs before observe record their save id)")
    m = mind(read_events(Path(session)))
    out = {"run": run.name, "save_id": save_id, "session": str(session), "mind": m}
    goal = next((v for v in results.values() if isinstance(v, dict) and "metrics" in v), {})
    out["g"] = goal.get("metrics")
    if (samples := run / "metrics-samples.json").exists():
        raw = json.loads(samples.read_text(encoding="utf-8"))
        out["body"] = body(raw["samples"], raw["nights"], m["busy"])
    out["output"] = {d["day"]: {k: v for k, v in d.items() if k != "day" and (type(v) is int or v is True)}
                     for d in goal.get("days", [])}
    if save_id:
        out["beliefs"] = next((beliefs(p) for p in DSH.glob(f"player2/bridge/projects/*/ledger/saves/{save_id}/facts.jsonl")), {})
    del m["busy"]
    return out


def headline(o: dict) -> dict:
    m, g, b = o["mind"], o.get("g") or {}, o.get("body") or {}
    tok = m["tokens"]
    return {
        "G1 idle ratio": g.get("g1_idle_ratio"), "G2 gap p95 ms": (g.get("g2_skill_gap_ms") or {}).get("p95"),
        "G3 stuck / game h": (g.get("g3_stuck") or {}).get("per_game_hour"),
        "idle, mind thinking": b.get("idle_thinking_share"), "idle, nobody working": b.get("idle_dead_share"),
        "model calls": m["model_calls"], "step p50 / p95 ms": f"{m['step_ms']['p50']} / {m['step_ms']['p95']}",
        "context p50 / max tok": f"{m['context_tokens']['p50']} / {m['context_tokens']['max']}",
        "tokens in / cached / out": f"{tok.get('input', 0)} / {tok.get('cached', 0)} / {tok.get('output', 0)}",
        "tool error rate": m["tool_error_rate"], "repeat-call reminders": m["repeat_reminders"],
        "observe calls per plan": m["observe_per_plan"], "one-step plans": m["plan_steps"]["one_step_share"],
        "goal blocked rounds": m["goals"].get("blocked_rounds"),
        "lines spoken": m["speech"].get("lines"), "stage directions": m["speech"].get("stage_direction_share"),
        "leaked internals": m["speech"].get("leaks"), "repeated lines": m["speech"].get("repeat_share"),
        "negative beliefs kept": (o.get("beliefs") or {}).get("negative"),
    }


def render(o: dict, vs: dict | None = None) -> str:
    h, hv = headline(o), headline(vs) if vs else None
    cols = f"| angle | {o['run']} |" + (f" {vs['run']} |" if vs else "")
    lines = [f"# Companion observation: `{o['run']}`", "", f"save `{o['save_id']}`, DSH log `{o['session']}`", "",
             cols, "|---|---|" + ("---|" if vs else "")]
    lines += [f"| {k} | {v} |" + (f" {hv[k]} |" if hv else "") for k, v in h.items()]
    m = o["mind"]
    lines += ["", "## Timeline (game day)", "",
              "| day | idle | nobody working | where | calls | think s | k tokens | plans OK / not reached | repeats | errors | said | output |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    bd = (o.get("body") or {}).get("days", {})
    for day in sorted(set(map(int, m["days"])) | set(map(int, bd))):
        c, b = m["days"].get(day, m["days"].get(str(day), {})), bd.get(day, bd.get(str(day), {}))
        where = ", ".join(f"{w[:14]} {s:.0%}" for w, s in b.get("where", []))
        out = " ".join(f"{k} {v}" for k, v in o["output"].get(day, o["output"].get(str(day), {})).items())
        lines.append(f"| {day} | {b.get('idle', '')} | {b.get('idle_dead', '')} | {where} | {c.get('calls', 0)} | "
                     f"{round(c.get('think_ms', 0) / 1000)} | {round(c.get('tokens', 0) / 1000)} | "
                     f"{c.get('plan_ok', 0)} / {c.get('plan_not_reached', 0)} | {c.get('repeats', 0)} | "
                     f"{c.get('tool_errors', 0)} | {c.get('said', 0)} | {out} |")
    sp, bel = m["speech"], o.get("beliefs") or {}
    lines += ["", "## Details", "", f"- tools: {m['tools']}", f"- tool errors: {m['tool_errors']}",
              f"- plan steps: {m['plan_steps']}; outcomes: {m['plan_outcomes']}", f"- goals: {m['goals']}",
              f"- stage-direction examples: {sp.get('stage_examples')}", f"- leak examples: {sp.get('leak_examples')}",
              f"- beliefs: {bel.get('facts')} facts, {bel.get('worked')} worked, {bel.get('relearned')} learned again; "
              f"negative: {bel.get('negative_examples')}"]
    return "\n".join(lines) + "\n"


def write(run: Path, **kw) -> dict:
    o = observe(run, **kw)
    (Path(run) / "observe.json").write_text(json.dumps(o, ensure_ascii=False, indent=1), encoding="utf-8")
    (Path(run) / "observe.md").write_text(render(o), encoding="utf-8")
    return o


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("run", type=Path)
    ap.add_argument("--save-id", type=int)
    ap.add_argument("--session", type=Path)
    ap.add_argument("--vs", type=Path, help="an earlier run dir with observe.json, shown side by side")
    a = ap.parse_args()
    o = write(a.run, session=a.session, save_id=a.save_id)
    vs = json.loads((a.vs / "observe.json").read_text(encoding="utf-8")) if a.vs else None
    print(render(o, vs))
