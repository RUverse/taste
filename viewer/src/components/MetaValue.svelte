<script lang="ts">
  import { fieldLabel } from "../lib/format.ts";
  import MetaValue from "./MetaValue.svelte";

  let { value }: { value: unknown } = $props();

  function plain(part: unknown): boolean {
    return part === null || typeof part !== "object";
  }

  function text(part: unknown): string {
    if (typeof part === "boolean") return part ? "Yes" : "No";
    return String(part);
  }
</script>

{#if plain(value)}
  {text(value)}
{:else if Array.isArray(value) && value.every(plain)}
  {value.map(text).join(", ")}
{:else if Array.isArray(value)}
  <ol class="meta-list">
    {#each value as part, index (index)}<li><MetaValue value={part} /></li>{/each}
  </ol>
{:else}
  <dl class="meta-nested">
    {#each Object.entries(value as Record<string, unknown>) as [key, part] (key)}
      <dt>{fieldLabel(key)}</dt>
      <dd><MetaValue value={part} /></dd>
    {/each}
  </dl>
{/if}
