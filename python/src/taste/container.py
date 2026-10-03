"""The ZIP container: reading entries lazily and writing whole files atomically."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import zipfile
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import IO, Any

MIMETYPE = "application/vnd.ruverse.taste+zip"
MANIFEST = "taste.json"
BLOB_PREFIX = "blobs/sha256/"
ZIP_EPOCH = (1980, 1, 1, 0, 0, 0)

BLOB_REF = re.compile(r"^sha256:([0-9a-f]{64})$")
_COMPRESSIBLE = re.compile(
    r"^(text/.*|application/(json|xml|javascript|x-subrip|.*\+json|.*\+xml)|image/svg\+xml)$"
)
_CHUNK = 1024 * 1024


class TasteError(Exception):
    """A .taste file could not be read, changed, or written."""


def blob_ref(digest: str) -> str:
    return f"sha256:{digest}"


def blob_entry(ref: str) -> str:
    match = BLOB_REF.match(ref)
    if match is None:
        raise TasteError(f"invalid blob reference: {ref!r}")
    return BLOB_PREFIX + match.group(1)


def _entry_ref(name: str) -> str | None:
    if not name.startswith(BLOB_PREFIX):
        return None
    ref = blob_ref(name.removeprefix(BLOB_PREFIX))
    return ref if BLOB_REF.match(ref) else None


def hash_bytes(data: bytes) -> str:
    return blob_ref(hashlib.sha256(data).hexdigest())


def hash_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK):
            digest.update(chunk)
    return blob_ref(digest.hexdigest())


@dataclass(frozen=True, slots=True)
class ContainerIssue:
    entry: str
    message: str


class ContainerReader:
    """An open .taste file. Blobs are read from the archive only when asked for."""

    def __init__(self, path: Path) -> None:
        self.path = path
        try:
            self._zip = zipfile.ZipFile(path)
        except (OSError, zipfile.BadZipFile) as error:
            raise TasteError(f"{path}: not a .taste file ({error})") from error
        try:
            self.issues = self._check()
            self.manifest = self._read_manifest()
        except BaseException:
            self._zip.close()
            raise
        self._blobs: dict[str, zipfile.ZipInfo] = {}
        for info in self._zip.infolist():
            ref = _entry_ref(info.filename)
            if ref is not None:
                self._blobs[ref] = info

    def _check(self) -> list[ContainerIssue]:
        infos = self._zip.infolist()
        if not infos or infos[0].filename != "mimetype":
            raise TasteError(f"{self.path}: not a .taste file (no leading mimetype entry)")
        if self._zip.read(infos[0]) != MIMETYPE.encode("ascii"):
            raise TasteError(f"{self.path}: not a .taste file (wrong mimetype)")
        issues = []
        if infos[0].compress_type != zipfile.ZIP_STORED:
            issues.append(ContainerIssue("mimetype", "must be stored without compression"))
        seen: set[str] = set()
        for info in infos:
            if info.filename in seen:
                issues.append(ContainerIssue(info.filename, "entry name appears more than once"))
            seen.add(info.filename)
            if info.filename.startswith(BLOB_PREFIX) and _entry_ref(info.filename) is None:
                issues.append(ContainerIssue(info.filename, "blob name is not a SHA-256 digest"))
        return issues

    def _read_manifest(self) -> dict[str, Any]:
        try:
            raw = self._zip.read(MANIFEST)
        except KeyError as error:
            raise TasteError(f"{self.path}: missing {MANIFEST}") from error
        try:
            manifest = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise TasteError(f"{self.path}: {MANIFEST} is not valid JSON ({error})") from error
        if not isinstance(manifest, dict):
            raise TasteError(f"{self.path}: {MANIFEST} must be a JSON object")
        return manifest

    def has_blob(self, ref: str) -> bool:
        return ref in self._blobs

    def blob_refs(self) -> set[str]:
        return set(self._blobs)

    def blob_size(self, ref: str) -> int:
        return self._blobs[ref].file_size

    def open_blob(self, ref: str) -> IO[bytes]:
        try:
            return self._zip.open(self._blobs[ref])
        except KeyError as error:
            raise TasteError(f"blob not in file: {ref}") from error

    def verify_blobs(self, refs: Iterable[str] | None = None) -> list[ContainerIssue]:
        """Re-hash blobs and report any whose content does not match its name."""

        issues = []
        for ref in sorted(self._blobs if refs is None else refs):
            if ref not in self._blobs:
                continue
            digest = hashlib.sha256()
            with self.open_blob(ref) as handle:
                while chunk := handle.read(_CHUNK):
                    digest.update(chunk)
            if blob_ref(digest.hexdigest()) != ref:
                issues.append(ContainerIssue(blob_entry(ref), "content does not match its hash"))
        return issues

    def close(self) -> None:
        self._zip.close()


BlobSource = bytes | Path | ContainerReader


def write_container(
    path: Path,
    manifest: Mapping[str, Any],
    blobs: Mapping[str, BlobSource],
    media_types: Mapping[str, str],
) -> None:
    """Write a complete .taste file to ``path`` without ever leaving it half-written.

    ``blobs`` maps each blob reference to its bytes, a file on disk, or the reader it can be
    copied from. ``media_types`` decides which blobs are worth compressing.
    """

    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    temp = Path(name)
    try:
        with (
            open(descriptor, "w+b") as handle,
            zipfile.ZipFile(handle, "w", allowZip64=True) as archive,
        ):
            archive.writestr(_entry("mimetype", zipfile.ZIP_STORED), MIMETYPE)
            text = json.dumps(manifest, indent=2, ensure_ascii=False) + "\n"
            archive.writestr(_entry(MANIFEST, zipfile.ZIP_DEFLATED), text.encode("utf-8"))
            for ref in sorted(blobs):
                kind = media_types.get(ref, "")
                method = zipfile.ZIP_DEFLATED if _COMPRESSIBLE.match(kind) else zipfile.ZIP_STORED
                _write_blob(archive, _entry(blob_entry(ref), method), ref, blobs[ref])
            archive.close()
            handle.flush()
            os.chmod(handle.fileno(), _file_mode(path))
            os.fsync(handle.fileno())
        os.replace(temp, path)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise
    _fsync_directory(path.parent)


def _entry(name: str, method: int) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, date_time=ZIP_EPOCH)
    info.compress_type = method
    info.external_attr = 0o644 << 16
    return info


def _write_blob(
    archive: zipfile.ZipFile, info: zipfile.ZipInfo, ref: str, source: BlobSource
) -> None:
    if isinstance(source, bytes):
        archive.writestr(info, source)
        return
    if isinstance(source, Path):
        info.file_size = source.stat().st_size
        reader: IO[bytes] = source.open("rb")
    else:
        info.file_size = source.blob_size(ref)
        reader = source.open_blob(ref)
    with reader, archive.open(info, "w", force_zip64=info.file_size > 0x7FFFFFFF) as writer:
        shutil.copyfileobj(reader, writer, _CHUNK)


def _file_mode(path: Path) -> int:
    """Keep an existing file's permissions; give a new file the usual umask-based ones."""

    try:
        return path.stat().st_mode & 0o7777
    except FileNotFoundError:
        umask = os.umask(0)
        os.umask(umask)
        return 0o666 & ~umask


def _fsync_directory(directory: Path) -> None:
    try:
        descriptor = os.open(directory, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    except OSError:
        pass
    finally:
        os.close(descriptor)
