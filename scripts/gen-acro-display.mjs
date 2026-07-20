// Emits display-overlay coordinates for the AcroForm docs (from the
// widget rects in form-fields.json) so the clipboard preview can
// position those values exactly where the PDF fields sit.
import fs from "fs";
import { DOCS } from "../lib/agreements/registry.mjs";

const fields = JSON.parse(fs.readFileSync("scripts/form-fields.json"));
const out = {};
for (const [docKey, widgets] of Object.entries(fields)) {
  const def = DOCS[docKey];
  if (!def?.acroText) continue;
  const items = [];
  for (const w of widgets) {
    const source = def.acroText[w.name];
    if (!source || w.type === "PDFSignature") continue;
    items.push({
      page: w.page,
      x: Math.round((w.x + 2) * 10) / 10,
      yTop: Math.round((w.pageH - w.y - w.h + 3) * 10) / 10,
      size: 9,
      source,
    });
  }
  out[docKey] = items;
}
fs.writeFileSync("scripts/acro-display.json", JSON.stringify(out, null, 1));
console.log(
  Object.entries(out)
    .map(([k, v]) => `${k}: ${v.length} display items`)
    .join("\n")
);
