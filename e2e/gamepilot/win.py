"""Windows window discovery, focus and geometry. Process is made per-monitor DPI aware first,
so every coordinate this package handles is a physical pixel (the box here runs at 125% scaling)."""
from __future__ import annotations

import ctypes
import time
from ctypes import wintypes
from dataclasses import dataclass

import psutil

user32 = ctypes.WinDLL("user32", use_last_error=True)


def make_dpi_aware() -> None:
    try:
        ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))  # PER_MONITOR_AWARE_V2
    except Exception:
        try:
            ctypes.windll.shcore.SetProcessDpiAwareness(2)
        except Exception:
            ctypes.windll.user32.SetProcessDPIAware()


make_dpi_aware()


@dataclass(frozen=True)
class Rect:
    left: int
    top: int
    width: int
    height: int

    @property
    def right(self) -> int:
        return self.left + self.width

    @property
    def bottom(self) -> int:
        return self.top + self.height

    def point(self, fx: float, fy: float) -> tuple[int, int]:
        """Absolute screen pixel at a fractional position inside this rect."""
        return int(self.left + fx * self.width), int(self.top + fy * self.height)


def _windows_of_pids(pids: set[int]) -> list[int]:
    found: list[int] = []

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def visit(hwnd, _):
        if not user32.IsWindowVisible(hwnd):
            return True
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if pid.value in pids and user32.GetWindowTextLengthW(hwnd) > 0:
            found.append(hwnd)
        return True

    user32.EnumWindows(visit, 0)
    return found


def find_window(process_names: tuple[str, ...], title_contains: str | None = None) -> int | None:
    pids = {p.pid for p in psutil.process_iter(["name"]) if (p.info["name"] or "").lower() in process_names}
    if not pids:
        return None
    for hwnd in _windows_of_pids(pids):
        buf = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(hwnd, buf, 256)
        if title_contains is None or title_contains.lower() in buf.value.lower():
            return hwnd
    return None


def wait_for_window(process_names: tuple[str, ...], title_contains: str | None, timeout: float) -> int:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        hwnd = find_window(process_names, title_contains)
        if hwnd:
            return hwnd
        time.sleep(0.5)
    raise TimeoutError(f"no window for {process_names} within {timeout}s")


def client_rect(hwnd: int) -> Rect:
    rc = wintypes.RECT()
    user32.GetClientRect(hwnd, ctypes.byref(rc))
    pt = wintypes.POINT(0, 0)
    user32.ClientToScreen(hwnd, ctypes.byref(pt))
    return Rect(pt.x, pt.y, rc.right - rc.left, rc.bottom - rc.top)


def focus(hwnd: int, attempts: int = 5) -> bool:
    SW_RESTORE = 9
    if user32.IsIconic(hwnd):
        user32.ShowWindow(hwnd, SW_RESTORE)
    for _ in range(attempts):
        # A lone Alt tap lifts Windows' foreground lock so SetForegroundWindow is honoured.
        user32.keybd_event(0x12, 0, 0, 0)
        user32.keybd_event(0x12, 0, 2, 0)
        user32.SetForegroundWindow(hwnd)
        time.sleep(0.15)
        if user32.GetForegroundWindow() == hwnd:
            return True
    return False


def ime_passthrough(hwnd: int) -> bool:
    """Close the target window's IME so letter keys arrive as keys, not pinyin composition. This machine has
    only a Chinese-pinyin layout installed; we neither add a layout nor touch user settings - the request is
    scoped to this one window. Returns True if the IME reports closed afterwards."""
    imm = ctypes.WinDLL("imm32", use_last_error=True)
    ime = imm.ImmGetDefaultIMEWnd(hwnd)
    if not ime:
        return True  # no IME bound to this window
    WM_IME_CONTROL, IMC_GETOPENSTATUS, IMC_SETOPENSTATUS = 0x283, 0x5, 0x6
    user32.SendMessageW(ime, WM_IME_CONTROL, IMC_SETOPENSTATUS, 0)
    return user32.SendMessageW(ime, WM_IME_CONTROL, IMC_GETOPENSTATUS, 0) == 0


def is_foreground(hwnd: int) -> bool:
    return user32.GetForegroundWindow() == hwnd


def cursor_pos() -> tuple[int, int]:
    pt = wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(pt))
    return pt.x, pt.y
