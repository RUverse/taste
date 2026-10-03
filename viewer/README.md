# Taste Viewer

A Svelte 5 app that opens `.taste` files and shows their collections as a grid of cards or as a
tree of every field and file. Files are read in the browser with [`@ruverse/taste`](../js/) and are
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

Viewing only for now; editing and saving come next.

## Desktop apps (planned)

macOS, Windows, and Linux apps will wrap this same build with [Tauri](https://tauri.app). The app
is prepared for that:

- Everything that touches the user's files is in [`src/lib/platform.ts`](src/lib/platform.ts):
  choosing a file, dropped files, downloads. A desktop build replaces those functions with native
  dialogs and file access; no component reads files directly.
- The build uses relative asset paths and no server, which is what Tauri loads.
- Opening a file reads only the ZIP directory, and stored files are Blob slices, so large files
  stay fast in a webview.

The desktop work will add a `src-tauri/` folder that registers `.taste` as a document type (so
double-clicking a file opens the app), forwards "open with" events into the app, and saves in
place. Release builds would come from CI: a `.dmg` for macOS, `.msi` for Windows, and
`.AppImage`/`.deb` for Linux.
