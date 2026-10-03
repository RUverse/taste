import { describe, expect, test } from "bun:test";
import { zipSync, strToU8 } from "fflate";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  MIMETYPE,
  TasteError,
  TasteFile,
  formatAt,
  placesOf,
  representativeFile,
  unsorted,
  matchesItem,
} from "../src/index.ts";

const EXAMPLE = join(import.meta.dir, "../../spec/examples/moods.taste");

function example(): Blob {
  return new Blob([readFileSync(EXAMPLE)]);
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return `sha256:${Buffer.from(digest).toString("hex")}`;
}

function archive(files: Record<string, Uint8Array | [Uint8Array, { level: 0 | 6 }]>): Blob {
  return new Blob([zipSync(files)]);
}

describe("the example file", () => {
  test("opens, validates, and verifies", async () => {
    const file = await TasteFile.open(example());
    expect(file.manifest.title).toBe("rez's moods");
    expect(file.validate()).toEqual([]);
    expect(await file.verify()).toEqual([]);
  });

  test("stored blobs are read without copying, text is inflated", async () => {
    const file = await TasteFile.open(example());
    const item = file.manifest.items["lost-in-translation-2003"]!;
    const shot = item.files!.find((f) => f.id === "window")!;
    const blob = await file.blob(shot.blob!, shot.type);
    expect(blob.type).toBe("image/png");
    expect(blob.size).toBe(shot.size!);
    expect(await sha256(new Uint8Array(await blob.arrayBuffer()))).toBe(shot.blob!);

    const article = file.manifest.items["in-praise-of-slowness"]!;
    const snapshot = article.files![0]!;
    expect(await file.text(snapshot.blob!)).toStartWith("# In Praise of Slowness");
  });

  test("queries", async () => {
    const { manifest } = await TasteFile.open(example());
    expect(unsorted(manifest)).toEqual(["night-ferry-2024"]);
    const places = placesOf(manifest, "lost-in-translation-2003");
    expect(places.map((p) => p.collection.id)).toEqual(["rainy-sunday", "neon-nights"]);
    const item = manifest.items["lost-in-translation-2003"]!;
    expect(representativeFile(item, places[0]!.entry)?.id).toBe("rain");
    expect(representativeFile(item, places[1]!.entry)?.id).toBe("window");
    expect(representativeFile(item)?.id).toBe("poster");
    expect(matchesItem(item, { kind: "movie", tags: { mood: "LONELY" } })).toBe(true);
    expect(matchesItem(item, { text: "coppola" })).toBe(true);
    expect(matchesItem(item, { text: "kavinsky" })).toBe(false);
  });
});

test("formatAt", () => {
  expect(formatAt({ season: 1, episode: 3, time: "00:41:05" })).toBe("S01E03 · 00:41:05");
  expect(formatAt({ platform: "PC", chapter: "Act II", playtime: "3:12:00" })).toBe(
    "Act II · PC · 3:12:00 played",
  );
  expect(formatAt(undefined)).toBe("");
});

describe("rejecting other files", () => {
  const manifest = strToU8(JSON.stringify({ taste: "0.1", collections: [], items: {} }));
  const cases: [string, Blob, string][] = [
    ["not a zip", new Blob(["hello there, this is not a zip archive"]), "not a .taste file"],
    ["no mimetype", archive({ "taste.json": manifest }), "no leading mimetype"],
    [
      "wrong mimetype",
      archive({ mimetype: [strToU8("application/zip"), { level: 0 }], "taste.json": manifest }),
      "wrong mimetype",
    ],
    ["no manifest", archive({ mimetype: [strToU8(MIMETYPE), { level: 0 }] }), "missing taste.json"],
    [
      "bad json",
      archive({ mimetype: [strToU8(MIMETYPE), { level: 0 }], "taste.json": strToU8("{nope") }),
      "not valid JSON",
    ],
    [
      "unknown version",
      archive({
        mimetype: [strToU8(MIMETYPE), { level: 0 }],
        "taste.json": strToU8(JSON.stringify({ taste: "0.9", collections: [], items: {} })),
      }),
      "not supported",
    ],
  ];
  for (const [name, blob, message] of cases) {
    test(name, async () => {
      const error = await TasteFile.open(blob).catch((e) => e);
      expect(error).toBeInstanceOf(TasteError);
      expect(error.message).toContain(message);
    });
  }

  test("unknown versions open when asked", async () => {
    const blob = archive({
      mimetype: [strToU8(MIMETYPE), { level: 0 }],
      "taste.json": strToU8(JSON.stringify({ taste: "0.9", collections: [], items: {} })),
    });
    const file = await TasteFile.open(blob, { anyVersion: true });
    expect(file.validate()[0]?.path).toBe("/taste");
  });
});

test("container issues and corrupted blobs are reported", async () => {
  const real = new Uint8Array(strToU8("real"));
  const ref = await sha256(real);
  const manifest = {
    taste: "0.1",
    collections: [],
    items: { a: { kind: "movie", title: "A", files: [{ id: "p", role: "poster", type: "image/png", blob: ref }] } },
  };
  const blob = archive({
    mimetype: strToU8(MIMETYPE),
    "taste.json": strToU8(JSON.stringify(manifest)),
    [`blobs/sha256/${ref.slice(7)}`]: strToU8("tampered"),
    "blobs/sha256/not-a-hash": strToU8("x"),
  });
  const file = await TasteFile.open(blob);
  expect(file.validate().map((p) => p.message)).toEqual([
    "must be stored without compression",
    "blob name is not a SHA-256 digest",
  ]);
  expect((await file.verify()).map((p) => p.message)).toEqual(["content does not match its hash"]);
});
