#!/usr/bin/env node
// Renders every agreement PDF in Forms/ to page PNGs under
// public/forms/<docKey>/page-N.png for the clipboard-style signing
// view. Run once whenever a source PDF changes, commit the output.
//
// Usage: node scripts/render-form-pages.mjs

import fs from "fs";
import path from "path";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const DOCS = {
  "bge-enhanced": "BGE Enhanced Tune up Terms.pdf",
  "bge-btu": "BGE BTU 2023 TERMS.pdf",
  "bge-release": "BGE BTU ConsentLetter.pdf",
  "pepco-terms": "Pepco BTU terms 2023.pdf",
  "pepco-consent": "Pepco BTU Consent Letter.pdf",
  "delmarva-terms": "Delmarva BTU terms 2023.pdf",
  "delmarva-consent": "Delmarva BTU consent letter.pdf",
  "smeco-enhanced": "SMECO Enhanced Tune Up Terms (1).pdf",
  "smeco-bldg": "SMECO Bldg Tune up Terms (1).pdf",
  "smeco-release": "SMECO Consent Form.pdf",
  "smeco-small": "SMECO Small Business HVAC Terms with therm MSE.pdf",
};

const SCALE = 2;

class NodeCanvasFactory {
  create(width, height) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext("2d") };
  }
  reset(pair, width, height) {
    pair.canvas.width = width;
    pair.canvas.height = height;
  }
  destroy(pair) {
    pair.canvas.width = 0;
    pair.canvas.height = 0;
  }
}

const outRoot = path.join("public", "forms");
fs.mkdirSync(outRoot, { recursive: true });

const manifest = {};
for (const [key, file] of Object.entries(DOCS)) {
  const bytes = new Uint8Array(fs.readFileSync(path.join("Forms", file)));
  const doc = await pdfjs.getDocument({
    data: bytes,
    // Render form-field appearances too (some docs are AcroForm).
    // Interactive widgets without appearance streams just stay blank.
    useSystemFonts: true,
  }).promise;

  const dir = path.join(outRoot, key);
  fs.mkdirSync(dir, { recursive: true });
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: SCALE });
    const factory = new NodeCanvasFactory();
    const { canvas, context } = factory.create(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height)
    );
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvasContext: context,
      viewport,
      canvasFactory: factory,
      // Show existing field values / annotations baked in the PDFs
      // (e.g. the pre-checked Contractor boxes and payee names).
      annotationMode: pdfjs.AnnotationMode.ENABLE,
    }).promise;
    const png = canvas.toBuffer("image/png");
    fs.writeFileSync(path.join(dir, `page-${p}.png`), png);
    const base = page.getViewport({ scale: 1 });
    pages.push({
      page: p,
      width: Math.round(base.width),
      height: Math.round(base.height),
    });
    console.log(`${key} page ${p}: ${canvas.width}x${canvas.height}`);
  }
  manifest[key] = { file, pages };
}

fs.writeFileSync(
  path.join(outRoot, "manifest.json"),
  JSON.stringify(manifest, null, 2)
);
console.log("\nWrote manifest.json");
