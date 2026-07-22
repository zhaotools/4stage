import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "exclude-internal-labeling-artifacts",
      apply: "build",
      async closeBundle() {
        const generated = resolve(process.cwd(), "dist", "data");
        await Promise.all([
          rm(resolve(generated, "stage13-candidates.json"), { force: true }),
          rm(resolve(generated, "stage13-validation-candidates.json"), { force: true }),
          rm(resolve(generated, "stage13-validation-v3-candidates.json"), { force: true }),
        ]);
      },
    },
  ],
  build: {
    rollupOptions: {
      input: { main: "index.html" },
    },
  },
});
