import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  // Relative asset paths, so the build works from any folder, static hosting, or a desktop shell.
  base: "./",
  server: {
    // The sample file lives in ../spec/examples.
    fs: { allow: [repoRoot] },
  },
  build: {
    target: "es2022",
  },
});
