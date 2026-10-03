/**
 * Editing .taste files: `TasteDocument` follows the Python `Taste` class. The manifest is plain
 * JSON data that callers may also change directly; files added since opening are held in memory
 * until {@link TasteDocument.save} builds the new archive.
 */

import { deflateSync } from "fflate";
import { guessType, isCompressible } from "./media.ts";
import { BLOB_PREFIX, MANIFEST, MIMETYPE, TasteError, TasteFile, type OpenOptions } from "./reader.ts";
import type {
  Actor,
  At,
  BlobRef,
  Collection,
  Entry,
  FileFields,
  Item,
  Manifest,
  Tags,
  TasteFileEntry,
} from "./types.ts";
import { ID, VERSION, formatProblem, validateManifest, type Problem } from "./validate.ts";
import { DEFLATED, STORED } from "./zip.ts";
import { crc32, writeZip, type ZipWriteEntry, type ZipWriteOptions } from "./zipwrite.ts";

export const GENERATOR = "@ruverse/taste 0.1.0";

/** `"user"`, `"agent:<name>"`, or an actor object. */
export type ActorInput = "user" | `agent:${string}` | Actor;

/** A file description that is not attached to anything yet; see {@link TasteDocument.fileFrom}. */
export type NewFile = FileFields;

export interface FileOptions {
  role: string;
  /** Detected from the data (or the name) when left out. */
  type?: string;
  name?: string;
  caption?: string;
  at?: At;
  tags?: Tags;
  width?: number;
  height?: number;
  duration?: number;
  /** A small preview image, stored next to the file. */
  thumb?: Blob;
}

export interface SaveOptions extends ZipWriteOptions {
  /** Recorded as the manifest's `generator`. */
  generator?: string;
  /** Recorded as the manifest's `modified` time; the current time by default. */
  now?: string;
}

const utf8 = new TextEncoder();

/** The current time as an RFC 3339 timestamp in whole seconds, such as `2026-10-03T12:00:00Z`. */
export function now(): string {
  return new Date().toISOString().replace(/\.\d+Z$/, "Z");
}

export function actor(value: ActorInput = "user"): Actor {
  if (typeof value === "object") return { ...value };
  if (value === "user") return { type: "user" };
  const name = value.slice("agent:".length);
  if (!value.startsWith("agent:")) throw new TasteError(`actor must be 'user' or 'agent:<name>'`);
  return name ? { type: "agent", name } : { type: "agent" };
}

/** A readable ASCII id: `"Amélie (2001)"` becomes `"amelie-2001"`. */
export function slugify(text: string, limit = 60): string {
  const ascii = text.normalize("NFKD").replace(/[^\x00-\x7f]/g, "");
  const slug = ascii.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, limit).replace(/-+$/, "");
}

/** SHA-256 of some bytes as a blob reference. */
export async function blobRef(data: Uint8Array<ArrayBuffer>): Promise<BlobRef> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

/** An open, editable .taste document. */
export class TasteDocument {
  /** Plain JSON data. Callers may replace it, for example with a reactive copy. */
  manifest: Manifest;
  private readonly pending = new Map<string, Blob>();
  private readonly urls = new Map<string, string>();

  constructor(
    manifest: Manifest,
    /** The file the document was opened from, which holds the blobs not added since. */
    readonly source: TasteFile | null = null,
  ) {
    this.manifest = manifest;
  }

  /** A new, empty document. */
  static create(title = "", description = ""): TasteDocument {
    const stamp = now();
    const manifest = { taste: VERSION } as Manifest;
    put(manifest, { title: title || undefined, description: description || undefined });
    Object.assign(manifest, { created: stamp, modified: stamp, collections: [], items: {} });
    return new TasteDocument(manifest);
  }

  static async open(source: Blob, options: OpenOptions = {}): Promise<TasteDocument> {
    const file = await TasteFile.open(source, options);
    return new TasteDocument(file.manifest, file);
  }

  /** Size of the file the document was opened from, if any. */
  get size(): number | undefined {
    return this.source?.size;
  }

  /** Whether files were added since the document was opened. */
  get hasNewFiles(): boolean {
    return this.pending.size > 0;
  }

  // Blobs

  hasBlob(ref: string): boolean {
    return this.pending.has(ref) || (this.source?.hasBlob(ref) ?? false);
  }

  blobSize(ref: string): number | undefined {
    return this.pending.get(ref)?.size ?? this.source?.blobSize(ref);
  }

  async blob(ref: string, type = ""): Promise<Blob> {
    const added = this.pending.get(ref);
    if (added) return added.slice(0, added.size, type);
    if (!this.source) throw new TasteError(`blob not in file: ${ref}`);
    return this.source.blob(ref, type);
  }

  async text(ref: string): Promise<string> {
    return (await this.blob(ref)).text();
  }

  /** An object URL for a blob, created once and reused until {@link TasteDocument.close}. */
  async objectUrl(ref: string, type = ""): Promise<string> {
    const known = this.urls.get(ref);
    if (known) return known;
    const url = URL.createObjectURL(await this.blob(ref, type));
    this.urls.set(ref, url);
    return url;
  }

  /** Keep some data in the document and return its reference. Nothing refers to it yet. */
  async storeBlob(data: Blob): Promise<BlobRef> {
    const ref = await blobRef(new Uint8Array(await data.arrayBuffer()));
    if (!this.hasBlob(ref)) this.pending.set(ref, data);
    return ref;
  }

  referencedBlobs(): Set<string> {
    const refs = new Set<string>();
    for (const file of this.fileEntries()) {
      for (const key of ["blob", "thumb"] as const) {
        if (typeof file[key] === "string") refs.add(file[key]);
      }
    }
    return refs;
  }

  /** Problems with the manifest, missing blobs, and the file it was opened from. */
  validate(): Problem[] {
    return [
      ...(this.source?.containerIssues ?? []),
      ...validateManifest(this.manifest, this.available()),
    ];
  }

  /**
   * The document as a complete .taste file. Blobs nothing refers to are left out. The caller
   * decides where it goes; it should replace any existing file in one step.
   */
  async save(options: SaveOptions = {}): Promise<Blob> {
    const problems = validateManifest(this.manifest, this.available());
    if (problems.length) {
      const list = problems.map((problem) => `  ${formatProblem(problem)}`).join("\n");
      throw new TasteError(`cannot save an invalid document:\n${list}`);
    }
    this.manifest.modified = options.now ?? now();
    this.manifest.generator = options.generator ?? GENERATOR;

    const entries: ZipWriteEntry[] = [
      entryFrom("mimetype", utf8.encode(MIMETYPE), false),
      entryFrom(MANIFEST, utf8.encode(JSON.stringify(this.manifest, null, 2) + "\n"), true),
    ];
    const types = this.mediaTypes();
    for (const ref of [...this.referencedBlobs()].sort()) {
      const name = BLOB_PREFIX + ref.slice("sha256:".length);
      const added = this.pending.get(ref);
      if (added) {
        const bytes = new Uint8Array(await added.arrayBuffer());
        entries.push(entryFrom(name, bytes, isCompressible(types.get(ref) ?? "")));
      } else if (this.source) {
        entries.push({ name, ...(await this.source.rawBlob(ref)) });
      } else {
        throw new TasteError(`blob not in file: ${ref}`);
      }
    }
    return new Blob([writeZip(entries, options)], { type: MIMETYPE });
  }

  /** Release object URLs created by {@link TasteDocument.objectUrl}. */
  close(): void {
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    this.urls.clear();
    this.source?.close();
  }

  // Finding things

  collection(collectionId: string): Collection {
    const found = this.manifest.collections.find((c) => c.id === collectionId);
    if (!found) throw new TasteError(`no collection with id ${JSON.stringify(collectionId)}`);
    return found;
  }

  item(itemId: string): Item {
    const found = Object.hasOwn(this.manifest.items, itemId) ? this.manifest.items[itemId] : undefined;
    if (!found) throw new TasteError(`no item with id ${JSON.stringify(itemId)}`);
    return found;
  }

  file(itemId: string, fileId: string): TasteFileEntry {
    const found = this.item(itemId).files?.find((f) => f.id === fileId);
    if (!found) {
      throw new TasteError(`item ${JSON.stringify(itemId)} has no file ${JSON.stringify(fileId)}`);
    }
    return found;
  }

  // Collections

  addCollection(
    name: string,
    fields: { id?: string; vibe?: string; description?: string; tags?: Tags; icon?: string } = {},
  ): Collection {
    const { id, tags, ...rest } = fields;
    const taken = new Set(this.manifest.collections.map((c) => c.id));
    const collection = { id: newId(id, name, taken), name } as Collection;
    put(collection, rest);
    if (tags && Object.keys(tags).length) collection.tags = { ...tags };
    collection.created = now();
    collection.entries = [];
    this.manifest.collections.push(collection);
    return collection;
  }

  /**
   * Remove a collection. With `prune`, also remove its items that are left in no collection and
   * have no children. Returns the ids of removed items.
   */
  removeCollection(collectionId: string, options: { prune?: boolean } = {}): string[] {
    const collection = this.collection(collectionId);
    this.manifest.collections.splice(this.manifest.collections.indexOf(collection), 1);
    if (!options.prune) return [];
    const placed = new Set(this.manifest.collections.flatMap((c) => c.entries.map((e) => e.item)));
    const removed: string[] = [];
    for (const entry of collection.entries) {
      if (placed.has(entry.item) || !this.manifest.items[entry.item]) continue;
      if (this.children(entry.item).length) continue;
      this.removeItem(entry.item);
      removed.push(entry.item);
    }
    return removed;
  }

  moveCollection(collectionId: string, position: number): void {
    const list = this.manifest.collections;
    const collection = this.collection(collectionId);
    list.splice(list.indexOf(collection), 1);
    list.splice(clamp(position, list.length), 0, collection);
  }

  /** Set a collection's cover image, or remove it with `null`. */
  setCover(collectionId: string, file: NewFile | null): void {
    const collection = this.collection(collectionId);
    if (file === null) {
      delete collection.cover;
      return;
    }
    collection.cover = { id: "cover", ...file, role: "cover" };
  }

  // Items

  /**
   * Add an item and return its id. Other fields (`year`, `ids`, `meta`, `tags`, `availability`…)
   * are copied as given.
   */
  addItem(
    kind: string,
    title: string,
    fields: Partial<Item> & { id?: string; by?: ActorInput } = {},
  ): string {
    const { id, by, ...rest } = fields;
    const seed = rest.year !== undefined ? `${title} ${rest.year}` : title;
    const taken = new Set(Object.keys(this.manifest.items));
    const itemId = newId(id, seed, taken, { fallback: kind.replaceAll(".", "-") });
    const item: Item = { kind, title };
    put(item, rest);
    item.added ??= now();
    item.added_by ??= actor(by);
    this.manifest.items[itemId] = item;
    return itemId;
  }

  /** Remove an item and its place in every collection. Items with children cannot be removed. */
  removeItem(itemId: string): void {
    this.item(itemId);
    const children = this.children(itemId);
    if (children.length) {
      throw new TasteError(
        `item ${JSON.stringify(itemId)} is the parent of ${children.join(", ")}; remove those first`,
      );
    }
    delete this.manifest.items[itemId];
    for (const collection of this.manifest.collections) {
      collection.entries = collection.entries.filter((entry) => entry.item !== itemId);
    }
  }

  /** Put an item in a collection, at the end unless `position` is given. */
  addEntry(
    collectionId: string,
    itemId: string,
    fields: { note?: string; show?: string[]; reason?: string; by?: ActorInput; position?: number } = {},
  ): Entry {
    const collection = this.collection(collectionId);
    this.item(itemId);
    if (collection.entries.some((entry) => entry.item === itemId)) {
      throw new TasteError(
        `item ${JSON.stringify(itemId)} is already in collection ${JSON.stringify(collectionId)}`,
      );
    }
    for (const fileId of fields.show ?? []) this.file(itemId, fileId);
    const entry: Entry = { item: itemId };
    put(entry, { note: fields.note, reason: fields.reason });
    if (fields.show?.length) entry.show = [...fields.show];
    entry.added = now();
    entry.added_by = actor(fields.by);
    const position = fields.position ?? collection.entries.length;
    collection.entries.splice(clamp(position, collection.entries.length), 0, entry);
    return entry;
  }

  removeEntry(collectionId: string, itemId: string): void {
    const collection = this.collection(collectionId);
    const kept = collection.entries.filter((entry) => entry.item !== itemId);
    if (kept.length === collection.entries.length) {
      throw new TasteError(
        `item ${JSON.stringify(itemId)} is not in collection ${JSON.stringify(collectionId)}`,
      );
    }
    collection.entries = kept;
  }

  moveEntry(collectionId: string, itemId: string, position: number): void {
    const entries = this.collection(collectionId).entries;
    const index = entries.findIndex((entry) => entry.item === itemId);
    if (index < 0) {
      throw new TasteError(
        `item ${JSON.stringify(itemId)} is not in collection ${JSON.stringify(collectionId)}`,
      );
    }
    const [entry] = entries.splice(index, 1);
    entries.splice(clamp(position, entries.length), 0, entry!);
  }

  // Files

  /**
   * Store data in the document and describe it as a file, ready for {@link attachFile} or
   * {@link setCover}. Image sizes and thumbnails are not computed here; pass them in.
   */
  async fileFrom(source: Blob, options: FileOptions): Promise<NewFile> {
    const ref = await this.storeBlob(source);
    const name = options.name ?? (source instanceof File && source.name ? source.name : undefined);
    const head = new Uint8Array(await source.slice(0, 64).arrayBuffer());
    let type = options.type;
    if (!type) {
      type = guessType(head, name);
      if (type === "application/octet-stream" && source.type) type = source.type;
    }
    const file: NewFile = { role: options.role, blob: ref, type, size: source.size };
    put(file, {
      name,
      width: options.width,
      height: options.height,
      duration: options.duration,
    });
    if (options.thumb) file.thumb = await this.storeBlob(options.thumb);
    put(file, { caption: options.caption });
    if (options.at && Object.keys(options.at).length) file.at = { ...options.at };
    if (options.tags && Object.keys(options.tags).length) file.tags = { ...options.tags };
    return file;
  }

  /** A file kept at a URL rather than stored in the document. */
  fileAt(url: string, options: Omit<FileOptions, "thumb">): NewFile {
    const type = options.type ?? guessType(new Uint8Array(0), new URL(url).pathname);
    const file: NewFile = { role: options.role, url, type };
    put(file, {
      name: options.name,
      width: options.width,
      height: options.height,
      duration: options.duration,
      caption: options.caption,
    });
    if (options.at && Object.keys(options.at).length) file.at = { ...options.at };
    if (options.tags && Object.keys(options.tags).length) file.tags = { ...options.tags };
    return file;
  }

  /** Add a file to an item. Its id comes from its role (`screenshot`, `screenshot-2`…). */
  attachFile(itemId: string, file: NewFile, fields: { id?: string; by?: ActorInput } = {}): TasteFileEntry {
    const item = this.item(itemId);
    const files = (item.files ??= []);
    const taken = new Set(files.map((f) => f.id));
    const entry: TasteFileEntry = {
      id: newId(fields.id, file.role, taken, { numbered: false }),
      ...file,
    };
    entry.added = now();
    entry.added_by = actor(fields.by);
    files.push(entry);
    return entry;
  }

  /** {@link fileFrom} and {@link attachFile} in one step. */
  async attach(
    itemId: string,
    source: Blob,
    options: FileOptions & { id?: string; by?: ActorInput },
  ): Promise<TasteFileEntry> {
    this.item(itemId);
    const { id, by, ...rest } = options;
    return this.attachFile(itemId, await this.fileFrom(source, rest), { id, by });
  }

  /** Remove a file from an item and from every collection's `show` list. */
  detach(itemId: string, fileId: string): void {
    const item = this.item(itemId);
    const file = this.file(itemId, fileId);
    item.files = item.files!.filter((f) => f !== file);
    if (!item.files.length) delete item.files;
    for (const collection of this.manifest.collections) {
      for (const entry of collection.entries) {
        if (entry.item !== itemId || !entry.show?.includes(fileId)) continue;
        entry.show = entry.show.filter((id) => id !== fileId);
        if (!entry.show.length) delete entry.show;
      }
    }
  }

  /** Set and remove tags on an item, file, or collection; returns its tags. */
  tag(target: { tags?: Tags }, values: Tags = {}, remove: string[] = []): Tags {
    const tags = { ...(target.tags ?? {}), ...values };
    for (const key of remove) delete tags[key];
    if (Object.keys(tags).length) target.tags = tags;
    else delete target.tags;
    return tags;
  }

  // Internals

  private available(): Set<string> {
    const refs = new Set(this.pending.keys());
    for (const ref of this.referencedBlobs()) {
      if (this.source?.hasBlob(ref)) refs.add(ref);
    }
    return refs;
  }

  /** Every file entry, skipping malformed ones so this also works on invalid manifests. */
  private *fileEntries(): Generator<TasteFileEntry> {
    for (const item of Object.values(this.manifest.items ?? {})) {
      if (isObject(item) && Array.isArray(item.files)) {
        for (const file of item.files) if (isObject(file)) yield file;
      }
    }
    for (const collection of this.manifest.collections ?? []) {
      if (isObject(collection) && isObject(collection.cover)) yield collection.cover;
    }
  }

  private mediaTypes(): Map<string, string> {
    const types = new Map<string, string>();
    for (const file of this.fileEntries()) {
      if (typeof file.blob === "string" && !types.has(file.blob)) types.set(file.blob, String(file.type ?? ""));
    }
    return types;
  }

  private children(itemId: string): string[] {
    return Object.entries(this.manifest.items)
      .filter(([, item]) => item.parent === itemId)
      .map(([id]) => id);
  }
}

/**
 * A free id: `wanted` if given (it must be valid and unused), otherwise one made from `seed`.
 * With `numbered`, the fallback always gets a number (`movie-1`); otherwise only clashes do.
 */
export function newId(
  wanted: string | undefined,
  seed: string,
  taken: Set<string>,
  options: { fallback?: string; numbered?: boolean } = {},
): string {
  const { fallback = "x", numbered = true } = options;
  if (wanted !== undefined) {
    if (!ID.test(wanted)) {
      throw new TasteError(`invalid id ${JSON.stringify(wanted)}: use letters, digits, '.', '_' or '-'`);
    }
    if (taken.has(wanted)) throw new TasteError(`id ${JSON.stringify(wanted)} is already used`);
    return wanted;
  }
  const base = slugify(seed) || fallback;
  if (!taken.has(base) && (!numbered || base !== fallback)) return base;
  let number = base !== fallback ? 2 : 1;
  while (taken.has(`${base}-${number}`)) number++;
  return `${base}-${number}`;
}

function entryFrom(name: string, bytes: Uint8Array<ArrayBuffer>, compress: boolean): ZipWriteEntry {
  const data = compress ? deflateSync(bytes, { level: 6 }) : bytes;
  return {
    name,
    method: compress ? DEFLATED : STORED,
    data: new Blob([data as Uint8Array<ArrayBuffer>]),
    size: bytes.length,
    crc32: crc32(bytes),
  };
}

/** Copy the defined values onto `target`. */
function put(target: object, values: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) (target as Record<string, unknown>)[key] = value;
  }
}

function clamp(position: number, length: number): number {
  return Math.max(0, Math.min(length, Math.trunc(position)));
}

function isObject<T extends object>(value: T | unknown): value is T {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
