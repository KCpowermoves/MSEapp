#!/usr/bin/env node
// Generate PWA icons from the brand logo on a navy background.
// Produces public/icon-192.png, public/icon-512.png, public/apple-touch-icon.png

import sharp from "sharp";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const logoPath = resolve(projectRoot, "public/logo.png");

const NAVY = { r: 26, g: 35, b: 50, alpha: 1 };

async function makeIcon(size, outFile, padding = 0.18) {
  const inner = Math.round(size * (1 - padding * 2));
  const offset = Math.round((size - inner) / 2);
  const logo = await sharp(logoPath)
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({
    create: { width: size, height: size, channels: 4, background: NAVY },
  })
    .composite([{ input: logo, left: offset, top: offset }])
    .png()
    .toFile(resolve(projectRoot, outFile));
  console.log(`  wrote ${outFile} (${size}×${size})`);
}

console.log("Generating PWA icons...");
await makeIcon(192, "public/icon-192.png");
await makeIcon(512, "public/icon-512.png");
await makeIcon(180, "public/apple-touch-icon.png");
console.log("Done.");
