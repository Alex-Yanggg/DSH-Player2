"""Keyboard and mouse injection through SendInput. Keys go out as hardware scancodes (what SDL/MonoGame
games read); text goes out as Unicode events so Chinese chat works without an IME."""
from __future__ import annotations

import ctypes
import time
from ctypes import wintypes
from contextlib import contextmanager

from . import win
from .failsafe import Failsafe

user32 = win.user32
ULONG_PTR = ctypes.c_size_t

INPUT_MOUSE, INPUT_KEYBOARD = 0, 1
KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP, KEYEVENTF_UNICODE, KEYEVENTF_SCANCODE = 1, 2, 4, 8
MOUSEEVENTF = {"left": (0x0002, 0x0004), "right": (0x0008, 0x0010), "middle": (0x0020, 0x0040)}


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class _U(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("u", _U)]


_VK = {"esc": 0x1B, "enter": 0x0D, "space": 0x20, "tab": 0x09, "backspace": 0x08, "shift": 0x10, "ctrl": 0x11,
       "alt": 0x12, "left": 0x25, "up": 0x26, "right": 0x27, "down": 0x28, "pageup": 0x21, "pagedown": 0x22,
       "home": 0x24, "end": 0x23, "delete": 0x2E, "insert": 0x2D}
_VK.update({f"f{i}": 0x6F + i for i in range(1, 13)})
_EXTENDED = {"left", "up", "right", "down", "pageup", "pagedown", "home", "end", "delete", "insert"}


def _vk(key: str) -> int:
    key = key.lower()
    if key in _VK:
        return _VK[key]
    if len(key) == 1:
        return user32.VkKeyScanW(ord(key)) & 0xFF
    raise KeyError(f"unknown key {key!r}")


def _send(*inputs: INPUT) -> None:
    arr = (INPUT * len(inputs))(*inputs)
    if user32.SendInput(len(inputs), arr, ctypes.sizeof(INPUT)) != len(inputs):
        raise OSError(f"SendInput failed: {ctypes.get_last_error()}")


def _key_event(key: str, up: bool) -> INPUT:
    vk = _vk(key)
    flags = KEYEVENTF_SCANCODE | (KEYEVENTF_KEYUP if up else 0) | (KEYEVENTF_EXTENDEDKEY if key.lower() in _EXTENDED else 0)
    scan = user32.MapVirtualKeyW(vk, 0)
    return INPUT(INPUT_KEYBOARD, _U(ki=KEYBDINPUT(0, scan, flags, 0, 0)))


class Keyboard:
    def __init__(self, failsafe: Failsafe | None = None):
        self._failsafe = failsafe
        self.log: list[tuple[float, str]] = []  # (monotonic, "down:w"/"up:w"/"text:...") for the report

    def _guard(self):
        if self._failsafe:
            self._failsafe.check()

    def down(self, key: str) -> None:
        self._guard()
        _send(_key_event(key, False))
        self.log.append((time.perf_counter(), f"down:{key}"))

    def up(self, key: str) -> None:
        # Releases are always sent, even when the foreground check would refuse a press: a stuck key is worse.
        _send(_key_event(key, True))
        self.log.append((time.perf_counter(), f"up:{key}"))

    def tap(self, key: str, hold: float = 0.06) -> None:
        self.down(key)
        time.sleep(hold)
        self.up(key)

    def chord(self, *keys: str, hold: float = 0.08) -> None:
        for k in keys:
            self.down(k)
        time.sleep(hold)
        for k in reversed(keys):
            self.up(k)

    @contextmanager
    def held(self, *keys: str):
        for k in keys:
            self.down(k)
        try:
            yield
        finally:
            for k in reversed(keys):
                self.up(k)

    def hold(self, keys: str | tuple[str, ...], seconds: float) -> None:
        keys = (keys,) if isinstance(keys, str) else keys
        with self.held(*keys):
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                self._guard()
                time.sleep(0.02)

    def type_text(self, text: str, interval: float = 0.02) -> None:
        """Unicode text, one WM_CHAR per UTF-16 unit."""
        self.log.append((time.perf_counter(), f"text:{text}"))
        for ch in text:
            self._guard()
            units = ch.encode("utf-16-le")
            for i in range(0, len(units), 2):
                u = int.from_bytes(units[i:i + 2], "little")
                _send(INPUT(INPUT_KEYBOARD, _U(ki=KEYBDINPUT(0, u, KEYEVENTF_UNICODE, 0, 0))),
                      INPUT(INPUT_KEYBOARD, _U(ki=KEYBDINPUT(0, u, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP, 0, 0))))
            time.sleep(interval)

    def release_all(self) -> None:
        for k in ("w", "a", "s", "d", "shift", "ctrl", "alt"):
            try:
                self.up(k)
            except OSError:
                pass


class Mouse:
    def __init__(self, failsafe: Failsafe | None = None):
        self._failsafe = failsafe

    def move(self, x: int, y: int, settle: float = 0.05) -> None:
        if self._failsafe:
            self._failsafe.check()
        user32.SetCursorPos(int(x), int(y))
        if self._failsafe:
            self._failsafe.note_injected_cursor(int(x), int(y))
        time.sleep(settle)

    def click(self, x: int | None = None, y: int | None = None, button: str = "left", hold: float = 0.05) -> None:
        if x is not None and y is not None:
            self.move(x, y)
        elif self._failsafe:
            self._failsafe.check()
        down, up = MOUSEEVENTF[button]
        _send(INPUT(INPUT_MOUSE, _U(mi=MOUSEINPUT(0, 0, 0, down, 0, 0))))
        time.sleep(hold)
        _send(INPUT(INPUT_MOUSE, _U(mi=MOUSEINPUT(0, 0, 0, up, 0, 0))))

    def wheel(self, notches: int) -> None:
        _send(INPUT(INPUT_MOUSE, _U(mi=MOUSEINPUT(0, 0, ctypes.c_ulong(notches * 120).value, 0x0800, 0, 0))))
