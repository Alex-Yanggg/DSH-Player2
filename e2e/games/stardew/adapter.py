"""Stardew Valley adapter for gamepilot.

Three channels, kept apart on purpose:
  * FIXTURE  - state we arrange before/around a run (copied test save, SMAPI console `debug ...` commands).
               Never used to produce the behaviour under test.
  * STIMULUS - what a player does: keyboard + mouse injected into the game window.
  * ORACLE   - what we judge from: SMAPI log, the mod's development-log JSONL, bridge files, screenshots.
No SMAPI mod API and no in-process injection is involved on the test side.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from pathlib import Path

import psutil

import gamepilot as gp
from gamepilot import vision, win

APPDATA = Path(os.environ.get("APPDATA", ""))
USERPROFILE = Path(os.environ.get("USERPROFILE", ""))

LAST_TEST_SAVE = Path(__file__).resolve().parents[2] / "artifacts" / "last-test-save.txt"


def _test_save_id() -> int:
    """Every run gets a fresh test character: a new unique id means a new farmer, new bridge sessions and new
    durable DSH sessions, so no run inherits an earlier run's conversation or receipts. The 99xxxxxxx range marks
    test saves. E2E_SAVE_ID pins one; attach mode (E2E_ATTACH) reuses the last run's save, which is still loaded."""
    if pinned := os.environ.get("E2E_SAVE_ID"):
        return int(pinned)
    if os.environ.get("E2E_ATTACH") and LAST_TEST_SAVE.exists():
        return int(LAST_TEST_SAVE.read_text(encoding="utf-8").strip())
    return 990_000_000 + int(time.time()) % 10_000_000


TEST_SAVE_ID = _test_save_id()  # unique-ID of this run's test save; anything under ~/.dsh keyed by it is ours
TEST_SAVE_NAME = f"E2E_{TEST_SAVE_ID}"


def find_game_dir() -> Path:
    env = os.environ.get("STARDEW_DIR")
    candidates = ([Path(env)] if env else []) + [
        Path(r"C:\Program Files (x86)\Steam\steamapps\common\Stardew Valley"),
        Path(r"C:\Program Files\Steam\steamapps\common\Stardew Valley"),
    ]
    for c in candidates:
        if (c / "StardewModdingAPI.exe").exists():
            return c
    raise FileNotFoundError("Stardew Valley with SMAPI not found; set STARDEW_DIR")


@dataclass
class Paths:
    game: Path = field(default_factory=find_game_dir)
    saves: Path = APPDATA / "StardewValley" / "Saves"
    smapi_log: Path = APPDATA / "StardewValley" / "ErrorLogs" / "SMAPI-latest.txt"
    bridge: Path = USERPROFILE / ".dsh" / "player2" / "bridge"

    @property
    def devlog(self) -> Path:
        """Written by the DSH host plugin: what DSH did with each turn (carries the turn `id`)."""
        return self.bridge / "development-logs" / "dsh-player2-host.jsonl"

    @property
    def mod_devlog(self) -> Path:
        """Written by the mod: what the PLAYER saw (reply presented, traced error, COMPANION_MOVEMENT_*)."""
        return self.bridge / "development-logs" / "player2-host.jsonl"

    @property
    def latency_mod(self) -> Path:
        """P2-0015 same-clock latency stages from the mod (key-enter, published, mod-picked, rendered, motion...)."""
        return self.bridge / "development-logs" / "latency-mod.jsonl"

    @property
    def latency_host(self) -> Path:
        """P2-0015 latency stages from the DSH host (host-picked, agent-ready, first-token, model-done, written)."""
        return self.bridge / "development-logs" / "latency-host.jsonl"

    def session_dirs(self, save_id: int = TEST_SAVE_ID) -> list[Path]:
        return list((self.bridge / "projects").glob(f"*/sessions/{save_id}"))


# --------------------------------------------------------------------------------------------- fixture
def _forget_previous_test_save(paths: Paths) -> None:
    """Remove the previous run's test save and its bridge sessions, by the exact id recorded for it (990000001
    is the legacy fixed id). Its durable DSH transcripts stay in ~/.dsh/sessions: a new id never resumes them."""
    previous = int(LAST_TEST_SAVE.read_text(encoding="utf-8").strip()) if LAST_TEST_SAVE.exists() else 990000001
    if previous == TEST_SAVE_ID or not 990_000_000 <= previous <= 999_999_999:
        return
    shutil.rmtree(paths.saves / f"E2E_{previous}", ignore_errors=True)
    for d in paths.session_dirs(previous):
        shutil.rmtree(d, ignore_errors=True)


def build_test_save(paths: Paths, source: str | None = None) -> Path:
    """Fresh isolated copy of a day-1 save under this run's new unique ID - a fresh test character - so chat
    history, receipts and sessions never mix with the player's real saves or with an earlier run. The template is
    any untouched day-1 save folder name under Saves, named by E2E_SOURCE_SAVE; it is only ever read."""
    source = source or os.environ.get("E2E_SOURCE_SAVE", "")
    if not source or not (paths.saves / source / source).is_file():
        raise RuntimeError(f"set E2E_SOURCE_SAVE to a day-1 save folder in {paths.saves} (got {source!r}); see e2e/README.md")
    _forget_previous_test_save(paths)
    LAST_TEST_SAVE.parent.mkdir(parents=True, exist_ok=True)
    LAST_TEST_SAVE.write_text(str(TEST_SAVE_ID), encoding="utf-8")
    src, dst = paths.saves / source, paths.saves / TEST_SAVE_NAME
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    (dst / source).rename(dst / TEST_SAVE_NAME)
    for stale in dst.glob("*_old"):
        stale.unlink()
    main = dst / TEST_SAVE_NAME
    xml = main.read_text(encoding="utf-8")
    old_id = re.search(r"<uniqueIDForThisGame>(\d+)</uniqueIDForThisGame>", xml).group(1)
    # The load screen orders saves by the farmer's <saveTime> (minutes since 2012-06-22) and every day-1 save
    # looks identical on screen. A copy ties with its source, so stamp it "now + 1" to be deterministically slot 1.
    stamp = int((time.time() - time.mktime((2012, 6, 22, 0, 0, 0, 0, 0, -1))) // 60) + 1
    retime = lambda s: re.sub(r"<saveTime>\d+</saveTime>", f"<saveTime>{stamp}</saveTime>", s)
    main.write_text(retime(xml.replace(f"<uniqueIDForThisGame>{old_id}</uniqueIDForThisGame>",
                                       f"<uniqueIDForThisGame>{TEST_SAVE_ID}</uniqueIDForThisGame>")), encoding="utf-8")
    info = dst / "SaveGameInfo"
    info.write_text(retime(info.read_text(encoding="utf-8")), encoding="utf-8")
    # Reset our bridge sessions only - the path is keyed by the test ID, never by a real save's.
    for d in paths.session_dirs():
        shutil.rmtree(d, ignore_errors=True)
    return dst


# --------------------------------------------------------------------------------------------- UI flows
# Coordinates are for a 1920x1080 client area, stored as fractions. Pixels only say WHERE to click; WHICH
# screen we are on is always decided from the SMAPI log, because colours collide (world floor vs title sign).
REF_W, REF_H = 1920.0, 1080.0
TITLE_EXIT_BUTTON = (0.640, 0.825, 0.745, 0.970)  # the title's Exit button, as a fraction region
TITLE_WOOD = (220, 150, 90)                        # its plank colour; ~27 % of that region at tol 50
UI = {
    "title_load": (835, 960),
    "load_slot_1": (950, 300),       # body of slot 1, clear of the delete icon at the right edge
    "companion_answer_0": (405, 841),  # answers are 68 px apart
    "companion_answer_step": 68,
    "customizer_ok": (1228, 840),
    # Question dialogues are bottom-anchored: the last answer is always at y=977 and answers are 68 px apart.
    "answer_last_y": 977,
    "answer_x": 480,
}
PROPOSAL_AGREE, PROPOSAL_DECLINE = 0, 1   # a proposal has exactly two answers, in this order
DIALOG_BOX = (255, 200, 120)
DIALOG_REGION: vision.Region = (0.17, 0.65, 0.83, 0.97)


CHAT_REGION: vision.Region = (0.0, 0.70, 0.40, 1.0)
CHAT_BORDER = (189, 148, 82)  # exact border colour of the Player2 chat overlay
CHAT_VISIBLE_MIN = 0.008      # closed: ~0.003 (HUD pixels), open: ~0.015
SOCIAL_DONE = ("DSH_SOCIAL_TURN_COMPLETED", "DSH_SOCIAL_TURN_FAILED")
MOVEMENT_DONE = ("COMPANION_MOVEMENT_COMPLETED", "COMPANION_MOVEMENT_FAILED")


@dataclass
class Exchange:
    """One chat message and everything observable about its round trip."""
    text: str
    timeline: gp.Timeline = field(default_factory=gp.Timeline)
    outcome: str = "timeout"           # completed | failed | timeout
    trace_id: str | None = None
    error: str | None = None
    movement: list = field(default_factory=list)   # COMPANION_MOVEMENT_* records (mod log) seen after the send
    command_stages: dict = field(default_factory=dict)  # latency-mod "command" lane: stage -> epoch s
    stages: dict = field(default_factory=dict)          # latency mod+host lane for THIS turn id: stage -> epoch s
    turn: dict | None = None            # the turn the game published (carries the companion's facts)
    envelope: dict | None = None        # whatever landed in the outbox lane (a reply OR an error envelope)
    reply: dict | None = None           # the validated reply only; None when DSH returned an error

    def latencies(self) -> dict:
        t, out = self.timeline, {}
        for a, b, name in (("enter", "published", "enter_to_publish"), ("published", "result", "dsh_roundtrip"),
                           ("enter", "result", "enter_to_result")):
            if a in t.marks and b in t.marks:
                out[name + "_ms"] = round(t.ms(a, b))
        # Same-clock stages written by the game and the host themselves (P2-0015 T0.1).
        cs = self.command_stages
        if "key-enter" in cs and "motion-started" in cs:
            out["command_to_motion_ms"] = round((cs["motion-started"] - cs["key-enter"]) * 1000)
        st = self.stages
        for a, b, name in (("key-enter", "first-token", "key_to_first_token"), ("key-enter", "rendered", "key_to_rendered"),
                           ("host-picked", "agent-ready", "agent_ready")):
            if a in st and b in st:
                out[name + "_ms"] = round((st[b] - st[a]) * 1000)
        return out

    @property
    def companion_facts(self) -> dict:
        """presentHere / location / movementState / distance exactly as the game told DSH at send time."""
        if not self.turn:
            return {}
        facts = {k: gp.find_key(self.turn, k) for k in ("presentHere", "location", "movementState")}
        facts["distance"] = gp.find_key(self.turn, "distanceInTiles")
        return facts


class WrongSave(RuntimeError):
    """The game loaded a save other than the isolated fixture. Nothing else may run."""


def _frac(xy):
    return xy[0] / REF_W, xy[1] / REF_H


class StardewFlows:
    """Player-visible flows built from clicks + log confirmation. Mixed into StardewGame."""

    def wait_title(self, timeout: float = 150.0) -> None:
        if not self.smapi.wait_for(r"titleScreenGameMode", timeout):
            raise TimeoutError("game never reached the title screen")
        deadline = time.monotonic() + timeout
        # The log line comes long before the title is usable: a white splash, then the logo animation, and a click
        # during either only skips ahead (the screen changes, so click_until_changed would wrongly call it done).
        # Ready means the title's own buttons are drawn; the Exit button is used because the cursor never hovers it.
        while not self._title_buttons_visible():
            if time.monotonic() > deadline:
                raise TimeoutError("title buttons never appeared")
            time.sleep(0.5)
        time.sleep(1.5)

    def _title_buttons_visible(self, frame=None) -> bool:
        return vision.color_fraction(frame if frame is not None else self.frame(), TITLE_WOOD, tol=50, region=TITLE_EXIT_BUTTON) >= 0.15

    def load_test_save(self, timeout: float = 90.0) -> None:
        if not self._title_buttons_visible():
            self.wait_title()
        exit_button = vision.crop(self.frame(), TITLE_EXIT_BUTTON)
        for _ in range(10):  # the load menu is open only once the title's button row is gone
            self.refocus()  # a just-refocused window can ignore clicks for a moment; keep trying for ~30 s
            self.click_at(*_frac(UI["title_load"]))
            time.sleep(2.0)
            now = self.frame()
            if vision.diff_fraction(exit_button, vision.crop(now, TITLE_EXIT_BUTTON)) >= 0.3:
                break
        else:
            raise TimeoutError("clicking Load never replaced the title screen")
        mark = len(self.smapi.lines)
        # The slot list fills in asynchronously ("Find Save Games") and hovering a slot already changes the screen,
        # so a pixel diff cannot tell a landed click from an ignored one. Click only once the list is found, and stop
        # as soon as the game enters loadingMode: input sent while it loads is unwanted (and may hit a lost focus).
        self.smapi.wait_for(r"Synchronizing 'Find Save Games' task", 30)
        for _ in range(5):
            self.click_at(*_frac(UI["load_slot_1"]))
            if self.smapi.wait_for(r"set to 'loadingMode", 6, since=mark):
                break
        hit = self.smapi.wait_for(r"Context: loaded save '([^']+)'", timeout, since=mark)
        if not hit:
            raise TimeoutError("no 'loaded save' line after clicking slot 1")
        name = re.search(r"loaded save '([^']+)'", hit[1]).group(1)
        if name != TEST_SAVE_NAME:
            raise WrongSave(f"loaded {name!r}, expected {TEST_SAVE_NAME!r}; closing without touching anything")

    def choose_companion(self, index: int = 0, timeout: float = 60.0) -> None:
        """First day of a fresh save: answer the roster question, then accept the native customizer as-is."""
        mark = len(self.smapi.lines)
        deadline = time.monotonic() + timeout
        ax, ay = UI["companion_answer_0"]
        target = _frac((ax, ay + UI["companion_answer_step"] * index))
        # the question needs a free player; click only once the dialogue box is on screen
        while time.monotonic() < deadline:
            if vision.color_fraction(self.frame(), (255, 200, 120), tol=40, region=(0.17, 0.65, 0.83, 0.97)) > 0.55:
                break
            time.sleep(0.5)
        else:
            raise TimeoutError("companion question never appeared")
        while not self.smapi.wait_for(r"companion \w+ was chosen", 2.5, since=mark):
            self.click_at(*target)
            if time.monotonic() > deadline:
                raise TimeoutError("companion choice was never registered")
        if not self.smapi.wait_for(r"queued Stardew Valley's native character customization", 10, since=mark):
            raise TimeoutError("customizer was never queued")
        time.sleep(3)  # menu opens on a later tick
        while not self.smapi.wait_for(r"saved the vanilla farmer appearance", 2.5, since=mark):
            self.click_at(*_frac(UI["customizer_ok"]))
            if time.monotonic() > deadline + 30:
                raise TimeoutError("customizer OK never registered")

    def wait_bundle_ready(self, timeout: float = 90.0) -> bool:
        return self.smapi.wait_for(r"native DSH bundle is ready", timeout) is not None

    # -- idempotent: each step inspects the log first, so a run can resume against an already-running game
    def log_has(self, pattern: str) -> bool:
        return bool(self.smapi.grep(pattern))

    def ensure_world(self) -> None:
        if not self.log_has(r"Context: loaded save"):
            self.wait_title()
            self.load_test_save()
        if not self.log_has(r"companion \w+ was chosen"):
            self.choose_companion(0)
        if not self.log_has(r"native DSH bundle is ready"):
            if not self.wait_bundle_ready():
                raise TimeoutError("native DSH bundle never reported ready")
        time.sleep(2)

    # -- consent: the daily "may I?" proposal (native question dialogue, blocks F2 while open)
    def dialog_visible(self, img=None) -> bool:
        img = img or self.frame()
        return vision.color_fraction(img, DIALOG_BOX, tol=40, region=DIALOG_REGION) > 0.55

    def wait_proposal(self, timeout: float = 90.0) -> float | None:
        """Block until DSH's proposal is awaiting consent and its dialogue is on screen. Returns seconds from the
        decision being published to the proposal arriving, or None if it never arrived."""
        hit = self.smapi.wait_for(r"awaiting native player consent", timeout)
        if not hit:
            return None
        published = next((t for t, ln in self.smapi.lines if "published decision sequence" in ln), None)
        deadline = time.monotonic() + 20
        while not self.dialog_visible():
            if time.monotonic() > deadline:
                raise TimeoutError("proposal is awaiting consent but no dialogue appeared on screen")
            time.sleep(0.5)
        return round(hit[0] - published, 1) if published else None

    def answer_proposal(self, answer: int, timeout: float = 30.0) -> str:
        """Click agree/decline and return the settled status ('completed' | 'declined' | 'failed')."""
        mark = len(self.smapi.lines)
        y = UI["answer_last_y"] - 68 * (1 - answer)   # two answers: agree is one step above decline
        deadline = time.monotonic() + timeout
        while True:
            self.click_at(*_frac((UI["answer_x"], y)))
            hit = self.smapi.wait_for(r"settled DSH decision sequence \d+ as (\w+)", 3, since=mark)
            if hit:
                return re.search(r"as (\w+);", hit[1]).group(1)
            if time.monotonic() > deadline:
                raise TimeoutError("proposal answer was never settled")

    def retry_day(self, timeout: float = 15.0) -> bool:
        """F6: re-open a settled-but-not-completed day turn."""
        mark = len(self.smapi.lines)
        self.refocus()
        self.kb.tap("f6")
        return self.smapi.wait_for(r"re-opens the settled game day", timeout, since=mark) is not None

    def clear_modal(self) -> None:
        """Leave the world with no dialogue up (decline a still-pending proposal): chat needs a free player."""
        self.smapi.poll()
        awaiting = len(self.smapi.grep(r"awaiting native player consent"))
        settled = len(self.smapi.grep(r"settled DSH decision sequence"))
        if awaiting > settled:
            self.wait_proposal(10)
            self.answer_proposal(PROPOSAL_DECLINE)

    # -- chat
    def chat_visible(self, img=None) -> bool:
        img = img or self.frame()
        return vision.color_fraction(img, CHAT_BORDER, tol=4, region=CHAT_REGION) >= CHAT_VISIBLE_MIN

    def open_chat(self, attempts: int = 3) -> None:
        for _ in range(attempts):
            if self.chat_visible():
                return
            self.refocus()
            self.kb.tap("f2")
            time.sleep(0.8)
        if not self.chat_visible():
            raise TimeoutError("F2 never opened the chat overlay")

    def close_chat(self) -> None:
        for _ in range(3):
            if not self.chat_visible():
                return
            self.kb.tap("esc")
            time.sleep(0.6)

    def watch_lanes(self) -> None:
        """Follow the social lanes (files are deleted when consumed, so poll and keep copies)."""
        pat = f"projects/*/sessions/{TEST_SAVE_ID}"
        self.lane_in = gp.DirWatch(self.paths.bridge, f"{pat}/social-inbox/*")
        self.lane_out = gp.DirWatch(self.paths.bridge, f"{pat}/social-outbox/*")

    def poll_logs(self) -> None:
        for tail in (self.smapi, self.devlog, self.modlog, self.lat_mod, self.lat_host):
            tail.poll()

    def latency_stages(self, lane: str, key: str) -> dict:
        """stage -> epoch seconds for one lane/key, from both latency files (first stamp of each stage wins)."""
        out: dict = {}
        for tail in (self.lat_mod, self.lat_host):
            for _, r in tail.records:
                if r.get("lane") == lane and r.get("key") == key and r.get("stage") not in out:
                    try:
                        out[r["stage"]] = gp.parse_iso(r["at"])
                    except (KeyError, ValueError, TypeError):
                        pass
        return out

    def pending_social_turns(self) -> list[str]:
        """Ids of social turns the game published (chat or day-start) that have no presented/failed record yet."""
        self.poll_logs()
        published = [m.group(1) for _, ln in self.smapi.lines
                     if (m := re.search(r"published native DSH social turn social:([0-9a-f-]+)", ln))]
        done = " ".join(str(r.get("traceId", "")) for _, r in self.modlog.records if r.get("code") in SOCIAL_DONE)
        return [tid for tid in published if tid not in done]

    def wait_social_idle(self, timeout: float = 90.0) -> bool:
        """The game holds one social turn at a time and keeps a new draft unsent while one is pending (by design).
        Wait for the in-flight turn (often the day-start line, or the reply to a movement command) to finish."""
        deadline = time.monotonic() + timeout
        while self.pending_social_turns():
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.2)
        return True

    def send_chat(self, text: str, timeout: float = 90.0, wait_movement: float = 0.0, reply: bool = True,
                  close_after_enter: bool = False) -> Exchange:
        """Type `text` into the open chat, press Enter, and follow the turn to a terminal outcome.

        The turn is identified by its own id (the inbox file whose message content is `text`), and its outcome
        is the mod's record whose traceId carries that id - so the day-start line or an earlier turn finishing
        meanwhile is never mistaken for this message's result.
        reply=False: an explicit movement command (P2-0015: it moves at submit time, independent of DSH); wait
        only for the movement records, up to `wait_movement` seconds, not for the DSH reply.
        close_after_enter: close the chat right after Enter. The open chat is a menu and pauses the world by design
        (single-player), so a command is issued at Enter but the companion only walks once the chat is closed."""
        if reply and not self.wait_social_idle(timeout):
            raise TimeoutError(f"an earlier social turn never finished: {self.pending_social_turns()}")
        self.open_chat()
        if not hasattr(self, "lane_in"):
            self.watch_lanes()
        self.poll_logs()
        sm, mm, cm = len(self.smapi.lines), len(self.modlog.records), len(self.lat_mod.records)
        n_in, n_out = len(self.lane_in.seen), len(self.lane_out.seen)
        ex = Exchange(text)
        self.kb.type_text(text)
        ex.timeline.mark("typed")
        ex.timeline.mark("enter")
        self.kb.tap("enter")
        if close_after_enter:
            time.sleep(0.2)
            self.close_chat()
        deadline = time.monotonic() + (timeout if reply else max(wait_movement, 3.0))
        movement_deadline = time.monotonic() + wait_movement
        while time.monotonic() < deadline:
            self.poll_logs()
            self.lane_in.poll()
            self.lane_out.poll()
            if ex.turn is None:
                for _, turn in list(self.lane_in.json_files())[n_in:]:
                    if (turn.get("message") or {}).get("content") == text and turn.get("occasion") in (None, ""):
                        ex.turn = turn
            tid = (ex.turn or {}).get("id")
            for seen, ln in self.smapi.lines[sm:]:
                if "published" not in ex.timeline.marks and "published native DSH social turn" in ln and (not tid or tid in ln):
                    ex.timeline.mark("published", seen)
            if tid and "result" not in ex.timeline.marks:
                for seen, rec in self.modlog.records[mm:]:
                    if rec.get("code") in SOCIAL_DONE and tid in str(rec.get("traceId", "")):
                        ex.timeline.mark("result", seen)
                        ex.outcome = "completed" if rec["code"].endswith("COMPLETED") else "failed"
                        ex.trace_id = rec.get("traceId")
                        ex.error = None if ex.outcome == "completed" else rec.get("message")
                        break
            ex.movement = [r for _, r in self.modlog.records[mm:] if str(r.get("code", "")).startswith("COMPANION_MOVEMENT")]
            moved_enough = time.monotonic() >= movement_deadline or any(m["code"] in MOVEMENT_DONE for m in ex.movement)
            if moved_enough and ("result" in ex.timeline.marks or not reply):
                break
            time.sleep(0.02)
        self.poll_logs()
        keys = [r.get("key") for _, r in self.lat_mod.records[cm:] if r.get("lane") == "command" and r.get("stage") == "key-enter"]
        if keys:
            ex.command_stages = self.latency_stages("command", keys[-1])
        if ex.turn:
            ex.stages = self.latency_stages("social", ex.turn["id"])
            outs = [o for _, o in self.lane_out.json_files() if o.get("id") == ex.turn["id"]]
            ex.envelope = outs[-1] if outs else None
        elif len(self.lane_out.seen) > n_out:
            ex.envelope = list(self.lane_out.json_files())[-1][1]
        ex.reply = None if (ex.envelope or {}).get("status") == "error" else ex.envelope
        if not reply and ex.outcome == "timeout":
            ex.outcome = "not-awaited"
        return ex

    def day_start_line(self, timeout: float = 60.0) -> dict:
        """The day's first line (P2-0015 T0.4), observed from the logs only: the turn id comes from the SMAPI
        publish line; the outcome is the mod record that names it. Returns {id, outcome, trace_id, message,
        stages, waited_s}."""
        t0 = time.monotonic()
        hit = self.smapi.wait_for(r"published native DSH social turn social:([0-9a-f-]+) \(day-start\)", timeout)
        if not hit:
            return {"id": None, "outcome": "never-published", "waited_s": round(time.monotonic() - t0, 1)}
        tid = re.search(r"social:([0-9a-f-]+) \(day-start\)", hit[1]).group(1)
        rec = self.modlog.wait_for(lambda r: r.get("code") in SOCIAL_DONE and tid in str(r.get("traceId", "")),
                                   max(1.0, timeout - (time.monotonic() - t0)))
        self.poll_logs()
        out = {"id": tid, "stages": self.latency_stages("day-start", tid), "waited_s": round(time.monotonic() - t0, 1)}
        if not rec:
            return {**out, "outcome": "timeout"}
        r = rec[1]
        return {**out, "outcome": "completed" if r["code"].endswith("COMPLETED") else "failed",
                "trace_id": r.get("traceId"), "message": r.get("message")}

    def warp(self, location: str, x: int, y: int) -> None:
        """FIXTURE, not stimulus: place the farmer via Stardew's own debug console command."""
        self.console(f"debug warp {location} {x} {y}")
        time.sleep(2.5)


# --------------------------------------------------------------------------------------------- game
class StardewGame(StardewFlows):
    PROCESS = ("stardewmoddingapi.exe", "stardew valley.exe")  # SMAPI 4.x hosts the game in its own process
    TITLE = "Stardew Valley"

    def __init__(self, paths: Paths | None = None, artifacts: gp.RunArtifacts | None = None, failsafe: gp.Failsafe | None = None):
        self.paths = paths or Paths()
        self.art = artifacts
        self.failsafe = failsafe or gp.Failsafe()
        self.kb = gp.Keyboard(self.failsafe)
        self.mouse = gp.Mouse(self.failsafe)
        self.proc: subprocess.Popen | None = None
        self.hwnd: int | None = None
        self._stdout = None
        self.smapi: gp.TextTail | None = None
        self.devlog: gp.JsonlTail | None = None
        self.modlog: gp.JsonlTail | None = None
        self.lat_mod: gp.JsonlTail | None = None
        self.lat_host: gp.JsonlTail | None = None
        self.rect: gp.Rect | None = None

    # -- lifecycle
    def launch(self, timeout: float = 120.0) -> None:
        """Start through StardewModdingAPI.exe with stdin piped (console channel) and wait for a window."""
        if find_existing := win.find_window(self.PROCESS):
            raise RuntimeError(f"Stardew Valley is already running (hwnd {find_existing}); close it first")
        # SMAPI rewrites its log per launch; a stale file would hide the new run behind an old offset.
        self.paths.smapi_log.unlink(missing_ok=True)
        self.smapi = gp.TextTail(self.paths.smapi_log)
        self._open_tails()
        logdir = (self.art.dir if self.art else Path.cwd())
        self._stdout = open(logdir / "smapi-console.txt", "wb")
        self.proc = subprocess.Popen([str(self.paths.game / "StardewModdingAPI.exe")], cwd=self.paths.game,
                                     stdin=subprocess.PIPE, stdout=self._stdout, stderr=subprocess.STDOUT)
        self.hwnd = win.wait_for_window(self.PROCESS, self.TITLE, timeout)
        self.refocus()

    def attach(self) -> None:
        """Bind to an already-running game (development: iterate on a scenario without a 90 s relaunch)."""
        self.hwnd = win.find_window(self.PROCESS, self.TITLE)
        if not self.hwnd:
            raise RuntimeError("no running Stardew Valley window to attach to")
        self.smapi = gp.TextTail(self.paths.smapi_log, from_start=True)  # the whole of this run's log
        self._open_tails(mod_from_start=True)
        self.refocus()

    def _open_tails(self, mod_from_start: bool = False) -> None:
        """JSONL oracles, each positioned at "now": the host's and the mod's development logs, plus the two
        P2-0015 latency traces. Missing files are fine (an older build simply never writes them)."""
        self.devlog = gp.JsonlTail(self.paths.devlog)
        self.modlog = gp.JsonlTail(self.paths.mod_devlog)
        if mod_from_start:  # attach: the SMAPI log is read from the start, so the mod's outcomes must be too
            self.modlog._pos = 0
        self.lat_mod = gp.JsonlTail(self.paths.latency_mod)
        self.lat_host = gp.JsonlTail(self.paths.latency_host)

    def refocus(self) -> None:
        assert self.hwnd
        self.failsafe.bind(self.hwnd)
        if not win.focus(self.hwnd):
            raise RuntimeError("could not bring the game window to the foreground")
        win.ime_passthrough(self.hwnd)
        self.rect = win.client_rect(self.hwnd)

    def quit(self) -> None:
        self.kb.release_all()
        if self.proc and self.proc.poll() is None:
            try:
                parent = psutil.Process(self.proc.pid)
                for p in parent.children(recursive=True) + [parent]:
                    p.terminate()
                psutil.wait_procs([parent], timeout=10)
            except psutil.NoSuchProcess:
                pass
        for p in psutil.process_iter(["name"]):  # SMAPI hands off to the game process; make sure it is gone
            if (p.info["name"] or "").lower() in self.PROCESS:
                p.terminate()
        self._reap_dsh()
        if self._stdout:
            self._stdout.close()

    def _reap_dsh(self) -> None:
        """The mod starts `dsh --profile web` as a plain process that outlives the game. Stop only the pid the
        mod itself announced in this run's log, and only if it still looks like dsh."""
        if not self.smapi:
            return
        self.smapi.poll()
        for ln in self.smapi.grep(r"started the normal DSH profile .*\(pid (\d+)\)"):
            pid = int(re.search(r"\(pid (\d+)\)", ln).group(1))
            try:
                p = psutil.Process(pid)
                if "dsh" in " ".join(p.cmdline()).lower():
                    for child in p.children(recursive=True):
                        child.terminate()
                    p.terminate()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

    # -- console channel (fixtures only)
    def console(self, command: str) -> None:
        assert self.proc and self.proc.stdin
        self.proc.stdin.write((command + "\n").encode())
        self.proc.stdin.flush()

    # -- screen
    def frame(self):
        self.rect = win.client_rect(self.hwnd)
        return gp.grab(self.rect, self.hwnd)

    def shot(self, name: str):
        img = self.frame()
        if self.art:
            self.art.shot(name, img)
        return img

    def click_at(self, fx: float, fy: float) -> None:
        assert self.rect
        self.mouse.click(*self.rect.point(fx, fy))

    def wait_stable(self, timeout: float = 10.0, quiet: float = 0.01, settle_frames: int = 2):
        """Block until consecutive frames stop changing (animations done); returns the settled frame."""
        prev, still, deadline = self.frame(), 0, time.monotonic() + timeout
        while time.monotonic() < deadline:
            cur = self.frame()
            still = still + 1 if vision.diff_fraction(prev, cur) <= quiet else 0
            prev = cur
            if still >= settle_frames:
                return cur
        return prev

    def click_until_changed(self, fx: float, fy: float, region: vision.Region | None = None, attempts: int = 4,
                            wait: float = 3.0, min_change: float = 0.05):
        """Menus swallow clicks while animating. Click, watch the region, and retry until it really changes."""
        for _ in range(attempts):
            before = self.frame()
            self.click_at(fx, fy)
            deadline = time.monotonic() + wait
            while time.monotonic() < deadline:
                time.sleep(0.25)
                now = self.frame()
                if vision.diff_fraction(before, now, region) >= min_change:
                    return self.wait_stable()
        raise TimeoutError(f"click at ({fx:.3f},{fy:.3f}) never changed the screen after {attempts} attempts")

    # -- log waits
    def wait_log(self, pattern: str, timeout: float):
        return self.smapi.wait_for(pattern, timeout)

    def player2_ready(self, timeout: float = 90.0) -> bool:
        return self.wait_log(r"Player2.*(ready|heartbeat|snapshot)", timeout) is not None
