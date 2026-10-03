/** Opening .taste files: container checks, the manifest, and blobs read on demand. */

import type { Manifest, TasteFileEntry } from "./types.ts";
import { BLOB_REF, VERSION, validateManifest, type Problem } from "./validate.ts";
import { STORED, ZipError, ZipReader, type ZipEntry } from "./zip.ts";

export const MIMETYPE = "application/vnd.ruverse.taste+zip";
export const MANIFEST = "taste.json";
export const BLOB_PREFIX = "blobs/sha256/";

export class TasteError extends Error {
  override name = "TasteError";
}

export interface RawBlob {
  /** The stored bytes: compressed when `method` is not `STORED`. */
  data: Blob;
  method: number;
  /** Uncompressed size. */
  size: number;
  crc32: number;
}

export interface OpenOptions {
  /** Open files whose format version this reader does not know. */
  anyVersion?: boolean;
}

/** An open .taste file. Nothing but the manifest is read until a blob is asked for. */
export class TasteFile {
  /** Problems with the container itself, such as a compressed mimetype entry. */
  readonly containerIssues: Problem[];
  private readonly blobEntries = new Map<string, ZipEntry>();
  private readonly urls = new Map<string, string>();

  private constructor(
    private readonly zip: ZipReader,
    readonly manifest: Manifest,
    containerIssues: Problem[],
  ) {
    this.containerIssues = containerIssues;
    for (const entry of zip.entries) {
      const ref = entryRef(entry.name);
      if (ref) this.blobEntries.set(ref, entry);
    }
  }

  static async open(source: Blob, options: OpenOptions = {}): Promise<TasteFile> {
    let zip: ZipReader;
    try {
      zip = await ZipReader.open(source);
    } catch (error) {
      throw new TasteError(`not a .taste file (${(error as Error).message})`);
    }
    const first = zip.entries[0];
    if (!first || first.name !== "mimetype") {
      throw new TasteError("not a .taste file (no leading mimetype entry)");
    }
    if ((await zip.text(first)) !== MIMETYPE) {
      throw new TasteError("not a .taste file (wrong mimetype)");
    }
    const issues: Problem[] = [];
    if (first.method !== STORED) {
      issues.push({ path: "[mimetype]", message: "must be stored without compression" });
    }
    const seen = new Set<string>();
    for (const entry of zip.entries) {
      if (seen.has(entry.name)) {
        issues.push({ path: `[${entry.name}]`, message: "entry name appears more than once" });
      }
      seen.add(entry.name);
      if (entry.name.startsWith(BLOB_PREFIX) && !entryRef(entry.name)) {
        issues.push({ path: `[${entry.name}]`, message: "blob name is not a SHA-256 digest" });
      }
    }

    const manifestEntry = zip.get(MANIFEST);
    if (!manifestEntry) throw new TasteError(`missing ${MANIFEST}`);
    let manifest: unknown;
    try {
      manifest = JSON.parse(await zip.text(manifestEntry));
    } catch (error) {
      if (error instanceof ZipError) throw new TasteError(error.message);
      throw new TasteError(`${MANIFEST} is not valid JSON (${(error as Error).message})`);
    }
    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) {
      throw new TasteError(`${MANIFEST} must be a JSON object`);
    }
    const version = (manifest as { taste?: unknown }).taste;
    if (version !== VERSION && !options.anyVersion) {
      throw new TasteError(
        `format version ${JSON.stringify(version)} is not supported (${VERSION})`,
      );
    }
    return new TasteFile(zip, manifest as Manifest, issues);
  }

  /** Total size of the file in bytes. */
  get size(): number {
    return this.zip.source.size;
  }

  hasBlob(ref: string): boolean {
    return this.blobEntries.has(ref);
  }

  blobSize(ref: string): number | undefined {
    return this.blobEntries.get(ref)?.size;
  }

  async blob(ref: string, type = ""): Promise<Blob> {
    const entry = this.blobEntries.get(ref);
    if (!entry) throw new TasteError(`blob not in file: ${ref}`);
    return this.zip.blob(entry, type);
  }

  /**
   * A blob exactly as it is stored in the archive, still compressed if it is, so a writer can
   * copy it without reading it.
   */
  async rawBlob(ref: string): Promise<RawBlob> {
    const entry = this.blobEntries.get(ref);
    if (!entry) throw new TasteError(`blob not in file: ${ref}`);
    return {
      data: await this.zip.raw(entry),
      method: entry.method,
      size: entry.size,
      crc32: entry.crc32,
    };
  }

  async text(ref: string): Promise<string> {
    const entry = this.blobEntries.get(ref);
    if (!entry) throw new TasteError(`blob not in file: ${ref}`);
    return this.zip.text(entry);
  }

  /**
   * An object URL for a blob, created once and reused. Browsers only: call
   * {@link TasteFile.close} when done to release them.
   */
  async objectUrl(ref: string, type = ""): Promise<string> {
    const known = this.urls.get(ref);
    if (known) return known;
    const url = URL.createObjectURL(await this.blob(ref, type));
    this.urls.set(ref, url);
    return url;
  }

  /** Manifest problems, missing blobs, and container issues. */
  validate(): Problem[] {
    return [...this.containerIssues, ...validateManifest(this.manifest, new Set(this.blobEntries.keys()))];
  }

  /** Re-hash stored blobs (all of them by default) and report any that do not match their name. */
  async verify(refs: Iterable<string> = this.blobEntries.keys()): Promise<Problem[]> {
    const problems: Problem[] = [];
    for (const ref of refs) {
      const entry = this.blobEntries.get(ref);
      if (!entry) continue;
      const digest = await crypto.subtle.digest("SHA-256", await this.zip.bytes(entry));
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (`sha256:${hex}` !== ref) {
        problems.push({ path: `[${entry.name}]`, message: "content does not match its hash" });
      }
    }
    return problems;
  }

  /** Release object URLs created by {@link TasteFile.objectUrl}. */
  close(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
  }
}

function entryRef(name: string): string | undefined {
  if (!name.startsWith(BLOB_PREFIX)) return undefined;
  const ref = `sha256:${name.slice(BLOB_PREFIX.length)}`;
  return BLOB_REF.test(ref) ? ref : undefined;
}

/** True when a file entry is stored in the container, as opposed to kept at a URL. */
export function isStored(file: TasteFileEntry): file is TasteFileEntry & { blob: string } {
  return typeof file.blob === "string";
}
