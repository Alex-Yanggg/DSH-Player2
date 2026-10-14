"""gamepilot: drive a desktop game like a player (keyboard, mouse, screen) and judge it from side-channel
oracles. Game-agnostic; a game plugs in through a small adapter (see e2e/games/stardew)."""
from . import vision
from .capture import grab
from .failsafe import Aborted, Failsafe
from .inputs import Keyboard, Mouse
from .oracles import TextTail
from .report import RunArtifacts
from .timeline import Timeline, summarize
from .win import Rect, client_rect, focus, wait_for_window
