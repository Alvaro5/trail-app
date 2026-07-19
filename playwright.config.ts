import { defineConfig } from "@playwright/test";

// E2E smoke against the real production build (vite preview). Guards the
// WIRING the unit tests mock away: lazy chunks, the export popup, the POI
// fetch path. External hosts are blocked per-test for determinism.
export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  use: {
    baseURL: "http://localhost:4173",
    locale: "en-US",
  },
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
