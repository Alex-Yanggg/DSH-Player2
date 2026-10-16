"""H2 blind sheet (P2-0017): shuffles the answers test_15_personas filed under artifacts/blind/ into a sheet without
persona names, plus a separate answer key. Usage: python blind_sheet.py [seed]"""
import json
import random
import sys
from pathlib import Path

blind = Path(__file__).parent / "artifacts" / "blind"
rows = [(f.stem, a["probe"], a["reply"]) for f in sorted(blind.glob("*.json")) for a in json.loads(f.read_text(encoding="utf-8"))]
random.Random(int(sys.argv[1]) if len(sys.argv) > 1 else 17).shuffle(rows)
names = sorted({persona for persona, _, _ in rows})
sheet = [f"# 盲测：每条回答是谁说的？（{' / '.join(names)}）", ""]
sheet += [f"{i}. 玩家：{probe}\n   回答：{reply}\n   猜：____" for i, (_, probe, reply) in enumerate(rows, 1)]
(blind / "sheet.md").write_text("\n".join(sheet) + "\n", encoding="utf-8")
(blind / "key.md").write_text("\n".join(f"{i}. {persona}" for i, (persona, _, _) in enumerate(rows, 1)) + "\n", encoding="utf-8")
print(f"{len(rows)} answers -> {blind / 'sheet.md'} (key: key.md)")
