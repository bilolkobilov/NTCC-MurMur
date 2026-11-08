/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // During development the API runs separately on :8000; in the demo FastAPI serves the built site itself.
    proxy: { "/api": "http://localhost:8000" },
  },
  build: {
    rolldownOptions: {
      output: {
        // Libraries change rarely: their own chunk stays cached when only app code changes.
        advancedChunks: {
          groups: [
            {
              name: "vendor",
              test: /node_modules[\\/](react|react-dom|react-router|scheduler|@tanstack|i18next|react-i18next|@radix-ui)[\\/]/,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
