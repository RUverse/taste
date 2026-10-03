/**
 * The open document and what the user is looking at. The selected collection and item live in the
 * URL hash (`#/c/<collection>/i/<item>`), so Back closes the item panel and links can be shared
 * between people who have the same file.
 *
 * Every change goes through {@link Session.edit}, which records the manifest before the change
 * so it can be undone. The manifest is deeply reactive, so views follow changes made to it.
 */

import {
  TasteDocument,
  TasteFile,
  guessType,
  matchesItem,
  matchesKind,
  slugify,
  tagPairs,
  unsorted,
  type Collection,
  type Entry,
  type Item,
  type Manifest,
  type NewFile,
  type Problem,
  type TasteFileEntry,
} from "@ruverse/taste";
import { defaultRole } from "./editing.ts";
import { describeImage } from "./images.ts";
import { confirmAction, saveFile, type OpenedFile } from "./platform.ts";

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
  /** The item the files belong to, so the gallery can follow edits to them. */
  itemId?: string;
}

/** The form that is open, if any. */
export type Editor =
  | { kind: "document" }
  | { kind: "collection"; id: string | null }
  | { kind: "item"; id: string | null }
  | { kind: "file"; itemId: string; fileId: string };

interface Step {
  manifest: Manifest;
  revision: number;
  label: string;
}

const VIEW_KEY = "taste-viewer:view";
const HISTORY_LIMIT = 100;
const GENERATOR = `Taste Viewer ${__VIEWER_VERSION__}`;

class Session {
  doc = $state.raw<TasteDocument | null>(null);
  /** The document's manifest, deeply reactive. `doc.manifest` is the same object. */
  manifest = $state<Manifest | null>(null);
  name = $state("");
  /** Where the document was opened from, when the platform can save back to it. */
  handle = $state.raw<unknown>(null);
  loading = $state(false);
  saving = $state(false);
  /** What the app is busy with, such as reading added files, for a status message. */
  busy = $state<string | null>(null);
  error = $state<string | null>(null);
  notice = $state<string | null>(null);

  scope = $state.raw<Scope>({ kind: "all" });
  itemId = $state<string | null>(null);
  view = $state<View>(readView());
  editor = $state.raw<Editor | null>(null);

  search = $state("");
  kindFilter = $state<string | null>(null);
  tagFilter = $state.raw<[string, string] | null>(null);
  lightbox = $state.raw<Gallery | null>(null);

  undoStack = $state.raw<Step[]>([]);
  redoStack = $state.raw<Step[]>([]);
  private revision = $state(0);
  private savedRevision = $state(0);
  private nextRevision = 1;

  /** Whether there are changes that have not been saved. */
  get dirty(): boolean {
    return this.revision !== this.savedRevision;
  }

  get collection(): Collection | null {
    const scope = this.scope;
    if (scope.kind !== "collection") return null;
    return this.manifest?.collections.find((c) => c.id === scope.id) ?? null;
  }

  readonly problems: Problem[] = $derived.by(() => {
    return this.manifest && this.doc ? this.doc.validate() : [];
  });

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

  /** Whether the rows are the whole collection in order, so they can be rearranged. */
  get canReorder(): boolean {
    return this.collection !== null && this.rows.length === this.scopeRows.length;
  }

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

  // Opening and closing

  async open(opened: OpenedFile): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.loading = true;
    this.error = null;
    try {
      const doc = await TasteDocument.open(opened.data);
      this.adopt(doc, opened.name, opened.handle ?? null);
      const first = doc.manifest.collections[0];
      this.go(first ? { kind: "collection", id: first.id } : { kind: "all" }, null, true);
    } catch (error) {
      this.error = `${opened.name}: ${(error as Error).message}`;
    } finally {
      this.loading = false;
    }
  }

  /** Start a new, empty document with one collection. */
  async create(title: string, firstCollection: string): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    const doc = TasteDocument.create(title.trim());
    const name = firstCollection.trim();
    const collection = name ? doc.addCollection(name) : null;
    this.adopt(doc, `${slugify(title) || "untitled"}.taste`, null);
    // A document that was never saved counts as changed, so closing it asks first.
    this.revision = this.nextRevision++;
    this.go(collection ? { kind: "collection", id: collection.id } : { kind: "all" }, null, true);
  }

  /** Close the document, asking first when it has unsaved changes. */
  async requestClose(): Promise<void> {
    if (await this.confirmDiscard()) this.close();
  }

  private async confirmDiscard(): Promise<boolean> {
    if (!this.doc || !this.dirty) return true;
    return confirmAction(`${this.name} has unsaved changes. Discard them?`);
  }

  private adopt(doc: TasteDocument, name: string, handle: unknown): void {
    this.close();
    this.manifest = doc.manifest;
    doc.manifest = this.manifest;
    this.doc = doc;
    this.name = name;
    this.handle = handle;
  }

  close(): void {
    this.doc?.close();
    this.doc = null;
    this.manifest = null;
    this.name = "";
    this.handle = null;
    this.itemId = null;
    this.lightbox = null;
    this.editor = null;
    this.undoStack = [];
    this.redoStack = [];
    this.revision = this.savedRevision = 0;
    this.clearFilters();
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  // Changing the document

  /**
   * Apply a change to the document as one undoable step. If the change throws, the document is
   * put back as it was and the error is shown.
   */
  edit(label: string, change: (doc: TasteDocument, manifest: Manifest) => void): boolean {
    const doc = this.doc;
    const manifest = this.manifest;
    if (!doc || !manifest) return false;
    const before = $state.snapshot(manifest) as Manifest;
    try {
      change(doc, manifest);
    } catch (error) {
      this.restore(before);
      this.error = (error as Error).message;
      return false;
    }
    this.undoStack = [...this.undoStack.slice(1 - HISTORY_LIMIT), { manifest: before, revision: this.revision, label }];
    this.redoStack = [];
    this.revision = this.nextRevision++;
    this.settle();
    return true;
  }

  undo(): void {
    this.travel(this.undoStack, this.redoStack, (undo, redo) => {
      this.undoStack = undo;
      this.redoStack = redo;
    });
  }

  redo(): void {
    this.travel(this.redoStack, this.undoStack, (redo, undo) => {
      this.undoStack = undo;
      this.redoStack = redo;
    });
  }

  private travel(from: Step[], to: Step[], update: (from: Step[], to: Step[]) => void): void {
    const step = from.at(-1);
    const doc = this.doc;
    if (!step || !doc || !this.manifest) return;
    // Saving drops files nothing refers to, so steps from before a save may need files that
    // are gone.
    const needed = new TasteDocument(step.manifest).referencedBlobs();
    if ([...needed].some((ref) => !doc.hasBlob(ref))) {
      this.error = `“${step.label}” can’t be undone: files it needs were removed when the file was saved.`;
      return;
    }
    const current = { manifest: $state.snapshot(this.manifest) as Manifest, revision: this.revision, label: step.label };
    this.restore(step.manifest);
    update(from.slice(0, -1), [...to, current]);
    this.revision = step.revision;
    this.settle();
  }

  private restore(manifest: Manifest): void {
    this.manifest = manifest;
    if (this.doc) this.doc.manifest = this.manifest;
  }

  /** After a change, leave views of things that no longer exist. */
  private settle(): void {
    const manifest = this.manifest;
    if (!manifest) return;
    const scope = this.scope;
    const scopeGone = scope.kind === "collection" && !manifest.collections.some((c) => c.id === scope.id);
    const itemGone = this.itemId !== null && !manifest.items[this.itemId];
    if (scopeGone || itemGone) {
      this.go(scopeGone ? { kind: "all" } : scope, itemGone ? null : this.itemId, true);
    }
    const gallery = this.lightbox;
    if (gallery) {
      const files = gallery.itemId ? manifest.items[gallery.itemId]?.files ?? [] : [];
      const kept = gallery.files.flatMap((old) => files.filter((f) => f.id === old.id));
      const current = gallery.files[gallery.index];
      const index = Math.max(0, kept.findIndex((f) => f.id === current?.id));
      this.lightbox = kept.length ? { ...gallery, files: kept, index } : null;
    }
    const editor = this.editor;
    if (editor?.kind === "file" && !manifest.items[editor.itemId]?.files?.some((f) => f.id === editor.fileId)) {
      this.editor = null;
    }
  }

  /** Store files and attach them to an item, as one step. Images get their size and a thumbnail. */
  async addFiles(itemId: string, files: File[]): Promise<void> {
    const doc = this.doc;
    if (!doc || !files.length) return;
    this.busy = files.length === 1 ? `Adding ${files[0]!.name}…` : `Adding ${files.length} files…`;
    try {
      const prepared: NewFile[] = [];
      for (const file of files) {
        const item = this.manifest?.items[itemId];
        if (!item) return;
        const type = await typeOf(file);
        const image = type.startsWith("image/") ? await describeImage(file) : {};
        const role = defaultRole(item, type, [...(item.files ?? []), ...prepared]);
        prepared.push(await doc.fileFrom(file, { role, type, ...image }));
      }
      const label = prepared.length === 1 ? "Add a file" : `Add ${prepared.length} files`;
      this.edit(label, (current) => {
        for (const file of prepared) current.attachFile(itemId, file);
      });
      this.notice = `${label.replace("Add", "Added")} to ${this.manifest?.items[itemId]?.title ?? "the item"}`;
    } catch (error) {
      this.error = `Could not add the file: ${(error as Error).message}`;
    } finally {
      this.busy = null;
    }
  }

  /** Store an image to use as a collection's cover. Resolves to the file, ready to set. */
  async coverFrom(file: File): Promise<NewFile | null> {
    const doc = this.doc;
    if (!doc) return null;
    const type = await typeOf(file);
    if (!type.startsWith("image/")) {
      this.error = `${file.name} is not an image.`;
      return null;
    }
    return doc.fileFrom(file, { role: "cover", type, ...(await describeImage(file)) });
  }

  /**
   * Save the document: back to its file when possible, otherwise to a place the user picks (or a
   * download). The saved file becomes the document's source, so later saves copy from it.
   */
  async save(saveAs = false): Promise<void> {
    const doc = this.doc;
    if (!doc || !this.manifest || this.saving) return;
    const problems = this.problems.filter((p) => !p.path.startsWith("["));
    if (problems.length) {
      this.error = `Can’t save while the file has ${problems.length === 1 ? "a problem" : `${problems.length} problems`}; see the list in the sidebar.`;
      return;
    }
    this.saving = true;
    this.error = null;
    try {
      const data = await doc.save({ generator: GENERATOR });
      const saved = await saveFile(data, { name: this.name, handle: this.handle ?? undefined }, saveAs);
      if (!saved) return;
      const file = await TasteFile.open(saved.data);
      const next = new TasteDocument(this.manifest, file);
      this.doc = next;
      doc.close();
      this.name = saved.name;
      if (saved.handle) this.handle = saved.handle;
      this.savedRevision = this.revision;
      this.notice = saved.handle ? `Saved ${saved.name}` : `Downloaded ${saved.name}`;
    } catch (error) {
      this.error = `Could not save: ${(error as Error).message}`;
    } finally {
      this.saving = false;
    }
  }

  // Moving around

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

  showFile(title: string, files: TasteFileEntry[], file: TasteFileEntry, itemId?: string): void {
    this.lightbox = { title, files, index: Math.max(0, files.indexOf(file)), itemId };
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

async function typeOf(file: File): Promise<string> {
  const type = guessType(new Uint8Array(await file.slice(0, 64).arrayBuffer()), file.name);
  return type === "application/octet-stream" && file.type ? file.type : type;
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
