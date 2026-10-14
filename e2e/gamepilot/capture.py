"""Frame capture of a window's client area.

Why not PIL.ImageGrab: on a fullscreen DirectX window it returns a stale frame (we saw a white splash for
minutes while the game sat on its title screen). The primary path is DXGI desktop duplication (dxcam), which
reads what the compositor really shows; PrintWindow(PW_RENDERFULLCONTENT) is the fallback and also works
when the window is occluded. Both need no cooperation from the game."""
from __future__ import annotations

import ctypes
import time

import numpy as np
from PIL import Image

from .win import Rect, user32

_cam = None
_abandoned: list = []  # cameras dropped after access loss; kept alive so their COM objects are never released


class _OutputLost(RuntimeError):
    pass


def _refuse_recovery() -> None:
    raise _OutputLost("DXGI output lost")


def _camera():
    """dxcam 0.3.0 recovers from DXGI access loss (fullscreen/mode switch) in place, but its retry loop releases
    the same duplicator again on every attempt and kills the interpreter with an access violation. So recovery is
    refused: the lost camera is abandoned unreleased and the next grab builds a fresh one."""
    global _cam
    if _cam is None:
        import dxcam
        cam = dxcam.create(output_color="BGRA")  # BGRA avoids dxcam's optional cv2 dependency
        cam._recover_output = _refuse_recovery
        _cam = cam
    return _cam


def _abandon_camera() -> None:
    global _cam
    if _cam is not None:
        _cam._is_released = True  # lets dxcam.create() drop it and makes its __del__ a no-op
        _abandoned.append(_cam)
        _cam = None


def _dxgi(rect: Rect, timeout: float = 2.0) -> Image.Image | None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            frame = _camera().grab(region=(rect.left, rect.top, rect.right, rect.bottom))
        except _OutputLost:
            _abandon_camera()
            frame = None
        except Exception:
            frame = None
        if frame is not None:
            return Image.fromarray(frame[:, :, [2, 1, 0]])
        time.sleep(0.03)
    return None


def print_window(hwnd: int, rect: Rect) -> Image.Image:
    import win32gui
    import win32ui
    w, h = rect.width, rect.height
    hdc = win32gui.GetWindowDC(hwnd)
    mfc = win32ui.CreateDCFromHandle(hdc)
    save = mfc.CreateCompatibleDC()
    bmp = win32ui.CreateBitmap()
    bmp.CreateCompatibleBitmap(mfc, w, h)
    save.SelectObject(bmp)
    try:
        user32.PrintWindow(hwnd, save.GetSafeHdc(), 3)  # PW_CLIENTONLY | PW_RENDERFULLCONTENT
        return Image.frombuffer("RGB", (w, h), bmp.GetBitmapBits(True), "raw", "BGRX", 0, 1)
    finally:
        win32gui.DeleteObject(bmp.GetHandle())
        save.DeleteDC()
        mfc.DeleteDC()
        win32gui.ReleaseDC(hwnd, hdc)


def grab(rect: Rect, hwnd: int | None = None) -> Image.Image:
    img = _dxgi(rect)
    if img is None and hwnd is not None:
        img = print_window(hwnd, rect)
    if img is None:
        raise RuntimeError("frame capture failed on every backend")
    return img
