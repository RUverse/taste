<script lang="ts">
  import sampleUrl from "../../../spec/examples/moods.taste?url";
  import { chooseFile, fetchFile } from "../lib/platform.ts";
  import { session } from "../lib/session.svelte.ts";
  import Icon from "./Icon.svelte";

  async function open() {
    const file = await chooseFile();
    if (file) await session.open(file);
  }

  let creating = $state(false);
  let title = $state("");
  let firstCollection = $state("");

  async function create(event: SubmitEvent) {
    event.preventDefault();
    await session.create(title, firstCollection);
  }

  async function openSample() {
    try {
      await session.open(await fetchFile(sampleUrl, "moods.taste"));
    } catch (error) {
      session.error = (error as Error).message;
    }
  }
</script>

<main class="welcome">
  <div class="welcome-card">
    <div class="welcome-mark" aria-hidden="true">
      <span class="swatch swatch-a"></span>
      <span class="swatch swatch-b"></span>
      <span class="swatch swatch-c"></span>
    </div>
    <h1>Taste Viewer</h1>
    <p class="welcome-lede">
      Open a <code>.taste</code> file to browse its collections: movies, series, music, articles,
      games, and the screenshots and notes that tie them together.
    </p>

    <div class="welcome-actions">
      <button class="button button-primary" type="button" onclick={open} disabled={session.loading}>
        <Icon name="open" />
        Open a file
      </button>
      <button class="button" type="button" onclick={() => (creating = !creating)} aria-expanded={creating}>
        <Icon name="plus" />
        New file
      </button>
      <button class="button" type="button" onclick={openSample} disabled={session.loading}>
        <Icon name="sparkle" />
        Try the sample
      </button>
    </div>

    {#if creating}
      <form class="welcome-new" onsubmit={create}>
        <label class="field">
          <span class="field-label">Title</span>
          <!-- svelte-ignore a11y_autofocus -->
          <input class="input" autofocus placeholder="My moods" bind:value={title} />
        </label>
        <label class="field">
          <span class="field-label">First collection</span>
          <input class="input" placeholder="Rainy Sunday" bind:value={firstCollection} />
        </label>
        <button class="button button-primary" type="submit">Create</button>
      </form>
    {/if}
    <p class="welcome-hint">or drop a file anywhere on this page</p>

    {#if session.loading}
      <p class="welcome-status" role="status">Opening…</p>
    {/if}
    {#if session.error}
      <p class="welcome-error" role="alert"><Icon name="alert" size={16} /> {session.error}</p>
    {/if}

    <p class="welcome-privacy">
      Files are read in your browser and never uploaded. Remote posters and links load from their
      own sites.
    </p>
  </div>
</main>
