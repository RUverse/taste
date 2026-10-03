/** Read-only questions about a manifest, shared by viewers and tools. */

import type { At, Collection, Entry, Item, Manifest, TagValue, Tags, TasteFileEntry } from "./types.ts";

/** Ids of items that are in no collection. */
export function unsorted(manifest: Manifest): string[] {
  const placed = new Set<string>();
  for (const collection of manifest.collections) {
    for (const entry of collection.entries) placed.add(entry.item);
  }
  return Object.keys(manifest.items).filter((id) => !placed.has(id));
}

/** The collections an item is in, with its entry in each. */
export function placesOf(
  manifest: Manifest,
  itemId: string,
): { collection: Collection; entry: Entry }[] {
  const places = [];
  for (const collection of manifest.collections) {
    const entry = collection.entries.find((e) => e.item === itemId);
    if (entry) places.push({ collection, entry });
  }
  return places;
}

/** Items whose `parent` is this item, such as a series' episodes. */
export function childrenOf(manifest: Manifest, itemId: string): string[] {
  return Object.entries(manifest.items)
    .filter(([, item]) => item.parent === itemId)
    .map(([id]) => id);
}

export interface ItemFilter {
  /** Matches the kind and its sub-kinds: `music` finds `music.track`. */
  kind?: string;
  /** Every tag must match: an equal value, or a list containing it, compared as text. */
  tags?: Record<string, TagValue>;
  /** Searched in titles, summaries, notes, and file captions. */
  text?: string;
}

export function matchesKind(kind: string, wanted: string): boolean {
  return kind === wanted || kind.startsWith(`${wanted}.`);
}

export function matchesItem(item: Item, filter: ItemFilter, notes: string[] = []): boolean {
  if (filter.kind && !matchesKind(item.kind, filter.kind)) return false;
  if (filter.tags) {
    for (const [key, wanted] of Object.entries(filter.tags)) {
      if (!tagMatches(item.tags?.[key], wanted)) return false;
    }
  }
  if (filter.text) {
    const needle = filter.text.toLocaleLowerCase();
    const haystack = [
      item.title,
      item.summary ?? "",
      ...notes,
      ...(item.files ?? []).map((f) => f.caption ?? ""),
      ...Object.values(item.meta ?? {}).flatMap((v) =>
        typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === "string") : [],
      ),
    ]
      .join(" ")
      .toLocaleLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

export function tagMatches(actual: TagValue | undefined, wanted: TagValue): boolean {
  if (actual === undefined) return false;
  if (Array.isArray(wanted)) return wanted.every((part) => tagMatches(actual, part));
  const expected = tagText(wanted);
  if (Array.isArray(actual)) return actual.some((part) => tagText(part) === expected);
  return tagText(actual) === expected;
}

function tagText(value: TagValue): string {
  return String(value).toLocaleLowerCase();
}

/** Tag pairs as `[key, value]`, one per list element, for display and filtering. */
export function tagPairs(tags: Tags | undefined): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(tags ?? {})) {
    for (const part of Array.isArray(value) ? value : [value]) pairs.push([key, String(part)]);
  }
  return pairs;
}

/** The moment a file shows, in words: `S01E03 · 00:41:05`, `Act II · PC`. */
export function formatAt(at: At | undefined): string {
  if (!at) return "";
  const parts: string[] = [];
  if (typeof at.season === "number") {
    const episode = typeof at.episode === "number" ? `E${String(at.episode).padStart(2, "0")}` : "";
    parts.push(`S${String(at.season).padStart(2, "0")}${episode}`);
  } else if (typeof at.episode === "number") parts.push(`Episode ${at.episode}`);
  if (typeof at.track === "number") parts.push(`Track ${at.track}`);
  if (typeof at.page === "number") parts.push(`Page ${at.page}`);
  for (const key of ["chapter", "level", "location", "section", "platform"] as const) {
    if (typeof at[key] === "string") parts.push(at[key]);
  }
  if (typeof at.time === "string") parts.push(at.time);
  if (typeof at.playtime === "string") parts.push(`${at.playtime} played`);
  return parts.join(" · ");
}

export function isImage(file: TasteFileEntry): boolean {
  return file.type.startsWith("image/");
}

/**
 * The file that best represents an item: the collection's chosen `show` file, then a poster or
 * cover, then any image.
 */
export function representativeFile(item: Item, entry?: Entry): TasteFileEntry | undefined {
  const files = item.files ?? [];
  for (const id of entry?.show ?? []) {
    const chosen = files.find((f) => f.id === id);
    if (chosen && isImage(chosen)) return chosen;
  }
  return (
    files.find((f) => (f.role === "poster" || f.role === "cover") && isImage(f)) ??
    files.find((f) => isImage(f))
  );
}
