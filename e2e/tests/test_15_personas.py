"""P2-0017: the chosen persona answers its pack's probes in character. Run once per persona
(E2E_PERSONA=0 大肥鱼, 1 军师, roster order) with `-m persona`; each run files its answers under
artifacts/blind/, and `python blind_sheet.py` shuffles them into a sheet without names (H2: a reader
names the persona behind each answer, >=80% right)."""
import json
import re
from pathlib import Path

import pytest

from conftest import ROOT, require_dsh
from games.stardew.adapter import DSH_STARTED

pytestmark = pytest.mark.persona

PERSONAS = ROOT.parent / "personas"


def test_persona_answers_probes(world, hello, art):
    require_dsh(hello)
    name = re.search(DSH_STARTED, world.smapi.grep(DSH_STARTED)[-1]).group(1)
    pack = next(p for p in (json.loads(f.read_text(encoding="utf-8")) for f in PERSONAS.glob("*/persona.json")) if p["name"] == name)
    answers = []
    for probe in pack["probes"]:
        ex = world.send_chat(probe, until_said=True)
        answers.append({"probe": probe, "reply": ex.reply, "error": ex.error})
    world.close_chat()
    world.shot(f"persona_{pack['id']}")
    art.record("persona", persona=pack["id"], answers=answers)
    blind = ROOT / "artifacts" / "blind"
    blind.mkdir(parents=True, exist_ok=True)
    (blind / f"{pack['id']}.json").write_text(json.dumps(answers, ensure_ascii=False, indent=2), encoding="utf-8")
    assert all(a["reply"] for a in answers), answers
    leaks = [a["reply"] for a in answers if re.search(r"\(\s*\d+\s*,\s*\d+\s*\)|world_|body_|goal", a["reply"])]
    assert not leaks, f"internal words or coordinates in speech: {leaks}"
