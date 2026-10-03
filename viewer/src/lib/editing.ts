/** What the editing forms offer: the spec's kinds, roles, and `at` fields, and value parsing. */

import type { Item, TagValue, Tags, TasteFileEntry } from "@ruverse/taste";

/** The kinds defined in SPEC.md section 3, in the order the kind menu shows them. */
export const KINDS = [
  "movie",
  "tv",
  "tv.episode",
  "music.track",
  "music.album",
  "podcast.episode",
  "video",
  "game",
  "book",
  "article",
  "image",
  "place",
  "note",
];

export const ROLES = [
  "poster",
  "cover",
  "backdrop",
  "screenshot",
  "media",
  "preview",
  "snapshot",
  "lyrics",
  "subtitle",
  "attachment",
];

export const AVAILABILITY_TYPES = ["subscription", "free", "ads", "rent", "buy"] as const;

interface KindFields {
  ids: string[];
  meta: string[];
  at: string[];
}

const KIND_FIELDS: Record<string, KindFields> = {
  movie: { ids: ["tmdb", "imdb"], meta: ["director", "genres", "runtime", "languages", "countries"], at: ["time"] },
  tv: { ids: ["tmdb", "imdb", "tvdb"], meta: ["creators", "genres", "seasons", "networks"], at: ["season", "episode", "time"] },
  "tv.episode": { ids: ["tmdb", "imdb"], meta: ["season", "episode"], at: ["time"] },
  "music.track": { ids: ["musicbrainz", "spotify", "isrc"], meta: ["artists", "album", "duration"], at: ["time"] },
  "music.album": { ids: ["musicbrainz", "spotify", "upc"], meta: ["artists", "tracks"], at: ["track", "time"] },
  "podcast.episode": { ids: ["spotify", "apple"], meta: ["show", "published", "duration"], at: ["time"] },
  video: { ids: ["youtube", "vimeo"], meta: ["channel", "published", "duration"], at: ["time"] },
  game: { ids: ["igdb", "steam"], meta: ["developers", "platforms", "genres"], at: ["platform", "chapter", "level", "location", "playtime"] },
  book: { ids: ["isbn", "openlibrary"], meta: ["authors", "publisher", "published", "pages"], at: ["page", "chapter"] },
  article: { ids: ["doi"], meta: ["author", "site", "published"], at: ["section"] },
  image: { ids: [], meta: ["artist", "taken"], at: [] },
  place: { ids: ["osm"], meta: ["address", "lat", "lon"], at: [] },
  note: { ids: [], meta: [], at: [] },
};

/** Suggested `ids`, `meta`, and `at` fields for a kind, falling back to its parent kind. */
export function kindFields(kind: string): KindFields {
  let key = kind;
  while (key) {
    const fields = KIND_FIELDS[key];
    if (fields) return fields;
    key = key.includes(".") ? key.slice(0, key.lastIndexOf(".")) : "";
  }
  return { ids: [], meta: [], at: [] };
}

/** `at` fields holding integers; `time` and `playtime` are durations, the rest are text. */
export const AT_INTEGERS = ["season", "episode", "track", "page"];
export const AT_DURATIONS = ["time", "playtime"];
/** The spec's duration form, `HH:MM:SS` with optional fractions, as an input pattern. */
export const DURATION_PATTERN = "\\d+:[0-5]\\d:[0-5]\\d(\\.\\d+)?";

const ART_ROLE: Record<string, string> = {
  movie: "poster",
  tv: "poster",
  game: "cover",
  book: "cover",
  "music.album": "cover",
  "music.track": "cover",
  "podcast.episode": "cover",
};

/** A role for a file someone just added: the first image becomes the poster or cover. */
export function defaultRole(item: Item, type: string, files: { role: string }[]): string {
  if (type.startsWith("image/")) {
    const art = ART_ROLE[item.kind];
    const hasArt = files.some((f) => f.role === "poster" || f.role === "cover");
    if (art && !hasArt) return art;
    return ["image", "place", "note", "article"].includes(item.kind.split(".")[0]!) ? "attachment" : "screenshot";
  }
  if (type.startsWith("audio/") || type.startsWith("video/")) return "media";
  if (item.kind === "article" && /^(text\/(html|markdown|plain)|application\/pdf)$/.test(type)) {
    return "snapshot";
  }
  if (type === "application/x-subrip" || type === "text/vtt") return "subtitle";
  return "attachment";
}

/** Whether an image file can be chosen as the one shown on an item's card. */
export function canShow(file: TasteFileEntry): boolean {
  return file.type.startsWith("image/");
}

// Values typed into key/value rows

/** How a tag, id, or meta value is shown in a text field. */
export function valueText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string" || typeof part === "number")) {
    return value.join(", ");
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * A typed value back as data: `true`/`false` and numbers become themselves, `a, b` becomes a
 * list, and JSON objects or arrays are parsed when `json` is allowed. A value that still reads as
 * it did keeps its original type.
 */
export function parseValue(text: string, original?: unknown, options: { json?: boolean } = {}): unknown {
  if (original !== undefined && valueText(original) === text) return original;
  const trimmed = text.trim();
  if (options.json && /^[[{]/.test(trimmed)) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // Not JSON after all; keep it as text.
    }
  }
  if (trimmed === "true" || trimmed === "false") return trimmed === "true";
  if (/^-?\d+(\.\d+)?$/.test(trimmed) && Number.isFinite(Number(trimmed))) return Number(trimmed);
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map((part) => part.trim()).filter(Boolean);
    return parts.length === 1 ? parts[0] : parts;
  }
  return trimmed;
}

/** Tag values allow strings, numbers, booleans, and lists of strings. */
export function parseTag(text: string, original?: TagValue): TagValue {
  const value = parseValue(text, original);
  if (Array.isArray(value)) return value.map(String);
  return value as TagValue;
}

export interface Pair {
  key: string;
  text: string;
  /** The value the row was loaded with, so an untouched row keeps its exact type. */
  original?: unknown;
}

export function pairsOf(values: Record<string, unknown> | undefined): Pair[] {
  return Object.entries(values ?? {}).map(([key, value]) => ({ key, text: valueText(value), original: value }));
}

/** Rows back into an object, skipping rows without a key or a value. */
export function objectOf<T>(pairs: Pair[], parse: (pair: Pair) => T): Record<string, T> | undefined {
  const result: Record<string, T> = {};
  for (const pair of pairs) {
    const key = pair.key.trim();
    if (!key || !pair.text.trim()) continue;
    result[key] = parse(pair);
  }
  return Object.keys(result).length ? result : undefined;
}

export function tagsOf(pairs: Pair[]): Tags | undefined {
  return objectOf(pairs, (pair) => parseTag(pair.text, pair.original as TagValue | undefined));
}

/** Set a field, or remove it when the value is empty. */
export function setField(target: object, key: string, value: unknown): void {
  const record = target as Record<string, unknown>;
  const empty =
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).length === 0);
  if (empty) delete record[key];
  else record[key] = value;
}
