<script lang="ts">
  import { untrack } from "svelte";
  import type { Availability, Item, Link } from "@ruverse/taste";
  import {
    AVAILABILITY_TYPES,
    KINDS,
    kindFields,
    objectOf,
    pairsOf,
    parseValue,
    setField,
    tagsOf,
    type Pair,
  } from "../lib/editing.ts";
  import { KNOWN_SERVICES, idName, serviceName } from "../lib/format.ts";
  import { kindStyle } from "../lib/kinds.ts";
  import { confirmAction } from "../lib/platform.ts";
  import { session } from "../lib/session.svelte.ts";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import PairsField from "./PairsField.svelte";

  /** The item to edit, or `null` to add a new one to the current collection. */
  const props: { itemId: string | null } = $props();
  // Forms are recreated for each edit (see Editors.svelte), so they read their target once.
  const { itemId } = untrack(() => props);

  interface OfferRow {
    service: string;
    type: string;
    region: string;
    url: string;
    original?: Availability;
  }

  interface LinkRow {
    label: string;
    url: string;
    original?: Link;
  }

  const manifest = session.manifest!;
  const existing: Item | undefined = itemId ? manifest.items[itemId] : undefined;
  const collection = session.collection;
  const entry = itemId ? collection?.entries.find((e) => e.item === itemId) : undefined;
  const addsToCollection = !existing && collection !== null;

  let kind = $state(existing?.kind ?? (session.kindFilter && KINDS.includes(session.kindFilter) ? session.kindFilter : "movie"));
  let title = $state(existing?.title ?? "");
  let year = $state<number | null>(existing?.year ?? null);
  let summary = $state(existing?.summary ?? "");
  let parent = $state(existing?.parent ?? "");
  let note = $state(entry?.note ?? "");
  let tags = $state<Pair[]>(pairsOf(existing?.tags));
  let ids = $state<Pair[]>(pairsOf(existing?.ids));
  let meta = $state<Pair[]>(pairsOf(existing?.meta));
  let offers = $state<OfferRow[]>(
    (existing?.availability ?? []).map((offer) => ({
      service: offer.service,
      type: offer.type ?? "",
      region: offer.region ?? "",
      url: offer.url ?? "",
      original: offer,
    })),
  );
  let links = $state<LinkRow[]>(
    (existing?.links ?? []).map((link) => ({ label: link.label ?? "", url: link.url, original: link })),
  );

  const kinds = $derived(KINDS.includes(kind) ? KINDS : [kind, ...KINDS]);
  const fields = $derived(kindFields(kind));
  const showParent = $derived(kind.includes(".") || parent !== "");
  const parents = $derived(
    Object.entries(manifest.items)
      .filter(([id]) => id !== itemId)
      .sort((a, b) => a[1].title.localeCompare(b[1].title)),
  );
  const serviceList = `services-${Math.random().toString(36).slice(2)}`;

  function availability(): Availability[] {
    return offers.flatMap((row) => {
      const service = row.service.trim();
      if (!service) return [];
      const offer: Availability = { ...(row.original ?? {}), service };
      setField(offer, "type", row.type || undefined);
      setField(offer, "region", row.region.trim().toUpperCase());
      setField(offer, "url", row.url.trim());
      return [offer];
    });
  }

  function linkList(): Link[] {
    return links.flatMap((row) => {
      const url = row.url.trim();
      if (!url) return [];
      const link: Link = { ...(row.original ?? {}), url };
      setField(link, "label", row.label.trim());
      return [link];
    });
  }

  function submit(): boolean {
    const name = title.trim();
    const values = {
      year: typeof year === "number" && Number.isInteger(year) ? year : undefined,
      summary: summary.trim(),
      parent: parent || undefined,
      tags: tagsOf(tags),
      ids: objectOf(ids, (pair) => {
        const value = parseValue(pair.text, pair.original);
        return typeof value === "number" ? value : String(value);
      }),
      meta: objectOf(meta, (pair) => parseValue(pair.text, pair.original, { json: true })),
      availability: availability(),
      links: linkList(),
    };

    if (!existing || !itemId) {
      let added = "";
      const done = session.edit(`Add “${name}”`, (doc) => {
        const fields: Partial<Item> = {};
        for (const [key, value] of Object.entries(values)) setField(fields, key, value);
        added = doc.addItem(kind, name, fields);
        if (addsToCollection && collection) {
          doc.addEntry(collection.id, added, { note: note.trim() || undefined });
        }
      });
      if (done) session.openItem(added);
      return done;
    }

    return session.edit(`Edit “${name}”`, (doc) => {
      const item = doc.item(itemId);
      item.kind = kind;
      item.title = name;
      for (const [key, value] of Object.entries(values)) setField(item, key, value);
      const current = collection ? doc.collection(collection.id).entries.find((e) => e.item === itemId) : undefined;
      if (current) setField(current, "note", note.trim());
    });
  }

  async function remove() {
    if (!itemId || !existing) return;
    const ok = await confirmAction(`Delete “${existing.title}”? It is removed from every collection, with its files.`);
    if (!ok) return;
    if (session.edit(`Delete “${existing.title}”`, (doc) => doc.removeItem(itemId))) {
      session.editor = null;
    }
  }
</script>

<Modal
  title={existing ? `Edit ${kindStyle(existing.kind).label.toLocaleLowerCase()}` : collection ? `Add to ${collection.name}` : "Add an item"}
  submitLabel={existing ? "Save changes" : "Add"}
  wide
  onclose={() => (session.editor = null)}
  onsubmit={submit}
>
  <div class="field-grid">
    <label class="field">
      <span class="field-label">Kind</span>
      <select class="input" bind:value={kind}>
        {#each kinds as option (option)}
          <option value={option}>{kindStyle(option).label}{option.includes(".") ? ` (${option})` : ""}</option>
        {/each}
      </select>
    </label>
    <label class="field field-wide">
      <span class="field-label">Title</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input class="input" required autofocus bind:value={title} />
    </label>
    <label class="field field-narrow">
      <span class="field-label">Year</span>
      <input class="input" type="number" step="1" min="0" max="9999" bind:value={year} />
    </label>
  </div>

  {#if showParent}
    <label class="field">
      <span class="field-label">Part of</span>
      <select class="input" bind:value={parent}>
        <option value="">Nothing</option>
        {#each parents as [id, candidate] (id)}
          <option value={id}>{candidate.title}{candidate.year ? ` (${candidate.year})` : ""} · {kindStyle(candidate.kind).label}</option>
        {/each}
      </select>
    </label>
  {/if}

  <label class="field">
    <span class="field-label">Summary</span>
    <textarea class="input" rows="3" bind:value={summary}></textarea>
  </label>

  {#if collection && (entry || addsToCollection)}
    <label class="field">
      <span class="field-label">Note in {collection.name}</span>
      <textarea class="input" rows="2" placeholder="Why it belongs here" bind:value={note}></textarea>
    </label>
  {/if}

  <PairsField
    bind:pairs={tags}
    legend="Tags"
    keyLabel="Tag"
    keyPlaceholder="mood"
    valuePlaceholder="calm, lonely"
    hint="Separate several values with commas."
    suggestions={["mood", "rating", "watched", "season", "with"]}
  />

  <fieldset class="field-group">
    <legend>Where to find it</legend>
    {#if offers.length}
      <ul class="pair-list" role="list">
        {#each offers as offer, index (index)}
          <li class="pair-row offer-row">
            <input class="input" aria-label="Service" placeholder="netflix" list={serviceList} required bind:value={offer.service} />
            <select class="input" aria-label="How" bind:value={offer.type}>
              <option value="">Any way</option>
              {#each AVAILABILITY_TYPES as type (type)}<option value={type}>{type}</option>{/each}
            </select>
            <input class="input offer-region" aria-label="Region" placeholder="US" maxlength="2" pattern={"[A-Za-z]{2}"} bind:value={offer.region} />
            <input class="input" aria-label="Address" placeholder="https://…" type="url" bind:value={offer.url} />
            <button class="icon-button" type="button" aria-label="Remove {serviceName(offer.service || 'service')}" onclick={() => (offers = offers.filter((_, at) => at !== index))}>
              <Icon name="close" size={16} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="field-add">
      <button class="button button-small" type="button" onclick={() => (offers = [...offers, { service: "", type: "", region: "", url: "" }])}>
        <Icon name="plus" size={15} /> Add a service
      </button>
    </div>
    <datalist id={serviceList}>
      {#each KNOWN_SERVICES as service (service)}<option value={service}>{serviceName(service)}</option>{/each}
    </datalist>
  </fieldset>

  <fieldset class="field-group">
    <legend>Links</legend>
    {#if links.length}
      <ul class="pair-list" role="list">
        {#each links as link, index (index)}
          <li class="pair-row">
            <input class="input pair-key" aria-label="Label" placeholder="Review" bind:value={link.label} />
            <input class="input pair-value" aria-label="Address" placeholder="https://…" type="url" required bind:value={link.url} />
            <button class="icon-button" type="button" aria-label="Remove link" onclick={() => (links = links.filter((_, at) => at !== index))}>
              <Icon name="close" size={16} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    <div class="field-add">
      <button class="button button-small" type="button" onclick={() => (links = [...links, { label: "", url: "" }])}>
        <Icon name="plus" size={15} /> Add a link
      </button>
    </div>
  </fieldset>

  <PairsField
    bind:pairs={ids}
    legend="Catalog ids"
    keyLabel="Catalog"
    valueLabel="Id"
    suggestions={fields.ids}
    hint={fields.ids.length ? `For example ${fields.ids.map(idName).join(", ")}.` : undefined}
  />

  <PairsField
    bind:pairs={meta}
    legend="Details"
    keyLabel="Field"
    suggestions={fields.meta}
    hint="Lists are separated by commas; numbers stay numbers."
  />

  {#snippet extra()}
    {#if existing}
      <button class="button button-danger" type="button" onclick={remove}>
        <Icon name="trash" size={16} /> Delete
      </button>
    {/if}
  {/snippet}
</Modal>
