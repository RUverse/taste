<script lang="ts">
  import { extensionFor, formatAt, isStored, tagPairs, type TasteFileEntry } from "@ruverse/taste";
  import { actorLabel, bytes, fieldLabel, safeUrl } from "../lib/format.ts";
  import { download } from "../lib/platform.ts";
  import { session } from "../lib/session.svelte.ts";
  import Icon from "./Icon.svelte";
  import StoredImage from "./StoredImage.svelte";

  const TEXT_TYPES = /^(text\/|application\/(json|xml|x-subrip|.*\+json|.*\+xml))/;
  const TEXT_LIMIT = 512 * 1024;

  let dialog: HTMLDialogElement | undefined = $state();
  const gallery = $derived(session.lightbox);
  const file = $derived(gallery ? gallery.files[gallery.index] : undefined);
  const kind = $derived(file ? viewKind(file) : "none");

  let mediaUrl = $state<string | undefined>();
  let text = $state<string | undefined>();
  let loadError = $state<string | undefined>();

  function viewKind(entry: TasteFileEntry): "image" | "text" | "audio" | "video" | "pdf" | "other" {
    if (entry.type.startsWith("image/")) return "image";
    if (TEXT_TYPES.test(entry.type)) return "text";
    if (entry.type.startsWith("audio/")) return "audio";
    if (entry.type.startsWith("video/")) return "video";
    if (entry.type === "application/pdf") return "pdf";
    return "other";
  }

  $effect(() => {
    if (!dialog) return;
    if (gallery && !dialog.open) dialog.showModal();
    if (!gallery && dialog.open) dialog.close();
  });

  $effect(() => {
    const entry = file;
    const doc = session.doc;
    mediaUrl = undefined;
    text = undefined;
    loadError = undefined;
    if (!entry || !doc || kind === "image") return;
    let cancelled = false;
    if (!isStored(entry)) {
      mediaUrl = safeUrl(entry.url);
      return;
    }
    const load = async () => {
      if (kind === "text") {
        const size = doc.blobSize(entry.blob) ?? 0;
        if (size > TEXT_LIMIT) throw new Error(`This file is ${bytes(size)}; download it to read it.`);
        return { text: await doc.text(entry.blob) };
      }
      if (kind === "other") return {};
      return { url: await doc.objectUrl(entry.blob, entry.type) };
    };
    load().then(
      (result) => {
        if (cancelled) return;
        text = result.text;
        mediaUrl = result.url;
      },
      (error: Error) => {
        if (!cancelled) loadError = error.message;
      },
    );
    return () => {
      cancelled = true;
    };
  });

  function step(delta: number) {
    if (!gallery) return;
    const index = gallery.index + delta;
    if (index < 0 || index >= gallery.files.length) return;
    session.lightbox = { ...gallery, index };
  }

  async function save() {
    const doc = session.doc;
    if (!doc || !file || !isStored(file)) return;
    const name = file.name ?? `${file.id}${extensionFor(file.type)}`;
    download(await doc.blob(file.blob, file.type), name);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === "ArrowLeft") step(-1);
    else if (event.key === "ArrowRight") step(1);
  }
</script>

<dialog
  bind:this={dialog}
  class="lightbox"
  aria-label={file ? `${gallery?.title}: ${fieldLabel(file.role)}` : "File"}
  onclose={() => (session.lightbox = null)}
  onkeydown={onKeydown}
  onclick={(event) => {
    if (event.target === dialog) session.lightbox = null;
  }}
>
  {#if gallery && file}
    <header class="lightbox-bar">
      <p class="lightbox-title">
        <strong>{gallery.title}</strong>
        <span>{fieldLabel(file.role)}{#if file.at} · {formatAt(file.at)}{/if}</span>
      </p>
      {#if gallery.files.length > 1}
        <span class="lightbox-count">{gallery.index + 1} / {gallery.files.length}</span>
      {/if}
      {#if gallery.itemId}
        {@const itemId = gallery.itemId}
        <button class="icon-button" type="button" aria-label="Edit file" title="Edit" onclick={() => (session.editor = { kind: "file", itemId, fileId: file.id })}>
          <Icon name="pencil" />
        </button>
      {/if}
      {#if isStored(file)}
        <button class="icon-button" type="button" aria-label="Download" title="Download" onclick={save}>
          <Icon name="download" />
        </button>
      {:else if safeUrl(file.url)}
        <a class="icon-button" href={safeUrl(file.url)} target="_blank" rel="noopener noreferrer" aria-label="Open the original" title="Open the original">
          <Icon name="external" />
        </a>
      {/if}
      <button class="icon-button" type="button" aria-label="Close" title="Close (Esc)" onclick={() => (session.lightbox = null)}>
        <Icon name="close" />
      </button>
    </header>

    <div class="lightbox-stage">
      {#if gallery.files.length > 1}
        <button class="lightbox-step lightbox-prev" type="button" aria-label="Previous file" disabled={gallery.index === 0} onclick={() => step(-1)}>
          <Icon name="left" size={22} />
        </button>
      {/if}

      {#key file}
        {#if kind === "image"}
          <StoredImage {file} full eager alt={file.caption ?? ""} />
        {:else if loadError}
          <p class="lightbox-message">{loadError}</p>
        {:else if kind === "text" && text !== undefined}
          <pre class="lightbox-text">{text}</pre>
        {:else if kind === "audio" && mediaUrl}
          <audio controls src={mediaUrl}></audio>
        {:else if kind === "video" && mediaUrl}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video controls src={mediaUrl}></video>
        {:else if kind === "pdf" && mediaUrl}
          <iframe class="lightbox-frame" src={mediaUrl} title={file.name ?? "PDF"}></iframe>
        {:else if kind === "other"}
          <div class="lightbox-message">
            <Icon name="file" size={36} />
            <p>{file.name ?? file.type} can’t be shown here.</p>
            {#if isStored(file)}<button class="button" type="button" onclick={save}><Icon name="download" size={16} /> Download</button>{/if}
          </div>
        {:else}
          <p class="lightbox-message">Loading…</p>
        {/if}
      {/key}

      {#if gallery.files.length > 1}
        <button class="lightbox-step lightbox-next" type="button" aria-label="Next file" disabled={gallery.index === gallery.files.length - 1} onclick={() => step(1)}>
          <Icon name="right" size={22} />
        </button>
      {/if}
    </div>

    <footer class="lightbox-info">
      {#if file.caption}<p class="lightbox-caption">{file.caption}</p>{/if}
      <p class="lightbox-facts">
        <span>{file.type}</span>
        {#if file.width && file.height}<span>{file.width} × {file.height}</span>{/if}
        {#if isStored(file)}<span>{bytes(file.size ?? session.doc?.blobSize(file.blob))}</span>{/if}
        {#if file.name}<span>{file.name}</span>{/if}
        {#if file.added_by}<span>added by {actorLabel(file.added_by)}</span>{/if}
        {#each tagPairs(file.tags) as [key, value], index (index)}<span class="tag"><span class="tag-key">{key}</span>{value}</span>{/each}
      </p>
    </footer>
  {/if}
</dialog>
