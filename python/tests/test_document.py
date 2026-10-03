from __future__ import annotations

import pytest
from conftest import png

from taste import Taste, TasteError, slugify


@pytest.fixture
def doc() -> Taste:
    doc = Taste.new("Moods")
    doc.add_collection("Rainy Sunday", vibe="Quiet.")
    return doc


def test_ids_are_readable_and_unique(doc: Taste) -> None:
    assert doc.add_item("movie", "Amélie", year=2001) == "amelie-2001"
    assert doc.add_item("movie", "Amélie", year=2001) == "amelie-2001-2"
    assert doc.add_item("movie", "فیلم") == "movie-1"
    assert doc.add_item("music.track", "名前") == "music-track-1"
    assert doc.add_collection("Rainy Sunday")["id"] == "rainy-sunday-2"
    with pytest.raises(TasteError, match="already used"):
        doc.add_item("movie", "X", id="amelie-2001")
    with pytest.raises(TasteError, match="invalid id"):
        doc.add_item("movie", "X", id="has space")


def test_slugify_limits_length() -> None:
    assert slugify("A" * 100) == "a" * 60
    assert slugify("  --Hello, World!-- ") == "hello-world"


def test_items_record_who_added_them(doc: Taste) -> None:
    by_user = doc.add_item("movie", "A")
    by_agent = doc.add_item("movie", "B", by="agent:hermes")
    assert doc.item(by_user)["added_by"] == {"type": "user"}
    assert doc.item(by_agent)["added_by"] == {"type": "agent", "name": "hermes"}
    with pytest.raises(TasteError, match="actor"):
        doc.add_item("movie", "C", by="robot")


def test_entries(doc: Taste) -> None:
    first = doc.add_item("movie", "First")
    second = doc.add_item("movie", "Second")
    doc.add_entry("rainy-sunday", first)
    doc.add_entry("rainy-sunday", second, position=0, note="Opens it.")
    assert [e["item"] for e in doc.collection("rainy-sunday")["entries"]] == [second, first]
    with pytest.raises(TasteError, match="already in"):
        doc.add_entry("rainy-sunday", first)
    with pytest.raises(TasteError, match="no file"):
        doc.add_entry(doc.add_collection("Other")["id"], first, show=["missing"])
    doc.move_entry("rainy-sunday", first, 0)
    assert doc.collection("rainy-sunday")["entries"][0]["item"] == first
    doc.remove_entry("rainy-sunday", first)
    assert doc.unsorted() == [first]
    with pytest.raises(TasteError, match="not in collection"):
        doc.remove_entry("rainy-sunday", first)


def test_remove_item_removes_its_entries(doc: Taste) -> None:
    item = doc.add_item("movie", "A")
    doc.add_entry("rainy-sunday", item)
    doc.remove_item(item)
    assert doc.collection("rainy-sunday")["entries"] == []
    assert doc.items == {}


def test_parent_cannot_be_removed_before_children(doc: Taste) -> None:
    show = doc.add_item("tv", "Show")
    doc.add_item("tv.episode", "Pilot", parent=show)
    with pytest.raises(TasteError, match="parent of pilot"):
        doc.remove_item(show)


def test_remove_collection_can_prune_unsorted_items(doc: Taste) -> None:
    only_here = doc.add_item("movie", "Only here")
    shared = doc.add_item("movie", "Shared")
    other = doc.add_collection("Other")["id"]
    for item in (only_here, shared):
        doc.add_entry("rainy-sunday", item)
    doc.add_entry(other, shared)
    assert doc.remove_collection("rainy-sunday", prune=True) == [only_here]
    assert set(doc.items) == {shared}


def test_attach_stores_bytes_once_and_detach_clears_show(doc: Taste) -> None:
    item = doc.add_item("movie", "A")
    first = doc.attach(item, b"same bytes", role="attachment", type="text/plain")
    second = doc.attach(item, b"same bytes", role="attachment", type="text/plain")
    assert first["blob"] == second["blob"]
    assert (first["id"], second["id"]) == ("attachment", "attachment-2")
    assert len(doc.referenced_blobs()) == 1
    doc.add_entry("rainy-sunday", item, show=[first["id"], second["id"]])
    doc.detach(item, first["id"])
    assert doc.collection("rainy-sunday")["entries"][0]["show"] == ["attachment-2"]
    doc.detach(item, second["id"])
    assert "show" not in doc.collection("rainy-sunday")["entries"][0]


def test_attach_by_url_or_path(doc: Taste, tmp_path) -> None:
    item = doc.add_item("article", "Essay")
    remote = doc.attach(item, url="https://example.com/a.md?x=1", role="snapshot")
    assert remote["type"] == "text/markdown" and "blob" not in remote
    path = tmp_path / "notes.txt"
    path.write_text("hello")
    stored = doc.attach(item, path, role="attachment")
    assert stored["name"] == "notes.txt" and stored["size"] == 5
    assert doc.read_blob(stored["blob"]) == b"hello"
    with pytest.raises(TasteError, match="exactly one"):
        doc.attach(item, path, url="https://x", role="attachment")
    with pytest.raises(TasteError, match="no such file"):
        doc.attach(item, tmp_path / "missing", role="attachment")


def test_screenshots_get_size_and_thumbnail(doc: Taste) -> None:
    pytest.importorskip("PIL")
    item = doc.add_item("movie", "A")
    big = doc.attach(item, png(1920, 800), role="screenshot", at={"time": "00:23:41"})
    small = doc.attach(item, png(200, 100), role="screenshot")
    assert big["type"] == "image/png"
    assert (big["width"], big["height"]) == (1920, 800)
    assert "thumb" in big and "thumb" not in small
    import io

    from PIL import Image

    with Image.open(io.BytesIO(doc.read_blob(big["thumb"]))) as thumb:
        assert max(thumb.size) == 512


def test_find(doc: Taste) -> None:
    calm = doc.add_item("movie", "Calm one", tags={"mood": ["calm", "warm"], "rating": 5})
    loud = doc.add_item("music.track", "Loud one", tags={"mood": "Loud", "watched": True})
    doc.add_entry("rainy-sunday", calm, note="window scene")
    assert doc.find(tags={"mood": "calm"}) == [calm]
    assert doc.find(tags={"mood": "loud"}) == [loud]
    assert doc.find(tags={"mood": ["calm", "warm"]}) == [calm]
    assert doc.find(tags={"rating": "5"}) == [calm]
    assert doc.find(tags={"watched": True}) == [loud]
    assert doc.find(kind="music") == [loud]
    assert doc.find(kind="mus") == []
    assert doc.find(collection="rainy-sunday") == [calm]
    assert doc.find(text="WINDOW") == [calm]
    doc.attach(
        loud,
        b"x",
        role="screenshot",
        type="image/png",
        caption="Crowd at night",
        tags={"palette": "red"},
    )
    assert doc.find_files(role="screenshot", text="crowd") == [(loud, "screenshot")]
    assert doc.find_files(tags={"palette": "blue"}) == []


def test_tag(doc: Taste) -> None:
    item = doc.item(doc.add_item("movie", "A"))
    assert doc.tag(item, {"mood": "calm", "rating": 4}) == {"mood": "calm", "rating": 4}
    doc.tag(item, remove=["mood", "rating"])
    assert "tags" not in item


def test_unknown_fields_survive(doc: Taste, tmp_path) -> None:
    item = doc.add_item("movie", "A", **{"x-mytaste": {"library_id": 7}})
    doc.manifest["x-viewer"] = {"theme": "dark"}
    path = doc.save(tmp_path / "a.taste")
    with Taste.open(path) as reopened:
        assert reopened.manifest["x-viewer"] == {"theme": "dark"}
        assert reopened.item(item)["x-mytaste"] == {"library_id": 7}
