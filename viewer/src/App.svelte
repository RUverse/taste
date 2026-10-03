<script lang="ts">
  import Browse from "./components/Browse.svelte";
  import Editors from "./components/Editors.svelte";
  import ItemPanel from "./components/ItemPanel.svelte";
  import Lightbox from "./components/Lightbox.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Welcome from "./components/Welcome.svelte";
  import Icon from "./components/Icon.svelte";
  import { droppedFile } from "./lib/platform.ts";
  import { session } from "./lib/session.svelte.ts";

  let dragging = $state(false);
  /** Over a part of the page that takes dropped files itself, such as the item panel. */
  let overDropzone = $state(false);
  let dragDepth = 0;
  let sidebarOpen = $state(false);

  function hasFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes("Files") ?? false;
  }

  function onDragEnter(event: DragEvent) {
    if (!hasFiles(event)) return;
    dragDepth++;
    dragging = true;
  }

  function onDragLeave(event: DragEvent) {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dragging = false;
  }

  function onDragOver(event: DragEvent) {
    if (!hasFiles(event)) return;
    overDropzone = Boolean((event.target as Element | null)?.closest?.("[data-dropzone]"));
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function onDrop(event: DragEvent) {
    if (!hasFiles(event)) return;
    dragDepth = 0;
    dragging = false;
    // A drop zone inside the page (the item panel) already took the files.
    if (event.defaultPrevented) return;
    event.preventDefault();
    const file = droppedFile(event);
    if (file) session.open(file);
  }

  $effect(() => {
    // Close the mobile collections drawer whenever the user moves somewhere.
    void session.scope;
    sidebarOpen = false;
  });

  $effect(() => {
    const name = session.manifest ? `${session.manifest.title || session.name}` : "";
    document.title = name ? `${session.dirty ? "• " : ""}${name} · Taste Viewer` : "Taste Viewer";
  });

  $effect(() => {
    // Short confirmations go away by themselves.
    if (!session.notice) return;
    const timer = setTimeout(() => (session.notice = null), 3500);
    return () => clearTimeout(timer);
  });

  function onKeydown(event: KeyboardEvent) {
    if (!session.manifest || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === "s") {
      event.preventDefault();
      session.save(event.shiftKey);
      return;
    }
    // Text fields and open forms keep their own undo.
    const target = event.target instanceof Element ? event.target : null;
    if (session.editor || target?.closest("input, textarea, select, [contenteditable]")) return;
    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      session.undo();
    } else if ((key === "z" && event.shiftKey) || key === "y") {
      event.preventDefault();
      session.redo();
    }
  }

  function onBeforeUnload(event: BeforeUnloadEvent) {
    if (session.manifest && session.dirty) event.preventDefault();
  }
</script>

<svelte:window
  onkeydown={onKeydown}
  onbeforeunload={onBeforeUnload}
  onhashchange={() => session.readHash()}
  onpopstate={() => session.readHash()}
  ondragenter={onDragEnter}
  ondragleave={onDragLeave}
  ondragover={onDragOver}
  ondrop={onDrop}
/>

{#if session.manifest}
  <div class="shell" class:has-panel={session.item !== null}>
    <Sidebar open={sidebarOpen} onclose={() => (sidebarOpen = false)} />
    <main class="main" id="main">
      <button
        class="icon-button menu-button"
        type="button"
        aria-label="Show collections"
        aria-expanded={sidebarOpen}
        onclick={() => (sidebarOpen = true)}
      >
        <Icon name="menu" />
      </button>
      <Browse />
    </main>
    {#if session.item && session.itemId}
      {#key session.itemId}
        <ItemPanel itemId={session.itemId} item={session.item} />
      {/key}
    {/if}
  </div>
  <Lightbox />
  <Editors />
{:else}
  <Welcome />
{/if}

{#if dragging && !overDropzone}
  <div class="drop-overlay" aria-hidden="true">
    <div class="drop-overlay-card">
      <Icon name="open" size={28} />
      <p>Drop a <strong>.taste</strong> file to open it</p>
    </div>
  </div>
{/if}

{#if session.manifest && (session.busy || session.notice) && !session.error}
  <div class="toast toast-info" role="status">
    <Icon name={session.busy ? "paperclip" : "check"} />
    <span>{session.busy ?? session.notice}</span>
  </div>
{/if}

{#if session.error && session.manifest}
  <div class="toast" role="alert">
    <Icon name="alert" />
    <span>{session.error}</span>
    <button class="icon-button" type="button" aria-label="Dismiss" onclick={() => (session.error = null)}>
      <Icon name="close" size={16} />
    </button>
  </div>
{/if}
