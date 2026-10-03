# The `.taste` format, version 0.1

Status: draft. Anything in 0.x may change; a reader that understands `0.1` is not required to
read `0.2`.

A `.taste` file is one portable file holding one or more **collections**: sets of media that
share a vibe, such as 15 movies, 34 music tracks, and 4 articles that all feel like a rainy
Sunday. Each **item** (a movie, a track, an article, a game…) carries its own metadata, where to
get it, the user's tags, and optional **files** such as a poster, screenshots, or a saved copy of
an article.

The format is designed to be read by people through a viewer and by agents through a library or
command-line tool. The whole structure, every tag, and a text description of every file live in
one small JSON document, so a reader can understand a collection without opening any media.

The key words MUST, SHOULD, and MAY are used as described in RFC 2119.

## 1. Container

A `.taste` file is a ZIP archive (APPNOTE 6.3) with these entries:

| Entry | Required | Contents |
| --- | --- | --- |
| `mimetype` | yes | The ASCII bytes `application/vnd.ruverse.taste+zip`, with no newline |
| `taste.json` | yes | The manifest, UTF-8 JSON (section 2) |
| `blobs/sha256/<hex>` | no | File contents, named by the lowercase SHA-256 of the bytes |

- `mimetype` MUST be the first entry, MUST be stored without compression, and SHOULD have no
  extra field, so tools can identify the format from the first bytes of the file.
- `taste.json` SHOULD be the second entry, so streaming readers reach it early.
- Each entry name MUST appear at most once in the central directory.
- Writers SHOULD store already-compressed media (JPEG, PNG, WebP, MP3, MP4…) without
  compression and SHOULD deflate text.
- Writers SHOULD use a fixed entry timestamp (1980-01-01 00:00:00) so the same content produces
  the same bytes.
- Readers MUST ignore entries they do not recognise and blobs that the manifest does not reference.
- A reader MAY verify that each blob's SHA-256 matches its name, and SHOULD reject the file if one
  does not.

### Saving

Writers MUST NOT leave a partially written file at the destination path. The RECOMMENDED way is
to write a temporary file in the same directory and rename it over the destination. A writer that
rewrites the file SHOULD drop blobs that are no longer referenced.

Writers MAY instead update a file in place by appending entries and a new central directory, as
long as the result still satisfies this section. Unreferenced blobs left by such updates are
removed by the next full rewrite.

## 2. Manifest

`taste.json` is a JSON object:

```json
{
  "taste": "0.1",
  "title": "rez's moods",
  "description": "",
  "created": "2026-10-03T12:00:00Z",
  "modified": "2026-10-03T12:00:00Z",
  "generator": "taste-format 0.1.0",
  "collections": [],
  "items": {}
}
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `taste` | string | yes | Format version, `"0.1"` |
| `title` | string | no | Name of the whole file |
| `description` | string | no | Free text |
| `created`, `modified` | timestamp | no | When the file was created and last saved |
| `generator` | string | no | The software that last wrote the file |
| `collections` | array of Collection | yes | In display order |
| `items` | object of Item | yes | Keyed by item id |

**Timestamps** are RFC 3339 strings in UTC, such as `2026-10-03T12:00:00Z`. A plain date such as
`2026-10-03` is also accepted where only the day matters.

**Ids** for collections, items, and files match `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`. They should
be readable, such as `rainy-sunday` or `lost-in-translation-2003`, because agents and people use
them as names. Item and collection ids are unique within the file; file ids are unique within
their item.

**Unknown fields** are allowed everywhere. A writer that does not understand a field MUST keep it
when it rewrites the manifest. Extension fields SHOULD be prefixed with a namespace, such as
`"x-mytaste": {...}`.

### 2.1 Collection

```json
{
  "id": "rainy-sunday",
  "name": "Rainy Sunday",
  "vibe": "Quiet, melancholic, warm. Grey light, slow pacing, nothing loud.",
  "tags": { "mood": ["melancholic", "cozy"], "season": "autumn" },
  "icon": "cloud-rain",
  "cover": { "id": "cover", "role": "cover", "blob": "sha256:…", "type": "image/jpeg" },
  "created": "2026-10-03T12:00:00Z",
  "entries": [
    { "item": "lost-in-translation-2003", "note": "The hotel window scenes.", "show": ["shot-1"] }
  ]
}
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | id | yes | |
| `name` | string | yes | Display name |
| `vibe` | string | no | What ties the collection together, in plain words. Agents read this to judge whether something belongs |
| `description` | string | no | Any other text |
| `tags` | Tags | no | |
| `icon` | string | no | A short icon name; viewers choose how to draw it |
| `cover` | File | no | An image for the collection itself |
| `created` | timestamp | no | |
| `entries` | array of Entry | yes | The collection's items in display order |

### 2.2 Entry

An entry places an item in a collection. The same item can appear in several collections, each
with its own note; it appears at most once in one collection.

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `item` | id | yes | An id in `items` |
| `note` | string | no | Why it is here, or what to notice |
| `show` | array of id | no | File ids of that item that represent it in this collection, for example the one screenshot that captures the vibe |
| `added` | timestamp | no | |
| `added_by` | Actor | no | |
| `reason` | string | no | Why an agent suggested it |

### 2.3 Item

```json
{
  "kind": "movie",
  "title": "Lost in Translation",
  "year": 2003,
  "summary": "A fading actor and a young woman drift through Tokyo.",
  "ids": { "tmdb": 153, "imdb": "tt0335266" },
  "meta": { "director": "Sofia Coppola", "genres": ["Drama", "Romance"], "runtime": 102 },
  "links": [{ "url": "https://www.themoviedb.org/movie/153", "label": "TMDB" }],
  "availability": [
    { "service": "netflix", "region": "DE", "type": "subscription", "url": "https://…", "checked": "2026-10-01" }
  ],
  "files": [],
  "tags": { "mood": "lonely", "watched": true, "rating": 5 },
  "added": "2026-10-03T12:00:00Z",
  "added_by": { "type": "user" }
}
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `kind` | string | yes | What the item is (section 3) |
| `title` | string | yes | |
| `year` | integer | no | Release year |
| `summary` | string | no | A short description, for people and agents |
| `ids` | object | no | Identifiers in other catalogs; values are strings or integers |
| `meta` | object | no | Facts about the work, see the kind profiles in section 3. Any JSON |
| `links` | array of Link | no | Related web pages |
| `availability` | array of Availability | no | Where it can be watched, heard, read, or played |
| `files` | array of File | no | Files belonging to the item |
| `tags` | Tags | no | The user's own labels |
| `parent` | id | no | The item this one belongs to, such as an episode's series |
| `added` | timestamp | no | |
| `added_by` | Actor | no | |

**Link:** `{ "url": "https://…", "label": "Trailer" }`. `url` is required.

**Availability:** `service` (required, a short service name such as `netflix` or `spotify`),
`region` (ISO 3166-1 alpha-2), `type` (`subscription`, `free`, `ads`, `rent`, `buy`), `url`, and
`checked` (timestamp). Availability changes over time and differs by country, so `checked` and
`region` SHOULD be set; readers SHOULD treat old entries as possibly out of date.

### 2.4 File

A file is either stored in the container (`blob`) or kept elsewhere (`url`). Exactly one of the
two MUST be present.

```json
{
  "id": "shot-1",
  "role": "screenshot",
  "blob": "sha256:c41e…",
  "type": "image/png",
  "size": 482113,
  "name": "window.png",
  "width": 1920,
  "height": 800,
  "thumb": "sha256:0b7d…",
  "at": { "time": "00:23:41" },
  "caption": "Charlotte at the hotel window over Tokyo at night.",
  "tags": { "palette": ["blue", "neon"] },
  "added": "2026-10-03T14:10:00Z",
  "added_by": { "type": "user" }
}
```

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `id` | id | yes | Unique within the item |
| `role` | string | yes | What the file is for (below) |
| `blob` | blob ref | one of | `sha256:` and 64 lowercase hex digits; the bytes are at `blobs/sha256/<hex>` |
| `url` | string | one of | A remote file |
| `type` | string | yes | Media type, such as `image/jpeg` |
| `size` | integer | no | Size in bytes; writers SHOULD set it for blobs |
| `name` | string | no | Original file name |
| `width`, `height` | integer | no | Pixel size of images and video |
| `duration` | number | no | Length in seconds of audio and video |
| `thumb` | blob ref | no | A small preview image, RECOMMENDED for images larger than 512 pixels |
| `at` | object | no | The moment in the work the file shows (section 3) |
| `caption` | string | no | What the file shows, in words. RECOMMENDED for images, so agents that cannot see the image can still search and reason about it |
| `tags` | Tags | no | |
| `added`, `added_by` | | no | |

Roles: `poster`, `cover`, `backdrop`, `screenshot`, `media` (the work itself, such as an audio
file), `preview` (a clip or sample), `snapshot` (a saved copy of a web page or article),
`lyrics`, `subtitle`, `attachment` (anything else). Readers MUST accept other roles and treat
them as `attachment`.

The same blob can be referenced by many files. A blob that no file references is not part of the
document.

### 2.5 Tags and actors

**Tags** are an object mapping a name to a string, number, boolean, or array of strings:
`{ "mood": ["calm", "lonely"], "rating": 5, "watched": true }`. Tag names are free; viewers SHOULD
let people filter by any tag.

**Actor** records who added something: `{ "type": "user" }` or
`{ "type": "agent", "name": "hermes" }`. Viewers SHOULD let people review what agents added.

## 3. Kinds

`kind` is a lowercase dotted name. These kinds are defined; any other value is valid, and readers
show unknown kinds with their `meta` as a plain tree. The listed `meta` fields are
recommendations, not requirements.

| Kind | Suggested `ids` | Suggested `meta` | `at` fields |
| --- | --- | --- | --- |
| `movie` | `tmdb`, `imdb` | `director`, `genres`, `runtime` (minutes), `languages`, `countries` | `time` |
| `tv` | `tmdb`, `imdb`, `tvdb` | `creators`, `genres`, `seasons`, `networks` | `season`, `episode`, `time` |
| `tv.episode` | `tmdb`, `imdb` | `season`, `episode`; `parent` is the `tv` item | `time` |
| `music.track` | `musicbrainz`, `spotify`, `isrc` | `artists`, `album`, `duration` (seconds) | `time` |
| `music.album` | `musicbrainz`, `spotify`, `upc` | `artists`, `tracks` | `track`, `time` |
| `podcast.episode` | `spotify`, `apple` | `show`, `published`, `duration` | `time` |
| `video` | `youtube`, `vimeo` | `channel`, `published`, `duration` | `time` |
| `game` | `igdb`, `steam` | `developers`, `platforms`, `genres` | `platform`, `chapter`, `level`, `location`, `playtime` |
| `book` | `isbn`, `openlibrary` | `authors`, `publisher`, `published`, `pages` | `page`, `chapter` |
| `article` | `doi` | `author`, `site`, `published` | `section` |
| `image` | | `artist`, `taken` | |
| `place` | `osm` | `address`, `lat`, `lon` | |
| `note` | | | |

`at.time` is `HH:MM:SS` with optional fractions of a second (`00:23:41.250`). `at.playtime` is the
total play time in the same form. `at.season`, `at.episode`, `at.track`, and `at.page` are
integers; the other `at` fields are strings.

## 4. Reading without unpacking

A reader opens `taste.json` through the ZIP central directory and reads a blob only when it is
needed. Viewers SHOULD load `thumb` blobs for tree and grid views and load full blobs on demand.
Agents SHOULD start from the manifest, which describes every file through its `role`, `type`,
`at`, `caption`, and `tags`.

## 5. Validation

A file is valid when it satisfies the container rules in section 1, `taste.json` matches
[`taste.schema.json`](taste.schema.json), and:

1. Collection ids are unique.
2. Every entry's `item` exists in `items`, and no item appears twice in one collection.
3. Every id in an entry's `show` is a file id of that entry's item.
4. File ids are unique within their item.
5. Every `parent` exists in `items` and is not the item itself.
6. Every `blob` and `thumb` reference names a blob present in the container.

Items that belong to no collection are allowed; a viewer MAY show them as unsorted.

## 6. Versioning

`taste` holds `MAJOR.MINOR`. Before 1.0, readers SHOULD refuse versions they do not know and MAY
offer to open them read-only. From 1.0 on, a minor version only adds optional fields.
