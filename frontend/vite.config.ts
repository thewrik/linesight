import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_BASE lets the static build live under a GitHub Pages sub-path.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react()],
  server: { proxy: { "/api": "http://127.0.0.1:8000" } },
});
