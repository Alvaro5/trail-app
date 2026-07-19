import { expect, test } from "@playwright/test";

// A drinking-water node sitting exactly on the Imperial course (its first
// track point), so the corridor filter must keep it.
const OVERPASS_FIXTURE = {
  elements: [
    {
      type: "node",
      lat: 48.43198,
      lon: 2.68463,
      tags: { amenity: "drinking_water", name: "Fontaine du départ" },
    },
  ],
};

test.beforeEach(async ({ context }) => {
  // Determinism: no real tiles, no analytics, no real Overpass.
  await context.route(
    /opentopomap|arcgisonline|openstreetmap\.org|umami/,
    (route) => route.abort(),
  );
  // The export sheet auto-calls print(); a native dialog would hang headless.
  await context.addInitScript(() => {
    window.print = () => {};
  });
});

test("auto-loads the example and renders the full dashboard", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText("Projected finish")).toBeVisible();
  await expect(page.getByText("Elevation gain")).toBeVisible();
  await expect(page.getByText("Example", { exact: true })).toBeVisible();
  // Splits table rendered with rows.
  expect(await page.locator("table tbody tr").count()).toBeGreaterThan(5);
});

test("Export PDF opens the printable plan sheet", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Projected finish")).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Export PDF" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("domcontentloaded");
  await expect(popup).toHaveTitle(/GradePace/);
  await expect(popup.getByText("Pacing table")).toBeVisible();
});

test("POI toggle fetches and pins points of interest", async ({ page }) => {
  // All Overpass mirrors answer with the fixture (the app races them).
  await page.route(/interpreter|overpass/, (route) =>
    route.fulfill({ json: OVERPASS_FIXTURE }),
  );
  await page.goto("/");
  await expect(page.getByText("Projected finish")).toBeVisible();
  // Wait for the lazy Leaflet chunk: the basemap select appears with it.
  await expect(page.getByLabel("Map style")).toBeVisible();
  const markers = page.locator(".leaflet-marker-icon");
  const before = await markers.count();
  await page.getByRole("button", { name: "Points of interest" }).click();
  await expect(async () => {
    expect(await markers.count()).toBeGreaterThan(before);
  }).toPass({ timeout: 15_000 });
});
