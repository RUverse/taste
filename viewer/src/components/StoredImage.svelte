<script lang="ts">
  import type { TasteFileEntry } from "@ruverse/taste";
  import { safeUrl } from "../lib/format.ts";
  import { session } from "../lib/session.svelte.ts";

  let {
    file,
    full = false,
    alt = "",
    eager = false,
    onfailure,
  }: {
    file: TasteFileEntry;
    full?: boolean;
    alt?: string;
    eager?: boolean;
    /** Called when the image cannot be loaded, so the caller can show something else. */
    onfailure?: () => void;
  } = $props();

  const THUMB_EDGE = 512;

  let element: HTMLImageElement | undefined = $state();
  let visible = $state(false);
  let src = $state<string | undefined>();
  let failed = $state(false);

  // Stored images are read from the file only once they come near the screen.
  $effect(() => {
    if (eager || !element) {
      visible = true;
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          visible = true;
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  });

  function fail() {
    failed = true;
    onfailure?.();
  }

  $effect(() => {
    const doc = session.doc;
    const target = file;
    failed = false;
    if (!visible || !doc) return;
    if (!target.blob) {
      src = safeUrl(target.url);
      if (!src) fail();
      return;
    }
    // Thumbnails are at most 512 pixels; larger displays (or sharper screens) get the original.
    const needed = (element?.clientWidth ?? 0) * (window.devicePixelRatio || 1);
    const useThumb = !full && target.thumb && doc.hasBlob(target.thumb) && needed <= THUMB_EDGE * 1.25;
    const ref = useThumb && target.thumb ? target.thumb : target.blob;
    const type = ref === target.blob ? target.type : "";
    let cancelled = false;
    doc.objectUrl(ref, type).then(
      (url) => {
        if (!cancelled) src = url;
      },
      () => {
        if (!cancelled) fail();
      },
    );
    return () => {
      cancelled = true;
    };
  });
</script>

<img
  bind:this={element}
  class="stored-image"
  class:failed
  {src}
  {alt}
  width={file.width}
  height={file.height}
  decoding="async"
  referrerpolicy="no-referrer"
  onerror={fail}
/>
