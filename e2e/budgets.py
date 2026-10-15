"""Responsiveness budgets for the "feel" checks. Numbers are measured-then-rounded-up, not aspirations:
raise one only with a recorded reason, because every raise is a deliberate loosening of the product's feel.
Both ends of each interval are stamped on the test's own clock (Enter pressed, SMAPI log line seen)."""

BOOT_TO_TITLE_S = 120          # SMAPI + mods + game on the reference laptop (Intel UHD 600): ~55 s
ENTER_TO_PUBLISH_MS = 750      # Enter pressed -> `Player2 sent: [chat ...]` seen; the mod sends at once
ENTER_TO_FIRST_LINE_MS = 45000 # Enter pressed -> first `Player2 companion said:` seen (LLM-bound; soft); the turn may
                               # work on after it speaks, so its end is not what the player waits for
