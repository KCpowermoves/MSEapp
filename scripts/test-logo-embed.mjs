#!/usr/bin/env node
// Standalone smoke test that the embedded base64 logo can actually
// be embedded by PDFKit's standalone build. No Next.js path aliases
// involved — just decode + doc.image + write to disk. If this PDF
// shows the Maryland circle logo at top-left, we know the runtime
// path on Vercel will too.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const PDFDocument = require("pdfkit/js/pdfkit.standalone");

// Extract the base64 from the auto-generated module without ESM-
// importing the .ts file (which needs Next-style aliasing).
const src = readFileSync("lib/payroll-logo.ts", "utf8");
const match = src.match(/"([A-Za-z0-9+/=]{1000,})"/);
if (!match) {
  console.error("Couldn't find base64 in lib/payroll-logo.ts");
  process.exit(1);
}
const logoBuf = Buffer.from(match[1], "base64");
console.log(`logo buffer: ${logoBuf.length} bytes, magic ${logoBuf.slice(0, 4).toString("hex")}`);

const doc = new PDFDocument({ size: "LETTER", margin: 48 });
const chunks = [];
doc.on("data", (c) => chunks.push(c));
const finished = new Promise((resolve, reject) => {
  doc.on("end", resolve);
  doc.on("error", reject);
});

// PDFKit standalone is a browserify bundle. Its Buffer.isBuffer()
// only recognizes the browserified Buffer class, not Node-native
// Buffer — so we hand it an ArrayBuffer slice and let PDFKit's
// own `Buffer.from(new Uint8Array(ab))` path run.
const logoAb = logoBuf.buffer.slice(
  logoBuf.byteOffset,
  logoBuf.byteOffset + logoBuf.byteLength
);

try {
  doc.image(logoAb, 48, 48, { fit: [56, 56] });
  console.log("✓ doc.image() succeeded — PDFKit accepted the ArrayBuffer");
} catch (e) {
  console.error("✗ doc.image() FAILED:", e);
  process.exit(1);
}

doc
  .fillColor("#1A2332")
  .font("Helvetica-Bold")
  .fontSize(22)
  .text("Payroll Report", 48 + 70, 50);
doc
  .fillColor("#6B7280")
  .font("Helvetica")
  .fontSize(10)
  .text("Maryland Smart Energy", 48 + 70, 76);

doc.end();
await finished;

mkdirSync("temporary screenshots", { recursive: true });
const out = "temporary screenshots/logo-embed-smoke.pdf";
writeFileSync(out, Buffer.concat(chunks));
console.log(`✓ wrote ${out} (${Buffer.concat(chunks).length} bytes)`);
console.log("Open it — if you see the Maryland circle logo, the embed works.");
