"""Media type detection and, when Pillow is installed, image sizes and thumbnails."""

from __future__ import annotations

import io
import mimetypes
from dataclasses import dataclass

THUMB_EDGE = 512

_SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\x89PNG\r\n\x1a\n", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"GIF87a", "image/gif"),
    (b"GIF89a", "image/gif"),
    (b"%PDF-", "application/pdf"),
    (b"fLaC", "audio/flac"),
    (b"OggS", "audio/ogg"),
    (b"ID3", "audio/mpeg"),
)
_EXTRA_TYPES = {
    ".md": "text/markdown",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".heic": "image/heic",
    ".srt": "application/x-subrip",
    ".vtt": "text/vtt",
    ".lrc": "text/plain",
    ".mkv": "video/x-matroska",
    ".flac": "audio/flac",
    ".opus": "audio/opus",
}


def guess_type(head: bytes, name: str | None = None) -> str:
    """Media type from the file's first bytes, falling back to its name."""

    for signature, media_type in _SIGNATURES:
        if head.startswith(signature):
            return media_type
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in (b"avif", b"avis"):
            return "image/avif"
        if brand in (b"heic", b"heix", b"mif1"):
            return "image/heic"
        if brand.startswith(b"M4A"):
            return "audio/mp4"
        return "video/mp4"
    if name:
        suffix = name[name.rfind(".") :].lower() if "." in name else ""
        if suffix in _EXTRA_TYPES:
            return _EXTRA_TYPES[suffix]
        guessed, _ = mimetypes.guess_type(name, strict=False)
        if guessed:
            return guessed
    return "application/octet-stream"


def extension(media_type: str) -> str:
    for suffix, known in _EXTRA_TYPES.items():
        if known == media_type:
            return suffix
    return mimetypes.guess_extension(media_type, strict=False) or ".bin"


@dataclass(frozen=True, slots=True)
class ImageInfo:
    width: int
    height: int
    thumb: bytes | None


def inspect_image(data: bytes, media_type: str) -> ImageInfo | None:
    """Size of an image and a small WebP or JPEG preview when it is larger than ``THUMB_EDGE``.

    Returns ``None`` when Pillow is not installed or cannot read the image.
    """

    if not media_type.startswith("image/") or media_type == "image/svg+xml":
        return None
    try:
        from PIL import Image, ImageOps, features
    except ImportError:
        return None
    try:
        with Image.open(io.BytesIO(data)) as image:
            image = ImageOps.exif_transpose(image)
            width, height = image.size
            if max(width, height) <= THUMB_EDGE:
                return ImageInfo(width, height, None)
            image.thumbnail((THUMB_EDGE, THUMB_EDGE))
            output = io.BytesIO()
            if features.check("webp"):
                image.save(output, "WEBP", quality=80, method=4)
            else:
                image.convert("RGB").save(output, "JPEG", quality=82, optimize=True)
            return ImageInfo(width, height, output.getvalue())
    except Exception:
        return None
