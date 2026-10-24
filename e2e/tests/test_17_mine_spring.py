"""P2-0020 T4: the mine goal from a plain spring day 1. No unlock edit, no re-date: the landslide that
closes the mountain mine until spring day 5 is still in place, and nothing tells the companion. It has to
find that out itself (stuck detector + reflect), use the waiting days well, then get 10 copper ore before
the day cap. The oracle is world_state: 10 (O)378 Copper Ore across both inventories; every day's words,
route and a screenshot go to the run artifacts, so the result is confirmed in-game, never by logs alone.
The same test on a second fresh test save of the same persona shows what the persona library saved."""
import time

import pytest

from conftest import require_dsh
from gamepilot.metrics import GoalMetrics
from games.stardew.adapter import SAID, SENT

pytestmark = pytest.mark.mine

COPPER = "(O)378"
WANTED = 10
DAYS = 8
BEDTIME = 2200


def _copper(s):
    return sum(i["stack"] for who in ("body", "player") for i in s[who]["items"] if i["id"] == COPPER)


def test_ten_copper_from_spring_day_1(world, hello, art):
    require_dsh(hello)
    s = world.state()
    first_day = s["time"]["day"]
    assert first_day <= 2, f"the run must start near spring day 1 (got day {first_day}); no E2E_DAY re-date"
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
            world.shot(f"mine_spring_day{day - first_day + 1}")
            art.record("mine_spring", ask_reply=ex.reply, days=days)
            if _copper(s) >= WANTED or day - first_day + 1 >= DAYS:
                break
            with metrics.night():
                world.sleep_night(day)
            s = world.state()
    world.smapi.poll()
    errors = [ln for _, ln in world.smapi.lines if "Player2 DSH_" in ln]
    art.record("mine_spring", ask_reply=ex.reply, days=days, errors=errors[-20:], metrics=metrics.summary(),
               prompts=sum(SENT in ln for _, ln in world.smapi.lines))
    assert _copper(s) >= WANTED, f"{_copper(s)} copper ore after {len(days)} day(s): {days}"
