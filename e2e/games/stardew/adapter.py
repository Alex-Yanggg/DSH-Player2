"""Stardew Valley adapter for gamepilot.

Three channels, kept apart on purpose:
  * FIXTURE  - state we arrange before/around a run (copied test save, SMAPI console `debug ...` commands).
               Never used to produce the behaviour under test.
  * STIMULUS - what a player does: keyboard + mouse injected into the game window.
  * ORACLE   - what we judge from: the mod's `Player2 ...` lines in the SMAPI log, the read-only world_state tool of the mod's
               game endpoint, and screenshots. DSH keeps its own session logs;
               their format is DSH's business, so nothing here reads them.
No SMAPI mod API and no in-process injection is involved on the test side.
"""
from __future__ import annotations

import calendar
import json
import os
import re
import shutil
import subprocess
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import psutil

import gamepilot as gp
from gamepilot import vision, win

APPDATA = Path(os.environ.get("APPDATA", ""))
USERPROFILE = Path(os.environ.get("USERPROFILE", ""))

LAST_TEST_SAVE = Path(__file__).resolve().parents[2] / "artifacts" / "last-test-save.txt"
PERSONAS = Path(__file__).resolve().parents[3] / "personas"


def _test_save_id() -> int:
    """Every run gets a fresh test character: a new unique id means a new farmer, new bridge sessions and new
    durable DSH sessions, so no run inherits an earlier run's conversation. The 99xxxxxxx range marks
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

    def session_dirs(self, save_id: int = TEST_SAVE_ID) -> list[Path]:
        """The save's DSH session directory (the dsh cwd; holds `dsh-session-id`), one per companion person."""
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
    history and sessions never mix with the player's real saves or with an earlier run. The template is
    any untouched day-1 save folder name under Saves, named by E2E_SOURCE_SAVE; it is only ever read."""
    source = source or os.environ.get("E2E_SOURCE_SAVE", "")
    if not source or not (paths.saves / source / source).is_file():
        raise RuntimeError(f"set E2E_SOURCE_SAVE to a day-1 save folder in {paths.saves} (got {source!r}); see e2e/README.md")
    _forget_previous_test_save(paths)
    LAST_TEST_SAVE.parent.mkdir(parents=True, exist_ok=True)
    LAST_TEST_SAVE.write_text(str(TEST_SAVE_ID), encoding="utf-8")
    dst = copy_save(paths, source, TEST_SAVE_ID)
    # Reset our bridge sessions only - the path is keyed by the test ID, never by a real save's.
    for d in paths.session_dirs():
        shutil.rmtree(d, ignore_errors=True)
    return dst


SEASONS = ("spring", "summer", "fall", "winter")


def copy_save(paths: Paths, source: str, save_id: int, day: int | None = None, season: str | None = None,
              year: int | None = None) -> Path:
    """Copies a save to `E2E_<save_id>` under a new unique id, the source only read. The date fields are edited in
    the save XML itself, so a copy can start on any day with whatever the source already holds (a created
    companion farmhand, a cabin) and no day-1 creation runs."""
    src, dst = paths.saves / source, paths.saves / f"E2E_{save_id}"
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(src, dst)
    (dst / source).rename(dst / dst.name)
    for stale in dst.glob("*_old"):
        stale.unlink()
    main, info = dst / dst.name, dst / "SaveGameInfo"
    xml, head = main.read_text(encoding="utf-8"), info.read_text(encoding="utf-8")
    xml = re.sub(r"<uniqueIDForThisGame>\d+</uniqueIDForThisGame>", f"<uniqueIDForThisGame>{save_id}</uniqueIDForThisGame>", xml)
    # The load screen orders saves by the farmer's <saveTime> (minutes since 2012-06-22) and every day-1 save
    # looks identical on screen. A copy ties with its source, so stamp it "now + 1" to be deterministically slot 1.
    stamp = int((time.time() - calendar.timegm((2012, 6, 22, 0, 0, 0))) // 60) + 1  # the game counts in UTC
    xml, head = (re.sub(r"<saveTime>\d+</saveTime>", f"<saveTime>{stamp}</saveTime>", s) for s in (xml, head))
    if day or season or year:
        d = day or int(re.search(r"<dayOfMonth>(\d+)<", xml).group(1))
        s = SEASONS.index(season or re.search(r"<currentSeason>(\w+)<", xml).group(1))
        y = year or int(re.search(r"<year>(\d+)<", xml).group(1))
        xml = re.sub(r"<dayOfMonth>\d+<", f"<dayOfMonth>{d}<", xml, count=1)
        xml = re.sub(r"<currentSeason>\w+<", f"<currentSeason>{SEASONS[s]}<", xml, count=1)
        xml = re.sub(r"<year>\d+<", f"<year>{y}<", xml, count=1)
        # The day count drives date checks such as the landslide that blocks the mines until spring 5.
        played = f"<string>daysPlayed</string></key><value><unsignedInt>{(y - 1) * 112 + s * 28 + d}<"
        xml = re.sub(r"<string>daysPlayed</string></key><value><unsignedInt>\d+<", played, xml)
        for tag, value in (("dayOfMonthForSaveGame", d), ("seasonForSaveGame", s), ("yearForSaveGame", y)):
            head = re.sub(rf"<{tag}>\d+<", f"<{tag}>{value}<", head)
    main.write_text(xml, encoding="utf-8")
    info.write_text(head, encoding="utf-8")
    return dst




# --------------------------------------------------------------------------------------------- UI flows
# Coordinates are for a 1920x1080 client area, stored as fractions. Pixels only say WHERE to click; WHICH
# screen we are on is decided from the SMAPI log wherever the mod writes one, because colours collide.
REF_W, REF_H = 1920.0, 1080.0
TITLE_EXIT_BUTTON = (0.640, 0.825, 0.745, 0.970)  # the title's Exit button, as a fraction region
TITLE_WOOD = (220, 150, 90)                        # its plank colour; ~27 % of that region at tol 50
UI = {
    "title_load": (835, 960),
    "load_slot_1": (950, 300),       # body of slot 1, clear of the delete icon at the right edge
    "companion_answer_last": (405, 977),  # the box grows upward from the bottom; answers are 68 px apart
    "companion_answer_step": 68,
    "customizer_ok": (1228, 840),
}
DIALOG_BOX = (255, 200, 120)
DIALOG_REGION: vision.Region = (0.17, 0.65, 0.83, 0.97)

CHAT_REGION: vision.Region = (0.0, 0.55, 0.55, 1.0)  # the whole panel: the game's own chat line can cover its foot
# Exact colours of the Player2 chat overlay's three-pixel border: a bright line between two dimmed ones.
CHAT_BORDERS = ((189, 148, 82), (157, 123, 68))
CHAT_VISIBLE_MIN = 0.003      # closed: 0, open: ~0.007-0.014

# The mod's oracle lines (ModEntry / DshCompanion).
DSH_STARTED = r"Player2 started DSH \(acp profile\) for companion (\w+)\."
SENT = "Player2 sent: "
SAID = "Player2 companion said: "
TURN_ENDED = "Player2 turn ended: "
NO_TURN = re.compile(r"Player2 (DSH_START_FAILED|DSH_NOT_RUNNING): ")  # a send that never reached a turn
ERROR = re.compile(r"Player2 (DSH_\w+): (.*)")


@dataclass
class Exchange:
    """One chat message and everything the SMAPI log says about its turn."""
    text: str
    timeline: gp.Timeline = field(default_factory=gp.Timeline)
    outcome: str = "timeout"           # completed | failed | timeout | speaking (until_said: spoke, turn still working)
    stop_reason: str | None = None     # the `turn ended:` text
    error: str | None = None           # `DSH_<CODE>: detail` reported during the turn
    said: list[str] = field(default_factory=list)       # `companion said:` lines between send and turn end

    @property
    def reply(self) -> str | None:
        return "\n".join(self.said) or None

    def latencies(self) -> dict:
        t, out = self.timeline, {}
        for a, b, name in (("enter", "published", "enter_to_publish"), ("published", "result", "dsh_roundtrip"),
                           ("enter", "result", "enter_to_result"), ("enter", "said", "enter_to_first_line")):
            if a in t.marks and b in t.marks:
                out[name + "_ms"] = round(t.ms(a, b))
        return out


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
        # during either only skips ahead. Ready means the title's own buttons are drawn; the Exit button is used
        # because the cursor never hovers it.
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
        """First day of a fresh save: answer the roster question, then accept the native customizer as-is. The
        mod logs neither step; the day (and DSH) starts once the customizer closes, which is the confirmation."""
        mark = len(self.smapi.lines)
        deadline = time.monotonic() + timeout
        ax, ay = UI["companion_answer_last"]
        roster = len(list(PERSONAS.glob("*/persona.json")))
        target = _frac((ax, ay - UI["companion_answer_step"] * (roster - 1 - index)))
        while not self.dialog_visible():  # the question needs a free player; click only once it is on screen
            if time.monotonic() > deadline:
                raise TimeoutError("companion question never appeared")
            time.sleep(0.5)
        while self.dialog_visible():
            self.click_at(*target)
            time.sleep(1.5)
            if time.monotonic() > deadline:
                raise TimeoutError("companion choice was never accepted")
        time.sleep(3)  # the customizer opens on a later tick
        while not self.smapi.wait_for(DSH_STARTED, 2.5, since=mark):
            self.click_at(*_frac(UI["customizer_ok"]))
            if time.monotonic() > deadline + 30:
                raise TimeoutError("customizer OK never started the companion's day")

    def dialog_visible(self, img=None) -> bool:
        img = img or self.frame()
        return vision.color_fraction(img, DIALOG_BOX, tol=40, region=DIALOG_REGION) > 0.55

    # -- idempotent: each step inspects the log first, so a run can resume against an already-running game
    def log_has(self, pattern: str) -> bool:
        return bool(self.smapi.grep(pattern))

    def ensure_world(self) -> None:
        if not self.log_has(r"Context: loaded save"):
            self.wait_title()
            self.load_test_save()
        if not self.smapi.wait_for(DSH_STARTED, 15):  # an existing companion starts DSH at day start
            self.choose_companion(int(os.environ.get("E2E_PERSONA", "0")))  # roster order: persona folders by name
        time.sleep(2)

    def sleep_night(self, day: int) -> None:
        """The host, at home, gets into bed; the night ends once the companion sleeps too (or passes out at 2:00), and
        the next day starts. Raises at the first stage that never happens."""
        in_bed = rf"{re.escape(SENT)}\[world day={day}\] .* went to bed"
        self.smapi.poll()
        mark = len(self.smapi.lines)
        for _ in range(3):  # step out of bed and back in; the game asks only after the farmer has moved
            self.refocus()
            self.kb.hold("a", 0.4)
            self.kb.hold("d", 0.5)
            if self._wait_dialog(3):
                self.kb.tap("y")  # the sleep question's Yes
                if self.smapi.wait_for(in_bed, 5, since=mark):
                    break
        self.shot(f"host_in_bed_day{day}")
        if not self.smapi.wait_for(in_bed, 0, since=mark):
            raise TimeoutError("the host never got into bed")
        if not self.smapi.wait_for(r"screen_0 SMAPI\] Context: before save", 720, since=mark):
            raise TimeoutError("the night never ended: the companion did not go to bed")
        lines = [ln for _, ln in self.smapi.lines]
        start = max(i for i, ln in enumerate(lines) if "Context: before save" in ln)
        if not self.smapi.wait_for(rf"Player2 sent: \[day-start day={day + 1}\]", 120, since=start):
            raise TimeoutError("the next day never started")

    def _wait_dialog(self, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while not self.dialog_visible():
            if time.monotonic() > deadline:
                return False
            time.sleep(0.3)
        return True

    # -- chat
    def chat_visible(self, img=None) -> bool:
        img = img or self.frame()
        return sum(vision.color_fraction(img, c, tol=4, region=CHAT_REGION) for c in CHAT_BORDERS) >= CHAT_VISIBLE_MIN

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

    def pending_turns(self) -> int:
        """Prompts sent (day-start, chat, day-end, resume) whose turn has not ended. DSH answers them in order."""
        self.smapi.poll()
        lines = [ln for _, ln in self.smapi.lines]
        return (sum(SENT in ln for ln in lines) - sum(TURN_ENDED in ln for ln in lines)
                - sum(bool(NO_TURN.search(ln)) for ln in lines))

    def wait_idle(self, timeout: float = 90.0) -> bool:
        """Wait for every earlier turn (often the day-start line) to end, so the next `turn ended:` is ours."""
        deadline = time.monotonic() + timeout
        while self.pending_turns() > 0:
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.2)
        return True

    def send_chat(self, text: str, timeout: float = 90.0, until_said: bool = False) -> Exchange:
        """Type `text` into the open chat, press Enter, and follow its turn in the SMAPI log: the turn starts at
        the `sent: [chat day=N] <text>` line and ends at the next `turn ended:` line; `companion said:` lines in
        between are the reply. The companion may work inside the turn after it spoke; until_said returns at the first
        spoken line instead. Like a player, it does not wait for earlier turns: one that has spoken is stopped by
        the message, one that has not answers first, and their lines are not ours. The chat stays open; with the
        companion seated the world keeps running."""
        ahead = self.pending_turns()
        self.open_chat()
        self.smapi.poll()
        mark = len(self.smapi.lines)
        ex = Exchange(text)
        self.kb.type_text(text)
        ex.timeline.mark("enter")
        self.kb.tap("enter", hold=0.2)  # with the seat running, a host frame can outlast a short tap
        sent = re.compile(rf"{SENT}\[chat day=\d+\] {re.escape(text)}$")
        deadline = time.monotonic() + timeout
        start = None
        while time.monotonic() < deadline and "result" not in ex.timeline.marks and not (until_said and ex.said):
            self.smapi.poll()
            lines = self.smapi.lines
            if start is None:
                start = next((i for i in range(mark, len(lines)) if sent.search(lines[i][1])), None)
                if start is not None:
                    ex.timeline.mark("published", lines[start][0])
            if start is not None:
                ex.said, ex.error, skip = [], None, ahead
                for seen, ln in lines[start + 1:]:
                    if skip:  # lines of the turns this message interrupted, up to their ends
                        skip -= TURN_ENDED in ln
                    elif SAID in ln:
                        ex.said.append(ln.split(SAID, 1)[1])
                        if "said" not in ex.timeline.marks:
                            ex.timeline.mark("said", seen)
                    elif m := ERROR.search(ln):
                        ex.error = f"{m.group(1)}: {m.group(2)}"
                        if NO_TURN.search(ln):  # the prompt never reached DSH: no `turn ended` will follow
                            ex.timeline.mark("result", seen)
                            ex.outcome = "failed"
                            break
                    elif TURN_ENDED in ln:
                        ex.timeline.mark("result", seen)
                        ex.stop_reason = ln.split(TURN_ENDED, 1)[1]
                        ex.outcome = "failed" if ex.error or ex.stop_reason.startswith("error") else "completed"
                        break
            time.sleep(0.02)
        if until_said and ex.said and ex.outcome == "timeout":
            ex.outcome = "speaking"
        return ex


class GameEndpoint:
    """The mod's game endpoint (GameMcpServer), read with the URL and bearer token the mod hands DSH in the patch
    file it writes when it starts DSH. Only the read-only tools are called; the body is never driven from here."""

    def __init__(self, paths: Paths):
        plugin = json.loads((paths.bridge / "player2.patch.yml").read_text(encoding="utf-8"))[0]["insert"][0]["config"]
        self.url, self.token = plugin["gameUrl"], plugin["gameToken"]

    def call(self, tool: str) -> dict:
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": {}}})
        req = urllib.request.Request(self.url, body.encode(), {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            result = json.load(r)["result"]
        text = result["content"][0]["text"]
        if result["isError"]:
            raise RuntimeError(f"{tool}: {text}")
        return json.loads(text)


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
        self.rect: gp.Rect | None = None

    # -- lifecycle
    def launch(self, timeout: float = 120.0) -> None:
        """Start through StardewModdingAPI.exe with stdin piped (console channel) and wait for a window."""
        if find_existing := win.find_window(self.PROCESS):
            raise RuntimeError(f"Stardew Valley is already running (hwnd {find_existing}); close it first")
        # SMAPI rewrites its log per launch; a stale file would hide the new run behind an old offset.
        self.paths.smapi_log.unlink(missing_ok=True)
        self.smapi = gp.TextTail(self.paths.smapi_log)
        logdir = (self.art.dir if self.art else Path.cwd())
        self._stdout = open(logdir / "smapi-console.txt", "ab")  # a relaunch in the same run appends
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
        self.refocus()

    def refocus(self) -> None:
        assert self.hwnd
        self.failsafe.bind(self.hwnd)
        if not win.focus(self.hwnd):
            raise RuntimeError("could not bring the game window to the foreground")
        win.ime_passthrough(self.hwnd)
        self.rect = win.client_rect(self.hwnd)

    def quit(self) -> None:
        """Stop SMAPI and the game. The mod's `dsh --profile acp` is the game's child on stdio and exits when its
        stdin closes, so the process tree below SMAPI covers it."""
        self.kb.release_all()
        if self.proc and self.proc.poll() is None:
            try:
                parent = psutil.Process(self.proc.pid)
                for p in parent.children(recursive=True) + [parent]:
                    p.terminate()
                psutil.wait_procs([parent], timeout=10)
            except psutil.NoSuchProcess:
                pass
        # SMAPI hands off to the game process; make sure it is gone, so the next launch finds no window.
        rest = [p for p in psutil.process_iter(["name"]) if (p.info["name"] or "").lower() in self.PROCESS]
        for p in rest:
            p.terminate()
        psutil.wait_procs(rest, timeout=10)
        if self._stdout:
            self._stdout.close()

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

    def state(self) -> dict:
        """The mod's world_state: the host (`player`), the companion's farmer (`body`), the clock, the body's menu."""
        return GameEndpoint(self.paths).call("world_state")

    def click_at(self, fx: float, fy: float) -> None:
        assert self.rect
        self.mouse.click(*self.rect.point(fx, fy))
