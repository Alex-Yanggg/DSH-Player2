"""Responsiveness budgets for the "feel" checks. Numbers are measured-then-rounded-up, not aspirations:
raise one only with a recorded reason, because every raise is a deliberate loosening of the product's feel."""

BOOT_TO_TITLE_S = 120          # SMAPI + mods + game on the reference laptop (Intel UHD 600): ~55 s
ENTER_TO_PUBLISH_MS = 750      # Enter pressed -> turn handed to DSH; measured 60-115 ms, so this has ~7x headroom
ENTER_TO_RESULT_MS = 45000     # Enter pressed -> validated reply or honest error (LLM-bound; soft)
COMMAND_TO_MOTION_MS = 100     # A1 (P2-0015): Enter on an explicit command -> companion starts moving, on the mod's
                               # own clock; movement no longer waits for DSH. Contract target, frozen after the W0 baseline
NEGATIVE_COMMAND_WATCH_S = 3   # "不要来我面前" etc.: watch this long and require no movement at all
DAY_FIRST_LINE_P50_MS = 3000   # A2 (P2-0015) target for day start -> first line rendered; reported, not yet a hard gate
DAY_FIRST_LINE_MAX_MS = 45000  # hard ceiling for one sample: the line (or its traced error) must arrive at all
MOVEMENT_ARRIVAL_S = 25        # /come issued -> arrived (same location)
FOLLOW_MAX_TILES = 4.0         # while following, distance to the player stays within this
