"""Deliberately coarse vision: region cropping, colour counting, frame diffs and template matching. It answers
"did a panel appear / did the scene change / is this calibrated glyph on screen", never "what is this sprite";
authoritative state comes from oracles."""
from __future__ import annotations

import numpy as np
from PIL import Image

Region = tuple[float, float, float, float]  # fractions of the frame: left, top, right, bottom


def crop(img: Image.Image, region: Region) -> Image.Image:
    w, h = img.size
    return img.crop((int(region[0] * w), int(region[1] * h), int(region[2] * w), int(region[3] * h)))


def color_fraction(img: Image.Image, rgb: tuple[int, int, int], tol: int = 24, region: Region | None = None) -> float:
    """Fraction of pixels within `tol` (per channel) of `rgb`."""
    a = np.asarray(crop(img, region) if region else img, dtype=np.int16)
    hit = (np.abs(a - np.array(rgb, dtype=np.int16)) <= tol).all(axis=2)
    return float(hit.mean())


def diff_fraction(a: Image.Image, b: Image.Image, region: Region | None = None, threshold: int = 30) -> float:
    """Fraction of pixels whose max channel difference exceeds `threshold`."""
    if region:
        a, b = crop(a, region), crop(b, region)
    if a.size != b.size:
        raise ValueError(f"frame size changed {a.size} -> {b.size}")
    d = np.abs(np.asarray(a, dtype=np.int16) - np.asarray(b, dtype=np.int16)).max(axis=2)
    return float((d > threshold).mean())


def mean_luma(img: Image.Image, region: Region | None = None) -> float:
    a = np.asarray(crop(img, region) if region else img, dtype=np.float32)
    return float((a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)).mean())


def find_template(frame: Image.Image, template: Image.Image, stride: int = 2) -> tuple[float, tuple[int, int]]:
    """Best normalised-cross-correlation match of `template` in `frame` (greyscale, FFT). Returns
    (score in [-1, 1], (x, y) of the template's top-left in frame pixels)."""
    f = np.asarray(frame.convert("L"), dtype=np.float64)[::stride, ::stride]
    t = np.asarray(template.convert("L"), dtype=np.float64)[::stride, ::stride]
    th, tw = t.shape
    if th > f.shape[0] or tw > f.shape[1]:
        raise ValueError("template larger than frame")
    t0 = t - t.mean()
    tn = float(np.sqrt((t0 ** 2).sum()))
    if tn == 0:
        raise ValueError("template has no contrast")
    shape = (f.shape[0] + th - 1, f.shape[1] + tw - 1)
    corr = np.fft.irfft2(np.fft.rfft2(f, shape) * np.conj(np.fft.rfft2(t0, shape)), shape)
    corr = corr[: f.shape[0] - th + 1, : f.shape[1] - tw + 1]  # cross-correlation: index (y, x) = template's top-left
    ii = np.pad(f, ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    ii2 = np.pad(f * f, ((1, 0), (1, 0))).cumsum(0).cumsum(1)

    def box(m):
        return m[th:, tw:] - m[:-th, tw:] - m[th:, :-tw] + m[:-th, :-tw]

    s, s2 = box(ii), box(ii2)
    var = np.maximum(s2 - s * s / (th * tw), 1e-6)
    score = corr / (tn * np.sqrt(var))
    y, x = np.unravel_index(int(np.argmax(score)), score.shape)
    return float(score[y, x]), (int(x) * stride, int(y) * stride)
