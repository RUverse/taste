from __future__ import annotations

import json
import sys
from pathlib import Path

import jsonschema
import pytest
from conftest import SPEC

from taste import Taste

EXAMPLE = SPEC / "examples" / "moods.taste"


def test_example_is_valid() -> None:
    with Taste.open(EXAMPLE) as doc:
        assert doc.validate(deep=True) == []
        schema = json.loads((SPEC / "taste.schema.json").read_text())
        jsonschema.validate(doc.manifest, schema)
        kinds = {item["kind"] for item in doc.items.values()}
        assert {"movie", "tv", "tv.episode", "music.track", "article", "game"} <= kinds


def test_example_is_up_to_date(tmp_path: Path) -> None:
    pytest.importorskip("PIL")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    try:
        import build_example
    finally:
        sys.path.pop(0)
    rebuilt = build_example.build().save(tmp_path / "moods.taste")
    with Taste.open(rebuilt) as fresh, Taste.open(EXAMPLE) as committed:
        fresh.manifest.pop("generator")
        committed.manifest.pop("generator")
        assert fresh.manifest == committed.manifest, "run scripts/build_example.py"
