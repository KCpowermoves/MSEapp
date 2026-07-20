// Packet fill engine — takes the registry + lead fields + a signature
// PNG and fills/flattens/signs each source document. Per Kevin, signed
// output is stored as SEPARATE PDFs (one per document — consent, BTU,
// enhanced, etc.), never merged, via buildPacketDocuments(). A merged
// build (buildPacketPdf) is kept for previews/tests. Plain ESM so both
// Next.js server code and node scripts can import it.

import fs from "fs";
import path from "path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { DOCS, PACKETS, resolveSource } from "./registry.mjs";

const FORM_FILES = {
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

const INK = rgb(0.1, 0.12, 0.3);

/** Build the date context (Eastern time) used by "!date" etc. */
export function dateContext(when = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).formatToParts(when);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  const monthName = get("month");
  const day = get("day");
  const year = get("year");
  return {
    monthName,
    day,
    year,
    dateLong: `${monthName} ${day}, ${year}`,
  };
}

/** Fill, flatten, and sign one source document. Returns the filled
 *  pdf-lib PDFDocument (not yet saved), so callers can either save it
 *  standalone or copy its pages into a merged doc. */
async function fillDoc(docKey, ctx, opts, formsDir) {
  const def = DOCS[docKey];
  const bytes = fs.readFileSync(path.join(formsDir, FORM_FILES[docKey]));
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await src.embedFont(StandardFonts.Helvetica);
  const pages = src.getPages();

  // 1. AcroForm fields by name, then flatten so the output is inert.
  if (def.acroText) {
    const form = src.getForm();
    for (const [name, source] of Object.entries(def.acroText)) {
      const value = resolveSource(source, ctx);
      if (!value) continue;
      try {
        const field = form.getTextField(name);
        field.setText(value);
        field.setFontSize(9);
      } catch (e) {
        console.warn(`[fill] ${docKey}: text field "${name}" failed:`, e.message);
      }
    }
    for (const name of def.acroCheck ?? []) {
      try {
        form.getCheckBox(name).check();
      } catch {
        // may already be checked via baked appearance — ignore
      }
    }
    // Signature-type fields can't be flattened — drop them (we stamp
    // the drawn signature image ourselves).
    for (const field of [...form.getFields()]) {
      if (field.constructor.name === "PDFSignature") {
        try {
          form.removeField(field);
        } catch { /* leave it */ }
      }
    }
    try {
      form.flatten();
    } catch (e) {
      console.warn(`[fill] ${docKey}: flatten failed:`, e.message);
    }
  }

  // 2. Flat overlays.
  for (const f of def.fill ?? []) {
    const value = resolveSource(f.source, ctx);
    if (!value) continue;
    const page = pages[f.page - 1];
    const size = f.size ?? 9.5;
    page.drawText(String(value), {
      x: f.x,
      y: page.getHeight() - f.yTop - size,
      size,
      font,
      color: INK,
    });
  }

  // 3. SMECO-Small pick marks.
  if (def.marks) {
    const drawMark = (spot) => {
      if (!spot) return;
      const page = pages[2]; // participation agreement, page 3
      page.drawText("X", {
        x: spot.x,
        y: page.getHeight() - spot.yTop - 9,
        size: 9,
        font,
        color: INK,
      });
    };
    if (opts.primaryUse) drawMark(def.marks.primaryUse[opts.primaryUse]);
    if (opts.customerType) drawMark(def.marks.customerType[opts.customerType]);
  }

  // 4. Signature stamps.
  if (opts.signaturePng) {
    const sigImage = await src.embedPng(opts.signaturePng);
    for (const s of def.sigs ?? []) {
      const page = pages[s.page - 1];
      const scale = Math.min(s.w / sigImage.width, s.h / sigImage.height);
      const w = sigImage.width * scale;
      const h = sigImage.height * scale;
      page.drawImage(sigImage, {
        x: s.x,
        y: page.getHeight() - s.yTop - s.h + (s.h - h) / 2,
        width: w,
        height: h,
      });
    }
  }

  return src;
}

/**
 * Fill a packet and return EACH document as its own PDF — never merged.
 * This is what the signing flow stores in Drive, so a customer who
 * signed two or three forms ends up with two or three separate files.
 *
 * @param {object} opts  same shape as buildPacketPdf
 * @returns {Promise<Array<{docKey: string, label: string, bytes: Uint8Array}>>}
 */
export async function buildPacketDocuments(opts) {
  const packet = PACKETS[opts.packetKey];
  if (!packet) throw new Error(`Unknown packet: ${opts.packetKey}`);
  const formsDir = opts.formsDir ?? path.join(process.cwd(), "Forms");
  const ctx = {
    fields: opts.fields ?? {},
    ...dateContext(opts.signedAt ?? new Date()),
  };

  const out = [];
  for (const docKey of packet.docs) {
    const src = await fillDoc(docKey, ctx, opts, formsDir);
    src.setTitle(`${DOCS[docKey].label} — ${ctx.fields.businessName ?? ""}`);
    src.setAuthor("Maryland Smart Energy");
    out.push({
      docKey,
      label: DOCS[docKey].label,
      bytes: await src.save(),
    });
  }
  return out;
}

/**
 * Fill a packet and return ONE merged PDF (all documents). Used for the
 * calibration/test harness and any single-file preview. The live
 * signing flow uses buildPacketDocuments() instead.
 *
 * @param {object} opts  see buildPacketDocuments
 * @returns {Promise<Uint8Array>}
 */
export async function buildPacketPdf(opts) {
  const packet = PACKETS[opts.packetKey];
  if (!packet) throw new Error(`Unknown packet: ${opts.packetKey}`);
  const formsDir = opts.formsDir ?? path.join(process.cwd(), "Forms");
  const ctx = {
    fields: opts.fields ?? {},
    ...dateContext(opts.signedAt ?? new Date()),
  };

  const out = await PDFDocument.create();
  out.setTitle(`${packet.label} — ${ctx.fields.businessName ?? ""}`);
  out.setAuthor("Maryland Smart Energy");
  for (const docKey of packet.docs) {
    const src = await fillDoc(docKey, ctx, opts, formsDir);
    const copied = await out.copyPages(src, src.getPageIndices());
    for (const p of copied) out.addPage(p);
  }
  return out.save();
}
