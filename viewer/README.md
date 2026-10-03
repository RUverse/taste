# Taste Viewer

A Svelte 5 app that opens and edits `.taste` files and shows their collections as a grid of cards
or as a tree of every field and file. Files are read in the browser with [`@ruverse/taste`](../js/) and are
never uploaded; stored images are read from the file only as they scroll into view.

```bash
bun install            # from the repository root
bun run dev            # http://localhost:5173
bun run check          # svelte-check and TypeScript
bun run build          # static site in dist/
```

The build is a static site with relative paths, so it can be served from any folder.

## What it does

- Open a file with the button, by dropping it anywhere on the page, or try the bundled sample.
- Collections in the sidebar, plus Everything and Unsorted. Search, filter by kind and tag.
- Cards keep the shape of their artwork: posters, wide screenshots, square album covers. A
  collection's chosen screenshot (`show`) is used as the card image in that collection.
- The item panel shows metadata, where to watch or listen, tags, every collection the item is in
  with its note, and agent suggestions with their reason.
- The lightbox shows images, text and Markdown snapshots, audio, video, and PDFs, and downloads
  stored files.
- Tree view shows the whole file structure.
- The selected collection and item are in the URL hash, so Back and Forward work.

## Editing

- Start a new file from the welcome screen, or edit any file you open.
- Add, edit, and delete collections (name, vibe, description, tags, cover image) and items (kind,
  title, year, summary, tags, where to find it, links, catalog ids, details, the note in the
  current collection). An item can be part of another, such as an episode of a series.
- Add files to an item with the Add button, by dropping them on the item panel, or by pasting a
  screenshot. Images get their size and, above 512 pixels, a WebP thumbnail, as the Python
  library stores them. The file editor sets the role, caption, the moment it shows (`at`), tags,
  and whether it is the card image in the current collection.
- Put items in collections from the item panel or by dragging a card onto a collection in the
  sidebar. Drag cards to reorder a collection (when no filter is on), or use the arrows in the
  item panel.
- Every change can be undone and redone (⌘Z / Ctrl+Z, ⇧⌘Z / Ctrl+Y). Text fields keep their own
  undo.
- ⌘S / Ctrl+S saves. In Chromium-based browsers the file is written back where it was opened
  (the browser writes a temporary file and swaps it in, so an interrupted save leaves the old
  file intact); elsewhere it downloads the edited file. Saving a file that has manifest problems
  is refused, and blobs nothing refers to are left out. The page asks before closing with unsaved
  changes.

Changes are kept in memory until they are saved, so adding very large videos needs as much memory
as the videos take. Undo steps from before a save that removed files can no longer bring those
files back.

## Desktop apps (planned)

macOS, Windows, and Linux apps will wrap this same build with [Tauri](https://tauri.app). The app
is prepared for that:

- Everything that touches the user's files is in [`src/lib/platform.ts`](src/lib/platform.ts):
  choosing and saving files, dropped files, attachments, downloads, and confirmations. A desktop build replaces those functions with native
  dialogs and file access; no component reads files directly.
- The build uses relative asset paths and no server, which is what Tauri loads.
- Opening a file reads only the ZIP directory, and stored files are Blob slices, so large files
  stay fast in a webview.

The desktop work will add a `src-tauri/` folder that registers `.taste` as a document type (so
double-clicking a file opens the app), forwards "open with" events into the app, and implements
`saveFile` with a temporary file renamed over the original. Release builds would come from CI: a `.dmg` for macOS, `.msi` for Windows, and
`.AppImage`/`.deb` for Linux.
