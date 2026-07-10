import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export function normalizePublicBasePath(value = process.env.PENNY_PUBLIC_BASE_PATH || "") {
  const trimmed = String(value).trim();
  if (!trimmed) return "./";
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/") ? withLeadingSlash : `${withLeadingSlash}/`;
}

export default defineConfig({
  root: new URL(".", import.meta.url).pathname,
  base: normalizePublicBasePath(),
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5177,
    strictPort: false,
  },
});
