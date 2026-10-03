/**
 * The open file and what the user is looking at. The selected collection and item live in the
 * URL hash (`#/c/<collection>/i/<item>`), so Back closes the item panel and links can be shared
 * between people who have the same file.
 */

import {
  TasteFile,
  matchesItem,
  matchesKind,
  tagPairs,
  unsorted,
  type Collection,
  type Entry,
  type Item,
  type Manifest,
  type Problem,
  type TasteFileEntry,
} from "@ruverse/taste";
import type { OpenedFile } from "./platform.ts";

export type Scope = { kind: "all" } | { kind: "unsorted" } | { kind: "collection"; id: string };
export type View = "grid" | "tree";

export interface Row {
  id: string;
  item: Item;
  entry?: Entry;
}

/** Files shown in the lightbox, with the one in view. */
export interface Gallery {
  title: string;
  files: TasteFileEntry[];
  index: number;
}

const VIEW_KEY = "taste-viewer:view";

class Session {
  file = $state.raw<TasteFile | null>(null);
  name = $state("");
  loading = $state(false);
  error = $state<string | null>(null);
  problems = $state.raw<Problem[]>([]);

  scope = $state.raw<Scope>({ kind: "all" });
  itemId = $state<string | null>(null);
  view = $state<View>(readView());

  search = $state("");
  kindFilter = $state<string | null>(null);
  tagFilter = $state.raw<[string, string] | null>(null);
  lightbox = $state.raw<Gallery | null>(null);

  get manifest(): Manifest | null {
    return this.file?.manifest ?? null;
  }

  get collection(): Collection | null {
    const scope = this.scope;
    if (scope.kind !== "collection") return null;
    return this.manifest?.collections.find((c) => c.id === scope.id) ?? null;
  }

  readonly unsortedIds: string[] = $derived.by(() => {
    return this.manifest ? unsorted(this.manifest) : [];
  });

  /** Every row in the current scope, before filters. */
  readonly scopeRows: Row[] = $derived.by(() => {
    const manifest = this.manifest;
    if (!manifest) return [];
    const scope = this.scope;
    if (scope.kind === "collection") {
      const collection = this.collection;
      if (!collection) return [];
      return collection.entries.flatMap((entry) => {
        const item = manifest.items[entry.item];
        return item ? [{ id: entry.item, item, entry }] : [];
      });
    }
    const ids = scope.kind === "unsorted" ? this.unsortedIds : Object.keys(manifest.items);
    return ids.flatMap((id) => {
      const item = manifest.items[id];
      return item ? [{ id, item }] : [];
    });
  });

  /** Rows after the search, kind, and tag filters. */
  readonly rows: Row[] = $derived.by(() => {
    const kind = this.kindFilter ?? undefined;
    const tag = this.tagFilter;
    const filter = {
      kind,
      text: this.search.trim() || undefined,
      tags: tag ? { [tag[0]]: tag[1] } : undefined,
    };
    return this.scopeRows.filter((row) =>
      matchesItem(row.item, filter, [row.entry?.note ?? "", row.entry?.reason ?? ""]),
    );
  });

  /** Top-level kinds in the scope with their counts, for the kind filter. */
  readonly kinds: [string, number][] = $derived.by(() => {
    const counts = new Map<string, number>();
    for (const { item } of this.scopeRows) {
      const top = item.kind.split(".")[0] ?? item.kind;
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1]);
  });

  /** The most common item tags in the scope, for the tag filter. */
  readonly tags: [string, string, number][] = $derived.by(() => {
    const counts = new Map<string, [string, string, number]>();
    for (const { item } of this.scopeRows) {
      if (this.kindFilter && !matchesKind(item.kind, this.kindFilter)) continue;
      for (const [key, value] of tagPairs(item.tags)) {
        if (typeof item.tags?.[key] === "boolean") continue;
        const id = `${key}\u0000${value.toLocaleLowerCase()}`;
        const known = counts.get(id);
        counts.set(id, known ? [key, known[1], known[2] + 1] : [key, value, 1]);
      }
    }
    return [...counts.values()]
      .filter(([, , count]) => count > 1 || counts.size <= 12)
      .sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0]))
      .slice(0, 12);
  });

  get item(): Item | null {
    return (this.itemId && this.manifest?.items[this.itemId]) || null;
  }

  async open(opened: OpenedFile): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const file = await TasteFile.open(opened.data);
      this.close();
      this.file = file;
      this.name = opened.name;
      this.problems = file.validate();
      const first = file.manifest.collections[0];
      this.go(first ? { kind: "collection", id: first.id } : { kind: "all" }, null, true);
    } catch (error) {
      this.error = `${opened.name}: ${(error as Error).message}`;
    } finally {
      this.loading = false;
    }
  }

  close(): void {
    this.file?.close();
    this.file = null;
    this.name = "";
    this.problems = [];
    this.itemId = null;
    this.lightbox = null;
    this.clearFilters();
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  clearFilters(): void {
    this.search = "";
    this.kindFilter = null;
    this.tagFilter = null;
  }

  setView(view: View): void {
    this.view = view;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Storage can be unavailable in private windows; the choice just is not remembered.
    }
  }

  /** Show a scope, and optionally an item in it. */
  go(scope: Scope, itemId: string | null = null, replace = false): void {
    const changedScope = !sameScope(scope, this.scope);
    this.scope = scope;
    this.itemId = itemId;
    if (changedScope) this.clearFilters();
    const hash = toHash(scope, itemId);
    if (location.hash !== hash) {
      if (replace) history.replaceState(null, "", hash);
      else history.pushState(null, "", hash);
    }
  }

  /** The link to an item in the current scope, for real hrefs (new tabs, copying links). */
  itemHref(itemId: string): string {
    return toHash(this.scope, itemId);
  }

  showFile(title: string, files: TasteFileEntry[], file: TasteFileEntry): void {
    this.lightbox = { title, files, index: Math.max(0, files.indexOf(file)) };
  }

  openItem(itemId: string): void {
    this.go(this.scope, itemId);
  }

  closeItem(): void {
    this.go(this.scope, null);
  }

  /** Follow a hash change from Back, Forward, or a pasted link. */
  readHash(): void {
    if (!this.manifest) return;
    const { scope, itemId } = fromHash(location.hash);
    const known =
      scope.kind !== "collection" || this.manifest.collections.some((c) => c.id === scope.id);
    const safeScope = known ? scope : { kind: "all" as const };
    if (!sameScope(safeScope, this.scope)) this.clearFilters();
    this.scope = safeScope;
    this.itemId = itemId && this.manifest.items[itemId] ? itemId : null;
    this.lightbox = null;
  }
}

function readView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "tree" ? "tree" : "grid";
  } catch {
    return "grid";
  }
}

function sameScope(a: Scope, b: Scope): boolean {
  return a.kind === b.kind && (a.kind !== "collection" || a.id === (b as { id: string }).id);
}

function toHash(scope: Scope, itemId: string | null): string {
  const base =
    scope.kind === "collection" ? `#/c/${encodeURIComponent(scope.id)}` : `#/${scope.kind}`;
  return itemId ? `${base}/i/${encodeURIComponent(itemId)}` : base;
}

function fromHash(hash: string): { scope: Scope; itemId: string | null } {
  const parts = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  let scope: Scope = { kind: "all" };
  let rest = parts;
  if (parts[0] === "c" && parts[1]) {
    scope = { kind: "collection", id: parts[1] };
    rest = parts.slice(2);
  } else if (parts[0] === "unsorted") {
    scope = { kind: "unsorted" };
    rest = parts.slice(1);
  } else if (parts[0] === "all") {
    rest = parts.slice(1);
  }
  const itemId = rest[0] === "i" && rest[1] ? rest[1] : null;
  return { scope, itemId };
}

export const session = new Session();
