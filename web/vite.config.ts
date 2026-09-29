import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: { "@shared": fileURLToPath(new URL("../shared", import.meta.url)) },
  },
  server: {
    host: "127.0.0.1",
    port: 4701,
    proxy: { "/api": { target: "http://127.0.0.1:4700", changeOrigin: false } },
  },
  build: {
    outDir: fileURLToPath(new URL("../dist/web", import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000, // served from localhost; one bundle is fine
  },
});
