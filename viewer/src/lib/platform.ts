/**
 * Everything that touches the user's files goes through this module.
 *
 * The browser build uses the File System Access API where it exists (Chromium) and a plain file
 * input elsewhere. Desktop builds (Tauri, planned for macOS, Windows, and Linux) will provide the
 * same functions backed by native dialogs and "open with" events, so the rest of the app does not
 * change.
 */

import { MIMETYPE } from "@ruverse/taste";

export interface OpenedFile {
  name: string;
  data: Blob;
  /** Present when the platform can later write back to the same file. */
  handle?: unknown;
}

type PickerWindow = Window & {
  showOpenFilePicker?: (options: unknown) => Promise<{ getFile(): Promise<File> }[]>;
};

/** Ask the user for a .taste file. Resolves to `null` when they cancel. */
export async function chooseFile(): Promise<OpenedFile | null> {
  const picker = (window as PickerWindow).showOpenFilePicker;
  if (picker) {
    try {
      const [handle] = await picker({
        types: [{ description: "Taste files", accept: { [MIMETYPE]: [".taste"] } }],
        excludeAcceptAllOption: false,
        multiple: false,
      });
      if (!handle) return null;
      const file = await handle.getFile();
      return { name: file.name, data: file, handle };
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return null;
      // Some embedded browsers expose the API but refuse to run it; fall back to an input.
    }
  }
  return chooseWithInput();
}

function chooseWithInput(): Promise<OpenedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".taste";
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, data: file } : null);
    });
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/** A file dropped onto the window, if the drop carried one. */
export function droppedFile(event: DragEvent): OpenedFile | null {
  const file = event.dataTransfer?.files?.[0];
  return file ? { name: file.name, data: file } : null;
}

/** Fetch a .taste file from a URL, such as the bundled sample. */
export async function fetchFile(url: string, name: string): Promise<OpenedFile> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load ${name} (HTTP ${response.status})`);
  return { name, data: await response.blob() };
}

/** Offer a blob to the user as a download. */
export function download(data: Blob, name: string): void {
  const url = URL.createObjectURL(data);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
