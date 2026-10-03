/**
 * Manifest validation: the structure in taste.schema.json plus the rules of SPEC.md section 5.
 * Kept in step with python/src/taste/validate.py; both must agree on spec/fixtures.
 */

export const VERSION = "0.1";

export const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
export const BLOB_REF = /^sha256:([0-9a-f]{64})$/;
const KIND = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/;
const MEDIA_TYPE = /^[a-z]+\/[A-Za-z0-9.+_-]+$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2}))?$/;
const DURATION = /^\d+:[0-5]\d:[0-5]\d(\.\d+)?$/;
const REGION = /^[A-Z]{2}$/;
const AVAILABILITY_TYPES = ["ads", "buy", "free", "rent", "subscription"];
const AT_INTEGERS: Record<string, number> = { season: 0, episode: 0, track: 1, page: 1 };
const AT_DURATIONS = ["time", "playtime"];
const AT_STRINGS = ["platform", "chapter", "level", "location", "section"];

/** One reason a manifest is invalid. `path` is a JSON Pointer into taste.json. */
export interface Problem {
  path: string;
  message: string;
}

export function formatProblem(problem: Problem): string {
  return `${problem.path || "/"}: ${problem.message}`;
}

type Obj = Record<string, unknown>;

/**
 * Every problem found; an empty array means the manifest is valid. `blobs` holds the blob
 * references present in the container; omit it to skip checking that referenced blobs exist.
 */
export function validateManifest(manifest: unknown, blobs?: ReadonlySet<string>): Problem[] {
  return new Validator(blobs).run(manifest);
}

class Validator {
  readonly problems: Problem[] = [];
  constructor(private readonly blobs?: ReadonlySet<string>) {}

  fail(path: string, message: string): void {
    this.problems.push({ path, message });
  }

  run(manifest: unknown): Problem[] {
    if (!isObject(manifest)) {
      this.fail("", "manifest must be an object");
      return this.problems;
    }
    if (!("taste" in manifest)) this.fail("/taste", "missing format version");
    else if (manifest.taste !== VERSION) {
      this.fail("/taste", `unsupported version ${repr(manifest.taste)}, expected '${VERSION}'`);
    }
    for (const key of ["title", "description", "generator"]) this.string(manifest, key, "");
    for (const key of ["created", "modified"]) this.timestamp(manifest, key, "");

    let items = manifest.items;
    if (!isObject(items)) {
      this.fail("/items", "must be an object of items keyed by id");
      items = {};
    }
    const itemMap = items as Obj;
    for (const [itemId, item] of Object.entries(itemMap)) this.item(itemId, item, itemMap);

    let collections = manifest.collections;
    if (!Array.isArray(collections)) {
      this.fail("/collections", "must be an array");
      collections = [];
    }
    const seen = new Set<string>();
    (collections as unknown[]).forEach((collection, index) => {
      const path = `/collections/${index}`;
      this.collection(path, collection, itemMap);
      const id = isObject(collection) ? collection.id : undefined;
      if (typeof id === "string") {
        if (seen.has(id)) this.fail(`${path}/id`, `duplicate collection id ${repr(id)}`);
        seen.add(id);
      }
    });
    return this.problems;
  }

  item(itemId: string, item: unknown, items: Obj): void {
    const path = `/items/${escape(itemId)}`;
    if (!ID.test(itemId)) this.fail(path, `invalid item id ${repr(itemId)}`);
    if (!isObject(item)) {
      this.fail(path, "item must be an object");
      return;
    }
    if (typeof item.kind !== "string" || !KIND.test(item.kind)) {
      this.fail(`${path}/kind`, "must be a lowercase dotted name such as 'movie'");
    }
    this.string(item, "title", path, { required: true, nonEmpty: true });
    if ("year" in item && !isInt(item.year)) this.fail(`${path}/year`, "must be an integer");
    this.string(item, "summary", path);
    if ("ids" in item) {
      if (!isObject(item.ids)) this.fail(`${path}/ids`, "must be an object");
      else {
        for (const [key, value] of Object.entries(item.ids)) {
          if (typeof value !== "string" && !isInt(value)) {
            this.fail(`${path}/ids/${escape(key)}`, "must be a string or integer");
          }
        }
      }
    }
    if ("meta" in item && !isObject(item.meta)) this.fail(`${path}/meta`, "must be an object");
    this.array(item, "links", path).forEach((link, index) => {
      const linkPath = `${path}/links/${index}`;
      if (!isObject(link)) {
        this.fail(linkPath, "must be an object");
        return;
      }
      this.string(link, "url", linkPath, { required: true });
      this.string(link, "label", linkPath);
    });
    this.array(item, "availability", path).forEach((offer, index) =>
      this.availability(`${path}/availability/${index}`, offer),
    );
    const fileIds = new Set<string>();
    this.array(item, "files", path).forEach((entry, index) => {
      const filePath = `${path}/files/${index}`;
      this.file(filePath, entry);
      const id = isObject(entry) ? entry.id : undefined;
      if (typeof id === "string") {
        if (fileIds.has(id)) this.fail(`${filePath}/id`, `duplicate file id ${repr(id)} in this item`);
        fileIds.add(id);
      }
    });
    this.tags(item, path);
    if ("parent" in item) {
      const parent = item.parent;
      if (parent === itemId) this.fail(`${path}/parent`, "an item cannot be its own parent");
      else if (typeof parent !== "string" || !Object.hasOwn(items, parent)) {
        this.fail(`${path}/parent`, `no item with id ${repr(parent)}`);
      }
    }
    this.timestamp(item, "added", path);
    this.actor(item, path);
  }

  collection(path: string, collection: unknown, items: Obj): void {
    if (!isObject(collection)) {
      this.fail(path, "collection must be an object");
      return;
    }
    const id = collection.id;
    if (typeof id !== "string" || !ID.test(id)) {
      this.fail(`${path}/id`, `invalid collection id ${repr(id)}`);
    }
    this.string(collection, "name", path, { required: true, nonEmpty: true });
    for (const key of ["vibe", "description", "icon"]) this.string(collection, key, path);
    this.tags(collection, path);
    if ("cover" in collection) this.file(`${path}/cover`, collection.cover);
    this.timestamp(collection, "created", path);
    if (!Array.isArray(collection.entries)) {
      this.fail(`${path}/entries`, "must be an array");
      return;
    }
    const placed = new Set<string>();
    collection.entries.forEach((entry: unknown, index: number) => {
      const entryPath = `${path}/entries/${index}`;
      if (!isObject(entry)) {
        this.fail(entryPath, "entry must be an object");
        return;
      }
      const itemId = entry.item;
      const item =
        typeof itemId === "string" && Object.hasOwn(items, itemId) ? items[itemId] : undefined;
      if (item === undefined) this.fail(`${entryPath}/item`, `no item with id ${repr(itemId)}`);
      else if (placed.has(itemId as string)) {
        this.fail(`${entryPath}/item`, `item ${repr(itemId)} is already in this collection`);
      } else placed.add(itemId as string);
      for (const key of ["note", "reason"]) this.string(entry, key, entryPath);
      const fileIds = fileIdsOf(item);
      this.array(entry, "show", entryPath).forEach((fileId, showIndex) => {
        if (item !== undefined && (typeof fileId !== "string" || !fileIds.has(fileId))) {
          this.fail(`${entryPath}/show/${showIndex}`, `item ${repr(itemId)} has no file ${repr(fileId)}`);
        }
      });
      this.timestamp(entry, "added", entryPath);
      this.actor(entry, entryPath);
    });
  }

  file(path: string, entry: unknown): void {
    if (!isObject(entry)) {
      this.fail(path, "file must be an object");
      return;
    }
    if (typeof entry.id !== "string" || !ID.test(entry.id)) {
      this.fail(`${path}/id`, `invalid file id ${repr(entry.id)}`);
    }
    this.string(entry, "role", path, { required: true, nonEmpty: true });
    if (typeof entry.type !== "string" || !MEDIA_TYPE.test(entry.type)) {
      this.fail(`${path}/type`, "must be a media type such as 'image/jpeg'");
    }
    const hasBlob = "blob" in entry;
    const hasUrl = "url" in entry;
    if (hasBlob === hasUrl) this.fail(path, "must have exactly one of 'blob' or 'url'");
    if (hasBlob) this.blob(entry.blob, `${path}/blob`);
    if (hasUrl) this.string(entry, "url", path);
    if ("thumb" in entry) this.blob(entry.thumb, `${path}/thumb`);
    for (const key of ["size", "width", "height"]) {
      const minimum = key === "size" ? 0 : 1;
      if (key in entry && (!isInt(entry[key]) || (entry[key] as number) < minimum)) {
        this.fail(`${path}/${key}`, `must be an integer of at least ${minimum}`);
      }
    }
    if ("duration" in entry && (!isNumber(entry.duration) || entry.duration < 0)) {
      this.fail(`${path}/duration`, "must be a non-negative number of seconds");
    }
    for (const key of ["name", "caption"]) this.string(entry, key, path);
    if ("at" in entry) this.at(`${path}/at`, entry.at);
    this.tags(entry, path);
    this.timestamp(entry, "added", path);
    this.actor(entry, path);
  }

  at(path: string, at: unknown): void {
    if (!isObject(at)) {
      this.fail(path, "must be an object");
      return;
    }
    for (const key of AT_DURATIONS) {
      if (key in at && (typeof at[key] !== "string" || !DURATION.test(at[key] as string))) {
        this.fail(`${path}/${key}`, "must look like HH:MM:SS");
      }
    }
    for (const [key, minimum] of Object.entries(AT_INTEGERS)) {
      if (key in at && (!isInt(at[key]) || (at[key] as number) < minimum)) {
        this.fail(`${path}/${key}`, `must be an integer of at least ${minimum}`);
      }
    }
    for (const key of AT_STRINGS) this.string(at, key, path);
  }

  availability(path: string, offer: unknown): void {
    if (!isObject(offer)) {
      this.fail(path, "must be an object");
      return;
    }
    this.string(offer, "service", path, { required: true, nonEmpty: true });
    if ("region" in offer && (typeof offer.region !== "string" || !REGION.test(offer.region))) {
      this.fail(`${path}/region`, "must be a two-letter country code such as 'DE'");
    }
    if ("type" in offer && !AVAILABILITY_TYPES.includes(offer.type as string)) {
      this.fail(`${path}/type`, `must be one of ${AVAILABILITY_TYPES.join(", ")}`);
    }
    this.string(offer, "url", path);
    this.timestamp(offer, "checked", path);
  }

  blob(ref: unknown, path: string): void {
    if (typeof ref !== "string" || !BLOB_REF.test(ref)) {
      this.fail(path, "must be 'sha256:' followed by 64 lowercase hex digits");
    } else if (this.blobs && !this.blobs.has(ref)) {
      this.fail(path, `blob ${ref} is not in the file`);
    }
  }

  tags(owner: Obj, path: string): void {
    if (!("tags" in owner)) return;
    const tags = owner.tags;
    if (!isObject(tags)) {
      this.fail(`${path}/tags`, "must be an object");
      return;
    }
    for (const [key, value] of Object.entries(tags)) {
      const valid = Array.isArray(value)
        ? value.every((part) => typeof part === "string")
        : typeof value === "string" || typeof value === "boolean" || isNumber(value);
      if (!valid) {
        this.fail(
          `${path}/tags/${escape(key)}`,
          "must be a string, number, boolean, or array of strings",
        );
      }
    }
  }

  actor(owner: Obj, path: string): void {
    if (!("added_by" in owner)) return;
    const actor = owner.added_by;
    if (!isObject(actor) || (actor.type !== "user" && actor.type !== "agent")) {
      this.fail(`${path}/added_by`, "must be {'type': 'user'} or {'type': 'agent', ...}");
    } else this.string(actor, "name", `${path}/added_by`);
  }

  array(owner: Obj, key: string, path: string): unknown[] {
    if (!(key in owner)) return [];
    const value = owner[key];
    if (!Array.isArray(value)) {
      this.fail(`${path}/${key}`, "must be an array");
      return [];
    }
    return value;
  }

  string(
    owner: Obj,
    key: string,
    path: string,
    { required = false, nonEmpty = false }: { required?: boolean; nonEmpty?: boolean } = {},
  ): void {
    if (!(key in owner)) {
      if (required) this.fail(`${path}/${key}`, "is required");
      return;
    }
    const value = owner[key];
    if (typeof value !== "string") this.fail(`${path}/${key}`, "must be a string");
    else if (nonEmpty && !value) this.fail(`${path}/${key}`, "must not be empty");
  }

  timestamp(owner: Obj, key: string, path: string): void {
    if (key in owner && (typeof owner[key] !== "string" || !TIMESTAMP.test(owner[key] as string))) {
      this.fail(`${path}/${key}`, "must be an RFC 3339 timestamp or a YYYY-MM-DD date");
    }
  }
}

function fileIdsOf(item: unknown): Set<string> {
  const ids = new Set<string>();
  if (isObject(item) && Array.isArray(item.files)) {
    for (const entry of item.files) {
      if (isObject(entry) && typeof entry.id === "string") ids.add(entry.id);
    }
  }
  return ids;
}

function isObject(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function escape(token: string): string {
  return String(token).replaceAll("~", "~0").replaceAll("/", "~1");
}

function repr(value: unknown): string {
  return typeof value === "string" ? `'${value}'` : JSON.stringify(value) ?? String(value);
}
