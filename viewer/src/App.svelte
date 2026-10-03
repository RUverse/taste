<script lang="ts">
  import Browse from "./components/Browse.svelte";
  import ItemPanel from "./components/ItemPanel.svelte";
  import Lightbox from "./components/Lightbox.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Welcome from "./components/Welcome.svelte";
  import Icon from "./components/Icon.svelte";
  import { droppedFile } from "./lib/platform.ts";
  import { session } from "./lib/session.svelte.ts";

  let dragging = $state(false);
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
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function onDrop(event: DragEvent) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    dragging = false;
    const file = droppedFile(event);
    if (file) session.open(file);
  }

  $effect(() => {
    // Close the mobile collections drawer whenever the user moves somewhere.
    void session.scope;
    sidebarOpen = false;
  });

  $effect(() => {
    document.title = session.manifest
      ? `${session.manifest.title || session.name} · Taste Viewer`
      : "Taste Viewer";
  });
</script>

<svelte:window
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
{:else}
  <Welcome />
{/if}

{#if dragging}
  <div class="drop-overlay" aria-hidden="true">
    <div class="drop-overlay-card">
      <Icon name="open" size={28} />
      <p>Drop a <strong>.taste</strong> file to open it</p>
    </div>
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
