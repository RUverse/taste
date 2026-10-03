<script lang="ts">
  import { untrack } from "svelte";
  import { isStored, type At } from "@ruverse/taste";
  import {
    AT_DURATIONS,
    AT_INTEGERS,
    DURATION_PATTERN,
    ROLES,
    canShow,
    kindFields,
    pairsOf,
    setField,
    tagsOf,
    type Pair,
  } from "../lib/editing.ts";
  import { bytes, fieldLabel } from "../lib/format.ts";
  import { session } from "../lib/session.svelte.ts";
  import Icon from "./Icon.svelte";
  import Modal from "./Modal.svelte";
  import PairsField from "./PairsField.svelte";

  const props: { itemId: string; fileId: string } = $props();
  // Forms are recreated for each edit (see Editors.svelte), so they read their target once.
  const { itemId, fileId } = untrack(() => props);

  const item = session.manifest!.items[itemId]!;
  const file = item.files!.find((f) => f.id === fileId)!;
  const collection = session.collection;
  const entry = collection?.entries.find((e) => e.item === itemId);
  const original = file.at ?? {};
  // The kind's `at` fields, plus any others this file already has.
  const atKeys = [...new Set([...kindFields(item.kind).at, ...Object.keys(original)])];

  let role = $state(file.role);
  let caption = $state(file.caption ?? "");
  let at = $state<Record<string, string | number | null>>(
    Object.fromEntries(atKeys.map((key) => [key, original[key] === undefined ? "" : String(original[key])])),
  );
  let tags = $state<Pair[]>(pairsOf(file.tags));
  let shown = $state(entry?.show?.[0] === fileId);

  const roles = $derived(ROLES.includes(role) ? ROLES : [role, ...ROLES]);

  function atValue(): At {
    const result: At = { ...original };
    for (const key of atKeys) {
      const raw = at[key];
      const text = raw === null || raw === undefined ? "" : String(raw).trim();
      if (!text) delete result[key];
      else if (AT_INTEGERS.includes(key)) result[key] = Number.parseInt(text, 10);
      else result[key] = text;
    }
    return result;
  }

  function submit(): boolean {
    return session.edit(`Edit ${fieldLabel(role).toLocaleLowerCase()}`, (doc) => {
      const target = doc.file(itemId, fileId);
      target.role = role;
      setField(target, "caption", caption.trim());
      setField(target, "at", atValue());
      setField(target, "tags", tagsOf(tags));
      if (!collection || !entry) return;
      const current = doc.collection(collection.id).entries.find((e) => e.item === itemId);
      if (!current) return;
      const others = (current.show ?? []).filter((id) => id !== fileId);
      setField(current, "show", shown ? [fileId, ...others] : others);
    });
  }

  function remove() {
    const label = `Remove ${fieldLabel(file.role).toLocaleLowerCase()}`;
    if (session.edit(label, (doc) => doc.detach(itemId, fileId))) session.editor = null;
  }
</script>

<Modal title="Edit file" onclose={() => (session.editor = null)} onsubmit={submit}>
  <p class="field-hint file-summary">
    {file.name ?? file.type}{#if isStored(file)} · {bytes(file.size ?? session.doc?.blobSize(file.blob))}{/if}
    {#if file.width && file.height} · {file.width} × {file.height}{/if}
    · on {item.title}
  </p>

  <label class="field">
    <span class="field-label">Role</span>
    <select class="input" bind:value={role}>
      {#each roles as option (option)}<option value={option}>{fieldLabel(option)}</option>{/each}
    </select>
  </label>

  <label class="field">
    <span class="field-label">Caption</span>
    <!-- svelte-ignore a11y_autofocus -->
    <textarea
      class="input"
      rows="2"
      autofocus
      placeholder="What it shows, so agents and searches can find it"
      bind:value={caption}
    ></textarea>
  </label>

  {#if atKeys.length}
    <fieldset class="field-group">
      <legend>The moment it shows</legend>
      <div class="field-grid">
        {#each atKeys as key (key)}
          <label class="field field-narrow">
            <span class="field-label">{fieldLabel(key)}</span>
            {#if AT_INTEGERS.includes(key)}
              <input class="input" type="number" min="0" step="1" bind:value={at[key]} />
            {:else if AT_DURATIONS.includes(key)}
              <input class="input" placeholder="00:23:41" pattern={DURATION_PATTERN} title="Hours, minutes, and seconds, like 01:02:10" bind:value={at[key]} />
            {:else}
              <input class="input" bind:value={at[key]} />
            {/if}
          </label>
        {/each}
      </div>
    </fieldset>
  {/if}

  {#if collection && entry && canShow(file)}
    <label class="check">
      <input type="checkbox" bind:checked={shown} />
      Show this on the card in {collection.name}
    </label>
  {/if}

  <PairsField bind:pairs={tags} legend="Tags" keyLabel="Tag" />

  {#snippet extra()}
    <button class="button button-danger" type="button" onclick={remove}>
      <Icon name="trash" size={16} /> Remove file
    </button>
  {/snippet}
</Modal>
