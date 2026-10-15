"""Makes a throwaway test save from any save folder, optionally on another date.

    python e2e/make_save.py <source folder> [--id 99xxxxxxx] [--day N] [--season fall] [--year N]

The copy is `E2E_<id>` under Saves; the source is only read. Copy a save the companion already slept in to start
with its farmhand created; move the date to reach later content (the mines open on spring 5).
"""
import argparse
import time

from games.stardew.adapter import SEASONS, Paths, copy_save

parser = argparse.ArgumentParser()
parser.add_argument("source")
parser.add_argument("--id", type=int, default=990_000_000 + int(time.time()) % 10_000_000)
parser.add_argument("--day", type=int)
parser.add_argument("--season", choices=SEASONS)
parser.add_argument("--year", type=int)
args = parser.parse_args()
print(copy_save(Paths(), args.source, args.id, args.day, args.season, args.year))
