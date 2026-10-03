<script lang="ts">
  import { session } from "../lib/session.svelte.ts";
  import CollectionForm from "./CollectionForm.svelte";
  import DocumentForm from "./DocumentForm.svelte";
  import FileForm from "./FileForm.svelte";
  import ItemForm from "./ItemForm.svelte";

  const editor = $derived(session.editor);
</script>

{#if editor}
  {#key editor}
    {#if editor.kind === "item"}
      <ItemForm itemId={editor.id} />
    {:else if editor.kind === "collection"}
      <CollectionForm collectionId={editor.id} />
    {:else if editor.kind === "file"}
      <FileForm itemId={editor.itemId} fileId={editor.fileId} />
    {:else}
      <DocumentForm />
    {/if}
  {/key}
{/if}
