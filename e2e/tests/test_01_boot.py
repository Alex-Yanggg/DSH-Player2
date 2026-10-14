"""Boot: the game starts through SMAPI, the mod loads, the isolated save loads, DSH is attached.
These run in order and each leaves the game one step further along; later categories build on them."""
import time

import pytest

import budgets
from gamepilot import vision
from games.stardew import TEST_SAVE_NAME

pytestmark = pytest.mark.boot


def test_window_geometry_is_16x9(game):
    # UI click targets are stored as fractions of a 16:9 client area
    r = game.rect
    assert abs(r.width / r.height - 16 / 9) < 0.02, f"client area {r.width}x{r.height} is not 16:9"


def test_mod_loaded_without_errors(game):
    game.smapi.wait_for(r"Mods loaded and ready", 60)
    assert game.log_has(r"Loaded \d+ mods"), "SMAPI never reported its mod list"
    assert game.log_has(r"DSH Player2 Companion \d"), "the Player2 mod is not in SMAPI's loaded list"
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


def test_first_day_companion_choice_and_customizer(game, art):
    if not game.log_has(r"companion \w+ was chosen"):
        game.choose_companion(0)
    assert game.log_has(r"companion Mira was chosen and persists on this farmer")
    assert game.log_has(r"saved the vanilla farmer appearance for companion Mira")
    assert game.log_has(r"loaded companion Mira into the current location")


def test_dsh_bundle_attached_and_ready(game):
    assert game.wait_bundle_ready(90), "native DSH bundle never published a fresh readiness heartbeat"
    assert game.log_has(r"decision bridge attached to DSH")
    game.shot("world_ready")
    assert vision.mean_luma(game.frame()) < 200, "screen is blank/white; capture or game is stuck"
