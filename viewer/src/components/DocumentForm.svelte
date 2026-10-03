<script lang="ts">
  import { setField } from "../lib/editing.ts";
  import { session } from "../lib/session.svelte.ts";
  import Modal from "./Modal.svelte";

  const manifest = session.manifest!;
  let title = $state(manifest.title ?? "");
  let description = $state(manifest.description ?? "");

  function submit(): boolean {
    return session.edit("Edit the file’s title", (_doc, current) => {
      setField(current, "title", title.trim());
      setField(current, "description", description.trim());
    });
  }
</script>

<Modal title="About this file" onclose={() => (session.editor = null)} onsubmit={submit}>
  <label class="field">
    <span class="field-label">Title</span>
    <!-- svelte-ignore a11y_autofocus -->
    <input class="input" autofocus placeholder={session.name} bind:value={title} />
  </label>
  <label class="field">
    <span class="field-label">Description</span>
    <textarea class="input" rows="3" bind:value={description}></textarea>
  </label>
</Modal>
