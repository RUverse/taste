from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest
from conftest import SPEC

from taste import validate_manifest

SCHEMA = json.loads((SPEC / "taste.schema.json").read_text())
VALIDATOR = jsonschema.Draft202012Validator(SCHEMA)


def fixtures(kind: str) -> list[Path]:
    return sorted((SPEC / "fixtures" / kind).glob("*.json"))


def test_schema_is_valid() -> None:
    jsonschema.Draft202012Validator.check_schema(SCHEMA)


@pytest.mark.parametrize("path", fixtures("valid"), ids=lambda p: p.stem)
def test_valid_fixtures(path: Path) -> None:
    manifest = json.loads(path.read_text())["manifest"]
    assert validate_manifest(manifest) == []
    assert list(VALIDATOR.iter_errors(manifest)) == []


@pytest.mark.parametrize("path", fixtures("invalid"), ids=lambda p: p.stem)
def test_invalid_fixtures(path: Path) -> None:
    fixture = json.loads(path.read_text())
    paths = sorted({problem.path for problem in validate_manifest(fixture["manifest"])})
    assert paths == fixture["problems"], fixture["description"]
    schema_errors = list(VALIDATOR.iter_errors(fixture["manifest"]))
    assert bool(schema_errors) == fixture["schema_catches"], fixture["description"]


def test_problems_point_at_the_field() -> None:
    manifest = {
        "taste": "0.1",
        "collections": [{"id": "c", "name": "C", "entries": [{"item": "a/b"}]}],
        "items": {"a/b": {"kind": "movie", "title": ""}},
    }
    paths = [problem.path for problem in validate_manifest(manifest)]
    assert "/items/a~1b" in paths
    assert "/items/a~1b/title" in paths


def test_blob_presence_is_checked_when_known() -> None:
    ref = "sha256:" + "a" * 64
    manifest = {
        "taste": "0.1",
        "collections": [],
        "items": {
            "a": {
                "kind": "movie",
                "title": "A",
                "files": [
                    {"id": "f", "role": "poster", "type": "image/png", "blob": ref, "thumb": ref}
                ],
            }
        },
    }
    assert validate_manifest(manifest) == []
    assert validate_manifest(manifest, {ref}) == []
    assert len(validate_manifest(manifest, set())) == 2


@pytest.mark.parametrize(
    "manifest",
    [None, [], "x", {"taste": "0.1", "items": {"a": 1}, "collections": [1, {"entries": [2]}]}],
)
def test_garbage_does_not_crash(manifest) -> None:
    assert validate_manifest(manifest) != []
