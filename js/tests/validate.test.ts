import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateManifest } from "../src/index.ts";

const FIXTURES = join(import.meta.dir, "../../spec/fixtures");

function load(kind: string) {
  return readdirSync(join(FIXTURES, kind))
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, ...JSON.parse(readFileSync(join(FIXTURES, kind, name), "utf8")) }));
}

describe("shared fixtures", () => {
  for (const fixture of load("valid")) {
    test(`valid: ${fixture.name}`, () => {
      expect(validateManifest(fixture.manifest)).toEqual([]);
    });
  }
  for (const fixture of load("invalid")) {
    test(`invalid: ${fixture.name}`, () => {
      const paths = [...new Set(validateManifest(fixture.manifest).map((p) => p.path))].sort();
      expect(paths).toEqual(fixture.problems);
    });
  }
});

test("blob presence is checked only when the blobs are known", () => {
  const ref = `sha256:${"a".repeat(64)}`;
  const manifest = {
    taste: "0.1",
    collections: [],
    items: {
      a: {
        kind: "movie",
        title: "A",
        files: [{ id: "f", role: "poster", type: "image/png", blob: ref, thumb: ref }],
      },
    },
  };
  expect(validateManifest(manifest)).toEqual([]);
  expect(validateManifest(manifest, new Set([ref]))).toEqual([]);
  expect(validateManifest(manifest, new Set())).toHaveLength(2);
});

test("garbage does not crash", () => {
  for (const manifest of [null, [], "x", { taste: "0.1", items: { a: 1 }, collections: [1, { entries: [2] }] }]) {
    expect(validateManifest(manifest).length).toBeGreaterThan(0);
  }
});

test("prototype keys are not items", () => {
  const manifest = {
    taste: "0.1",
    collections: [{ id: "c", name: "C", entries: [{ item: "constructor" }] }],
    items: {},
  };
  expect(validateManifest(manifest).map((p) => p.path)).toEqual(["/collections/0/entries/0/item"]);
});
