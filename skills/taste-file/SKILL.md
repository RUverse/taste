---
name: taste-file
description: Read and summarize .taste files, ZIP archives that hold collections of movies, series, music, articles, games and other media sharing a vibe, with metadata, tags, and stored posters or screenshots. Use when a user shares or asks about a `.taste` file, or about any file (often an attachment with a random name or `application/octet-stream` type) whose first ZIP entry is `mimetype` containing `application/vnd.ruverse.taste+zip`.
---

# Reading .taste files

A `.taste` file is a ZIP archive containing three things:

```
mimetype       application/vnd.ruverse.taste+zip   (first entry, stored uncompressed)
taste.json     the manifest: collections → entries → items → files, all plain JSON
blobs/sha256/  stored files (posters, screenshots, saved articles…), named by SHA-256, no extension
```

Everything needed to understand the file is in `taste.json`. Its content includes a text
description of every stored file: role, media type, moment in the work, caption, and tags.
**Start from the manifest and open blobs only when you actually need to look at one.** Don't
`unzip -l` the archive and inspect the blobs one by one. Their names are hashes, they have no
extensions, and they tell you nothing that the manifest doesn't already say.

The full specification is `spec/SPEC.md` in https://github.com/RUverse/taste.

## 1. Confirm it is a .taste file

```bash
unzip -p FILE mimetype; echo     # prints application/vnd.ruverse.taste+zip
```

Attachments are often saved under random names with no `.taste` extension. If you get this
output, it is a .taste file.

## 2. Get an overview

Use the `taste` command when it is available. Pick the first form that works:

```bash
taste info FILE                                    # if installed
uv run --project <taste-repo>/python taste info FILE   # inside a checkout of the repo
uvx --from 'git+https://github.com/RUverse/taste#subdirectory=python' taste info FILE
```

Commands for reading (none of them change the file):

| Command | What it gives you |
| --- | --- |
| `taste info FILE [--json]` | Title, format version, counts of collections, items, kinds, and files |
| `taste tree FILE` | **Best first look.** Each collection with its vibe, then its items, notes, and files |
| `taste show FILE [ID]` | The whole manifest, or one item as JSON (includes `collections` it belongs to) |
| `taste show FILE -c ID` | One collection as JSON |
| `taste find FILE [TAG=VALUE…] [--kind K] [--in COLLECTION] [--text T]` | Matching items |
| `taste find FILE --files [--role screenshot]` | Matching files with their captions |
| `taste extract FILE ITEM FILE_ID -o out.png [--thumb]` | Write one stored file out |
| `taste validate FILE [--deep]` | Check against the spec (`--deep` re-hashes every blob) |

In `taste tree` output, a `*` before a file means that file is featured for the item in that
collection (see `show` below). Items that are in no collection are listed under `(unsorted)`.

### Without the `taste` command

Use Python's standard library only:

```python
import json, sys, zipfile

z = zipfile.ZipFile(sys.argv[1])
assert z.read("mimetype") == b"application/vnd.ruverse.taste+zip", "not a .taste file"
m = json.loads(z.read("taste.json"))
items, placed = m["items"], set()
print(m.get("title", ""), "| format", m["taste"])
for c in m["collections"]:
    print(f"\n{c['name']} [{c['id']}] tags={c.get('tags', {})}\n  vibe: {c.get('vibe', '')}")
    for e in c["entries"]:
        placed.add(e["item"])
        it, by = items[e["item"]], e.get("added_by", {})
        agent = f"  (added by agent {by.get('name')})" if by.get("type") == "agent" else ""
        print(f"  - {it['kind']}: {it['title']} {it.get('year', '')} [{e['item']}]{agent}")
        for k in ("note", "reason"):
            if k in e:
                print(f"      {k}: {e[k]}")
        for f in it.get("files", []):
            star = "*" if f["id"] in e.get("show", []) else " "
            print(f"     {star}{f['role']} {f['type']} [{f['id']}] {f.get('at', '')} "
                  f"{f.get('caption', '')} {f.get('blob') or f.get('url')}")
for i in sorted(set(items) - placed):
    print(f"(unsorted) {items[i]['kind']}: {items[i]['title']} [{i}]")
```

For the raw manifest, run `unzip -p FILE taste.json`.

## 3. Understand the structure

- **Collection**: a named set with a `vibe`, which is a plain-words description of what ties the
  set together. Use it to judge whether something belongs. Collections also have `tags`, an
  optional `icon` name, an optional `cover` image, and an ordered list of `entries`.
- **Entry**: places an item in a collection. `note` says why the item is here or what to notice.
  `reason` says why an agent suggested it. `show` lists the item's file ids that represent it in
  this collection. `added_by` is `{"type": "user"}` or `{"type": "agent", "name": "…"}`.
- **Item**: lives once in the top-level `items` object, keyed by a readable id such as
  `lost-in-translation-2003`. **The same item can appear in several collections**, with a different
  note and featured file in each. Fields:
  - `kind`, `title`, `year`, and `summary`.
  - `ids`: catalog ids such as `tmdb`, `imdb`, `spotify`, or `isbn`.
  - `meta`: facts about the work, which depend on the kind.
  - `links`.
  - `availability`: service, region, type, and the date it was `checked`. Treat old dates as
    possibly out of date.
  - `tags`: the user's own labels, such as `mood`, `watched`, or `rating`.
  - `files`.
  - `parent`: for example, a `tv.episode`'s series.
- **Items in no collection are allowed.** These are often the parent series of an episode.
- **Kinds**: `movie`, `tv`, `tv.episode`, `music.track`, `music.album`, `podcast.episode`,
  `video`, `game`, `book`, `article`, `image`, `place`, `note`. Other kinds are valid too; read
  their `meta` as plain data.
- **File**: has either `blob` (`sha256:<hex>`, stored at `blobs/sha256/<hex>`) or `url` (not
  stored; it may not be reachable). Its other fields:
  - `role`: `poster`, `cover`, `backdrop`, `screenshot`, `media`, `preview`, `snapshot` (a saved
    article or page), `lyrics`, `subtitle`, or `attachment`.
  - `type`, which is the media type.
  - `caption`.
  - `tags`.
  - `thumb`: a small WebP preview.
  - `at`: the moment in the work the file shows. Examples are `time` `HH:MM:SS`; `season` and
    `episode`; `track`; `page`; or, for games, `platform`, `chapter`, `level`, and `playtime`.
- Unknown fields (often `x-…` extensions) are allowed anywhere. Report them, don't treat them as
  errors.

## 4. Look at stored files only when needed

Captions usually tell you what an image shows. Open the image itself only when the user asks
about its visual content or there is no caption. Open the thumbnail first; it is small.

```bash
taste extract FILE ITEM_ID FILE_ID -o /tmp/shot.png [--thumb]
# or, without the command, using the hex from the file's "blob" or "thumb" field:
unzip -p FILE blobs/sha256/<hex> > /tmp/shot.png
```

Give the output file the extension that matches the file's `type`. Thumbnails are WebP. Image
viewers and image-reading tools usually need the right extension.

To read a text snapshot, run `unzip -p FILE blobs/sha256/<hex>`.

## 5. Describing a file to the user

When you summarize a file, cover these points:

- The title and every collection, each with its vibe, its tags, and its items. Give each item's
  kind, title, and year.
- Items that appear in more than one collection.
- What each item carries: availability, ratings and other tags, and files with their captions
  and `at` moments.
- What agents added, with their reasons, so the user can review it.
- Anything odd:
  - files that are only `url`s;
  - items in no collection;
  - availability with old `checked` dates;
  - placeholder-looking content (the sample file `spec/examples/moods.taste` uses gradient
    placeholder images and example URLs);
  - problems reported by `taste validate`.

## Changing a file

This skill is for reading. If the user asks for changes, use the `taste` command:

- `add-collection`, `add-item`, `attach`, `set`, `tag`, and so on. See `taste --help`.
- Set `TASTE_BY=agent:<your-name>` so that what you add is credited to you.

Never edit the ZIP in place with `zip`. To edit `taste.json` by hand, run `taste unpack`, edit,
then `taste pack`. These commands rewrite the file atomically and keep the blob hashes
consistent.
