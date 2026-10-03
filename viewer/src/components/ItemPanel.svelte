<script lang="ts">
  import {
    childrenOf,
    formatAt,
    isImage,
    placesOf,
    representativeFile,
    tagPairs,
    type Item,
    type TasteFileEntry,
  } from "@ruverse/taste";
  import {
    actorLabel,
    byline,
    date,
    fieldLabel,
    idName,
    idUrl,
    offerLabel,
    safeUrl,
    serviceName,
  } from "../lib/format.ts";
  import { kindStyle } from "../lib/kinds.ts";
  import { chooseAttachments } from "../lib/platform.ts";
  import { session } from "../lib/session.svelte.ts";
  import Icon from "./Icon.svelte";
  import MetaValue from "./MetaValue.svelte";
  import StoredImage from "./StoredImage.svelte";

  let { itemId, item }: { itemId: string; item: Item } = $props();

  const manifest = $derived(session.manifest!);
  const style = $derived(kindStyle(item.kind));
  const places = $derived(placesOf(manifest, itemId));
  const currentEntry = $derived(
    session.collection ? places.find((p) => p.collection.id === session.collection?.id)?.entry : undefined,
  );
  const hero = $derived(representativeFile(item, currentEntry));
  const files = $derived(item.files ?? []);
  const images = $derived(files.filter((f) => isImage(f) && f !== hero));
  const others = $derived(files.filter((f) => !isImage(f)));
  const parent = $derived(item.parent ? manifest.items[item.parent] : undefined);
  const children = $derived(childrenOf(manifest, itemId));
  const metaEntries = $derived(Object.entries(item.meta ?? {}));
  const ids = $derived(Object.entries(item.ids ?? {}));
  const author = $derived(byline(item));

  const position = $derived(session.rows.findIndex((row) => row.id === itemId));
  const previous = $derived(position > 0 ? session.rows[position - 1] : undefined);
  const next = $derived(position >= 0 ? session.rows[position + 1] : undefined);

  const otherCollections = $derived(
    manifest.collections.filter((c) => !places.some((place) => place.collection.id === c.id)),
  );
  const entryIndex = $derived(
    session.collection ? session.collection.entries.findIndex((e) => e.item === itemId) : -1,
  );

  let heading: HTMLHeadingElement | undefined = $state();
  let dropping = $state(false);

  $effect(() => {
    heading?.focus({ preventScroll: true });
  });

  function show(file: TasteFileEntry) {
    const gallery = [...(hero ? [hero] : []), ...images, ...others];
    session.showFile(item.title, gallery, file, itemId);
  }

  async function addFiles() {
    const files = await chooseAttachments();
    await session.addFiles(itemId, files);
  }

  function addTo(collectionId: string) {
    const collection = manifest.collections.find((c) => c.id === collectionId);
    if (!collection) return;
    session.edit(`Add “${item.title}” to ${collection.name}`, (doc) => doc.addEntry(collectionId, itemId));
  }

  function removeFrom(collectionId: string, name: string) {
    session.edit(`Remove “${item.title}” from ${name}`, (doc) => doc.removeEntry(collectionId, itemId));
  }

  function move(delta: number) {
    const collection = session.collection;
    if (!collection || entryIndex < 0) return;
    session.edit(`Move “${item.title}”`, (doc) => doc.moveEntry(collection.id, itemId, entryIndex + delta));
  }

  function hasFiles(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes("Files") ?? false;
  }

  function onDragOver(event: DragEvent) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    dropping = true;
  }

  function onDrop(event: DragEvent) {
    if (!hasFiles(event)) return;
    // Marks the drop as handled, so the window does not open a dropped .taste file as well.
    event.preventDefault();
    dropping = false;
    session.addFiles(itemId, [...(event.dataTransfer?.files ?? [])]);
  }

  function onPaste(event: ClipboardEvent) {
    const target = event.target instanceof Element ? event.target : null;
    if (session.editor || target?.closest("input, textarea, [contenteditable]")) return;
    const files = [...(event.clipboardData?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    session.addFiles(itemId, files);
  }

  function onKeydown(event: KeyboardEvent) {
    if (session.lightbox || session.editor || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable], dialog")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      session.closeItem();
    } else if (event.key === "ArrowLeft" && previous) {
      session.openItem(previous.id);
    } else if (event.key === "ArrowRight" && next) {
      session.openItem(next.id);
    }
  }
</script>

<svelte:window onkeydown={onKeydown} onpaste={onPaste} />

{#snippet fileTile(file: TasteFileEntry)}
  <li>
    <button class="file-tile" type="button" onclick={() => show(file)}>
      {#if isImage(file)}
        <span class="file-tile-art" style:aspect-ratio={file.width && file.height ? file.width / file.height : 16 / 9}>
          <StoredImage {file} alt={file.caption ?? ""} />
        </span>
      {:else}
        <span class="file-tile-art file-tile-generic"><Icon name="file" size={22} /><span>{file.type}</span></span>
      {/if}
      <span class="file-tile-text">
        <span class="file-tile-role">{fieldLabel(file.role)}{#if file.at} · {formatAt(file.at)}{/if}</span>
        {#if file.caption}<span class="file-tile-caption">{file.caption}</span>{:else if file.name}<span class="file-tile-caption">{file.name}</span>{/if}
      </span>
    </button>
  </li>
{/snippet}

<aside
  class="panel"
  class:dropping
  aria-labelledby="panel-title"
  data-dropzone
  ondragover={onDragOver}
  ondragleave={(event) => {
    if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) dropping = false;
  }}
  ondrop={onDrop}
>
  <header class="panel-bar">
    <button class="icon-button" type="button" aria-label="Previous item" title="Previous (←)" disabled={!previous} onclick={() => previous && session.openItem(previous.id)}>
      <Icon name="left" />
    </button>
    <button class="icon-button" type="button" aria-label="Next item" title="Next (→)" disabled={!next} onclick={() => next && session.openItem(next.id)}>
      <Icon name="right" />
    </button>
    <span class="panel-position">{#if position >= 0}{position + 1} of {session.rows.length}{/if}</span>
    <button class="icon-button" type="button" aria-label="Edit item" title="Edit" onclick={() => (session.editor = { kind: "item", id: itemId })}>
      <Icon name="pencil" />
    </button>
    <button class="icon-button" type="button" aria-label="Close details" title="Close (Esc)" onclick={() => session.closeItem()}>
      <Icon name="close" />
    </button>
  </header>

  <div class="panel-body">
    {#if hero}
      <button class="panel-hero" type="button" onclick={() => show(hero)} aria-label="View {fieldLabel(hero.role).toLocaleLowerCase()} full size">
        <StoredImage file={hero} full alt={hero.caption ?? ""} eager />
      </button>
      {#if hero.caption || hero.at}
        <p class="panel-hero-caption">
          {#if hero.at}<span class="pill">{formatAt(hero.at)}</span>{/if}
          {hero.caption ?? ""}
        </p>
      {/if}
    {/if}

    <div class="panel-heading">
      <p class="panel-kind"><Icon name={style.icon} size={14} /> {style.label}{#if item.year} · {item.year}{/if}</p>
      <h2 id="panel-title" tabindex="-1" bind:this={heading}>{item.title}</h2>
      {#if author}<p class="panel-byline">{author}</p>{/if}
      {#if parent && item.parent}
        <p class="panel-parent">
          Part of
          <button class="link-button" type="button" onclick={() => session.openItem(item.parent!)}>{parent.title}</button>
        </p>
      {/if}
    </div>

    {#if item.summary}<p class="panel-summary">{item.summary}</p>{/if}

    {#if tagPairs(item.tags).length}
      <ul class="tag-list" role="list" aria-label="Tags">
        {#each tagPairs(item.tags) as [key, value], index (index)}
          <li class="tag"><span class="tag-key">{key}</span>{value}</li>
        {/each}
      </ul>
    {/if}

    {#if places.length || otherCollections.length}
      <section class="panel-section">
        <h3>{places.length === 1 ? "In collection" : places.length ? "In collections" : "In no collection yet"}</h3>
        <ul class="place-list" role="list">
          {#each places as { collection, entry } (collection.id)}
            {@const current = collection.id === session.collection?.id}
            <li class="place" class:current>
              <div class="place-head">
                <button class="link-button place-name" type="button" onclick={() => session.go({ kind: "collection", id: collection.id }, itemId)}>
                  {collection.name}
                </button>
                {#if current}
                  <button class="icon-button icon-button-small" type="button" aria-label="Move earlier in {collection.name}" title="Move earlier" disabled={entryIndex <= 0} onclick={() => move(-1)}>
                    <Icon name="up" size={15} />
                  </button>
                  <button class="icon-button icon-button-small" type="button" aria-label="Move later in {collection.name}" title="Move later" disabled={entryIndex < 0 || entryIndex >= collection.entries.length - 1} onclick={() => move(1)}>
                    <Icon name="down" size={15} />
                  </button>
                {/if}
                <button class="icon-button icon-button-small" type="button" aria-label="Remove from {collection.name}" title="Remove from {collection.name}" onclick={() => removeFrom(collection.id, collection.name)}>
                  <Icon name="close" size={15} />
                </button>
              </div>
              {#if entry.note}<p class="place-note">“{entry.note}”</p>{/if}
              {#if entry.added_by?.type === "agent"}
                <p class="place-agent">
                  <Icon name="sparkle" size={13} />
                  Suggested by {actorLabel(entry.added_by)}{#if entry.reason}: {entry.reason}{/if}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
        {#if otherCollections.length}
          <label class="add-to">
            <span class="sr-only">Add to a collection</span>
            <select
              class="input input-small"
              value=""
              onchange={(event) => {
                const select = event.currentTarget;
                if (select.value) addTo(select.value);
                select.value = "";
              }}
            >
              <option value="" disabled>Add to a collection…</option>
              {#each otherCollections as collection (collection.id)}
                <option value={collection.id}>{collection.name}</option>
              {/each}
            </select>
          </label>
        {/if}
      </section>
    {/if}

    {#if item.availability?.length}
      <section class="panel-section">
        <h3>Where to find it</h3>
        <ul class="offer-list" role="list">
          {#each item.availability as offer, index (index)}
            {@const url = safeUrl(offer.url)}
            <li class="offer">
              {#if url}
                <a href={url} target="_blank" rel="noopener noreferrer">{serviceName(offer.service)} <Icon name="external" size={13} /></a>
              {:else}
                <span>{serviceName(offer.service)}</span>
              {/if}
              {#if offerLabel(offer)}<span class="offer-detail">{offerLabel(offer)}</span>{/if}
              {#if offer.checked}<span class="offer-checked">checked {date(offer.checked)}</span>{/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <section class="panel-section">
      <div class="section-head">
        <h3>Files</h3>
        <button class="button button-small" type="button" disabled={session.busy !== null} onclick={addFiles}>
          <Icon name="paperclip" size={14} /> Add
        </button>
      </div>
      {#if images.length || others.length}
        <ul class="file-grid" role="list">
          {#each images as file (file.id)}{@render fileTile(file)}{/each}
          {#each others as file (file.id)}{@render fileTile(file)}{/each}
        </ul>
      {:else if !hero}
        <button class="file-drop" type="button" onclick={addFiles}>
          <Icon name="image" size={22} />
          <span>Add a poster, screenshots, or other files</span>
          <span class="muted">or drop or paste them here</span>
        </button>
      {:else}
        <p class="field-hint">Drop or paste screenshots here to add them.</p>
      {/if}
    </section>

    {#if children.length}
      <section class="panel-section">
        <h3>Includes</h3>
        <ul class="child-list" role="list">
          {#each children as childId (childId)}
            {@const child = manifest.items[childId]}
            {#if child}
              <li>
                <button class="link-button" type="button" onclick={() => session.openItem(childId)}>{child.title}</button>
                <span class="muted">{kindStyle(child.kind).label}</span>
              </li>
            {/if}
          {/each}
        </ul>
      </section>
    {/if}

    {#if metaEntries.length || ids.length || item.links?.length}
      <section class="panel-section">
        <h3>Details</h3>
        <dl class="facts">
          {#each metaEntries as [key, value] (key)}
            <dt>{fieldLabel(key)}</dt>
            <dd><MetaValue {value} /></dd>
          {/each}
          {#each ids as [catalog, value] (catalog)}
            {@const url = idUrl(catalog, value, item)}
            <dt>{idName(catalog)}</dt>
            <dd>
              {#if url}<a href={url} target="_blank" rel="noopener noreferrer">{value} <Icon name="external" size={12} /></a>{:else}<code>{value}</code>{/if}
            </dd>
          {/each}
          {#each item.links ?? [] as link, index (index)}
            {@const url = safeUrl(link.url)}
            <dt>{link.label ?? "Link"}</dt>
            <dd>{#if url}<a href={url} target="_blank" rel="noopener noreferrer">{new URL(url).hostname} <Icon name="external" size={12} /></a>{:else}{link.url}{/if}</dd>
          {/each}
        </dl>
      </section>
    {/if}

    <p class="panel-footnote">
      <code>{itemId}</code>
      {#if item.added} · added {date(item.added)}{/if}
      {#if item.added_by} by {actorLabel(item.added_by)}{/if}
    </p>
  </div>
</aside>
