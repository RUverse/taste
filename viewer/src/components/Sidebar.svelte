<script lang="ts">
  import { bytes, date, plural } from "../lib/format.ts";
  import { chooseFile } from "../lib/platform.ts";
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
</script>

{#if open}
  <button class="scrim" type="button" aria-label="Close collections" onclick={onclose}></button>
{/if}

<nav class="sidebar" class:open aria-label="Collections">
  <header class="sidebar-head">
    <div class="sidebar-title">
      <h1>{manifest.title || session.name}</h1>
      <p>{session.name} · {bytes(session.file?.size)}</p>
    </div>
    <button class="icon-button sidebar-close" type="button" aria-label="Close collections" onclick={onclose}>
      <Icon name="close" />
    </button>
  </header>

  {#if manifest.description}
    <p class="sidebar-description">{manifest.description}</p>
  {/if}

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

  <h2 class="nav-heading">Collections</h2>
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
            title={collection.vibe}
            onclick={(event) => {
              event.preventDefault();
              session.go(scope);
            }}
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
    <button class="button button-quiet" type="button" onclick={openAnother}>
      <Icon name="open" size={16} />
      Open another file
    </button>
    <button class="button button-quiet" type="button" onclick={() => session.close()}>
      <Icon name="close" size={16} />
      Close
    </button>
    <p class="sidebar-meta">
      Format {manifest.taste}{#if manifest.modified} · saved {date(manifest.modified)}{/if}
      {#if manifest.generator}<br />{manifest.generator}{/if}
    </p>
  </footer>
</nav>
