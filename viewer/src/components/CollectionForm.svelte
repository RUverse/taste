<script lang="ts">
  import { untrack } from "svelte";
  import type { NewFile } from "@ruverse/taste";
  import { pairsOf, setField, tagsOf, type Pair } from "../lib/editing.ts";
  import { plural } from "../lib/format.ts";
  import { chooseAttachments, confirmAction } from "../lib/platform.ts";
  import { session } from "../lib/session.svelte.ts";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import PairsField from "./PairsField.svelte";
  import StoredImage from "./StoredImage.svelte";

  /** The collection to edit, or `null` to create one. */
  const props: { collectionId: string | null } = $props();
  // Forms are recreated for each edit (see Editors.svelte), so they read their target once.
  const { collectionId } = untrack(() => props);

  const existing = collectionId
    ? session.manifest!.collections.find((c) => c.id === collectionId)
    : undefined;

  let name = $state(existing?.name ?? "");
  let vibe = $state(existing?.vibe ?? "");
  let description = $state(existing?.description ?? "");
  let tags = $state<Pair[]>(pairsOf(existing?.tags));
  /** `undefined` keeps the current cover, `null` removes it. */
  let cover = $state.raw<NewFile | null | undefined>(undefined);
  let prune = $state(false);
  let loadingCover = $state(false);

  const shownCover = $derived(cover === undefined ? existing?.cover : cover);
  const preview = $derived(shownCover?.type.startsWith("image/") ? { id: "cover", ...shownCover } : undefined);

  async function chooseCover() {
    const [file] = await chooseAttachments("image/*");
    if (!file) return;
    loadingCover = true;
    try {
      const stored = await session.coverFrom(file);
      if (stored) cover = stored;
    } finally {
      loadingCover = false;
    }
  }

  function submit(): boolean {
    const values = { vibe: vibe.trim(), description: description.trim(), tags: tagsOf(tags) };
    if (!existing || !collectionId) {
      let created = "";
      const done = session.edit(`Add “${name.trim()}”`, (doc) => {
        const collection = doc.addCollection(name.trim(), {
          vibe: values.vibe || undefined,
          description: values.description || undefined,
          tags: values.tags,
        });
        created = collection.id;
        if (cover) doc.setCover(created, cover);
      });
      if (done) session.go({ kind: "collection", id: created });
      return done;
    }
    return session.edit(`Edit “${name.trim()}”`, (doc) => {
      const collection = doc.collection(collectionId);
      collection.name = name.trim();
      for (const [key, value] of Object.entries(values)) setField(collection, key, value);
      if (cover !== undefined) doc.setCover(collectionId, cover);
    });
  }

  async function remove() {
    if (!existing || !collectionId) return;
    const what = prune
      ? `Delete “${existing.name}” and the items that are in no other collection?`
      : `Delete “${existing.name}”? Its items stay in the file.`;
    if (!(await confirmAction(what))) return;
    if (session.edit(`Delete “${existing.name}”`, (doc) => doc.removeCollection(collectionId, { prune }))) {
      session.editor = null;
    }
  }
</script>

<Modal
  title={existing ? "Edit collection" : "New collection"}
  submitLabel={existing ? "Save changes" : "Create"}
  onclose={() => (session.editor = null)}
  onsubmit={submit}
>
  <label class="field">
    <span class="field-label">Name</span>
    <!-- svelte-ignore a11y_autofocus -->
    <input class="input" required autofocus placeholder="Rainy Sunday" bind:value={name} />
  </label>
  <label class="field">
    <span class="field-label">Vibe</span>
    <textarea class="input" rows="2" placeholder="Quiet, grey, slow. Nothing loud." bind:value={vibe}></textarea>
  </label>
  <label class="field">
    <span class="field-label">Description</span>
    <textarea class="input" rows="2" bind:value={description}></textarea>
  </label>

  <div class="field">
    <span class="field-label">Cover</span>
    <div class="cover-field">
      <span class="cover-preview">
        {#if preview}
          <StoredImage file={preview} eager alt="" />
        {:else}
          <Icon name="image" />
        {/if}
      </span>
      <button class="button button-small" type="button" disabled={loadingCover} onclick={chooseCover}>
        {shownCover ? "Change…" : "Choose an image…"}
      </button>
      {#if shownCover}
        <button class="button button-small" type="button" onclick={() => (cover = null)}>Remove</button>
      {/if}
      {#if cover}<span class="field-hint">{cover.name ?? "New image"}</span>{/if}
    </div>
  </div>

  <PairsField bind:pairs={tags} legend="Tags" keyLabel="Tag" keyPlaceholder="mood" valuePlaceholder="calm" />

  {#if existing}
    <fieldset class="field-group danger-zone">
      <legend>Delete</legend>
      <label class="check">
        <input type="checkbox" bind:checked={prune} />
        Also delete its items that are in no other collection
      </label>
      <p class="field-hint">
        {plural(existing.entries.length, "item")} in this collection. You can undo this.
      </p>
    </fieldset>
  {/if}

  {#snippet extra()}
    {#if existing}
      <button class="button button-danger" type="button" onclick={remove}>
        <Icon name="trash" size={16} /> Delete collection
      </button>
    {/if}
  {/snippet}
</Modal>
