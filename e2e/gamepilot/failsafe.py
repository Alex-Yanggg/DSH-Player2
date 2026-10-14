"""Safety layer for unattended runs. The harness owns the keyboard and mouse on the operator's own desktop, so:
  * it never injects unless the target window is in the foreground (otherwise keystrokes would land in
    whatever the operator is using - a chat box, a terminal);
  * Ctrl+Alt+Q aborts at once;
  * moving the mouse away from where we last put it aborts too."""
from __future__ import annotations

import ctypes

from . import win


class Aborted(RuntimeError):
    """Raised when the run must stop touching the input devices."""


class Failsafe:
    def __init__(self, drift_px: int | None = None, enabled: bool = True, require_foreground: bool = True):
        """`drift_px` (abort if the cursor strays that far from where we left it) is opt-in: games such as
        Stardew re-centre the pointer on screen transitions, which a drift check would mistake for the operator."""
        self.enabled = enabled
        self.drift_px = drift_px
        self.require_foreground = require_foreground
        self._last: tuple[int, int] | None = None
        self._target: int | None = None

    def bind(self, hwnd: int | None) -> None:
        """Set the one window input may be sent to."""
        self._target = hwnd

    def note_injected_cursor(self, x: int, y: int) -> None:
        self._last = (x, y)

    def check(self) -> None:
        if not self.enabled:
            return
        down = lambda vk: ctypes.windll.user32.GetAsyncKeyState(vk) & 0x8000
        if down(0x11) and down(0x12) and down(0x51):  # Ctrl+Alt+Q
            raise Aborted("operator pressed Ctrl+Alt+Q")
        if self.drift_px is not None and self._last is not None:
            x, y = win.cursor_pos()
            if abs(x - self._last[0]) > self.drift_px or abs(y - self._last[1]) > self.drift_px:
                raise Aborted(f"mouse moved by the operator ({self._last} -> {(x, y)})")
        if self.require_foreground and self._target is not None and not win.is_foreground(self._target):
            if not win.focus(self._target, attempts=3):
                raise Aborted("target window lost the foreground and could not be restored; refusing to inject input")
