from __future__ import annotations

import json

import pytest
from conftest import SPEC, png

from taste import Taste
from taste.cli import main

EXAMPLE = SPEC / "examples" / "moods.taste"


def run(capsys: pytest.CaptureFixture[str], *argv: str) -> tuple[int, str, str]:
    code = main([str(arg) for arg in argv])
    out, err = capsys.readouterr()
    return code, out, err


def test_building_a_file_from_the_shell(tmp_path, capsys, monkeypatch) -> None:
    pytest.importorskip("PIL")
    path = tmp_path / "m.taste"
    shot = tmp_path / "shot.png"
    shot.write_bytes(png(1280, 720))

    assert run(capsys, "new", path, "--title", "Moods")[0] == 0
    assert run(capsys, "new", path)[0] == 1
    _, out, _ = run(
        capsys,
        "add-collection",
        path,
        "Rainy Sunday",
        "--vibe",
        "Quiet.",
        "--tag",
        "mood=calm",
        "--tag",
        "mood=cozy",
    )
    assert out.strip() == "rainy-sunday"
    _, out, _ = run(
        capsys,
        "add-item",
        path,
        "--kind",
        "movie",
        "--title",
        "Lost in Translation",
        "--year",
        "2003",
        "--ext",
        "tmdb:=153",
        "--meta",
        "director=Sofia Coppola",
        "--tag",
        "rating:=5",
        "--available",
        '{"service": "netflix", "region": "DE"}',
        "--to",
        "rainy-sunday",
        "--note",
        "Window scenes",
    )
    item = out.strip()
    assert item == "lost-in-translation-2003"
    _, out, _ = run(
        capsys,
        "attach",
        path,
        item,
        shot,
        "--role",
        "screenshot",
        "--at",
        "time=00:23:41",
        "--at",
        "season=1",
        "--caption",
        "Window",
        "--show-in",
        "rainy-sunday",
    )
    assert out.strip() == "screenshot"
    monkeypatch.setenv("TASTE_BY", "agent:hermes")
    run(
        capsys,
        "add-item",
        path,
        "--json",
        '{"kind": "music.track", "title": "Nightcall"}',
        "--to",
        "rainy-sunday",
        "--reason",
        "Synths",
    )
    run(capsys, "tag", path, f"{item}/screenshot", "palette=blue")
    run(capsys, "set", path, item, "meta.runtime:=102", "summary=Tokyo.")

    with Taste.open(path) as doc:
        movie = doc.item(item)
        assert movie["ids"] == {"tmdb": 153}
        assert movie["meta"] == {"director": "Sofia Coppola", "runtime": 102}
        assert movie["availability"] == [{"service": "netflix", "region": "DE"}]
        assert movie["summary"] == "Tokyo."
        shot_entry = movie["files"][0]
        assert shot_entry["at"] == {"time": "00:23:41", "season": 1}
        assert shot_entry["tags"] == {"palette": "blue"}
        assert "thumb" in shot_entry
        collection = doc.collection("rainy-sunday")
        assert collection["tags"] == {"mood": ["calm", "cozy"]}
        assert collection["entries"][0]["show"] == ["screenshot"]
        assert doc.item("nightcall")["added_by"] == {"type": "agent", "name": "hermes"}

    _, out, _ = run(capsys, "tree", path)
    assert "Rainy Sunday  [rainy-sunday]" in out and "*screenshot" in out
    _, out, _ = run(capsys, "find", path, "rating=5")
    assert out.split("\t")[0] == item
    _, out, _ = run(capsys, "find", path, "--files", "--role", "screenshot", "--json")
    assert json.loads(out)[0]["item"] == item
    assert run(capsys, "validate", path, "--deep")[0] == 0

    target = tmp_path / "out.png"
    run(capsys, "extract", path, item, "screenshot", "-o", target)
    assert target.read_bytes() == shot.read_bytes()

    run(capsys, "unlink", path, "rainy-sunday", item)
    run(capsys, "detach", path, item, "screenshot")
    run(capsys, "remove-item", path, item)
    with Taste.open(path) as doc:
        assert list(doc.items) == ["nightcall"]
        assert doc.referenced_blobs() == set()


def test_errors_are_reported_without_tracebacks(tmp_path, capsys) -> None:
    path = tmp_path / "m.taste"
    run(capsys, "new", path)
    code, _, err = run(capsys, "link", path, "missing", "x")
    assert code == 1 and err.startswith("taste: error: no collection")
    code, _, err = run(capsys, "tag", path, "x", "novalue")
    assert code == 1 and "key=value" in err
    assert run(capsys, "info", tmp_path / "nope.taste")[0] == 1


def test_failed_edit_does_not_save(tmp_path, capsys) -> None:
    path = tmp_path / "m.taste"
    run(capsys, "new", path)
    before = path.read_bytes()
    assert run(capsys, "add-item", path, "--kind", "Bad Kind", "--title", "X")[0] == 1
    assert path.read_bytes() == before


def test_reading_the_example(capsys) -> None:
    code, out, _ = run(capsys, "info", EXAMPLE, "--json")
    info = json.loads(out)
    assert code == 0 and [c["id"] for c in info["collections"]] == ["rainy-sunday", "neon-nights"]
    _, out, _ = run(capsys, "show", EXAMPLE, "lost-in-translation-2003")
    assert json.loads(out)["collections"] == ["rainy-sunday", "neon-nights"]
    _, out, _ = run(capsys, "find", EXAMPLE, "--kind", "music", "--in", "neon-nights")
    assert out.split("\t")[0] == "nightcall-2010"


def test_pack_and_unpack(tmp_path, capsys) -> None:
    folder = tmp_path / "moods"
    assert run(capsys, "unpack", EXAMPLE, folder)[0] == 0
    manifest = json.loads((folder / "taste.json").read_text())
    manifest["title"] = "Edited by hand"
    (folder / "taste.json").write_text(json.dumps(manifest))
    packed = tmp_path / "packed.taste"
    assert run(capsys, "pack", folder, packed)[0] == 0
    with Taste.open(packed) as doc:
        assert doc.title == "Edited by hand"
        assert doc.validate(deep=True) == []
