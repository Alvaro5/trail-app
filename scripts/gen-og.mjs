// Rasterize the social-card / icon SVGs to PNG. X/Twitter cards require a raster
// og:image (PNG/JPG) — an SVG og:image will not unfurl. sharp ships prebuilt
// libvips binaries, so no system image libraries are needed.
//
// Usage: node scripts/gen-og.mjs
// Produces: public/og.png (1200x630), public/apple-touch-icon.png (180x180)
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pub = join(root, "public");

await sharp(readFileSync(join(pub, "og.svg")))
  .png()
  .toFile(join(pub, "og.png"));
console.log("wrote public/og.png (1200x630)");

await sharp(readFileSync(join(pub, "favicon.svg")))
  .resize(180, 180)
  .png()
  .toFile(join(pub, "apple-touch-icon.png"));
console.log("wrote public/apple-touch-icon.png (180x180)");
