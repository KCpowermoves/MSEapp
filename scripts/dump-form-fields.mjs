#!/usr/bin/env node
// Dumps AcroForm field widget rectangles (in PDF points, origin
// bottom-left) for the fillable agreement PDFs. These become exact
// overlay coordinates in the packet registry.
//
// Usage: node scripts/dump-form-fields.mjs

import fs from "fs";
import path from "path";
import { PDFDocument } from "pdf-lib";

const DOCS = {
  "bge-enhanced": "BGE Enhanced Tune up Terms.pdf",
  "bge-release": "BGE BTU ConsentLetter.pdf",
  "pepco-consent": "Pepco BTU Consent Letter.pdf",
  "smeco-enhanced": "SMECO Enhanced Tune Up Terms (1).pdf",
};

const out = {};
for (const [key, file] of Object.entries(DOCS)) {
  const doc = await PDFDocument.load(
    fs.readFileSync(path.join("Forms", file)),
    { ignoreEncryption: true }
  );
  const pages = doc.getPages();
  const fields = [];
  for (const field of doc.getForm().getFields()) {
    for (const widget of field.acroField.getWidgets()) {
      const rect = widget.getRectangle();
      // Which page is this widget on?
      let pageIndex = -1;
      const ref = widget.P();
      pages.forEach((pg, i) => {
        if (ref && pg.ref === ref) pageIndex = i;
      });
      if (pageIndex === -1) {
        // Fallback: find via page annotations
        pages.forEach((pg, i) => {
          const annots = pg.node.Annots();
          if (!annots) return;
          for (let a = 0; a < annots.size(); a++) {
            if (annots.get(a) === widget.dict) pageIndex = i;
          }
        });
      }
      fields.push({
        name: field.getName(),
        type: field.constructor.name,
        page: pageIndex + 1,
        x: Math.round(rect.x * 10) / 10,
        y: Math.round(rect.y * 10) / 10,
        w: Math.round(rect.width * 10) / 10,
        h: Math.round(rect.height * 10) / 10,
        pageH: Math.round(pages[Math.max(pageIndex, 0)].getHeight()),
      });
    }
  }
  out[key] = fields;
  console.log(`${key}: ${fields.length} widgets`);
}

fs.writeFileSync("scripts/form-fields.json", JSON.stringify(out, null, 1));
console.log("Wrote scripts/form-fields.json");
