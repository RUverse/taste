# taste

`.taste` is a file format for collections of media that share a vibe: say 15 movies, 34 music
tracks, 4 articles, and a game that all feel like a rainy Sunday. One file can hold several
collections. Each item keeps its own metadata, where to watch, hear, read, or play it, the user's
tags, and optional files such as posters, screenshots, or a saved copy of an article.

A `.taste` file is a single ZIP archive with a small JSON manifest (`taste.json`) and
content-addressed files. Viewers and agents read the manifest to see every collection, item, tag,
and file description, and open a stored file only when they need it.

```
moods.taste
├── mimetype       application/vnd.ruverse.taste+zip
├── taste.json     collections → entries → items → files, all described in JSON
└── blobs/sha256/  posters, screenshots, snapshots… named by their hash
```

## What is here

| Folder | Contents |
| --- | --- |
| [`spec/`](spec/) | [The specification](spec/SPEC.md), the [JSON Schema](spec/taste.schema.json), a [sample file](spec/examples/moods.taste), and shared [conformance fixtures](spec/fixtures/) |
| [`python/`](python/) | Reference library and the `taste` command |
| [`js/`](js/) | `@ruverse/taste`: TypeScript reading and editing for browsers, Bun, Node, and desktop webviews |
| [`viewer/`](viewer/) | Taste Viewer, a Svelte app that opens and edits `.taste` files (desktop apps planned) |

The Python and TypeScript implementations are checked against the same fixtures in
`spec/fixtures/`, including the exact location of every reported problem.

## Try it

Open the viewer (requires [Bun](https://bun.sh)):

```bash
bun install
bun run dev        # then choose "Try the sample"
```

Or use the command line:

```bash
cd python
uv sync --extra dev
uv run taste tree ../spec/examples/moods.taste
```

```
Rainy Sunday  [rainy-sunday]
  Quiet, melancholic, warm. Grey light, slow pacing, nothing loud.
  ├─ movie           Lost in Translation (2003)  [lost-in-translation-2003]
  │  ├─ note: The hotel window scenes.
  │  ├─  poster       image/jpeg  [poster]
  │  ├─  screenshot   image/png  00:23:41  Charlotte sits in the hotel window…  [window]
  │  └─ *screenshot   image/png  01:02:10  Rain on the taxi window, city lights blurred.  [rain]
  ├─ music.track     Motion Picture Soundtrack (2000)  [motion-picture-soundtrack-2000]
  …
```

Build a file from the shell:

```bash
taste new moods.taste --title "My moods"
taste add-collection moods.taste "Rainy Sunday" --vibe "Quiet, grey, slow." --tag mood=calm
taste add-item moods.taste --kind movie --title "Lost in Translation" --year 2003 \
  --ext tmdb:=153 --meta "director=Sofia Coppola" --to rainy-sunday
taste attach moods.taste lost-in-translation-2003 shot.png --role screenshot \
  --at time=00:23:41 --caption "Hotel window at night" --show-in rainy-sunday
taste find moods.taste mood=calm
taste validate moods.taste --deep
```

`key=text` sets a string (repeat a key to make a list) and `key:=json` sets any JSON value, such
as `rating:=5`. Agents should set `TASTE_BY=agent:<name>` so the items and entries they add are
credited to them. `taste unpack` and `taste pack` convert between a `.taste` file and a plain
folder for editing `taste.json` by hand.

From Python:

```python
from taste import Taste

with Taste.open("moods.taste") as doc:
    for item_id in doc.find(collection="rainy-sunday", tags={"mood": "calm"}):
        print(doc.item(item_id)["title"])
    doc.attach("lost-in-translation-2003", "shot.png", role="screenshot",
               at={"time": "00:23:41"}, caption="Hotel window at night")
    doc.save()
```

Saving rewrites the file in one step (a temporary file renamed over the original), so an
interrupted save never leaves a damaged file, and stored files that nothing refers to are dropped.

## Contributing

Branches come from `dev` and pull requests go back to `dev`; see
[CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and the checks to run.

## License

MIT. See [LICENSE](LICENSE).
