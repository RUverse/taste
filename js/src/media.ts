/** Media types: detecting them from a file's first bytes or name, and which ones to compress. */

const SIGNATURES: [number[], string][] = [
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png"],
  [[0xff, 0xd8, 0xff], "image/jpeg"],
  [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], "image/gif"],
  [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], "image/gif"],
  [[0x25, 0x50, 0x44, 0x46, 0x2d], "application/pdf"],
  [[0x66, 0x4c, 0x61, 0x43], "audio/flac"],
  [[0x4f, 0x67, 0x67, 0x53], "audio/ogg"],
  [[0x49, 0x44, 0x33], "audio/mpeg"],
];

const EXTENSIONS: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".txt": "text/plain",
  ".html": "text/html",
  ".json": "application/json",
  ".srt": "application/x-subrip",
  ".vtt": "text/vtt",
  ".lrc": "text/plain",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
};

const COMPRESSIBLE =
  /^(text\/.*|application\/(json|xml|javascript|x-subrip|.*\+json|.*\+xml)|image\/svg\+xml)$/;

/** Media type from the first bytes of a file (64 are enough), falling back to its name. */
export function guessType(head: Uint8Array, name?: string): string {
  for (const [signature, type] of SIGNATURES) {
    if (signature.every((byte, index) => head[index] === byte)) return type;
  }
  const ascii = (start: number, end: number) => String.fromCharCode(...head.subarray(start, end));
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (brand === "heic" || brand === "heix" || brand === "mif1") return "image/heic";
    if (brand.startsWith("M4A")) return "audio/mp4";
    return "video/mp4";
  }
  if (name?.includes(".")) {
    const known = EXTENSIONS[name.slice(name.lastIndexOf(".")).toLowerCase()];
    if (known) return known;
  }
  return "application/octet-stream";
}

/** A file name extension for a media type, such as `.jpg`, or `""` when none is known. */
export function extensionFor(type: string): string {
  for (const [extension, known] of Object.entries(EXTENSIONS)) {
    if (known === type) return extension;
  }
  return "";
}

/** Whether a blob of this type is worth deflating. Media that is already compressed is not. */
export function isCompressible(type: string): boolean {
  return COMPRESSIBLE.test(type);
}
