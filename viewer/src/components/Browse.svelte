<script lang="ts">
  import { tagPairs } from "@ruverse/taste";
  import { plural } from "../lib/format.ts";
  import { kindStyle } from "../lib/kinds.ts";
  import { session } from "../lib/session.svelte.ts";
  import Icon from "./Icon.svelte";
  import ItemCard from "./ItemCard.svelte";
  import TreeView from "./TreeView.svelte";

  const collection = $derived(session.collection);
  const heading = $derived(
    collection?.name ??
      (session.scope.kind === "unsorted" ? "Unsorted" : "Everything"),
  );
  const intro = $derived(
    collection
      ? collection.vibe
      : session.scope.kind === "unsorted"
        ? "Items in this file that are in no collection yet."
        : "Every item in this file, across all collections.",
  );
  const agentCount = $derived(
    collection?.entries.filter((entry) => entry.added_by?.type === "agent").length ?? 0,
  );
  const filtered = $derived(
    Boolean(session.search.trim() || session.kindFilter || session.tagFilter),
  );

  function toggleTag(key: string, value: string) {
    const current = session.tagFilter;
    session.tagFilter =
      current && current[0] === key && current[1].toLocaleLowerCase() === value.toLocaleLowerCase()
        ? null
        : [key, value];
  }

  function isTagActive(key: string, value: string): boolean {
    const current = session.tagFilter;
    return Boolean(
      current && current[0] === key && current[1].toLocaleLowerCase() === value.toLocaleLowerCase(),
    );
  }
</script>

<header class="browse-head">
  <div class="browse-title">
    <h2>{heading}</h2>
    {#if intro}<p class="browse-vibe">{intro}</p>{/if}
    {#if collection?.description}<p class="browse-description">{collection.description}</p>{/if}
    <p class="browse-meta">
      {plural(session.scopeRows.length, "item")}
      {#if agentCount}
        <span class="dot" aria-hidden="true">·</span>
        <span class="agent-count"><Icon name="sparkle" size={13} /> {agentCount} suggested by agents</span>
      {/if}
    </p>
    {#if collection?.tags}
      <ul class="tag-list" role="list" aria-label="Collection tags">
        {#each tagPairs(collection.tags) as [key, value], index (index)}
          <li class="tag"><span class="tag-key">{key}</span>{value}</li>
        {/each}
      </ul>
    {/if}
  </div>
</header>

<div class="toolbar" role="search">
  <label class="search">
    <Icon name="search" size={16} />
    <span class="sr-only">Search this view</span>
    <input type="search" placeholder="Search titles, notes, captions…" bind:value={session.search} />
  </label>

  {#if session.kinds.length > 1}
    <div class="segmented" role="group" aria-label="Kind">
      <button type="button" aria-pressed={session.kindFilter === null} onclick={() => (session.kindFilter = null)}>
        All
      </button>
      {#each session.kinds as [kind, count] (kind)}
        {@const style = kindStyle(kind)}
        <button
          type="button"
          aria-pressed={session.kindFilter === kind}
          title="{count} {count === 1 ? style.label : style.plural}"
          onclick={() => (session.kindFilter = session.kindFilter === kind ? null : kind)}
        >
          <Icon name={style.icon} size={15} />
          <span>{style.plural}</span>
        </button>
      {/each}
    </div>
  {/if}

  <div class="segmented view-toggle" role="group" aria-label="View">
    <button type="button" aria-pressed={session.view === "grid"} onclick={() => session.setView("grid")}>
      <Icon name="grid" size={15} />
      <span>Grid</span>
    </button>
    <button type="button" aria-pressed={session.view === "tree"} onclick={() => session.setView("tree")}>
      <Icon name="tree" size={15} />
      <span>Tree</span>
    </button>
  </div>
</div>

{#if session.tags.length && session.view === "grid"}
  <ul class="tag-filter" role="list" aria-label="Filter by tag">
    {#each session.tags as [key, value, count] (`${key}=${value}`)}
      <li>
        <button
          class="tag tag-button"
          type="button"
          aria-pressed={isTagActive(key, value)}
          onclick={() => toggleTag(key, value)}
        >
          <span class="tag-key">{key}</span>{value}<span class="tag-count">{count}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

{#if session.view === "tree"}
  <TreeView />
{:else if session.rows.length}
  <ul class="card-grid" role="list">
    {#each session.rows as row (row.id)}
      <ItemCard {row} />
    {/each}
  </ul>
{:else}
  <div class="empty">
    {#if filtered}
      <p>Nothing here matches.</p>
      <button class="button" type="button" onclick={() => session.clearFilters()}>Clear filters</button>
    {:else}
      <p>This collection is empty.</p>
    {/if}
  </div>
{/if}
