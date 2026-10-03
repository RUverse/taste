import { svelte } from "@sveltejs/vite-plugin-svelte";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8"));

export default defineConfig({
  plugins: [svelte()],
  define: {
    __VIEWER_VERSION__: JSON.stringify(version),
  },
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
