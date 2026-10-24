"""P2-0019 T3: the mine goal. From a fresh test character (a copy of a save that already holds a chosen
companion farmhand, natively re-dated past the spring-5 landslide with E2E_DAY=6 so the mine is open),
the player asks for 10 copper ore once and then idles at home. The companion must find the mountain
mine, get down, mine copper with its own pickaxe, survive what it meets (reflexes), come home to sleep,
and hold the ore. The oracle is world_state: 10 (O)378 Copper Ore across both inventories."""
import time

import pytest

from conftest import require_dsh
from gamepilot.metrics import GoalMetrics
from games.stardew.adapter import SAID, SENT

pytestmark = pytest.mark.mine

COPPER = "(O)378"
WANTED = 10
DAYS = 5
BEDTIME = 2200


def _copper(s):
    return sum(i["stack"] for who in ("body", "player") for i in s[who]["items"] if i["id"] == COPPER)


def test_ten_copper_from_the_mine(world, hello, art):
    require_dsh(hello)
    s = world.state()
    first_day = s["time"]["day"]
    if first_day < 5:
        pytest.skip(f"the mine is still blocked on day {first_day}; run with E2E_DAY>=5 and a template whose farmhand is a chosen companion")
    assert _copper(s) == 0, "the run must start without copper ore"
    ex = world.send_chat("给我挖 10 块铜矿", until_said=True)
    world.close_chat()
    assert ex.reply, ex.error or ex.stop_reason
    days, s = [], world.state()
    with GoalMetrics(world, art.dir) as metrics:
        while True:
            day, health = s["time"]["day"], s["body"].get("health")
            mark, route = len(world.smapi.lines), [s["body"]["location"]]
            while s["time"]["timeOfDay"] < BEDTIME and _copper(s) < WANTED:
                time.sleep(2)
                s = world.state()
                if s["body"]["location"] != route[-1]:
                    route.append(s["body"]["location"])
            world.smapi.poll()
            said = [ln.split(SAID, 1)[1] for _, ln in world.smapi.lines[mark:] if SAID in ln]
            days.append({"day": s["time"]["dayOfMonth"], "said": said, "route": route, "copper": _copper(s),
                         "woke_health": health, "died": any("fainted" in ln.lower() or "passed out" in ln.lower() for _, ln in world.smapi.lines[mark:])})
            world.shot(f"copper_day{day - first_day + 1}")
            art.record("mine", ask_reply=ex.reply, days=days)
            if _copper(s) >= WANTED or day - first_day + 1 >= DAYS:
                break
            with metrics.night():
                world.sleep_night(day)
            s = world.state()
    world.smapi.poll()
    errors = [ln for _, ln in world.smapi.lines if "Player2 DSH_" in ln]
    art.record("mine", ask_reply=ex.reply, days=days, errors=errors[-20:], metrics=metrics.summary(),
               prompts=sum(SENT in ln for _, ln in world.smapi.lines))
    assert _copper(s) >= WANTED, f"{_copper(s)} copper ore after {len(days)} day(s): {days}"
