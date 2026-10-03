/**
 * Everything that touches the user's files goes through this module.
 *
 * The browser build uses the File System Access API where it exists (Chromium): files open with a
 * handle and save back to the same file. Elsewhere it uses a plain file input, and saving
 * downloads a copy. Desktop builds (Tauri, planned for macOS, Windows, and Linux) will provide the
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

interface Writable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}

interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable?(): Promise<Writable>;
  queryPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "readwrite" }): Promise<PermissionState>;
}

type PickerWindow = Window & {
  showOpenFilePicker?: (options: unknown) => Promise<FileHandle[]>;
  showSaveFilePicker?: (options: unknown) => Promise<FileHandle>;
};

const TASTE_TYPES = [{ description: "Taste files", accept: { [MIMETYPE]: [".taste"] } }];

/** Whether saving can write back to the file that was opened, rather than download a copy. */
export const savesInPlace = typeof (window as PickerWindow).showSaveFilePicker === "function";

/** Ask the user for a .taste file. Resolves to `null` when they cancel. */
export async function chooseFile(): Promise<OpenedFile | null> {
  const picker = (window as PickerWindow).showOpenFilePicker;
  if (picker) {
    try {
      const [handle] = await picker({
        types: TASTE_TYPES,
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

/**
 * Save a whole .taste file. Without `saveAs`, it goes back to the file it was opened from when the
 * platform allows; otherwise the user picks a place, or the browser downloads it. Resolves to the
 * saved file (read back from disk when it was written there), or `null` when the user cancels.
 *
 * The browser writes through a temporary file that replaces the original when complete, so an
 * interrupted save leaves the old file as it was.
 */
export async function saveFile(
  data: Blob,
  target: { name: string; handle?: unknown },
  saveAs = false,
): Promise<OpenedFile | null> {
  let handle = saveAs ? undefined : (target.handle as FileHandle | undefined);
  const picker = (window as PickerWindow).showSaveFilePicker;
  if (!handle?.createWritable && picker) {
    try {
      handle = await picker({ suggestedName: target.name, types: TASTE_TYPES });
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return null;
      handle = undefined;
    }
  }
  if (!handle?.createWritable) {
    download(data, target.name);
    return { name: target.name, data };
  }
  if (handle.queryPermission && (await handle.queryPermission({ mode: "readwrite" })) !== "granted") {
    const answer = await handle.requestPermission?.({ mode: "readwrite" });
    if (answer !== "granted") throw new Error("permission to save to the file was not given");
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort?.().catch(() => undefined);
    throw error;
  }
  const file = await handle.getFile();
  return { name: file.name, data: file, handle };
}

/** Ask the user for files to add to an item, such as screenshots. */
export function chooseAttachments(accept = ""): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = accept;
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

/** Ask the user to confirm something that is hard to take back. */
export async function confirmAction(message: string): Promise<boolean> {
  return window.confirm(message);
}
