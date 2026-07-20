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

test("race replay animates a dot with a live readout", async ({ page }) => {
  await page.goto("/#rav=17,33,47&st=8:00");
  await expect(page.getByText("Projected finish")).toBeVisible();
  await expect(page.getByLabel("Map style")).toBeVisible();
  await page.getByRole("button", { name: /Replay the race/ }).click();
  // The readout chip fills and advances as the dot runs the course.
  const readout = page
    .locator("span.tabular-nums", { hasText: /km|mi/ })
    .first();
  await expect(readout).toBeVisible();
  const t1 = await readout.textContent();
  await page.waitForTimeout(2500);
  const t2 = await readout.textContent();
  expect(t1).toMatch(/km|mi/); // en-US locale renders miles
  expect(t2).not.toBe(t1); // it moved
  // Wall-clock present because a start time is set.
  expect(t2).toMatch(/\d{2}:\d{2}/);
  await page.getByRole("button", { name: /Stop replay/ }).click();
});

test("3D flyover renders a rotating course ribbon", async ({ page }) => {
  await page.goto("/#rav=17,33,47");
  await expect(page.getByText("Projected finish")).toBeVisible();
  await page.getByRole("button", { name: "3D", exact: true }).click();
  const overlay = page.locator("body > div.fixed");
  await expect(overlay.getByText("3D flyover")).toBeVisible();
  // The ribbon paths get real geometry once the rAF loop draws…
  const path = overlay.locator("svg path").nth(2);
  await expect(path).toHaveAttribute("d", /M.+L.+/);
  // …and the auto-orbit keeps changing it.
  const d1 = await path.getAttribute("d");
  await page.waitForTimeout(800);
  expect(await path.getAttribute("d")).not.toBe(d1);
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
});
