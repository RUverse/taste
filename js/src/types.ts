/** The taste.json manifest, version 0.1. See spec/SPEC.md. Unknown fields are allowed everywhere. */

export type BlobRef = `sha256:${string}`;
export type TagValue = string | number | boolean | string[];
export type Tags = Record<string, TagValue>;

export interface Actor {
  type: "user" | "agent";
  name?: string;
  [extra: string]: unknown;
}

export interface At {
  time?: string;
  playtime?: string;
  season?: number;
  episode?: number;
  track?: number;
  page?: number;
  platform?: string;
  chapter?: string;
  level?: string;
  location?: string;
  section?: string;
  [extra: string]: unknown;
}

export interface TasteFileEntry {
  id: string;
  role: string;
  blob?: BlobRef;
  url?: string;
  type: string;
  size?: number;
  name?: string;
  width?: number;
  height?: number;
  duration?: number;
  thumb?: BlobRef;
  at?: At;
  caption?: string;
  tags?: Tags;
  added?: string;
  added_by?: Actor;
  [extra: string]: unknown;
}

export interface Link {
  url: string;
  label?: string;
  [extra: string]: unknown;
}

export interface Availability {
  service: string;
  region?: string;
  type?: "subscription" | "free" | "ads" | "rent" | "buy";
  url?: string;
  checked?: string;
  [extra: string]: unknown;
}

export interface Item {
  kind: string;
  title: string;
  year?: number;
  summary?: string;
  ids?: Record<string, string | number>;
  meta?: Record<string, unknown>;
  links?: Link[];
  availability?: Availability[];
  files?: TasteFileEntry[];
  tags?: Tags;
  parent?: string;
  added?: string;
  added_by?: Actor;
  [extra: string]: unknown;
}

export interface Entry {
  item: string;
  note?: string;
  show?: string[];
  added?: string;
  added_by?: Actor;
  reason?: string;
  [extra: string]: unknown;
}

export interface Collection {
  id: string;
  name: string;
  vibe?: string;
  description?: string;
  tags?: Tags;
  icon?: string;
  cover?: TasteFileEntry;
  created?: string;
  entries: Entry[];
  [extra: string]: unknown;
}

export interface Manifest {
  taste: string;
  title?: string;
  description?: string;
  created?: string;
  modified?: string;
  generator?: string;
  collections: Collection[];
  items: Record<string, Item>;
  [extra: string]: unknown;
}
