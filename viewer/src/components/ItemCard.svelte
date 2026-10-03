<script lang="ts">
  import { formatAt, representativeFile } from "@ruverse/taste";
  import { actorLabel, byline } from "../lib/format.ts";
  import { kindStyle } from "../lib/kinds.ts";
  import { session, type Row } from "../lib/session.svelte.ts";
  import Icon from "./Icon.svelte";
  import StoredImage from "./StoredImage.svelte";

  let { row, drop = null }: { row: Row; drop?: "before" | "after" | null } = $props();

  const item = $derived(row.item);
  const style = $derived(kindStyle(item.kind));
  const art = $derived(representativeFile(item, row.entry));
  const aspect = $derived.by(() => {
    if (art?.width && art.height) return Math.min(1.9, Math.max(0.55, art.width / art.height));
    return style.aspect;
  });
  const parent = $derived(item.parent ? session.manifest?.items[item.parent] : undefined);
  const subtitle = $derived(
    [parent?.title, item.year, byline(item)].filter((part) => part !== undefined && part !== "").join(" · "),
  );
  const agent = $derived(row.entry?.added_by?.type === "agent" ? row.entry.added_by : undefined);
  const fileCount = $derived(item.files?.length ?? 0);
  const selected = $derived(session.itemId === row.id);
  let broken = $state(false);
</script>

<li
  class="card-cell"
  class:drop-before={drop === "before"}
  class:drop-after={drop === "after"}
  style:--aspect={aspect}
  data-item={row.id}
>
  <a
    class="card"
    class:selected
    href={session.itemHref(row.id)}
    aria-current={selected ? "true" : undefined}
    onclick={(event) => {
      event.preventDefault();
      session.openItem(row.id);
    }}
  >
    <div class="card-art" style:aspect-ratio={aspect}>
      {#if art && !broken}
        <StoredImage file={art} alt="" onfailure={() => (broken = true)} />
      {:else}
        <div class="card-placeholder" data-kind={item.kind.split(".")[0]}>
          <Icon name={style.icon} size={34} />
        </div>
      {/if}
      <span class="card-kind"><Icon name={style.icon} size={13} />{style.label}</span>
      {#if art?.role === "screenshot" && art.at}
        <span class="card-at">{formatAt(art.at)}</span>
      {/if}
    </div>
    <div class="card-text">
      <h3 class="card-title">{item.title}</h3>
      {#if subtitle}<p class="card-subtitle">{subtitle}</p>{/if}
      {#if row.entry?.note}
        <p class="card-note">{row.entry.note}</p>
      {:else if agent && row.entry?.reason}
        <p class="card-note card-note-agent">
          <Icon name="sparkle" size={13} />
          <span>{actorLabel(agent)}: {row.entry.reason}</span>
        </p>
      {/if}
      {#if fileCount > 1}
        <p class="card-files">{fileCount} files</p>
      {/if}
    </div>
  </a>
</li>
