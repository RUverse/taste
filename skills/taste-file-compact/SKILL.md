---
name: taste-file-compact
description: Read .taste files, ZIP archives of media collections (movies, series, music, articles, games…) that share a vibe. Use when a user shares or asks about a `.taste` file, or an attachment whose `mimetype` entry is `application/vnd.ruverse.taste+zip`.
---

# Reading .taste files

Everything is described in one JSON manifest. Read it:

```bash
unzip -p FILE taste.json
```

You don't need anything else in the archive to understand the file.

## How to read the manifest

- **Collections** are groups of things that feel alike. A collection's `vibe` says in plain words
  what that feeling is.
- Each collection's **entries** point to **items** by id. One item can be in several
  collections.
- An entry's `note` says why the item is in that collection. Its `reason` says why an agent
  suggested it, and `added_by` says who added it.
- **Items** are the works themselves: a movie, a track, an article, a game. `kind` says which.
  `meta` holds facts about the work, `tags` holds the user's own opinions, and `availability`
  says where to watch, hear, read or play it.
- An item with a `parent` belongs to another item, such as an episode and its series. An item
  can also be in no collection at all.
- **Files** are an item's posters, screenshots and saved articles. Their `caption` and `at` (the
  moment in the work) tell you what they show, so you don't need to open the images. An entry's
  `show` lists the files that best represent the item in that collection.
