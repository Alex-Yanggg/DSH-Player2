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


def focus(hwnd: int, attempts: int = 8) -> bool:
    """Brings the window to the foreground. A fresh game window may not accept focus for a few
    seconds, so several Windows mechanisms are tried in a loop before giving up."""
    import ctypes
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    SW_RESTORE, SW_MINIMIZE = 9, 6
    this_thread = kernel32.GetCurrentThreadId()
    deadline = time.monotonic() + attempts * 1.5
    tried_restore = False
    while time.monotonic() < deadline:
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, SW_RESTORE)
            time.sleep(0.2)
        # 1. A lone Alt tap lifts Windows' foreground lock so SetForegroundWindow is honoured.
        user32.keybd_event(0x12, 0, 0, 0)
        user32.keybd_event(0x12, 0, 2, 0)
        user32.SetForegroundWindow(hwnd)
        if user32.GetForegroundWindow() == hwnd:
            return True
        # 2. Share the foreground thread's input queue for the duration of the call.
        fg_thread = user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), None)
        attached = user32.AttachThreadInput(this_thread, fg_thread, True)
        try:
            user32.SetForegroundWindow(hwnd)
            user32.BringWindowToTop(hwnd)
        finally:
            if attached:
                user32.AttachThreadInput(this_thread, fg_thread, False)
        if user32.GetForegroundWindow() == hwnd:
            return True
        # 3. The undocumented switch, and a minimize/restore cycle, which Windows also honours.
        user32.SwitchToThisWindow(hwnd, True)
        if user32.GetForegroundWindow() == hwnd:
            return True
        if not tried_restore:
            user32.ShowWindow(hwnd, SW_MINIMIZE)
            time.sleep(0.4)
            user32.ShowWindow(hwnd, SW_RESTORE)
            tried_restore = True
            if user32.GetForegroundWindow() == hwnd:
                return True
        # 4. A player's own way in: a synthetic click on the window's title bar
        #    (never the client area, so the game sees no input) activates it like
        #    a real click does, even when every programmatic call is refused.
        import ctypes.wintypes as wt
        wrect = wt.RECT()
        if user32.GetWindowRect(hwnd, ctypes.byref(wrect)):
            user32.SetCursorPos(wrect.left + (wrect.right - wrect.left) // 2, wrect.top + 8)
            time.sleep(0.05)
            user32.mouse_event(0x0002, 0, 0, 0, 0)
            user32.mouse_event(0x0004, 0, 0, 0, 0)
            time.sleep(0.2)
            if user32.GetForegroundWindow() == hwnd:
                return True
        time.sleep(0.5)
    return user32.GetForegroundWindow() == hwnd


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


def pin_on_top(hwnd: int) -> None:
    """Keeps the window above every normal window, so one that pops up mid-run (a chat app, a remote-control
    helper) can neither cover the frames nor catch the clicks, which land on whatever is under the cursor."""
    user32.SetWindowPos(ctypes.c_void_p(hwnd), ctypes.c_void_p(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)  # HWND_TOPMOST; NOSIZE|NOMOVE|NOACTIVATE


def is_foreground(hwnd: int) -> bool:
    return user32.GetForegroundWindow() == hwnd


def cursor_pos() -> tuple[int, int]:
    pt = wintypes.POINT()
    user32.GetCursorPos(ctypes.byref(pt))
    return pt.x, pt.y
