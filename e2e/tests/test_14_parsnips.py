"""Row 3b: a goal from scratch. The player asks for 3 parsnips once and then only idles at home, going to bed at 22:00;
the companion has no parsnip seeds (Pierre sells them; they grow in 4 days) and must find its own way, following the host to bed through the [world] notice.
The oracle is world_state (3 parsnips in either inventory); the story per day (what it said, where it went, the gold,
and the world_map route out of the cabin it woke in) goes to the run's results."""
import time

import pytest

from conftest import require_dsh
from gamepilot.metrics import GoalMetrics
from games.stardew.adapter import SAID, SENT, GameEndpoint

pytestmark = pytest.mark.bline

PARSNIP = "(O)24"
WANTED = 3
DAYS = 8
BEDTIME = 2200


def _parsnips(s):
    return sum(i["stack"] for who in ("body", "player") for i in s[who]["items"] if i["id"] == PARSNIP)


def test_three_parsnips_from_scratch(world, hello, art):
    require_dsh(hello)
    s = world.state()
    first_day = s["time"]["day"]
    assert _parsnips(s) == 0, "the run must start without parsnips"
    ex = world.send_chat("给我弄 3 根防风草", until_said=True)
    world.close_chat()
    assert ex.reply, ex.error or ex.stop_reason
    days, s = [], world.state()
    with GoalMetrics(world, art.dir) as metrics:
        while True:
            day, woke = s["time"]["day"], s["body"]["location"]
            places = {l["name"]: l for l in GameEndpoint(world.paths).call("world_map")["locations"]}
            mark, money, route = len(world.smapi.lines), s["player"]["money"], [woke]
            while s["time"]["timeOfDay"] < BEDTIME and _parsnips(s) < WANTED:
                time.sleep(2)
                s = world.state()
                if s["body"]["location"] != route[-1]:
                    route.append(s["body"]["location"])
            world.smapi.poll()
            said = [ln.split(SAID, 1)[1] for _, ln in world.smapi.lines[mark:] if SAID in ln]
            days.append({"day": s["time"]["dayOfMonth"], "said": said, "route": route, "gold": (money, s["player"]["money"]),
                         "woke_in": woke, "cabin_exits": [w["to"] for w in places[woke]["warps"]] if woke in places else None,
                         "parsnips": _parsnips(s)})
            world.shot(f"parsnips_day{day - first_day + 1}")
            art.record("parsnips", ask_reply=ex.reply, days=days)
            assert woke in places, f"the companion woke in {woke}, which world_map does not know"
            if _parsnips(s) >= WANTED or day - first_day + 1 >= DAYS:
                break
            with metrics.night():
                world.sleep_night(day)
            s = world.state()
    world.smapi.poll()
    errors = [ln for _, ln in world.smapi.lines if "Player2 DSH_" in ln]
    art.record("parsnips", ask_reply=ex.reply, days=days, errors=errors[-20:], metrics=metrics.summary(),
               prompts=sum(SENT in ln for _, ln in world.smapi.lines))
    assert _parsnips(s) >= WANTED, f"{_parsnips(s)} parsnips after {len(days)} days"
