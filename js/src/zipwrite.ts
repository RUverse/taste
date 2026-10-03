/**
 * Writing ZIP archives as a Blob. Entry data is passed as Blobs, so data copied from an existing
 * archive (a slice of the source file) is never read into memory. ZIP64 records are written only
 * when a size, offset, or entry count needs them.
 */

import { ZipError } from "./zip.ts";

export interface ZipWriteEntry {
  name: string;
  /** `STORED` or `DEFLATED`; `data` must already be compressed with it. */
  method: number;
  data: Blob;
  /** Uncompressed size. */
  size: number;
  /** CRC-32 of the uncompressed data. */
  crc32: number;
}

export interface ZipWriteOptions {
  /** Write ZIP64 fields for values at or above this. Only tests should change it. */
  zip64Above?: number;
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const EOCD = 0x06054b50;
const EOCD64 = 0x06064b50;
const EOCD64_LOCATOR = 0x07064b50;
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
/** 1980-01-01 00:00:00 in MS-DOS format, so the same content gives the same bytes. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
/** Regular file, rw-r--r--, as the Python writer records it. */
const EXTERNAL_ATTR = 0o644 << 16;
const MADE_BY_UNIX = 3 << 8;
const UTF8_NAMES = 0x800;

const utf8 = new TextEncoder();

export function writeZip(entries: ZipWriteEntry[], options: ZipWriteOptions = {}): Blob {
  const limit = options.zip64Above ?? MAX32;
  const parts: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = utf8.encode(entry.name);
    const flags = /^[\x20-\x7e]*$/.test(entry.name) ? 0 : UTF8_NAMES;
    const compressedSize = entry.data.size;
    const bigSize = entry.size >= limit || compressedSize >= limit;
    const bigOffset = offset >= limit;
    const version = bigSize || bigOffset ? 45 : 20;

    // The local header carries both sizes in its ZIP64 field when either one is too large.
    const localExtra = bigSize ? zip64Extra([entry.size, compressedSize]) : new Uint8Array(0);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL, true);
    local.setUint16(4, version, true);
    local.setUint16(6, flags, true);
    local.setUint16(8, entry.method, true);
    local.setUint16(10, DOS_TIME, true);
    local.setUint16(12, DOS_DATE, true);
    local.setUint32(14, entry.crc32 >>> 0, true);
    local.setUint32(18, bigSize ? MAX32 : compressedSize, true);
    local.setUint32(22, bigSize ? MAX32 : entry.size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, localExtra.length, true);
    parts.push(local.buffer, name, localExtra, entry.data);

    const big64: number[] = [];
    if (entry.size >= limit) big64.push(entry.size);
    if (compressedSize >= limit) big64.push(compressedSize);
    if (bigOffset) big64.push(offset);
    const centralExtra = big64.length ? zip64Extra(big64) : new Uint8Array(0);
    const record = new Uint8Array(46 + name.length + centralExtra.length);
    const header = new DataView(record.buffer);
    header.setUint32(0, CENTRAL, true);
    header.setUint16(4, MADE_BY_UNIX | version, true);
    header.setUint16(6, version, true);
    header.setUint16(8, flags, true);
    header.setUint16(10, entry.method, true);
    header.setUint16(12, DOS_TIME, true);
    header.setUint16(14, DOS_DATE, true);
    header.setUint32(16, entry.crc32 >>> 0, true);
    header.setUint32(20, compressedSize >= limit ? MAX32 : compressedSize, true);
    header.setUint32(24, entry.size >= limit ? MAX32 : entry.size, true);
    header.setUint16(28, name.length, true);
    header.setUint16(30, centralExtra.length, true);
    header.setUint32(38, EXTERNAL_ATTR, true);
    header.setUint32(42, bigOffset ? MAX32 : offset, true);
    record.set(name, 46);
    record.set(centralExtra, 46 + name.length);
    central.push(record);

    offset += 30 + name.length + localExtra.length + compressedSize;
  }

  const directoryOffset = offset;
  const directorySize = central.reduce((sum, record) => sum + record.length, 0);
  parts.push(...central);
  const count = entries.length;
  const needs64 =
    count >= Math.min(MAX16, limit) || directorySize >= limit || directoryOffset >= limit;
  if (needs64) {
    const record = new DataView(new ArrayBuffer(56));
    record.setUint32(0, EOCD64, true);
    setUint64(record, 4, 44);
    record.setUint16(12, MADE_BY_UNIX | 45, true);
    record.setUint16(14, 45, true);
    setUint64(record, 24, count);
    setUint64(record, 32, count);
    setUint64(record, 40, directorySize);
    setUint64(record, 48, directoryOffset);
    const locator = new DataView(new ArrayBuffer(20));
    locator.setUint32(0, EOCD64_LOCATOR, true);
    setUint64(locator, 8, directoryOffset + directorySize);
    locator.setUint32(16, 1, true);
    parts.push(record.buffer, locator.buffer);
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, EOCD, true);
  end.setUint16(8, needs64 ? MAX16 : count, true);
  end.setUint16(10, needs64 ? MAX16 : count, true);
  end.setUint32(12, needs64 ? MAX32 : directorySize, true);
  end.setUint32(16, needs64 ? MAX32 : directoryOffset, true);
  parts.push(end.buffer);
  return new Blob(parts);
}

function zip64Extra(values: number[]): Uint8Array<ArrayBuffer> {
  const extra = new DataView(new ArrayBuffer(4 + 8 * values.length));
  extra.setUint16(0, 0x0001, true);
  extra.setUint16(2, 8 * values.length, true);
  values.forEach((value, index) => setUint64(extra, 4 + 8 * index, value));
  return new Uint8Array(extra.buffer);
}

function setUint64(view: DataView, at: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new ZipError(`bad ZIP size ${value}`);
  view.setBigUint64(at, BigInt(value), true);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
