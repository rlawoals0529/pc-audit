import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(import.meta.dirname, "."),
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        root: resolve(import.meta.dirname, "index.html"),
        site: resolve(import.meta.dirname, "site/index.html"),
      },
    },
  },
  server: { port: 4192 },
  preview: { port: 4192 },
});
