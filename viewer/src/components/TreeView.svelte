<script lang="ts">
  import {
    formatAt,
    isStored,
    tagPairs,
    type Collection,
    type Entry,
    type Item,
    type TasteFileEntry,
  } from "@ruverse/taste";
  import { actorLabel, bytes, date, fieldLabel, idName, serviceName, offerLabel } from "../lib/format.ts";
  import { kindStyle } from "../lib/kinds.ts";
  import { session, type Row } from "../lib/session.svelte.ts";
  import Icon from "./Icon.svelte";
  import StoredImage from "./StoredImage.svelte";

  const manifest = $derived(session.manifest!);

  function rowsOf(collection: Collection): Row[] {
    const visible = new Set(session.rows.map((row) => row.id));
    const filtering = session.scope.kind === "collection";
    return collection.entries.flatMap((entry) => {
      const item = manifest.items[entry.item];
      if (!item) return [];
      if (filtering && !visible.has(entry.item)) return [];
      return [{ id: entry.item, item, entry }];
    });
  }

  function shortRef(ref: string): string {
    return `${ref.slice(0, 15)}…`;
  }

  function isPlain(value: unknown): boolean {
    return value === null || typeof value !== "object";
  }

  function plainList(value: unknown): boolean {
    return Array.isArray(value) && value.every(isPlain);
  }
</script>

{#snippet leaf(label: string, value: unknown)}
  <li class="tree-leaf">
    <span class="tree-key">{label}</span>
    <span class="tree-value">{Array.isArray(value) ? value.join(", ") : String(value)}</span>
  </li>
{/snippet}

{#snippet json(label: string, value: unknown)}
  {#if isPlain(value) || plainList(value)}
    {@render leaf(label, value)}
  {:else}
    <li>
      <details class="tree-node">
        <summary><span class="tree-key">{label}</span></summary>
        <ul role="group">
          {#if Array.isArray(value)}
            {#each value as part, index (index)}
              {@render json(String(index + 1), part)}
            {/each}
          {:else}
            {#each Object.entries(value as Record<string, unknown>) as [key, part] (key)}
              {@render json(key, part)}
            {/each}
          {/if}
        </ul>
      </details>
    </li>
  {/if}
{/snippet}

{#snippet fileNode(file: TasteFileEntry, files: TasteFileEntry[], title: string, itemId?: string)}
  <li>
    <details class="tree-node tree-file">
      <summary>
        {#if file.type.startsWith("image/")}
          <span class="tree-thumb"><StoredImage {file} alt="" /></span>
        {:else}
          <Icon name="file" size={15} />
        {/if}
        <span class="tree-label">{fieldLabel(file.role)}</span>
        {#if file.at}<span class="tree-at">{formatAt(file.at)}</span>{/if}
        {#if file.caption}<span class="tree-caption">{file.caption}</span>{/if}
        <code class="tree-id">{file.id}</code>
      </summary>
      <ul role="group">
        {@render leaf("type", file.type)}
        {#if isStored(file)}
          {@render leaf("stored", `${bytes(file.size ?? session.doc?.blobSize(file.blob))} · ${shortRef(file.blob)}`)}
        {:else if file.url}
          {@render leaf("url", file.url)}
        {/if}
        {#if file.name}{@render leaf("name", file.name)}{/if}
        {#if file.width && file.height}{@render leaf("size", `${file.width} × ${file.height}`)}{/if}
        {#if file.duration}{@render leaf("duration", `${file.duration} s`)}{/if}
        {#if file.thumb}{@render leaf("thumbnail", shortRef(file.thumb))}{/if}
        {#each tagPairs(file.tags) as [key, value], index (index)}{@render leaf(`#${key}`, value)}{/each}
        {#if file.added_by}{@render leaf("added by", actorLabel(file.added_by))}{/if}
        <li class="tree-actions">
          <button
            class="link-button"
            type="button"
            onclick={() => session.showFile(title, files, file, itemId)}
          >
            View file
          </button>
        </li>
      </ul>
    </details>
  </li>
{/snippet}

{#snippet itemNode(id: string, item: Item, entry: Entry | undefined)}
  {@const style = kindStyle(item.kind)}
  <li>
    <details class="tree-node tree-item">
      <summary>
        <Icon name={style.icon} size={15} />
        <span class="tree-label">{item.title}</span>
        {#if item.year}<span class="tree-year">{item.year}</span>{/if}
        <span class="tree-kind">{item.kind}</span>
        {#if entry?.added_by?.type === "agent"}
          <span class="tree-agent" title="Added by {actorLabel(entry.added_by)}"><Icon name="sparkle" size={13} /></span>
        {/if}
        <code class="tree-id">{id}</code>
      </summary>
      <ul role="group">
        <li class="tree-actions">
          <button class="link-button" type="button" onclick={() => session.openItem(id)}>Open details</button>
        </li>
        {#if entry?.note}{@render leaf("note", entry.note)}{/if}
        {#if entry?.reason}{@render leaf(`${actorLabel(entry.added_by)}’s reason`, entry.reason)}{/if}
        {#if item.summary}{@render leaf("summary", item.summary)}{/if}
        {#if item.parent}{@render leaf("part of", manifest.items[item.parent]?.title ?? item.parent)}{/if}
        {#if item.ids && Object.keys(item.ids).length}
          <li>
            <details class="tree-node">
              <summary><span class="tree-key">ids</span></summary>
              <ul role="group">
                {#each Object.entries(item.ids) as [catalog, value] (catalog)}{@render leaf(idName(catalog), value)}{/each}
              </ul>
            </details>
          </li>
        {/if}
        {#if item.meta && Object.keys(item.meta).length}
          <li>
            <details class="tree-node" open>
              <summary><span class="tree-key">meta</span></summary>
              <ul role="group">
                {#each Object.entries(item.meta) as [key, value] (key)}{@render json(key, value)}{/each}
              </ul>
            </details>
          </li>
        {/if}
        {#if item.availability?.length}
          <li>
            <details class="tree-node">
              <summary><span class="tree-key">availability</span><span class="tree-count">{item.availability.length}</span></summary>
              <ul role="group">
                {#each item.availability as offer, index (index)}
                  {@render leaf(serviceName(offer.service), [offerLabel(offer), offer.checked ? `checked ${date(offer.checked)}` : ""].filter(Boolean).join(" · ") || "—")}
                {/each}
              </ul>
            </details>
          </li>
        {/if}
        {#if item.links?.length}
          {#each item.links as link, index (index)}{@render leaf(link.label ?? "link", link.url)}{/each}
        {/if}
        {#each tagPairs(item.tags) as [key, value], index (index)}{@render leaf(`#${key}`, value)}{/each}
        {#if item.files?.length}
          <li>
            <details class="tree-node" open>
              <summary><span class="tree-key">files</span><span class="tree-count">{item.files.length}</span></summary>
              <ul role="group">
                {#each item.files as file (file.id)}{@render fileNode(file, item.files, item.title, id)}{/each}
              </ul>
            </details>
          </li>
        {/if}
        {#each Object.entries(item).filter(([key]) => key.startsWith("x-")) as [key, value] (key)}
          {@render json(key, value)}
        {/each}
      </ul>
    </details>
  </li>
{/snippet}

{#snippet collectionNode(collection: Collection, open: boolean)}
  {@const rows = rowsOf(collection)}
  <li>
    <details class="tree-node tree-collection" {open}>
      <summary>
        <Icon name="folder" size={15} />
        <span class="tree-label">{collection.name}</span>
        <span class="tree-count">{rows.length}</span>
        <code class="tree-id">{collection.id}</code>
      </summary>
      <ul role="group">
        {#if collection.vibe}{@render leaf("vibe", collection.vibe)}{/if}
        {#each tagPairs(collection.tags) as [key, value], index (index)}{@render leaf(`#${key}`, value)}{/each}
        {#if collection.cover}{@render fileNode(collection.cover, [collection.cover], collection.name)}{/if}
        {#each rows as row (row.id)}{@render itemNode(row.id, row.item, row.entry)}{/each}
      </ul>
    </details>
  </li>
{/snippet}

<div class="tree">
  <ul class="tree-root" role="list">
    {#if session.scope.kind === "collection" && session.collection}
      {@render collectionNode(session.collection, true)}
    {:else if session.scope.kind === "unsorted"}
      {#each session.rows as row (row.id)}{@render itemNode(row.id, row.item, undefined)}{/each}
    {:else}
      <li>
        <details class="tree-node tree-file-root" open>
          <summary>
            <Icon name="box" size={15} />
            <span class="tree-label">{manifest.title || session.name}</span>
            <span class="tree-kind">.taste {manifest.taste}</span>
          </summary>
          <ul role="group">
            {#if manifest.created}{@render leaf("created", date(manifest.created))}{/if}
            {#if manifest.modified}{@render leaf("saved", date(manifest.modified))}{/if}
            {#each manifest.collections as collection, index (collection.id)}
              {@render collectionNode(collection, index === 0)}
            {/each}
            {#if session.unsortedIds.length}
              <li>
                <details class="tree-node tree-collection">
                  <summary>
                    <Icon name="inbox" size={15} />
                    <span class="tree-label">Unsorted</span>
                    <span class="tree-count">{session.unsortedIds.length}</span>
                  </summary>
                  <ul role="group">
                    {#each session.unsortedIds as id (id)}
                      {@const item = manifest.items[id]}
                      {#if item}{@render itemNode(id, item, undefined)}{/if}
                    {/each}
                  </ul>
                </details>
              </li>
            {/if}
          </ul>
        </details>
      </li>
    {/if}
  </ul>
</div>
