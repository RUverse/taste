from __future__ import annotations

import json
import os
import zipfile

import pytest

from taste import MIMETYPE, Taste, TasteError


def make(tmp_path) -> Taste:
    doc = Taste.new("Moods")
    collection = doc.add_collection("Rainy")["id"]
    item = doc.add_item("movie", "A", year=2000)
    doc.attach(item, b"poster bytes", role="poster", type="image/jpeg")
    doc.attach(item, b"# notes\n" * 50, role="snapshot", type="text/markdown")
    doc.add_entry(collection, item)
    return doc


def test_layout(tmp_path) -> None:
    path = make(tmp_path).save(tmp_path / "a.taste")
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        assert [i.filename for i in infos[:2]] == ["mimetype", "taste.json"]
        assert infos[0].compress_type == zipfile.ZIP_STORED and infos[0].extra == b""
        assert archive.read("mimetype") == MIMETYPE.encode()
        by_type = {i.filename: i.compress_type for i in infos[2:]}
        assert sorted(by_type.values()) == [zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED]
        assert all(i.date_time == (1980, 1, 1, 0, 0, 0) for i in infos)
    with open(path, "rb") as handle:
        assert handle.read(38)[30:38] == b"mimetype"


def test_round_trip_and_reading_blobs(tmp_path) -> None:
    path = make(tmp_path).save(tmp_path / "a.taste")
    with Taste.open(path) as doc:
        item = doc.item("a-2000")
        poster = doc.file("a-2000", "poster")
        assert doc.read_blob(poster["blob"]) == b"poster bytes"
        assert item["files"][1]["type"] == "text/markdown"
        assert doc.manifest["generator"].startswith("taste-format ")
        assert doc.validate(deep=True) == []


def test_saving_drops_unreferenced_blobs(tmp_path) -> None:
    path = make(tmp_path).save(tmp_path / "a.taste")
    with Taste.open(path) as doc:
        doc.detach("a-2000", "snapshot")
        doc.attach("a-2000", b"new", role="attachment", type="text/plain")
        doc.save()
        assert doc.read_blob(doc.file("a-2000", "attachment")["blob"]) == b"new"
        assert doc.read_blob(doc.file("a-2000", "poster")["blob"]) == b"poster bytes"
    with zipfile.ZipFile(path) as archive:
        assert len([n for n in archive.namelist() if n.startswith("blobs/")]) == 2


def test_save_as_keeps_blobs_from_the_original(tmp_path) -> None:
    original = make(tmp_path).save(tmp_path / "a.taste")
    with Taste.open(original) as doc:
        copy = doc.save(tmp_path / "b.taste")
        assert doc.path == copy.resolve()
    with Taste.open(copy) as reopened:
        assert reopened.validate(deep=True) == []


def test_save_leaves_no_temporary_files_and_keeps_permissions(tmp_path) -> None:
    path = make(tmp_path).save(tmp_path / "a.taste")
    os.chmod(path, 0o640)
    with Taste.open(path) as doc:
        doc.save()
    assert [p.name for p in tmp_path.iterdir()] == ["a.taste"]
    assert path.stat().st_mode & 0o777 == 0o640


def test_failed_save_leaves_the_original_untouched(tmp_path) -> None:
    path = make(tmp_path).save(tmp_path / "a.taste")
    before = path.read_bytes()
    with Taste.open(path) as doc:
        doc.items["a-2000"]["kind"] = "Not A Kind"
        with pytest.raises(TasteError, match="invalid document"):
            doc.save()
    assert path.read_bytes() == before
    assert [p.name for p in tmp_path.iterdir()] == ["a.taste"]


def test_saving_twice_gives_identical_bytes(tmp_path, frozen_clock) -> None:
    first = make(tmp_path).save(tmp_path / "a.taste").read_bytes()
    second = make(tmp_path).save(tmp_path / "b.taste").read_bytes()
    assert first == second


def test_unknown_entries_are_ignored(tmp_path) -> None:
    path = make(tmp_path).save(tmp_path / "a.taste")
    with zipfile.ZipFile(path, "a") as archive:
        archive.writestr("extras/readme.txt", "hello")
    with Taste.open(path) as doc:
        assert doc.validate() == []


@pytest.mark.parametrize(
    ("entries", "message"),
    [
        ([("taste.json", "{}")], "no leading mimetype"),
        ([("mimetype", "application/zip"), ("taste.json", "{}")], "wrong mimetype"),
        ([("mimetype", MIMETYPE)], "missing taste.json"),
        ([("mimetype", MIMETYPE), ("taste.json", "{nope")], "not valid JSON"),
        ([("mimetype", MIMETYPE), ("taste.json", "[]")], "must be a JSON object"),
    ],
)
def test_rejects_files_that_are_not_taste(tmp_path, entries, message) -> None:
    path = tmp_path / "bad.taste"
    with zipfile.ZipFile(path, "w") as archive:
        for name, text in entries:
            archive.writestr(name, text)
    with pytest.raises(TasteError, match=message):
        Taste.open(path)


def test_rejects_non_zip(tmp_path) -> None:
    path = tmp_path / "bad.taste"
    path.write_text("hello")
    with pytest.raises(TasteError, match="not a .taste file"):
        Taste.open(path)


def test_unknown_versions_need_opting_in(tmp_path) -> None:
    path = tmp_path / "future.taste"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("mimetype", MIMETYPE)
        archive.writestr("taste.json", json.dumps({"taste": "0.9", "collections": [], "items": {}}))
    with pytest.raises(TasteError, match="not supported"):
        Taste.open(path)
    with Taste.open(path, any_version=True) as doc:
        assert doc.validate()[0].path == "/taste"


def test_deep_validation_finds_corrupted_blobs(tmp_path) -> None:
    doc = Taste.new()
    item = doc.add_item("movie", "A")
    ref = doc.attach(item, b"real", role="poster", type="image/jpeg")["blob"]
    path = tmp_path / "a.taste"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("mimetype", MIMETYPE)
        archive.writestr("taste.json", json.dumps(doc.manifest))
        archive.writestr("blobs/sha256/" + ref.removeprefix("sha256:"), b"tampered")
        archive.writestr("blobs/sha256/not-a-hash", b"x")
    with Taste.open(path) as reopened:
        shallow = [str(p) for p in reopened.validate()]
        deep = [str(p) for p in reopened.validate(deep=True)]
    assert shallow == ["[blobs/sha256/not-a-hash]: blob name is not a SHA-256 digest"]
    assert any("does not match its hash" in p for p in deep)


def test_missing_blob_is_reported(tmp_path) -> None:
    path = make(tmp_path).save(tmp_path / "a.taste")
    with Taste.open(path) as doc:
        doc.file("a-2000", "poster")["blob"] = "sha256:" + "0" * 64
        assert any("is not in the file" in str(p) for p in doc.validate())


def test_unpack_and_pack(tmp_path) -> None:
    path = make(tmp_path).save(tmp_path / "a.taste")
    with Taste.open(path) as doc:
        folder = doc.unpack(tmp_path / "unpacked")
        manifest = doc.manifest
    assert json.loads((folder / "taste.json").read_text()) == manifest
    assert len(list((folder / "blobs" / "sha256").iterdir())) == 2
    rebuilt = Taste.from_folder(folder).save(tmp_path / "b.taste")
    with Taste.open(rebuilt) as doc:
        assert doc.read_blob(doc.file("a-2000", "poster")["blob"]) == b"poster bytes"
