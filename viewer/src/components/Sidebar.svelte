<script lang="ts">
  import { draggedItem, endItemDrag } from "../lib/drag.ts";
  import { bytes, date, plural } from "../lib/format.ts";
  import { chooseFile, savesInPlace } from "../lib/platform.ts";
  import { session, type Scope } from "../lib/session.svelte.ts";
  import Icon from "./Icon.svelte";
  import StoredImage from "./StoredImage.svelte";

  let { open, onclose }: { open: boolean; onclose: () => void } = $props();

  const manifest = $derived(session.manifest!);
  const totalItems = $derived(Object.keys(manifest.items).length);

  function isCurrent(scope: Scope): boolean {
    const current = session.scope;
    if (scope.kind !== current.kind) return false;
    return scope.kind !== "collection" || (current.kind === "collection" && scope.id === current.id);
  }

  async function openAnother() {
    const file = await chooseFile();
    if (file) await session.open(file);
  }

  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";
  const undoLabel = $derived(session.undoStack.at(-1)?.label);
  const redoLabel = $derived(session.redoStack.at(-1)?.label);
  const saveLabel = savesInPlace ? "Save" : "Download";
  let dropTarget = $state<string | null>(null);

  function canDrop(event: DragEvent, collectionId: string): boolean {
    const itemId = draggedItem(event);
    const collection = manifest.collections.find((c) => c.id === collectionId);
    return Boolean(itemId && collection && !collection.entries.some((e) => e.item === itemId));
  }

  function dropOn(event: DragEvent, collectionId: string) {
    const itemId = draggedItem(event);
    const allowed = canDrop(event, collectionId);
    dropTarget = null;
    endItemDrag();
    if (!itemId || !allowed) return;
    event.preventDefault();
    const collection = manifest.collections.find((c) => c.id === collectionId)!;
    const title = manifest.items[itemId]?.title ?? itemId;
    if (session.edit(`Add “${title}” to ${collection.name}`, (doc) => doc.addEntry(collectionId, itemId))) {
      session.notice = `Added “${title}” to ${collection.name}`;
    }
  }
</script>

{#if open}
  <button class="scrim" type="button" aria-label="Close collections" onclick={onclose}></button>
{/if}

<nav class="sidebar" class:open aria-label="Collections">
  <header class="sidebar-head">
    <div class="sidebar-title">
      <h1>{manifest.title || session.name}</h1>
      <p>{session.name}{#if session.doc?.size !== undefined} · {bytes(session.doc.size)}{/if}</p>
    </div>
    <button class="icon-button" type="button" aria-label="Edit the title and description" title="Edit the title and description" onclick={() => (session.editor = { kind: "document" })}>
      <Icon name="pencil" size={16} />
    </button>
    <button class="icon-button sidebar-close" type="button" aria-label="Close collections" onclick={onclose}>
      <Icon name="close" />
    </button>
  </header>

  {#if manifest.description}
    <p class="sidebar-description">{manifest.description}</p>
  {/if}

  <div class="save-bar">
    <button
      class="button button-small"
      class:button-primary={session.dirty}
      type="button"
      disabled={session.saving}
      title="{savesInPlace ? 'Save' : 'Download the file with your changes'} ({mod}S)"
      onclick={() => session.save()}
    >
      <Icon name={savesInPlace ? "save" : "download"} size={15} />
      {session.saving ? "Saving…" : saveLabel}
    </button>
    <button class="icon-button" type="button" aria-label="Undo" title={undoLabel ? `Undo ${undoLabel} (${mod}Z)` : "Nothing to undo"} disabled={!undoLabel} onclick={() => session.undo()}>
      <Icon name="undo" size={17} />
    </button>
    <button class="icon-button" type="button" aria-label="Redo" title={redoLabel ? `Redo ${redoLabel}` : "Nothing to redo"} disabled={!redoLabel} onclick={() => session.redo()}>
      <Icon name="redo" size={17} />
    </button>
    <span class="save-state" class:unsaved={session.dirty}>{session.dirty ? "Unsaved changes" : "Saved"}</span>
  </div>

  <ul class="nav-list" role="list">
    <li>
      <a
        class="nav-link"
        href="#/all"
        aria-current={isCurrent({ kind: "all" }) ? "page" : undefined}
        onclick={(event) => {
          event.preventDefault();
          session.go({ kind: "all" });
        }}
      >
        <span class="nav-icon"><Icon name="layers" /></span>
        <span class="nav-name">Everything</span>
        <span class="nav-count">{totalItems}</span>
      </a>
    </li>
  </ul>

  <div class="nav-heading-row">
    <h2 class="nav-heading">Collections</h2>
    <button class="icon-button" type="button" aria-label="New collection" title="New collection" onclick={() => (session.editor = { kind: "collection", id: null })}>
      <Icon name="plus" size={16} />
    </button>
  </div>
  {#if manifest.collections.length === 0}
    <p class="nav-empty">This file has no collections yet.</p>
  {:else}
    <ul class="nav-list" role="list">
      {#each manifest.collections as collection (collection.id)}
        {@const scope = { kind: "collection" as const, id: collection.id }}
        <li>
          <a
            class="nav-link"
            href="#/c/{encodeURIComponent(collection.id)}"
            aria-current={isCurrent(scope) ? "page" : undefined}
            class:drop-target={dropTarget === collection.id}
            title={collection.vibe}
            onclick={(event) => {
              event.preventDefault();
              session.go(scope);
            }}
            ondragover={(event) => {
              if (!canDrop(event, collection.id)) return;
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
              dropTarget = collection.id;
            }}
            ondragleave={() => {
              if (dropTarget === collection.id) dropTarget = null;
            }}
            ondrop={(event) => dropOn(event, collection.id)}
          >
            <span class="nav-icon nav-cover">
              {#if collection.cover?.type.startsWith("image/")}
                <StoredImage file={collection.cover} eager />
              {:else}
                <Icon name="folder" />
              {/if}
            </span>
            <span class="nav-name">{collection.name}</span>
            <span class="nav-count">{collection.entries.length}</span>
          </a>
        </li>
      {/each}
    </ul>
  {/if}

  {#if session.unsortedIds.length}
    <ul class="nav-list nav-list-after" role="list">
      <li>
        <a
          class="nav-link"
          href="#/unsorted"
          aria-current={isCurrent({ kind: "unsorted" }) ? "page" : undefined}
          title="Items that are in no collection"
          onclick={(event) => {
            event.preventDefault();
            session.go({ kind: "unsorted" });
          }}
        >
          <span class="nav-icon"><Icon name="inbox" /></span>
          <span class="nav-name">Unsorted</span>
          <span class="nav-count">{session.unsortedIds.length}</span>
        </a>
      </li>
    </ul>
  {/if}

  <footer class="sidebar-foot">
    {#if session.problems.length}
      <details class="problems">
        <summary>
          <Icon name="alert" size={16} />
          {plural(session.problems.length, "problem")} in this file
        </summary>
        <ul role="list">
          {#each session.problems as problem, index (index)}
            <li><code>{problem.path || "/"}</code> {problem.message}</li>
          {/each}
        </ul>
      </details>
    {/if}
    {#if savesInPlace}
      <button class="button button-quiet" type="button" onclick={() => session.save(true)}>
        <Icon name="save" size={16} />
        Save a copy…
      </button>
    {/if}
    <button class="button button-quiet" type="button" onclick={openAnother}>
      <Icon name="open" size={16} />
      Open another file
    </button>
    <button class="button button-quiet" type="button" onclick={() => session.requestClose()}>
      <Icon name="close" size={16} />
      Close
    </button>
    <p class="sidebar-meta">
      Format {manifest.taste}{#if manifest.modified} · saved {date(manifest.modified)}{/if}
      {#if manifest.generator}<br />{manifest.generator}{/if}
    </p>
  </footer>
</nav>
