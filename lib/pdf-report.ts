import "server-only";
// Standalone build inlines the Standard 14 fonts so the document
// renders in Vercel's serverless runtime without external font files.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const PDFDocument: any = require("pdfkit/js/pdfkit.standalone");
import { getDriveClient } from "@/lib/google/auth";
import type { Dispatch, Job, UnitServiced } from "@/lib/types";

// PDFKit's untyped runtime — every helper takes a doc instance and
// chains side-effecting calls. Aliasing once here keeps the disable
// comments out of every signature.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;

const NAVY = "#1A2332";
const GOLD = "#C5A572";
const MUTED = "#6B7280";
const LIGHT = "#E5E7EB";

interface BuildPdfInput {
  job: Job;
  dispatch: Dispatch;
  units: UnitServiced[];
}

// PDFKit page geometry — letter, 48pt margins.
const PAGE_HEIGHT = 792;
const PAGE_WIDTH = 612;
const MARGIN = 48;
const CONTENT_W = PAGE_WIDTH - MARGIN * 2; // 516
const PAGE_BOTTOM = PAGE_HEIGHT - MARGIN; // 744

interface PhotoPair {
  label: string;
  beforeUrl: string;
  afterUrl: string;
}

interface UnitNameplates {
  outdoor: string;
  indoor: string;
}

/**
 * For each unit type, returns the canonical before/after pairs (using
 * the actual column-storage convention from urlForSlot in lib/data/
 * units.ts) plus any standalone-photo URLs not in a pair.
 *
 *   PTAC / Ductless: 1 pair (pre1=before, pre2=after) + filter standalone
 *   RTU-S/M/L:       3 pairs (coil1, coil2, filter)
 *   Split System:    4 pairs (outdoor 1/2/3 + air handler) + filter standalone
 */
function pairsForUnit(u: UnitServiced): {
  pairs: PhotoPair[];
  standalones: { label: string; url: string }[];
  nameplates: UnitNameplates;
} {
  if (u.unitType === "PTAC / Ductless") {
    return {
      pairs: [
        {
          label: "Service",
          beforeUrl: u.pre1Url,
          afterUrl: u.pre2Url,
        },
      ],
      standalones: u.filterUrl
        ? [{ label: "Filter", url: u.filterUrl }]
        : [],
      nameplates: { outdoor: u.nameplateUrl, indoor: "" },
    };
  }
  if (u.unitType === "Split System") {
    return {
      pairs: [
        { label: "Outdoor · side 1", beforeUrl: u.pre1Url, afterUrl: u.post1Url },
        { label: "Outdoor · side 2", beforeUrl: u.pre2Url, afterUrl: u.post2Url },
        { label: "Outdoor · side 3", beforeUrl: u.pre3Url, afterUrl: u.post3Url },
        { label: "Air handler", beforeUrl: u.inPreUrl, afterUrl: u.inPostUrl },
      ],
      standalones: u.filterUrl
        ? [{ label: "Filter", url: u.filterUrl }]
        : [],
      nameplates: {
        outdoor: u.nameplateUrl,
        indoor: u.inNameplateUrl,
      },
    };
  }
  // RTU-S/M/L — pre1/post1 = coil1, pre2/post2 = coil2, filterUrl/pre3 = filter
  return {
    pairs: [
      { label: "Coil 1", beforeUrl: u.pre1Url, afterUrl: u.post1Url },
      { label: "Coil 2", beforeUrl: u.pre2Url, afterUrl: u.post2Url },
      { label: "Filter", beforeUrl: u.filterUrl, afterUrl: u.pre3Url },
    ],
    standalones: [],
    nameplates: { outdoor: u.nameplateUrl, indoor: "" },
  };
}

/**
 * Render the service-report PDF. Layout:
 *   Page 1: header + customer block + per-unit sections
 *     Each unit:
 *       - Heading bar (navy)
 *       - Two-column row: make/model/serial/notes on the left,
 *         nameplate photo on the right
 *       - Before/after photo pairs, side-by-side per pair
 *       - Standalone photos (filter etc.) below
 *   Last page: customer signature (if captured)
 *
 * Photos are pre-fetched concurrently from Drive via the service
 * account. Bytes that don't pass a JPEG/PNG magic-byte sniff are
 * dropped with a logged warning so the PDF doesn't try to embed an
 * HTML error page (which would silently break the embed).
 */
export async function buildJobPdf(input: BuildPdfInput): Promise<Buffer> {
  const { job, dispatch, units } = input;

  // ── Pre-fetch every unique photo URL we'll need.
  const urls = new Set<string>();
  for (const u of units) {
    if (u.nameplateUrl) urls.add(u.nameplateUrl);
    if (u.inNameplateUrl) urls.add(u.inNameplateUrl);
    if (u.pre1Url) urls.add(u.pre1Url);
    if (u.pre2Url) urls.add(u.pre2Url);
    if (u.pre3Url) urls.add(u.pre3Url);
    if (u.post1Url) urls.add(u.post1Url);
    if (u.post2Url) urls.add(u.post2Url);
    if (u.post3Url) urls.add(u.post3Url);
    if (u.filterUrl) urls.add(u.filterUrl);
    if (u.inPreUrl) urls.add(u.inPreUrl);
    if (u.inPostUrl) urls.add(u.inPostUrl);
  }
  if (dispatch.signatureUrl) urls.add(dispatch.signatureUrl);

  console.log(
    `[pdf] dispatch=${dispatch.dispatchId} fetching ${urls.size} unique photo(s)`
  );
  const photoMap = new Map<string, Buffer>();
  await Promise.all(
    Array.from(urls).map(async (url) => {
      const buf = await fetchDriveImage(url);
      if (buf) photoMap.set(url, buf);
    })
  );
  console.log(
    `[pdf] dispatch=${dispatch.dispatchId} fetched ${photoMap.size}/${urls.size} photos`
  );

  return await new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument({ size: "LETTER", margin: MARGIN });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    renderHeader(doc, job, dispatch);

    if (units.length === 0) {
      doc
        .fillColor(MUTED)
        .fontSize(11)
        .font("Helvetica")
        .text("No units recorded on this dispatch.");
    } else {
      units.forEach((u, i) => {
        if (i > 0) doc.moveDown(1.2);
        renderUnitSection(doc, u, photoMap);
      });
    }

    if (dispatch.signatureUrl) {
      const sigBuf = photoMap.get(dispatch.signatureUrl);
      if (sigBuf) renderSignature(doc, sigBuf, dispatch.signedByName);
    }

    doc.end();
  });
}

// ── Section renderers ───────────────────────────────────────────────

function renderHeader(doc: Doc, job: Job, dispatch: Dispatch) {
  doc
    .fillColor(NAVY)
    .fontSize(22)
    .font("Helvetica-Bold")
    .text("Maryland Smart Energy");
  doc
    .fillColor(MUTED)
    .fontSize(10)
    .font("Helvetica")
    .text("HVAC service report", { paragraphGap: 14 });

  doc
    .fillColor(NAVY)
    .fontSize(16)
    .font("Helvetica-Bold")
    .text(job.customerName);
  if (job.siteAddress) {
    doc.fillColor(MUTED).fontSize(11).font("Helvetica").text(job.siteAddress);
  }
  doc.fillColor(MUTED).fontSize(10).font("Helvetica");
  const submittedAt = dispatch.submittedAt
    ? new Date(dispatch.submittedAt).toLocaleString("en-US", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : dispatch.dispatchDate;
  doc.text(
    [
      `Service date: ${dispatch.dispatchDate}`,
      `Submitted: ${submittedAt}`,
      `Tech${dispatch.techsOnSite.length === 1 ? "" : "s"}: ${
        dispatch.techsOnSite.join(", ") || "—"
      }`,
      `Utility: ${job.utilityTerritory}`,
    ].join("    ·    "),
    { paragraphGap: 14 }
  );

  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .strokeColor(GOLD)
    .lineWidth(1.5)
    .stroke();
  doc.moveDown(0.7);
}

function renderUnitSection(doc: Doc, u: UnitServiced, photos: Map<string, Buffer>) {
  const num = String(u.unitNumberOnJob).padStart(3, "0");
  const heading = u.label?.trim()
    ? `Unit ${num} · ${u.label} · ${u.unitType}`
    : `Unit ${num} · ${u.unitType}`;

  ensureRoom(doc, 220);

  // Heading bar
  const headingY = doc.y;
  doc
    .rect(MARGIN, headingY, CONTENT_W, 22)
    .fillColor(NAVY)
    .fill();
  doc
    .fillColor("#FFFFFF")
    .fontSize(11)
    .font("Helvetica-Bold")
    .text(heading, MARGIN + 10, headingY + 6, {
      width: CONTENT_W - 20,
    });
  doc.y = headingY + 28;

  const { pairs, standalones, nameplates } = pairsForUnit(u);

  // Two-column row: text on left, primary nameplate on right.
  const textColW = 280;
  const photoColW = CONTENT_W - textColW - 16;
  const rowTop = doc.y;
  const rowLeftX = MARGIN;
  const rowRightX = MARGIN + textColW + 16;

  // Left column: make / model / serial + notes
  doc.fillColor(NAVY).fontSize(10).font("Helvetica-Bold");
  let textY = rowTop;
  const writeRow = (label: string, value: string) => {
    if (!value) return;
    doc.font("Helvetica-Bold").fillColor(MUTED).fontSize(9).text(
      label.toUpperCase(),
      rowLeftX,
      textY,
      { width: textColW, lineBreak: false }
    );
    textY += 11;
    doc.font("Helvetica").fillColor(NAVY).fontSize(11).text(
      value,
      rowLeftX,
      textY,
      { width: textColW }
    );
    textY = doc.y + 4;
  };
  writeRow("Make", u.make);
  writeRow("Model", u.model);
  writeRow("Serial", u.serial);
  if (u.notes) {
    doc.font("Helvetica-Bold").fillColor(MUTED).fontSize(9).text(
      "NOTES",
      rowLeftX,
      textY,
      { width: textColW, lineBreak: false }
    );
    textY += 11;
    doc.font("Helvetica-Oblique").fillColor(NAVY).fontSize(10).text(
      u.notes,
      rowLeftX,
      textY,
      { width: textColW }
    );
    textY = doc.y + 4;
  }

  // Right column: nameplate photo (outdoor — main one for this unit type)
  const photoH = 150;
  if (nameplates.outdoor) {
    const buf = photos.get(nameplates.outdoor);
    if (buf) {
      drawCaptionedPhoto(
        doc,
        buf,
        u.unitType === "Split System" ? "Outdoor nameplate" : "Nameplate",
        rowRightX,
        rowTop,
        photoColW,
        photoH
      );
    }
  }

  // Advance y past whichever column is taller.
  const photoBottom = nameplates.outdoor && photos.get(nameplates.outdoor)
    ? rowTop + photoH + 16
    : rowTop;
  doc.y = Math.max(textY, photoBottom);

  // Indoor (air handler) nameplate as a second row if present
  if (nameplates.indoor && photos.get(nameplates.indoor)) {
    ensureRoom(doc, photoH + 30);
    doc.moveDown(0.4);
    drawCaptionedPhoto(
      doc,
      photos.get(nameplates.indoor)!,
      "Air handler nameplate",
      MARGIN,
      doc.y,
      photoColW,
      photoH
    );
    doc.y = doc.y + photoH + 22;
  }

  // Before/after pairs — each pair in its own 2-col row
  for (const pair of pairs) {
    const beforeBuf = pair.beforeUrl ? photos.get(pair.beforeUrl) : undefined;
    const afterBuf = pair.afterUrl ? photos.get(pair.afterUrl) : undefined;
    if (!beforeBuf && !afterBuf) continue;
    ensureRoom(doc, 200);
    doc.moveDown(0.6);
    renderPairRow(doc, pair.label, beforeBuf, afterBuf);
  }

  // Standalones (filter, etc.)
  for (const sp of standalones) {
    const buf = photos.get(sp.url);
    if (!buf) continue;
    ensureRoom(doc, photoH + 30);
    doc.moveDown(0.6);
    drawCaptionedPhoto(doc, buf, sp.label, MARGIN, doc.y, 280, photoH);
    doc.y = doc.y + photoH + 22;
  }
}

function renderPairRow(
  doc: Doc,
  pairLabel: string,
  beforeBuf: Buffer | undefined,
  afterBuf: Buffer | undefined
) {
  // Pair label spanning both columns
  doc.fillColor(NAVY).fontSize(10).font("Helvetica-Bold").text(
    pairLabel,
    MARGIN,
    doc.y,
    { width: CONTENT_W }
  );
  doc.moveDown(0.25);

  const cellW = (CONTENT_W - 16) / 2;
  const cellH = 165;
  const top = doc.y;
  const leftX = MARGIN;
  const rightX = MARGIN + cellW + 16;

  drawCaptionedPhoto(doc, beforeBuf, "BEFORE", leftX, top, cellW, cellH);
  drawCaptionedPhoto(doc, afterBuf, "AFTER", rightX, top, cellW, cellH);

  doc.y = top + cellH + 22;
}

function drawCaptionedPhoto(
  doc: Doc,
  buf: Buffer | undefined,
  caption: string,
  x: number,
  y: number,
  w: number,
  h: number
) {
  // Frame
  doc
    .rect(x, y, w, h)
    .strokeColor(LIGHT)
    .lineWidth(1)
    .stroke();
  if (buf) {
    try {
      doc.image(buf, x + 2, y + 2, {
        fit: [w - 4, h - 4],
        align: "center",
        valign: "center",
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[pdf] embed failed for "${caption}": ${msg}`);
      drawMissingPlaceholder(doc, x, y, w, h, "Photo unavailable");
    }
  } else {
    drawMissingPlaceholder(doc, x, y, w, h, "—");
  }
  doc
    .fillColor(MUTED)
    .fontSize(9)
    .font("Helvetica-Bold")
    .text(caption, x, y + h + 4, { width: w });
}

function drawMissingPlaceholder(
  doc: Doc,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string
) {
  doc
    .fillColor("#F3F4F6")
    .rect(x + 1, y + 1, w - 2, h - 2)
    .fill();
  doc
    .fillColor(MUTED)
    .fontSize(10)
    .font("Helvetica")
    .text(text, x, y + h / 2 - 6, { width: w, align: "center" });
}

function renderSignature(doc: Doc, buf: Buffer, signedByName: string) {
  ensureRoom(doc, 180);
  doc.moveDown(1.2);
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_WIDTH - MARGIN, doc.y)
    .strokeColor(GOLD)
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.6);
  doc.fillColor(NAVY).fontSize(11).font("Helvetica-Bold").text(
    "Customer signature",
    MARGIN,
    doc.y
  );
  doc.moveDown(0.3);
  const top = doc.y;
  try {
    doc.image(buf, MARGIN, top, { fit: [320, 100] });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[pdf] signature embed failed: ${msg}`);
  }
  doc.fillColor(MUTED).fontSize(10).font("Helvetica").text(
    signedByName ? `Signed by ${signedByName}` : "",
    MARGIN,
    top + 110
  );
}

function ensureRoom(doc: Doc, needed: number) {
  if (doc.y + needed > PAGE_BOTTOM) {
    doc.addPage();
    doc.y = MARGIN;
  }
}

// ── Drive fetch with magic-byte validation ──────────────────────────

async function fetchDriveImage(url: string): Promise<Buffer | null> {
  const m =
    url.match(/\/d\/([A-Za-z0-9_-]+)/) ??
    url.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (!m) {
    console.warn(`[pdf] no fileId in url: ${url.slice(0, 100)}`);
    return null;
  }
  const fileId = m[1];
  try {
    const drive = getDriveClient();
    const res = await drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
        // Drive sometimes wraps "abusive" file downloads in an HTML
        // confirm page. acknowledgeAbuse bypasses that for trusted
        // service-account access — needed when bytes come back as
        // an HTML wrapper instead of the actual image.
        acknowledgeAbuse: true,
      },
      { responseType: "arraybuffer" }
    );
    const buf = Buffer.from(res.data as ArrayBuffer);
    if (buf.length === 0) {
      console.warn(`[pdf] empty buffer for ${fileId}`);
      return null;
    }
    if (!isImageBuffer(buf)) {
      // Surface what we got — usually HTML if the file isn't accessible
      // or a permissions error response. Logging the first 80 bytes is
      // enough to spot HTML/JSON without dumping the whole payload.
      const snippet = buf.slice(0, 80).toString("utf8").replace(/\s+/g, " ");
      console.warn(
        `[pdf] non-image bytes for ${fileId} (len=${buf.length}): ${snippet}`
      );
      return null;
    }
    return buf;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[pdf] drive fetch failed for ${fileId}: ${msg}`);
    return null;
  }
}

/** JPEG starts with FF D8 FF; PNG with 89 50 4E 47. */
function isImageBuffer(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  )
    return true;
  return false;
}
