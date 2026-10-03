import { describe, expect, test } from "bun:test";
import { unzipSync } from "fflate";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFLATED,
  MIMETYPE,
  STORED,
  TasteDocument,
  TasteError,
  TasteFile,
  ZipReader,
  crc32,
  newId,
  slugify,
  writeZip,
  type Manifest,
} from "../src/index.ts";

const EXAMPLE = join(import.meta.dir, "../../spec/examples/moods.taste");
const NOW = "2026-10-04T09:00:00Z";
// A 1×1 PNG.
const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);

function example(): Blob {
  return new Blob([readFileSync(EXAMPLE)]);
}

async function bytes(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe("writeZip", () => {
  const text = new TextEncoder().encode("hello, hello, hello, hello");

  async function roundTrip(zip64Above?: number) {
    const blob = writeZip(
      [
        { name: "a.txt", method: STORED, data: new Blob([text]), size: text.length, crc32: crc32(text) },
        { name: "dir/b.png", method: STORED, data: new Blob([PNG]), size: PNG.length, crc32: crc32(PNG) },
      ],
      { zip64Above },
    );
    const zip = await ZipReader.open(blob);
    expect(zip.entries.map((e) => e.name)).toEqual(["a.txt", "dir/b.png"]);
    expect(await zip.bytes(zip.get("a.txt")!)).toEqual(text);
    expect(await zip.bytes(zip.get("dir/b.png")!)).toEqual(PNG);
    expect(zip.get("a.txt")!.crc32).toBe(crc32(text));
    return blob;
  }

  test("writes archives other readers accept", async () => {
    const files = unzipSync(await bytes(await roundTrip()));
    expect(Object.keys(files)).toEqual(["a.txt", "dir/b.png"]);
  });

  test("writes ZIP64 records when sizes need them", async () => {
    const blob = await roundTrip(0);
    const data = await bytes(blob);
    const view = new DataView(data.buffer);
    expect(view.getUint32(data.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint32(data.length - 22 - 20, true)).toBe(0x07064b50);
  });

  test("crc32 matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
});

describe("ids", () => {
  test("slugify keeps readable ASCII", () => {
    expect(slugify("Amélie (2001)")).toBe("amelie-2001");
    expect(slugify("  Lost in Translation!  ")).toBe("lost-in-translation");
    expect(slugify("東京")).toBe("");
  });

  test("newId avoids clashes like the Python library", () => {
    const taken = new Set(["amelie-2001", "movie-1", "screenshot"]);
    expect(newId(undefined, "Amélie 2001", taken)).toBe("amelie-2001-2");
    expect(newId(undefined, "東京", taken, { fallback: "movie" })).toBe("movie-2");
    expect(newId(undefined, "screenshot", taken, { numbered: false })).toBe("screenshot-2");
    expect(newId(undefined, "poster", taken, { numbered: false })).toBe("poster");
    expect(() => newId("bad id", "", taken)).toThrow(TasteError);
    expect(() => newId("movie-1", "", taken)).toThrow(TasteError);
  });
});

describe("saving", () => {
  test("an unchanged file keeps its manifest and blobs", async () => {
    const doc = await TasteDocument.open(example());
    const before = structuredClone(doc.manifest);
    const saved = await doc.save({ now: NOW, generator: "test" });
    const reopened = await TasteFile.open(saved);
    expect(reopened.validate()).toEqual([]);
    expect(await reopened.verify()).toEqual([]);
    const restored: Manifest = { ...reopened.manifest, modified: before.modified, generator: before.generator };
    expect(restored).toEqual(before);
    expect(reopened.manifest.modified).toBe(NOW);
    expect(reopened.manifest.generator).toBe("test");
  });

  test("the container layout follows the spec", async () => {
    const doc = await TasteDocument.open(example());
    const zip = await ZipReader.open(await doc.save({ now: NOW }));
    const [first, second, ...blobs] = zip.entries;
    expect(first?.name).toBe("mimetype");
    expect(first?.method).toBe(STORED);
    expect(first?.extraLength).toBe(0);
    expect(await zip.text(first!)).toBe(MIMETYPE);
    expect(second?.name).toBe("taste.json");
    expect(second?.method).toBe(DEFLATED);
    const names = blobs.map((e) => e.name);
    expect(names).toEqual([...names].sort());
    // The example's markdown snapshot is deflated; its images are stored.
    const article = doc.manifest.items["in-praise-of-slowness"]!.files![0]!;
    const poster = doc.manifest.items["lost-in-translation-2003"]!.files![0]!;
    expect(zip.get(`blobs/sha256/${article.blob!.slice(7)}`)?.method).toBe(DEFLATED);
    expect(zip.get(`blobs/sha256/${poster.blob!.slice(7)}`)?.method).toBe(STORED);
  });

  test("the same content gives the same bytes", async () => {
    const first = await (await TasteDocument.open(example())).save({ now: NOW });
    const second = await (await TasteDocument.open(first)).save({ now: NOW });
    expect(await bytes(second)).toEqual(await bytes(first));
  });

  test("invalid documents are refused", async () => {
    const doc = TasteDocument.create("Broken");
    doc.manifest.collections.push({ id: "c", name: "C", entries: [{ item: "missing" }] });
    await expect(doc.save()).rejects.toThrow(/cannot save an invalid document/);
  });
});

describe("editing", () => {
  test("a new document with collections, items, and files", async () => {
    const doc = TasteDocument.create("Mine");
    const collection = doc.addCollection("Rainy Sunday", { vibe: "Grey and slow." });
    expect(collection.id).toBe("rainy-sunday");
    const id = doc.addItem("movie", "Lost in Translation", { year: 2003 });
    expect(id).toBe("lost-in-translation-2003");
    expect(doc.item(id).added_by).toEqual({ type: "user" });

    const shot = await doc.attach(id, new Blob([PNG]), {
      role: "screenshot",
      caption: "Hotel window",
      at: { time: "00:23:41" },
      width: 1,
      height: 1,
      thumb: new Blob([PNG.slice()]),
    });
    expect(shot).toMatchObject({ id: "screenshot", type: "image/png", size: PNG.length });
    const second = await doc.attach(id, new Blob([PNG]), { role: "screenshot", by: "agent:hermes" });
    expect(second.id).toBe("screenshot-2");
    expect(second.added_by).toEqual({ type: "agent", name: "hermes" });

    const note = await doc.fileFrom(new Blob(["# Notes\n"], { type: "text/markdown" }), {
      role: "attachment",
      name: "notes.md",
    });
    expect(note.type).toBe("text/markdown");
    doc.attachFile(id, note);

    doc.addEntry("rainy-sunday", id, { note: "The hotel scenes.", show: ["screenshot"] });
    doc.setCover("rainy-sunday", await doc.fileFrom(new Blob([PNG]), { role: "cover" }));
    expect(doc.validate()).toEqual([]);

    const reopened = await TasteFile.open(await doc.save());
    expect(reopened.validate()).toEqual([]);
    expect(await reopened.verify()).toEqual([]);
    expect(reopened.manifest.collections[0]!.cover?.id).toBe("cover");
    expect(reopened.manifest.items[id]!.files!.map((f) => f.id)).toEqual([
      "screenshot",
      "screenshot-2",
      "attachment",
    ]);
  });

  test("detached files leave show lists and the saved file", async () => {
    const doc = TasteDocument.create();
    doc.addCollection("Neon");
    const id = doc.addItem("game", "Kentucky Route Zero");
    const big = new Uint8Array(PNG.length + 1);
    big.set(PNG);
    const file = await doc.attach(id, new Blob([big]), { role: "screenshot", type: "image/png" });
    doc.addEntry("neon", id, { show: [file.id] });
    doc.detach(id, file.id);
    expect(doc.manifest.collections[0]!.entries[0]!.show).toBeUndefined();
    expect(doc.item(id).files).toBeUndefined();

    const zip = await ZipReader.open(await doc.save());
    expect(zip.entries.map((e) => e.name)).toEqual(["mimetype", "taste.json"]);
  });

  test("files added to an opened document are saved next to the old ones", async () => {
    const doc = await TasteDocument.open(example());
    const id = "night-ferry-2024";
    await doc.attach(id, new Blob([PNG]), { role: "poster" });
    const reopened = await TasteDocument.open(await doc.save());
    expect(reopened.validate()).toEqual([]);
    expect(await reopened.source!.verify()).toEqual([]);
    const poster = reopened.manifest.items[id]!.files!.find((f) => f.role === "poster")!;
    expect(await bytes(await reopened.blob(poster.blob!))).toEqual(PNG);
  });

  test("entries move, and items leave every collection", async () => {
    const doc = await TasteDocument.open(example());
    const order = () => doc.collection("rainy-sunday").entries.map((e) => e.item);
    const first = order()[0]!;
    doc.moveEntry("rainy-sunday", first, 99);
    expect(order().at(-1)).toBe(first);
    doc.moveEntry("rainy-sunday", first, 0);
    expect(order()[0]).toBe(first);

    doc.removeItem("lost-in-translation-2003");
    expect(order()).not.toContain("lost-in-translation-2003");
    expect(doc.collection("neon-nights").entries.map((e) => e.item)).not.toContain(
      "lost-in-translation-2003",
    );
    expect(() => doc.removeItem("night-ferry-2024")).toThrow(/parent of the-last-crossing/);
    expect(doc.validate()).toEqual([]);
  });

  test("removing a collection can prune its items", async () => {
    const doc = await TasteDocument.open(example());
    const kept = doc.removeCollection("neon-nights");
    expect(kept).toEqual([]);
    const restored = await TasteDocument.open(example());
    const removed = restored.removeCollection("neon-nights", { prune: true });
    expect(removed.length).toBeGreaterThan(0);
    for (const id of removed) expect(restored.manifest.items[id]).toBeUndefined();
    expect(restored.validate()).toEqual([]);
  });

  test("tags are set and removed", () => {
    const doc = TasteDocument.create();
    const id = doc.addItem("music.track", "Nightcall", { tags: { mood: "dark" } });
    doc.tag(doc.item(id), { energy: "low" }, ["mood"]);
    expect(doc.item(id).tags).toEqual({ energy: "low" });
    doc.tag(doc.item(id), {}, ["energy"]);
    expect(doc.item(id).tags).toBeUndefined();
  });
});
