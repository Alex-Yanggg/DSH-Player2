"""Boot: the game starts through SMAPI, the mod loads, the isolated save loads, the mod starts DSH.
These run in order and each leaves the game one step further along; later categories build on them."""
import time

import pytest

import budgets
from gamepilot import vision
from games.stardew import TEST_SAVE_NAME
from games.stardew.adapter import DSH_STARTED

pytestmark = pytest.mark.boot


def test_window_geometry_is_16x9(game):
    # UI click targets are stored as fractions of a 16:9 client area
    r = game.rect
    assert abs(r.width / r.height - 16 / 9) < 0.02, f"client area {r.width}x{r.height} is not 16:9"


def test_mod_loaded_without_errors(game):
    game.smapi.wait_for(r"Mods loaded and ready", 60)
    assert game.log_has(r"Loaded \d+ mods"), "SMAPI never reported its mod list"
    assert game.log_has(r"DSH Player2 Companion \d"), "the Player2 mod is not in SMAPI's loaded list"
    assert game.log_has(r"Player2 companion: DSH acp profile for the mind, game endpoint on port \d+"), \
        "the mod never opened its game endpoint"
    game.smapi.poll()
    startup = []
    for _, ln in game.smapi.lines:
        if "titleScreenGameMode" in ln:   # startup ends where the title screen begins
            break
        startup.append(ln)
    errors = [ln for ln in startup if " ERROR " in ln]
    assert not errors, f"SMAPI errors during startup: {errors[:3]}"


def test_reaches_title_screen(game, art):
    t0 = time.perf_counter()
    game.wait_title(timeout=budgets.BOOT_TO_TITLE_S)  # always: the log line precedes the usable title by seconds
    art.record("boot", title_wait_s=round(time.perf_counter() - t0, 1))
    game.shot("title")


def test_loads_the_isolated_fixture_save(game):
    if not game.log_has(r"Context: loaded save"):
        game.load_test_save()
    assert game.log_has(rf"loaded save '{TEST_SAVE_NAME}'"), "a save other than the fixture was loaded"


def test_first_day_companion_choice_starts_dsh(game, art):
    if not game.smapi.wait_for(DSH_STARTED, 15):
        game.choose_companion(0)
    started = game.smapi.grep(DSH_STARTED)
    art.record("boot", dsh_started=started[-1:])
    assert started and "companion 大肥鱼." in started[-1], f"the mod never started DSH for 大肥鱼: {started}"


def test_day_start_reaches_dsh(game, art):
    hit = game.smapi.wait_for(r"Player2 sent: \[day-start day=\d+\]", 30)
    assert hit, "the day-start prompt was never sent"
    errors = game.smapi.grep(r"Player2 DSH_(START_FAILED|NOT_RUNNING|EXITED):")
    assert not errors, errors
    # The companion may work on inside the day's first turn; it is enough that it spoke.
    start = next(i for i, (_, ln) in enumerate(game.smapi.lines) if "Player2 sent: [day-start" in ln)
    assert game.smapi.wait_for(r"Player2 companion said: ", 90, since=start), "the companion said nothing at day start"
    art.record("boot", day_start_end=game.smapi.grep(r"Player2 turn ended:")[-1:])
    game.shot("world_ready")
    assert vision.mean_luma(game.frame()) < 200, "screen is blank/white; capture or game is stuck"
