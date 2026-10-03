"""Manifest validation: the structure in taste.schema.json plus the rules of SPEC.md section 5."""

from __future__ import annotations

import re
from collections.abc import Container, Mapping
from dataclasses import dataclass
from typing import Any

from taste.container import BLOB_REF

VERSION = "0.1"

ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
KIND = re.compile(r"^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$")
MEDIA_TYPE = re.compile(r"^[a-z]+/[A-Za-z0-9.+_-]+$")
TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$")
DURATION = re.compile(r"^\d+:[0-5]\d:[0-5]\d(\.\d+)?$")
REGION = re.compile(r"^[A-Z]{2}$")
AVAILABILITY_TYPES = frozenset({"subscription", "free", "ads", "rent", "buy"})
AT_INTEGERS = {"season": 0, "episode": 0, "track": 1, "page": 1}
AT_DURATIONS = ("time", "playtime")
AT_STRINGS = ("platform", "chapter", "level", "location", "section")


@dataclass(frozen=True, slots=True)
class Problem:
    """One reason a manifest is invalid. ``path`` is a JSON Pointer into taste.json."""

    path: str
    message: str

    def __str__(self) -> str:
        return f"{self.path or '/'}: {self.message}"


def validate_manifest(manifest: Any, blobs: Container[str] | None = None) -> list[Problem]:
    """Return every problem found; an empty list means the manifest is valid.

    ``blobs`` holds the blob references present in the container. Pass ``None`` to skip
    checking that referenced blobs exist, for example while a file is still being assembled.
    """

    return _Validator(blobs).run(manifest)


class _Validator:
    def __init__(self, blobs: Container[str] | None) -> None:
        self.blobs = blobs
        self.problems: list[Problem] = []

    def fail(self, path: str, message: str) -> None:
        self.problems.append(Problem(path, message))

    def run(self, manifest: Any) -> list[Problem]:
        if not isinstance(manifest, dict):
            self.fail("", "manifest must be an object")
            return self.problems
        if "taste" not in manifest:
            self.fail("/taste", "missing format version")
        elif manifest["taste"] != VERSION:
            self.fail("/taste", f"unsupported version {manifest['taste']!r}, expected {VERSION!r}")
        for key in ("title", "description", "generator"):
            self.string(manifest, key, "")
        for key in ("created", "modified"):
            self.timestamp(manifest, key, "")

        items = manifest.get("items")
        if not isinstance(items, dict):
            self.fail("/items", "must be an object of items keyed by id")
            items = {}
        for item_id, item in items.items():
            self.item(item_id, item, items)

        collections = manifest.get("collections")
        if not isinstance(collections, list):
            self.fail("/collections", "must be an array")
            collections = []
        seen: set[str] = set()
        for index, collection in enumerate(collections):
            path = f"/collections/{index}"
            self.collection(path, collection, items)
            collection_id = collection.get("id") if isinstance(collection, dict) else None
            if isinstance(collection_id, str):
                if collection_id in seen:
                    self.fail(f"{path}/id", f"duplicate collection id {collection_id!r}")
                seen.add(collection_id)
        return self.problems

    def item(self, item_id: str, item: Any, items: Mapping[str, Any]) -> None:
        path = f"/items/{_escape(item_id)}"
        if not ID.match(item_id):
            self.fail(path, f"invalid item id {item_id!r}")
        if not isinstance(item, dict):
            self.fail(path, "item must be an object")
            return
        kind = item.get("kind")
        if not isinstance(kind, str) or not KIND.match(kind):
            self.fail(f"{path}/kind", "must be a lowercase dotted name such as 'movie'")
        self.string(item, "title", path, required=True, non_empty=True)
        if "year" in item and not _is_int(item["year"]):
            self.fail(f"{path}/year", "must be an integer")
        self.string(item, "summary", path)
        if "ids" in item:
            ids = item["ids"]
            if not isinstance(ids, dict):
                self.fail(f"{path}/ids", "must be an object")
            else:
                for key, value in ids.items():
                    if not isinstance(value, str) and not _is_int(value):
                        self.fail(f"{path}/ids/{_escape(key)}", "must be a string or integer")
        if "meta" in item and not isinstance(item["meta"], dict):
            self.fail(f"{path}/meta", "must be an object")
        for index, link in enumerate(self.array(item, "links", path)):
            link_path = f"{path}/links/{index}"
            if not isinstance(link, dict):
                self.fail(link_path, "must be an object")
                continue
            self.string(link, "url", link_path, required=True)
            self.string(link, "label", link_path)
        for index, offer in enumerate(self.array(item, "availability", path)):
            self.availability(f"{path}/availability/{index}", offer)
        file_ids: set[str] = set()
        for index, entry in enumerate(self.array(item, "files", path)):
            file_path = f"{path}/files/{index}"
            self.file(file_path, entry)
            file_id = entry.get("id") if isinstance(entry, dict) else None
            if isinstance(file_id, str):
                if file_id in file_ids:
                    self.fail(f"{file_path}/id", f"duplicate file id {file_id!r} in this item")
                file_ids.add(file_id)
        self.tags(item, path)
        if "parent" in item:
            parent = item["parent"]
            if parent == item_id:
                self.fail(f"{path}/parent", "an item cannot be its own parent")
            elif not isinstance(parent, str) or parent not in items:
                self.fail(f"{path}/parent", f"no item with id {parent!r}")
        self.timestamp(item, "added", path)
        self.actor(item, path)

    def collection(self, path: str, collection: Any, items: Mapping[str, Any]) -> None:
        if not isinstance(collection, dict):
            self.fail(path, "collection must be an object")
            return
        collection_id = collection.get("id")
        if not isinstance(collection_id, str) or not ID.match(collection_id):
            self.fail(f"{path}/id", f"invalid collection id {collection_id!r}")
        self.string(collection, "name", path, required=True, non_empty=True)
        for key in ("vibe", "description", "icon"):
            self.string(collection, key, path)
        self.tags(collection, path)
        if "cover" in collection:
            self.file(f"{path}/cover", collection["cover"])
        self.timestamp(collection, "created", path)
        if not isinstance(collection.get("entries"), list):
            self.fail(f"{path}/entries", "must be an array")
            return
        placed: set[str] = set()
        for index, entry in enumerate(collection["entries"]):
            entry_path = f"{path}/entries/{index}"
            if not isinstance(entry, dict):
                self.fail(entry_path, "entry must be an object")
                continue
            item_id = entry.get("item")
            item = items.get(item_id) if isinstance(item_id, str) else None
            if item is None:
                self.fail(f"{entry_path}/item", f"no item with id {item_id!r}")
            elif item_id in placed:
                self.fail(f"{entry_path}/item", f"item {item_id!r} is already in this collection")
            else:
                placed.add(item_id)
            for key in ("note", "reason"):
                self.string(entry, key, entry_path)
            file_ids = _file_ids(item)
            for show_index, file_id in enumerate(self.array(entry, "show", entry_path)):
                if item is not None and (not isinstance(file_id, str) or file_id not in file_ids):
                    self.fail(
                        f"{entry_path}/show/{show_index}",
                        f"item {item_id!r} has no file {file_id!r}",
                    )
            self.timestamp(entry, "added", entry_path)
            self.actor(entry, entry_path)

    def file(self, path: str, entry: Any) -> None:
        if not isinstance(entry, dict):
            self.fail(path, "file must be an object")
            return
        file_id = entry.get("id")
        if not isinstance(file_id, str) or not ID.match(file_id):
            self.fail(f"{path}/id", f"invalid file id {file_id!r}")
        self.string(entry, "role", path, required=True, non_empty=True)
        media_type = entry.get("type")
        if not isinstance(media_type, str) or not MEDIA_TYPE.match(media_type):
            self.fail(f"{path}/type", "must be a media type such as 'image/jpeg'")
        has_blob, has_url = "blob" in entry, "url" in entry
        if has_blob == has_url:
            self.fail(path, "must have exactly one of 'blob' or 'url'")
        if has_blob:
            self.blob(entry["blob"], f"{path}/blob")
        if has_url:
            self.string(entry, "url", path)
        if "thumb" in entry:
            self.blob(entry["thumb"], f"{path}/thumb")
        for key in ("size", "width", "height"):
            minimum = 0 if key == "size" else 1
            if key in entry and (not _is_int(entry[key]) or entry[key] < minimum):
                self.fail(f"{path}/{key}", f"must be an integer of at least {minimum}")
        if "duration" in entry and (not _is_number(entry["duration"]) or entry["duration"] < 0):
            self.fail(f"{path}/duration", "must be a non-negative number of seconds")
        for key in ("name", "caption"):
            self.string(entry, key, path)
        if "at" in entry:
            self.at(f"{path}/at", entry["at"])
        self.tags(entry, path)
        self.timestamp(entry, "added", path)
        self.actor(entry, path)

    def at(self, path: str, at: Any) -> None:
        if not isinstance(at, dict):
            self.fail(path, "must be an object")
            return
        for key in AT_DURATIONS:
            if key in at and (not isinstance(at[key], str) or not DURATION.match(at[key])):
                self.fail(f"{path}/{key}", "must look like HH:MM:SS")
        for key, minimum in AT_INTEGERS.items():
            if key in at and (not _is_int(at[key]) or at[key] < minimum):
                self.fail(f"{path}/{key}", f"must be an integer of at least {minimum}")
        for key in AT_STRINGS:
            self.string(at, key, path)

    def availability(self, path: str, offer: Any) -> None:
        if not isinstance(offer, dict):
            self.fail(path, "must be an object")
            return
        self.string(offer, "service", path, required=True, non_empty=True)
        if "region" in offer and (
            not isinstance(offer["region"], str) or not REGION.match(offer["region"])
        ):
            self.fail(f"{path}/region", "must be a two-letter country code such as 'DE'")
        if "type" in offer and offer["type"] not in AVAILABILITY_TYPES:
            self.fail(f"{path}/type", f"must be one of {', '.join(sorted(AVAILABILITY_TYPES))}")
        self.string(offer, "url", path)
        self.timestamp(offer, "checked", path)

    def blob(self, ref: Any, path: str) -> None:
        if not isinstance(ref, str) or not BLOB_REF.match(ref):
            self.fail(path, "must be 'sha256:' followed by 64 lowercase hex digits")
        elif self.blobs is not None and ref not in self.blobs:
            self.fail(path, f"blob {ref} is not in the file")

    def tags(self, owner: Mapping[str, Any], path: str) -> None:
        if "tags" not in owner:
            return
        tags = owner["tags"]
        if not isinstance(tags, dict):
            self.fail(f"{path}/tags", "must be an object")
            return
        for key, value in tags.items():
            if isinstance(value, list):
                valid = all(isinstance(part, str) for part in value)
            else:
                valid = isinstance(value, str | bool) or _is_number(value)
            if not valid:
                self.fail(
                    f"{path}/tags/{_escape(key)}",
                    "must be a string, number, boolean, or array of strings",
                )

    def actor(self, owner: Mapping[str, Any], path: str) -> None:
        if "added_by" not in owner:
            return
        actor = owner["added_by"]
        if not isinstance(actor, dict) or actor.get("type") not in ("user", "agent"):
            self.fail(f"{path}/added_by", "must be {'type': 'user'} or {'type': 'agent', ...}")
        else:
            self.string(actor, "name", f"{path}/added_by")

    def array(self, owner: Mapping[str, Any], key: str, path: str) -> list[Any]:
        if key not in owner:
            return []
        if not isinstance(owner[key], list):
            self.fail(f"{path}/{key}", "must be an array")
            return []
        return owner[key]

    def string(
        self,
        owner: Mapping[str, Any],
        key: str,
        path: str,
        *,
        required: bool = False,
        non_empty: bool = False,
    ) -> None:
        if key not in owner:
            if required:
                self.fail(f"{path}/{key}", "is required")
            return
        value = owner[key]
        if not isinstance(value, str):
            self.fail(f"{path}/{key}", "must be a string")
        elif non_empty and not value:
            self.fail(f"{path}/{key}", "must not be empty")

    def timestamp(self, owner: Mapping[str, Any], key: str, path: str) -> None:
        if key in owner and (not isinstance(owner[key], str) or not TIMESTAMP.match(owner[key])):
            self.fail(f"{path}/{key}", "must be an RFC 3339 timestamp or a YYYY-MM-DD date")


def _file_ids(item: Any) -> set[str]:
    if not isinstance(item, dict) or not isinstance(item.get("files"), list):
        return set()
    return {
        entry["id"]
        for entry in item["files"]
        if isinstance(entry, dict) and isinstance(entry.get("id"), str)
    }


def _escape(token: str) -> str:
    return str(token).replace("~", "~0").replace("/", "~1")


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)
