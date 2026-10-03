"""The ``Taste`` document: a manifest plus the blobs it refers to."""

from __future__ import annotations

import io
import json
import re
import unicodedata
from collections.abc import Iterator, Mapping
from datetime import UTC, datetime
from pathlib import Path
from typing import IO, Any, Self

from taste import __version__
from taste.container import (
    BlobSource,
    ContainerIssue,
    ContainerReader,
    TasteError,
    hash_bytes,
    hash_file,
    write_container,
)
from taste.media import guess_type, inspect_image
from taste.validate import ID, VERSION, Problem, validate_manifest

Actor = Mapping[str, str]
USER: Actor = {"type": "user"}
GENERATOR = f"taste-format {__version__}"


def now() -> str:
    return datetime.now(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def actor(value: str | Mapping[str, str] | None) -> dict[str, str]:
    """``"user"``, ``"agent:hermes"``, or an actor object, as an actor object."""

    if value is None:
        return dict(USER)
    if isinstance(value, Mapping):
        return dict(value)
    if value == "user":
        return {"type": "user"}
    kind, _, name = value.partition(":")
    if kind != "agent":
        raise TasteError(f"actor must be 'user' or 'agent:<name>', not {value!r}")
    return {"type": "agent", "name": name} if name else {"type": "agent"}


class Taste:
    """An open .taste document.

    The manifest is kept as plain JSON data in :attr:`manifest`, so fields this library does not
    know about survive a round trip. Blobs stay inside the source file until they are needed;
    files added since opening are held until :meth:`save`.
    """

    def __init__(self, manifest: dict[str, Any], reader: ContainerReader | None = None) -> None:
        self.manifest = manifest
        self._reader = reader
        self._pending: dict[str, bytes | Path] = {}

    # Opening and saving

    @classmethod
    def new(cls, title: str = "", description: str = "") -> Self:
        stamp = now()
        manifest: dict[str, Any] = {"taste": VERSION}
        if title:
            manifest["title"] = title
        if description:
            manifest["description"] = description
        manifest.update(created=stamp, modified=stamp, collections=[], items={})
        return cls(manifest)

    @classmethod
    def open(cls, path: str | Path, *, any_version: bool = False) -> Self:
        """Open a .taste file. Unknown versions are refused unless ``any_version`` is set."""

        reader = ContainerReader(Path(path))
        version = reader.manifest.get("taste")
        if version != VERSION and not any_version:
            reader.close()
            raise TasteError(f"{path}: format version {version!r} is not supported ({VERSION})")
        return cls(reader.manifest, reader)

    @classmethod
    def from_folder(cls, folder: str | Path) -> Self:
        """Load an unpacked document: ``taste.json`` plus ``blobs/sha256/<hex>`` files."""

        folder = Path(folder)
        try:
            manifest = json.loads((folder / "taste.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise TasteError(f"{folder}: cannot read taste.json ({error})") from error
        document = cls(manifest)
        blob_dir = folder / "blobs" / "sha256"
        if blob_dir.is_dir():
            for path in sorted(blob_dir.iterdir()):
                if path.is_file():
                    document._pending[f"sha256:{path.name}"] = path
        return document

    @property
    def path(self) -> Path | None:
        return self._reader.path if self._reader else None

    def save(self, path: str | Path | None = None) -> Path:
        """Write the document, by default back to the file it was opened from.

        The file is replaced in one step, and blobs nothing refers to any more are dropped.
        """

        target = Path(path) if path is not None else self.path
        if target is None:
            raise TasteError("this document has no file yet; pass a path to save()")
        problems = validate_manifest(self.manifest, self._available())
        if problems:
            raise TasteError("cannot save an invalid document:\n" + _report(problems))
        self.manifest["modified"] = now()
        self.manifest["generator"] = GENERATOR
        refs = self.referenced_blobs()
        sources: dict[str, BlobSource] = {}
        for ref in refs:
            if ref in self._pending:
                sources[ref] = self._pending[ref]
            else:
                assert self._reader is not None
                sources[ref] = self._reader
        write_container(target, self.manifest, sources, self._media_types())
        if self._reader is not None:
            self._reader.close()
        self._reader = ContainerReader(target)
        self._pending.clear()
        return target

    def unpack(self, folder: str | Path) -> Path:
        """Write ``taste.json`` and the referenced blobs as plain files, for editing by hand."""

        folder = Path(folder)
        blob_dir = folder / "blobs" / "sha256"
        blob_dir.mkdir(parents=True, exist_ok=True)
        text = json.dumps(self.manifest, indent=2, ensure_ascii=False) + "\n"
        (folder / "taste.json").write_text(text, encoding="utf-8")
        for ref in sorted(self.referenced_blobs()):
            with (
                self.open_blob(ref) as source,
                (blob_dir / ref.removeprefix("sha256:")).open("wb") as target,
            ):
                while chunk := source.read(1024 * 1024):
                    target.write(chunk)
        return folder

    def close(self) -> None:
        if self._reader is not None:
            self._reader.close()
            self._reader = None

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # Reading

    @property
    def title(self) -> str:
        return self.manifest.get("title", "")

    @property
    def collections(self) -> list[dict[str, Any]]:
        return self.manifest.setdefault("collections", [])

    @property
    def items(self) -> dict[str, dict[str, Any]]:
        return self.manifest.setdefault("items", {})

    def collection(self, collection_id: str) -> dict[str, Any]:
        for collection in self.collections:
            if collection.get("id") == collection_id:
                return collection
        raise TasteError(f"no collection with id {collection_id!r}")

    def item(self, item_id: str) -> dict[str, Any]:
        try:
            return self.items[item_id]
        except KeyError as error:
            raise TasteError(f"no item with id {item_id!r}") from error

    def file(self, item_id: str, file_id: str) -> dict[str, Any]:
        for entry in self.item(item_id).get("files", []):
            if entry.get("id") == file_id:
                return entry
        raise TasteError(f"item {item_id!r} has no file {file_id!r}")

    def unsorted(self) -> list[str]:
        """Ids of items that are not in any collection."""

        placed = {entry.get("item") for c in self.collections for entry in c.get("entries", [])}
        return [item_id for item_id in self.items if item_id not in placed]

    def collections_of(self, item_id: str) -> list[str]:
        return [
            collection["id"]
            for collection in self.collections
            if any(entry.get("item") == item_id for entry in collection.get("entries", []))
        ]

    def find(
        self,
        *,
        kind: str | None = None,
        collection: str | None = None,
        tags: Mapping[str, Any] | None = None,
        text: str | None = None,
    ) -> list[str]:
        """Ids of items matching every given condition.

        ``kind`` also matches sub-kinds (``music`` finds ``music.track``). A tag condition matches
        an equal value or a list containing it, compared case-insensitively as text. ``text``
        searches titles, summaries, collection notes, and file captions.
        """

        candidates: list[str]
        if collection is not None:
            candidates = [e.get("item") for e in self.collection(collection).get("entries", [])]
        else:
            candidates = list(self.items)
        needle = text.casefold() if text else None
        notes = self._notes()
        found = []
        for item_id in candidates:
            item = self.items.get(item_id)
            if item is None:
                continue
            item_kind = item.get("kind", "")
            if kind and item_kind != kind and not item_kind.startswith(kind + "."):
                continue
            if tags and not all(
                _tag_matches(item.get("tags", {}).get(key), value) for key, value in tags.items()
            ):
                continue
            if needle and needle not in _searchable(item, notes.get(item_id, [])):
                continue
            found.append(item_id)
        return found

    def find_files(
        self,
        *,
        role: str | None = None,
        tags: Mapping[str, Any] | None = None,
        text: str | None = None,
    ) -> list[tuple[str, str]]:
        """``(item id, file id)`` pairs for files matching every given condition."""

        needle = text.casefold() if text else None
        found = []
        for item_id, item in self.items.items():
            for entry in item.get("files", []):
                if role and entry.get("role") != role:
                    continue
                if tags and not all(
                    _tag_matches(entry.get("tags", {}).get(key), value)
                    for key, value in tags.items()
                ):
                    continue
                haystack = " ".join(str(entry.get(key, "")) for key in ("caption", "name"))
                if needle and needle not in haystack.casefold():
                    continue
                found.append((item_id, entry["id"]))
        return found

    def referenced_blobs(self) -> set[str]:
        refs = set()
        for file_entry in self._file_entries():
            for key in ("blob", "thumb"):
                if isinstance(file_entry.get(key), str):
                    refs.add(file_entry[key])
        return refs

    def has_blob(self, ref: str) -> bool:
        return ref in self._pending or (self._reader is not None and self._reader.has_blob(ref))

    def open_blob(self, ref: str) -> IO[bytes]:
        source = self._pending.get(ref)
        if isinstance(source, bytes):
            return io.BytesIO(source)
        if isinstance(source, Path):
            return source.open("rb")
        if self._reader is None:
            raise TasteError(f"blob not in file: {ref}")
        return self._reader.open_blob(ref)

    def read_blob(self, ref: str) -> bytes:
        with self.open_blob(ref) as handle:
            return handle.read()

    def validate(self, *, deep: bool = False) -> list[Problem]:
        """Problems with the manifest, missing blobs, and (with ``deep``) corrupted blobs."""

        available = self._available()
        issues: list[ContainerIssue] = []
        if self._reader is not None:
            issues = list(self._reader.issues)
            if deep:
                issues += self._reader.verify_blobs(self.referenced_blobs() - set(self._pending))
        problems = validate_manifest(self.manifest, available)
        if deep:
            for ref, source in self._pending.items():
                if isinstance(source, Path) and hash_file(source) != ref:
                    issues.append(ContainerIssue(str(source), "content does not match its hash"))
        return [Problem(f"[{issue.entry}]", issue.message) for issue in issues] + problems

    # Changing collections

    def add_collection(
        self,
        name: str,
        *,
        id: str | None = None,
        vibe: str | None = None,
        description: str | None = None,
        tags: Mapping[str, Any] | None = None,
        icon: str | None = None,
    ) -> dict[str, Any]:
        collection_id = self._new_id(id, name, {c.get("id") for c in self.collections})
        collection: dict[str, Any] = {"id": collection_id, "name": name}
        _put(collection, vibe=vibe, description=description, icon=icon)
        if tags:
            collection["tags"] = dict(tags)
        collection["created"] = now()
        collection["entries"] = []
        self.collections.append(collection)
        return collection

    def remove_collection(self, collection_id: str, *, prune: bool = False) -> list[str]:
        """Remove a collection. With ``prune``, also remove items left in no collection.

        Returns the ids of removed items.
        """

        collection = self.collection(collection_id)
        self.collections.remove(collection)
        if not prune:
            return []
        orphans = set(self.unsorted())
        removed = []
        for entry in collection.get("entries", []):
            item_id = entry.get("item")
            if item_id in orphans and not self._children(item_id):
                self.remove_item(item_id)
                removed.append(item_id)
        return removed

    def set_cover(
        self,
        collection_id: str,
        source: bytes | str | Path,
        *,
        type: str | None = None,
        caption: str | None = None,
    ) -> dict[str, Any]:
        collection = self.collection(collection_id)
        cover = self._file_from(source, role="cover", file_id="cover", media_type=type)
        _put(cover, caption=caption)
        collection["cover"] = cover
        return cover

    # Changing items

    def add_item(
        self,
        kind: str,
        title: str,
        *,
        id: str | None = None,
        by: str | Mapping[str, str] | None = None,
        **fields: Any,
    ) -> str:
        """Add an item and return its id. ``fields`` are any other item fields (``year``,
        ``ids``, ``meta``, ``tags``, ``availability``…)."""

        seed = f"{title} {fields['year']}" if "year" in fields else title
        item_id = self._new_id(id, seed, set(self.items), fallback=kind.replace(".", "-"))
        item: dict[str, Any] = {"kind": kind, "title": title}
        item.update({key: value for key, value in fields.items() if value is not None})
        item.setdefault("added", now())
        item.setdefault("added_by", actor(by))
        self.items[item_id] = item
        return item_id

    def remove_item(self, item_id: str) -> None:
        """Remove an item and its place in every collection."""

        self.item(item_id)
        children = self._children(item_id)
        if children:
            raise TasteError(
                f"item {item_id!r} is the parent of {', '.join(children)}; remove those first"
            )
        del self.items[item_id]
        for collection in self.collections:
            collection["entries"] = [
                e for e in collection.get("entries", []) if e.get("item") != item_id
            ]

    def add_entry(
        self,
        collection_id: str,
        item_id: str,
        *,
        note: str | None = None,
        show: list[str] | None = None,
        reason: str | None = None,
        by: str | Mapping[str, str] | None = None,
        position: int | None = None,
    ) -> dict[str, Any]:
        """Put an item in a collection, at the end unless ``position`` is given."""

        collection = self.collection(collection_id)
        self.item(item_id)
        entries = collection.setdefault("entries", [])
        if any(entry.get("item") == item_id for entry in entries):
            raise TasteError(f"item {item_id!r} is already in collection {collection_id!r}")
        for file_id in show or []:
            self.file(item_id, file_id)
        entry: dict[str, Any] = {"item": item_id}
        _put(entry, note=note, reason=reason)
        if show:
            entry["show"] = list(show)
        entry["added"] = now()
        entry["added_by"] = actor(by)
        entries.insert(len(entries) if position is None else position, entry)
        return entry

    def remove_entry(self, collection_id: str, item_id: str) -> None:
        collection = self.collection(collection_id)
        entries = collection.get("entries", [])
        kept = [entry for entry in entries if entry.get("item") != item_id]
        if len(kept) == len(entries):
            raise TasteError(f"item {item_id!r} is not in collection {collection_id!r}")
        collection["entries"] = kept

    def move_entry(self, collection_id: str, item_id: str, position: int) -> None:
        collection = self.collection(collection_id)
        entries = collection.get("entries", [])
        for index, entry in enumerate(entries):
            if entry.get("item") == item_id:
                entries.insert(position, entries.pop(index))
                return
        raise TasteError(f"item {item_id!r} is not in collection {collection_id!r}")

    def attach(
        self,
        item_id: str,
        source: bytes | str | Path | None = None,
        *,
        role: str,
        url: str | None = None,
        type: str | None = None,
        name: str | None = None,
        id: str | None = None,
        caption: str | None = None,
        at: Mapping[str, Any] | None = None,
        tags: Mapping[str, Any] | None = None,
        by: str | Mapping[str, str] | None = None,
    ) -> dict[str, Any]:
        """Add a file to an item, either stored in the document (``source``) or by ``url``.

        Images larger than 512 pixels get a thumbnail when Pillow is installed.
        """

        item = self.item(item_id)
        files = item.setdefault("files", [])
        file_id = self._new_id(id, role, {f.get("id") for f in files}, numbered=False)
        if (source is None) == (url is None):
            raise TasteError("attach needs exactly one of a source or a url")
        if url is not None:
            if type is None:
                type = guess_type(b"", url.split("?", 1)[0])
            entry: dict[str, Any] = {"id": file_id, "role": role, "url": url, "type": type}
        else:
            entry = self._file_from(source, role=role, file_id=file_id, media_type=type)
        _put(entry, name=name, caption=caption)
        if at:
            entry["at"] = dict(at)
        if tags:
            entry["tags"] = dict(tags)
        entry["added"] = now()
        entry["added_by"] = actor(by)
        files.append(entry)
        return entry

    def detach(self, item_id: str, file_id: str) -> None:
        """Remove a file from an item and from every collection's ``show`` list."""

        item = self.item(item_id)
        entry = self.file(item_id, file_id)
        item["files"].remove(entry)
        for collection in self.collections:
            for placed in collection.get("entries", []):
                if placed.get("item") == item_id and file_id in placed.get("show", []):
                    placed["show"] = [f for f in placed["show"] if f != file_id]
                    if not placed["show"]:
                        del placed["show"]

    def tag(
        self,
        target: dict[str, Any],
        values: Mapping[str, Any] | None = None,
        remove: list[str] | None = None,
    ) -> dict[str, Any]:
        """Set and remove tags on an item, file, or collection object; returns its tags."""

        tags = target.setdefault("tags", {})
        tags.update(values or {})
        for key in remove or []:
            tags.pop(key, None)
        if not tags:
            del target["tags"]
        return tags

    # Internals

    def _file_from(
        self,
        source: bytes | str | Path,
        *,
        role: str,
        file_id: str,
        media_type: str | None,
    ) -> dict[str, Any]:
        if isinstance(source, bytes):
            data: bytes | None = source
            ref = hash_bytes(source)
            size = len(source)
            name = None
            self._pending.setdefault(ref, source)
        else:
            path = Path(source)
            if not path.is_file():
                raise TasteError(f"no such file: {path}")
            ref = hash_file(path)
            size = path.stat().st_size
            name = path.name
            data = None
            if not self.has_blob(ref):
                self._pending[ref] = path
        with self.open_blob(ref) as handle:
            head = handle.read(64)
        media_type = media_type or guess_type(head, name)
        entry: dict[str, Any] = {
            "id": file_id,
            "role": role,
            "blob": ref,
            "type": media_type,
            "size": size,
        }
        if name:
            entry["name"] = name
        if media_type.startswith("image/"):
            info = inspect_image(data if data is not None else self.read_blob(ref), media_type)
            if info is not None:
                entry["width"], entry["height"] = info.width, info.height
                if info.thumb is not None:
                    thumb = hash_bytes(info.thumb)
                    self._pending.setdefault(thumb, info.thumb)
                    entry["thumb"] = thumb
        return entry

    def _available(self) -> set[str]:
        available = set(self._pending)
        if self._reader is not None:
            available |= self._reader.blob_refs()
        return available

    def _file_entries(self) -> Iterator[dict[str, Any]]:
        for item in self.items.values():
            if isinstance(item, dict):
                yield from (f for f in item.get("files", []) if isinstance(f, dict))
        for collection in self.collections:
            if isinstance(collection, dict) and isinstance(collection.get("cover"), dict):
                yield collection["cover"]

    def _media_types(self) -> dict[str, str]:
        types: dict[str, str] = {}
        for file_entry in self._file_entries():
            if isinstance(file_entry.get("blob"), str):
                types.setdefault(file_entry["blob"], str(file_entry.get("type", "")))
        return types

    def _children(self, item_id: str) -> list[str]:
        return [child for child, item in self.items.items() if item.get("parent") == item_id]

    def _notes(self) -> dict[str, list[str]]:
        notes: dict[str, list[str]] = {}
        for collection in self.collections:
            for entry in collection.get("entries", []):
                text = " ".join(entry.get(key, "") for key in ("note", "reason"))
                notes.setdefault(entry.get("item"), []).append(text)
        return notes

    @staticmethod
    def _new_id(
        wanted: str | None,
        seed: str,
        taken: set[Any],
        *,
        fallback: str = "x",
        numbered: bool = True,
    ) -> str:
        if wanted is not None:
            if not ID.match(wanted):
                raise TasteError(f"invalid id {wanted!r}: use letters, digits, '.', '_' or '-'")
            if wanted in taken:
                raise TasteError(f"id {wanted!r} is already used")
            return wanted
        base = slugify(seed) or fallback
        if base not in taken and (not numbered or base != fallback):
            return base
        number = 2 if base != fallback else 1
        while f"{base}-{number}" in taken:
            number += 1
        return f"{base}-{number}"


def slugify(text: str, limit: int = 60) -> str:
    """A readable ASCII id: ``"Amélie (2001)"`` becomes ``"amelie-2001"``."""

    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
    return slug[:limit].rstrip("-")


def _put(target: dict[str, Any], **values: Any) -> None:
    for key, value in values.items():
        if value is not None:
            target[key] = value


def _tag_matches(actual: Any, wanted: Any) -> bool:
    if actual is None:
        return False
    if isinstance(wanted, list | tuple):
        return all(_tag_matches(actual, part) for part in wanted)
    expected = _tag_text(wanted)
    if isinstance(actual, list):
        return any(_tag_text(part) == expected for part in actual)
    return _tag_text(actual) == expected


def _tag_text(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value).casefold()


def _searchable(item: Mapping[str, Any], notes: list[str]) -> str:
    parts = [str(item.get("title", "")), str(item.get("summary", "")), *notes]
    parts += [str(f.get("caption", "")) for f in item.get("files", []) if isinstance(f, dict)]
    return " ".join(parts).casefold()


def _report(problems: list[Problem]) -> str:
    return "\n".join(f"  {problem}" for problem in problems)
