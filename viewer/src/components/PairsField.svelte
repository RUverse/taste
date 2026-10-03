<script lang="ts">
  import { tick } from "svelte";
  import type { Pair } from "../lib/editing.ts";
  import Icon from "./Icon.svelte";

  let {
    pairs = $bindable(),
    legend,
    keyLabel = "Name",
    valueLabel = "Value",
    keyPlaceholder = "",
    valuePlaceholder = "",
    suggestions = [],
    hint,
  }: {
    pairs: Pair[];
    legend: string;
    keyLabel?: string;
    valueLabel?: string;
    keyPlaceholder?: string;
    valuePlaceholder?: string;
    /** Keys offered while typing, such as the meta fields suggested for the item's kind. */
    suggestions?: string[];
    hint?: string;
  } = $props();

  const listId = `keys-${Math.random().toString(36).slice(2)}`;
  const unused = $derived(suggestions.filter((key) => !pairs.some((pair) => pair.key === key)));
  let group: HTMLFieldSetElement | undefined = $state();

  /** Add a row and put the cursor where typing should continue. */
  async function add(key = "") {
    pairs = [...pairs, { key, text: "" }];
    await tick();
    group?.querySelector<HTMLInputElement>(`.pair-row:last-child .${key ? "pair-value" : "pair-key"}`)?.focus();
  }
</script>

<fieldset class="field-group" bind:this={group}>
  <legend>{legend}</legend>
  {#if hint}<p class="field-hint">{hint}</p>{/if}
  {#if pairs.length}
    <ul class="pair-list" role="list">
      {#each pairs as pair, index (index)}
        <li class="pair-row">
          <input
            class="input pair-key"
            aria-label={keyLabel}
            placeholder={keyPlaceholder || keyLabel}
            list={suggestions.length ? listId : undefined}
            bind:value={pair.key}
          />
          <input
            class="input pair-value"
            aria-label={valueLabel}
            placeholder={valuePlaceholder || valueLabel}
            bind:value={pair.text}
          />
          <button
            class="icon-button"
            type="button"
            aria-label="Remove {pair.key || 'row'}"
            onclick={() => (pairs = pairs.filter((_, at) => at !== index))}
          >
            <Icon name="close" size={16} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="field-add">
    <button class="button button-small" type="button" onclick={() => add()}>
      <Icon name="plus" size={15} /> Add
    </button>
    {#each unused.slice(0, 4) as key (key)}
      <button class="chip-button" type="button" onclick={() => add(key)}>{key}</button>
    {/each}
  </div>
  {#if suggestions.length}
    <datalist id={listId}>
      {#each suggestions as key (key)}<option value={key}></option>{/each}
    </datalist>
  {/if}
</fieldset>
