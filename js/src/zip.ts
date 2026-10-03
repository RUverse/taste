/**
 * A small ZIP reader over a Blob. It reads the central directory once and then reads each entry
 * only when asked, so opening a large file costs a few small reads. Stored (uncompressed)
 * entries are returned as slices of the original Blob without copying.
 */

import { inflateSync } from "fflate";

export const STORED = 0;
export const DEFLATED = 8;

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  crc32: number;
  /** Offset of the entry's local header. */
  offset: number;
  /** Central directory extra field length, used to check the spec's "no extra field" rule. */
  extraLength: number;
}

export class ZipError extends Error {
  override name = "ZipError";
}

const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const MAX_COMMENT = 0xffff;

const utf8 = new TextDecoder("utf-8");

export class ZipReader {
  /** Entries in archive order, including duplicate names. */
  readonly entries: readonly ZipEntry[];
  private readonly byName = new Map<string, ZipEntry>();
  private readonly dataStarts = new Map<ZipEntry, number>();

  private constructor(
    readonly source: Blob,
    entries: ZipEntry[],
  ) {
    this.entries = entries;
    // The last entry with a name wins, as in most readers; duplicates are reported separately.
    for (const entry of entries) this.byName.set(entry.name, entry);
  }

  static async open(source: Blob): Promise<ZipReader> {
    const size = source.size;
    if (size < 22) throw new ZipError("file is too small to be a ZIP archive");
    const tailStart = Math.max(0, size - 22 - MAX_COMMENT);
    const tail = await view(source, tailStart, size);
    let at = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === EOCD) {
        at = i;
        break;
      }
    }
    if (at < 0) throw new ZipError("no ZIP end-of-directory record");

    let count = tail.getUint16(at + 10, true);
    let directorySize = tail.getUint32(at + 12, true);
    let directoryOffset = tail.getUint32(at + 16, true);
    const needs64 =
      count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff;
    if (needs64) {
      const locatorAt = tailStart + at - 20;
      if (locatorAt < 0) throw new ZipError("missing ZIP64 locator");
      const locator = await view(source, locatorAt, locatorAt + 20);
      if (locator.getUint32(0, true) !== EOCD64_LOCATOR) throw new ZipError("bad ZIP64 locator");
      const recordAt = number64(locator, 8);
      const record = await view(source, recordAt, recordAt + 56);
      if (record.getUint32(0, true) !== EOCD64) throw new ZipError("bad ZIP64 directory record");
      count = number64(record, 32);
      directorySize = number64(record, 40);
      directoryOffset = number64(record, 48);
    }
    if (directoryOffset + directorySize > size) throw new ZipError("truncated ZIP directory");

    const directory = await view(source, directoryOffset, directoryOffset + directorySize);
    const entries: ZipEntry[] = [];
    let p = 0;
    for (let index = 0; index < count; index++) {
      if (p + 46 > directory.byteLength || directory.getUint32(p, true) !== CENTRAL) {
        throw new ZipError("corrupt ZIP directory");
      }
      const flags = directory.getUint16(p + 8, true);
      if (flags & 1) throw new ZipError("encrypted ZIP entries are not supported");
      const nameLength = directory.getUint16(p + 28, true);
      const extraLength = directory.getUint16(p + 30, true);
      const commentLength = directory.getUint16(p + 32, true);
      const nameBytes = new Uint8Array(
        directory.buffer,
        directory.byteOffset + p + 46,
        nameLength,
      );
      const entry: ZipEntry = {
        name: utf8.decode(nameBytes),
        method: directory.getUint16(p + 10, true),
        compressedSize: directory.getUint32(p + 20, true),
        size: directory.getUint32(p + 24, true),
        crc32: directory.getUint32(p + 16, true),
        offset: directory.getUint32(p + 42, true),
        extraLength,
      };
      readZip64Extra(directory, p + 46 + nameLength, extraLength, entry);
      entries.push(entry);
      p += 46 + nameLength + extraLength + commentLength;
    }
    return new ZipReader(source, entries);
  }

  get(name: string): ZipEntry | undefined {
    return this.byName.get(name);
  }

  /** The entry's contents as a Blob; stored entries are slices of the source, not copies. */
  async blob(entry: ZipEntry, type = ""): Promise<Blob> {
    const start = await this.dataStart(entry);
    const end = start + entry.compressedSize;
    if (entry.method === STORED) return this.source.slice(start, end, type);
    return new Blob([await this.bytes(entry)], { type });
  }

  /** The entry's data exactly as stored, still compressed if it is, for copying it unchanged. */
  async raw(entry: ZipEntry): Promise<Blob> {
    const start = await this.dataStart(entry);
    return this.source.slice(start, start + entry.compressedSize);
  }

  async bytes(entry: ZipEntry): Promise<Uint8Array<ArrayBuffer>> {
    const start = await this.dataStart(entry);
    const raw = new Uint8Array(
      await this.source.slice(start, start + entry.compressedSize).arrayBuffer(),
    );
    if (entry.method === STORED) return raw;
    if (entry.method === DEFLATED) {
      const output = inflateSync(raw, { out: new Uint8Array(entry.size) });
      return new Uint8Array(output);
    }
    throw new ZipError(`${entry.name}: unsupported compression method ${entry.method}`);
  }

  async text(entry: ZipEntry): Promise<string> {
    return utf8.decode(await this.bytes(entry));
  }

  private async dataStart(entry: ZipEntry): Promise<number> {
    const known = this.dataStarts.get(entry);
    if (known !== undefined) return known;
    const header = await view(this.source, entry.offset, entry.offset + 30);
    if (header.byteLength < 30 || header.getUint32(0, true) !== LOCAL) {
      throw new ZipError(`${entry.name}: bad local header`);
    }
    const start =
      entry.offset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
    if (start + entry.compressedSize > this.source.size) {
      throw new ZipError(`${entry.name}: entry runs past the end of the file`);
    }
    this.dataStarts.set(entry, start);
    return start;
  }
}

async function view(source: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await source.slice(start, end).arrayBuffer());
}

function number64(data: DataView, at: number): number {
  const value = data.getBigUint64(at, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError("ZIP offset too large");
  return Number(value);
}

function readZip64Extra(data: DataView, at: number, length: number, entry: ZipEntry): void {
  const end = at + length;
  while (at + 4 <= end) {
    const id = data.getUint16(at, true);
    const size = data.getUint16(at + 2, true);
    if (id === 0x0001) {
      let p = at + 4;
      if (entry.size === 0xffffffff) {
        entry.size = number64(data, p);
        p += 8;
      }
      if (entry.compressedSize === 0xffffffff) {
        entry.compressedSize = number64(data, p);
        p += 8;
      }
      if (entry.offset === 0xffffffff) entry.offset = number64(data, p);
      return;
    }
    at += 4 + size;
  }
}
