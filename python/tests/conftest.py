from __future__ import annotations

import io
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = ROOT / "spec"


def png(width: int, height: int, color: tuple[int, int, int] = (30, 60, 120)) -> bytes:
    from PIL import Image

    output = io.BytesIO()
    Image.new("RGB", (width, height), color).save(output, "PNG")
    return output.getvalue()


@pytest.fixture
def frozen_clock(monkeypatch: pytest.MonkeyPatch) -> str:
    stamp = "2026-10-03T12:00:00Z"
    monkeypatch.setattr("taste.document.now", lambda: stamp)
    return stamp
