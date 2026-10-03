<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  let {
    title,
    submitLabel = "Save",
    wide = false,
    onclose,
    onsubmit,
    children,
    extra,
  }: {
    title: string;
    submitLabel?: string;
    wide?: boolean;
    onclose: () => void;
    /** Return `false` to keep the dialog open, for example when the change failed. */
    onsubmit: () => boolean | void;
    children: Snippet;
    /** Shown at the start of the footer, such as a delete button. */
    extra?: Snippet;
  } = $props();

  const id = `modal-${Math.random().toString(36).slice(2)}`;
  let dialog: HTMLDialogElement | undefined = $state();
  let mounted = true;

  $effect(() => {
    dialog?.showModal();
    return () => {
      mounted = false;
      if (dialog?.open) dialog.close();
    };
  });

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (onsubmit() !== false) dialog?.close();
  }
</script>

<dialog
  bind:this={dialog}
  class="modal"
  class:wide
  aria-labelledby={id}
  onclose={() => {
    if (mounted) onclose();
  }}
>
  <form class="modal-form" onsubmit={submit}>
    <header class="modal-head">
      <h2 {id}>{title}</h2>
      <button class="icon-button" type="button" aria-label="Close" title="Close (Esc)" onclick={() => dialog?.close()}>
        <Icon name="close" />
      </button>
    </header>
    <div class="modal-body">
      {@render children()}
    </div>
    <footer class="modal-foot">
      {#if extra}<div class="modal-extra">{@render extra()}</div>{/if}
      <button class="button" type="button" onclick={() => dialog?.close()}>Cancel</button>
      <button class="button button-primary" type="submit">{submitLabel}</button>
    </footer>
  </form>
</dialog>
