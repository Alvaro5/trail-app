import { defineConfig } from "vitest/config";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable + offline: the app shell precaches, so a plan saved on the
    // device (lib/persistence.ts) opens with no signal — the race-day case.
    // Deliberately NO runtime caching: map tiles and Overpass stay live-only
    // (tile-server usage policies, and stale POIs are worse than none).
    // The bundled example GPX files are not precached either; offline serves
    // YOUR saved plan, not the demo.
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "GradePace",
        short_name: "GradePace",
        description:
          "Grade-adjusted race plans from your GPX: per-km pace, climbs, and power-hike splits. All in your browser.",
        theme_color: "#18181b",
        background_color: "#09090b",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // og.png exists for social unfurls only; the app never fetches it.
        globIgnores: ["**/og.png"],
      },
    }),
  ],
  test: {
    // Playwright specs live in e2e/ and must not run under Vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
