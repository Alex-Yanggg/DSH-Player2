"""pytest wiring: one game session for the whole run, dependency-aware skipping, failure screenshots and a
category summary. Set E2E_ATTACH=1 to drive an already-running game instead of launching one (fast iteration;
the console fixture channel is then unavailable)."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

import gamepilot as gp  # noqa: E402
from games.stardew import Paths, StardewGame, build_test_save  # noqa: E402

CATEGORIES = ("boot", "presence", "conversation", "boundaries", "feel", "bline", "coop", "persona")
_results: list[dict] = []
_state: dict = {}


def pytest_collection_modifyitems(items):
    for item in items:
        if "unit" not in item.nodeid.replace("\\", "/").split("/"):
            item.add_marker(pytest.mark.live)


@pytest.fixture(scope="session")
def art():
    a = gp.RunArtifacts(ROOT / "artifacts")
    _state["art"] = a
    return a


@pytest.fixture(scope="session")
def game(art):
    attach = bool(os.environ.get("E2E_ATTACH"))
    paths = Paths()
    if not attach:
        # Refuse before rebuilding: the rebuild deletes the test save's bridge sessions, which would corrupt a
        # run (or a manual session) that is already driving the game.
        if running := gp.win.find_window(StardewGame.PROCESS):
            raise RuntimeError(f"Stardew Valley is already running (hwnd {running}); close it first")
        build_test_save(paths)
    g = StardewGame(paths, art)
    _state["game"] = g
    try:
        if attach:
            g.attach()
        else:
            g.launch()
        yield g
    finally:
        if not attach:
            g.quit()


@pytest.fixture(scope="session")
def world(game):
    """Past the title screen, in the isolated save, companion chosen and DSH started; the chat closed, so F2 and
    typing reach the chat."""
    game.ensure_world()
    game.close_chat()
    return game


@pytest.fixture(scope="session")
def hello(world, art):
    """One ordinary chat turn shared by every test that only needs *a* completed/failed exchange."""
    ex = world.send_chat("你好", timeout=90, until_said=True)
    art.record("shared_hello_exchange", outcome=ex.outcome, error=ex.error, stop_reason=ex.stop_reason,
               latencies=ex.latencies(), reply=ex.reply)
    world.shot("hello_after")
    return ex


def require_dsh(ex):
    """Skip (do not fail) tests whose subject is downstream of a working DSH turn (`sent:` ... spoken or ended)."""
    if ex.outcome not in ("completed", "speaking"):
        pytest.skip(f"BLOCKED by conversation round-trip ({ex.outcome}): {(ex.error or '')[:140]}")


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    rep = outcome.get_result()
    if rep.when == "call" or (rep.when == "setup" and (rep.skipped or rep.failed)):
        cat = next((m.name for m in item.iter_markers() if m.name in CATEGORIES), "unit")
        _results.append({"test": item.name, "category": cat, "outcome": "error" if rep.when == "setup" and rep.failed else rep.outcome,
                         "detail": (str(rep.longrepr).splitlines()[-1][:200] if rep.failed or rep.skipped else "")})
    if rep.when == "call" and rep.failed and "game" in _state and "art" in _state:
        try:
            _state["game"].shot(f"FAIL_{item.name}")
        except Exception:
            pass


def pytest_sessionfinish(session):
    art = _state.get("art")
    if not art or not _results:
        return
    lines = ["# E2E run summary", f"run: `{art.run_id}`", "", "| category | pass | fail | setup error | blocked/skip |", "|---|---|---|---|---|"]
    for cat in (*CATEGORIES, "unit"):
        rs = [r for r in _results if r["category"] == cat]
        if rs:
            lines.append(f"| {cat} | {sum(r['outcome']=='passed' for r in rs)} | {sum(r['outcome']=='failed' for r in rs)} | "
                         f"{sum(r['outcome']=='error' for r in rs)} | {sum(r['outcome']=='skipped' for r in rs)} |")
    lines += ["", "## Details", ""]
    lines += [f"- **{r['outcome'].upper()}** `{r['category']}/{r['test']}` {r['detail']}" for r in _results]
    (art.dir / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
