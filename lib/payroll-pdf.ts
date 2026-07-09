import "server-only";
// Standalone PDFKit build bundles the Standard 14 fonts so this works
// on Vercel serverless without external font files.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const PDFDocument: any = require("pdfkit/js/pdfkit.standalone");

import { formatCurrency } from "@/lib/utils";
import { getPayrollLogoBuffer } from "@/lib/payroll-logo";
import { getDriveClient } from "@/lib/google/auth";
import type { PayrollReport, TechRollup } from "@/lib/payroll/compute";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;

// ─── Brand tokens ────────────────────────────────────────────────────
const NAVY = "#1A2332";
const NAVY_SOFT = "#2A3A52";
const GOLD = "#C5A572";
const GOLD_SOFT = "#E8DCC4";
const MUTED = "#6B7280";
const LIGHT = "#E5E7EB";
const RED = "#B73E2C";

// ─── Page geometry ───────────────────────────────────────────────────
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2; // 516

// ─── Logo loading ────────────────────────────────────────────────────
//
// The MSE logo lives as an inlined base64 JPEG in lib/payroll-logo.ts
// (auto-generated from public/logo.png, downscaled to 256×256 with a
// white background flatten). Embedding means zero runtime fs reads.
//
// CRITICAL: we hand PDFKit an ArrayBuffer, NOT a Node Buffer. The
// `pdfkit/js/pdfkit.standalone` build we use here is a browserify
// bundle — its internal `Buffer.isBuffer()` only recognizes its own
// polyfilled Buffer class and rejects Node-native Buffers. Passing
// a Buffer makes PDFKit fall through to a `fs.readFileSync` path that
// doesn't exist in the bundle, throwing silently and dropping us to
// the fallback brand badge. PDFKit DOES handle `ArrayBuffer`
// explicitly, then rebuilds its own Buffer from it — that path works
// on both Node and serverless.
//
// To refresh the embedded logo after a brand asset change:
//   node scripts/generate-payroll-logo.mjs

// Per-PDF nameplate cache: Drive fetches happen once per fileId per
// render, hand the same ArrayBuffer to doc.image() each row (same
// reason we hand it an ArrayBuffer, not a Node Buffer, for the logo).
async function fetchNameplate(fileId: string): Promise<ArrayBuffer | null> {
  try {
    const drive = getDriveClient();
    const res = await drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
        acknowledgeAbuse: true,
      },
      { responseType: "arraybuffer" }
    );
    const buf = res.data as ArrayBuffer;
    if (!buf || (buf as ArrayBuffer).byteLength === 0) return null;
    // First two bytes tell us if it's a JPEG or PNG — anything else
    // can't be embedded by PDFKit's standalone build.
    const view = new Uint8Array(buf);
    const isJpeg = view[0] === 0xff && view[1] === 0xd8;
    const isPng =
      view[0] === 0x89 &&
      view[1] === 0x50 &&
      view[2] === 0x4e &&
      view[3] === 0x47;
    if (!isJpeg && !isPng) return null;
    return buf;
  } catch (e) {
    console.warn("[payroll-pdf] nameplate fetch failed:", e);
    return null;
  }
}

async function buildNameplateMap(
  report: PayrollReport,
  techNameFilter?: string
): Promise<Map<string, ArrayBuffer>> {
  const ids = new Set<string>();
  for (const tech of report.techs) {
    if (techNameFilter && tech.techName !== techNameFilter) continue;
    for (const item of tech.lineItems) {
      if (item.nameplateFileId) ids.add(item.nameplateFileId);
    }
  }
  const out = new Map<string, ArrayBuffer>();
  await Promise.all(
    Array.from(ids).map(async (id) => {
      const buf = await fetchNameplate(id);
      if (buf) out.set(id, buf);
    })
  );
  return out;
}

let cachedLogoAb: ArrayBuffer | null = null;
function getLogoArrayBuffer(): ArrayBuffer | null {
  if (cachedLogoAb) return cachedLogoAb;
  try {
    const buf = getPayrollLogoBuffer();
    cachedLogoAb = buf.buffer.slice(
      buf.byteOffset,
      buf.byteOffset + buf.byteLength
    ) as ArrayBuffer;
    return cachedLogoAb;
  } catch (e) {
    console.warn("[payroll-pdf] failed to decode embedded logo:", e);
    return null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function prettyDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function prettyDateRange(start: string, end: string): string {
  return `${prettyDate(start)} – ${prettyDate(end)}`;
}

function prettyTimestamp(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusColor(status: string): string {
  if (status === "Approved") return GOLD;
  if (status === "Paid") return "#1F7A4D"; // emerald-ish
  return MUTED;
}

function ensureRoom(doc: Doc, needed: number): void {
  if (doc.y + needed > PAGE_H - MARGIN - 28) {
    addPageFooter(doc);
    doc.addPage();
    drawTopRule(doc);
  }
}

// ─── Reusable drawing primitives ─────────────────────────────────────

function drawTopRule(doc: Doc): void {
  doc.save();
  doc
    .rect(0, 0, PAGE_W, 6)
    .fill(NAVY);
  doc
    .rect(0, 6, PAGE_W, 2)
    .fill(GOLD);
  doc.restore();
  doc.y = MARGIN;
  doc.x = MARGIN;
}

function addPageFooter(doc: Doc): void {
  doc.save();
  const y = PAGE_H - MARGIN + 18;
  doc
    .fillColor(MUTED)
    .fontSize(8)
    .font("Helvetica")
    .text(
      "Maryland Smart Energy · Commission Report · CONFIDENTIAL",
      MARGIN,
      y,
      { width: CONTENT_W, align: "left", continued: true }
    )
    .text(`Page ${doc.bufferedPageRange().count}`, { align: "right" });
  doc.restore();
}

function statusPill(doc: Doc, status: string, x: number, y: number): void {
  // "Approved" reads as "INVOICE APPROVED" on the printed report so
  // the pill matches the in-app commission report language.
  const label =
    status === "Approved" ? "INVOICE APPROVED" : status.toUpperCase();
  doc.save();
  doc.font("Helvetica-Bold").fontSize(8);
  const w = doc.widthOfString(label) + 16;
  const color = statusColor(status);
  doc
    .roundedRect(x, y, w, 16, 8)
    .fill(color);
  doc
    .fillColor("white")
    .text(label, x + 8, y + 4, { width: w - 16, align: "center" });
  doc.restore();
}

function moneyAlignRight(
  doc: Doc,
  value: string,
  rightEdge: number,
  y: number,
  width: number
): void {
  doc.text(value, rightEdge - width, y, { width, align: "right" });
}

// ─── Cover header ────────────────────────────────────────────────────

function renderHeader(doc: Doc, report: PayrollReport): void {
  drawTopRule(doc);

  // Logo block — sits at top-left at 56x56pt. Falls back to a drawn
  // circular brand badge if the embedded JPEG can't be decoded for
  // some reason; the header is never logo-less.
  const logoSize = 56;
  const logoY = MARGIN;
  let logoRendered = false;
  const logoAb = getLogoArrayBuffer();
  if (logoAb) {
    try {
      doc.image(logoAb, MARGIN, logoY, { fit: [logoSize, logoSize] });
      logoRendered = true;
    } catch (e) {
      console.warn("[payroll-pdf] failed to render logo image:", e);
    }
  }
  if (!logoRendered) {
    // Fallback: navy circle + gold "MSE" wordmark. Tells the reader
    // this is a Maryland Smart Energy document even if the asset
    // didn't make it into the deployment.
    doc.save();
    doc
      .circle(MARGIN + logoSize / 2, logoY + logoSize / 2, logoSize / 2)
      .fill(NAVY);
    doc
      .fillColor(GOLD)
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("MSE", MARGIN, logoY + logoSize / 2 - 9, {
        width: logoSize,
        align: "center",
      });
    doc.restore();
  }
  const textLeft = MARGIN + logoSize + 14;

  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("Commission Report", textLeft, MARGIN + 2);
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(10)
    .text("Maryland Smart Energy", textLeft, MARGIN + 28);

  // Right column — period + status pill
  const rightX = PAGE_W - MARGIN;
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(prettyDateRange(report.startDate, report.endDate), MARGIN, MARGIN + 4, {
      width: CONTENT_W,
      align: "right",
    });
  if (report.period) {
    const labelW = 200;
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text(
        `Period · ${report.period.periodId}`,
        rightX - labelW,
        MARGIN + 22,
        { width: labelW, align: "right" }
      );
    // Status pill — measure first, then position to the right edge.
    // Keep this label calculation in sync with statusPill()'s
    // internal label override.
    const pillLabel =
      report.period.status === "Approved"
        ? "INVOICE APPROVED"
        : report.period.status.toUpperCase();
    doc.font("Helvetica-Bold").fontSize(8);
    const pillW = doc.widthOfString(pillLabel) + 16;
    statusPill(doc, report.period.status, rightX - pillW, MARGIN + 38);
  } else {
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text("Preview · not yet saved", MARGIN, MARGIN + 22, {
        width: CONTENT_W,
        align: "right",
      });
  }

  // Separator
  doc.y = MARGIN + 78;
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_W - MARGIN, doc.y)
    .lineWidth(0.5)
    .strokeColor(LIGHT)
    .stroke();
  doc.y += 18;
}

// ─── Summary band ────────────────────────────────────────────────────

function renderSummary(doc: Doc, report: PayrollReport): void {
  const cardW = (CONTENT_W - 16) / 3;
  const cardH = 64;
  const startY = doc.y;

  function card(
    i: number,
    label: string,
    value: string,
    accent: "navy" | "gold" | "muted" = "navy"
  ) {
    const x = MARGIN + i * (cardW + 8);
    doc.save();
    const bg = accent === "navy" ? NAVY : accent === "gold" ? GOLD_SOFT : "white";
    doc.roundedRect(x, startY, cardW, cardH, 8).fill(bg);
    if (accent === "muted") {
      doc.roundedRect(x, startY, cardW, cardH, 8).strokeColor(LIGHT).lineWidth(1).stroke();
    }
    // Labels: PDFKit doesn't parse rgba() — must use solid colors.
    // Navy cards get the brand gold caption so the label has high
    // contrast against the dark fill (same pattern as the web UI).
    const labelColor =
      accent === "navy" ? GOLD : accent === "gold" ? NAVY : MUTED;
    const valueColor = accent === "navy" ? "white" : NAVY;
    doc
      .fillColor(labelColor)
      .font("Helvetica-Bold")
      .fontSize(9.5)
      .text(label.toUpperCase(), x + 14, startY + 12, {
        width: cardW - 28,
        characterSpacing: 1.2,
      });
    doc
      .fillColor(valueColor)
      .font("Helvetica-Bold")
      .fontSize(20)
      .text(value, x + 14, startY + 30, { width: cardW - 28 });
    doc.restore();
  }

  card(0, "Total Pay", formatCurrency(report.grandTotal), "navy");
  card(1, "Techs", String(report.techs.length), "gold");
  card(
    2,
    "Line Items",
    `${report.attributionLineCount + report.adjustmentLineCount}`,
    "muted"
  );

  doc.y = startY + cardH + 22;
}

// ─── Per-tech section ────────────────────────────────────────────────

function renderTechSection(
  doc: Doc,
  tech: TechRollup,
  nameplates: Map<string, ArrayBuffer>,
  ytdPrior?: number
): void {
  ensureRoom(doc, 140);

  // Section header band
  const headerY = doc.y;
  doc
    .roundedRect(MARGIN, headerY, CONTENT_W, 36, 6)
    .fill(NAVY_SOFT);
  doc
    .fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(tech.techName, MARGIN + 14, headerY + 11, {
      width: CONTENT_W - 200,
    });
  doc
    .fillColor(GOLD_SOFT)
    .font("Helvetica-Bold")
    .fontSize(15)
    .text(
      formatCurrency(tech.grandTotal),
      MARGIN,
      headerY + 9,
      { width: CONTENT_W - 14, align: "right" }
    );
  doc.y = headerY + 48;

  // Subtotal chips
  const chips: Array<{ label: string; value: number; show: boolean }> = [
    { label: "Service", value: tech.subtotals.service, show: tech.subtotals.service !== 0 },
    { label: "Sales (paid)", value: tech.subtotals.salesPaid, show: tech.subtotals.salesPaid !== 0 },
    { label: "Sales (pending)", value: tech.subtotals.salesPending, show: tech.subtotals.salesPending !== 0 },
    { label: "Standalone", value: tech.subtotals.standalone, show: tech.subtotals.standalone !== 0 },
    { label: "Daily Stipend", value: tech.subtotals.dailyStipend, show: tech.subtotals.dailyStipend !== 0 },
    { label: "Travel Bonus", value: tech.subtotals.travelBonus, show: tech.subtotals.travelBonus !== 0 },
    { label: "Bonus", value: tech.subtotals.bonus, show: tech.subtotals.bonus !== 0 },
    { label: "Deductions", value: tech.subtotals.deduction, show: tech.subtotals.deduction !== 0 },
    { label: "Reimbursements", value: tech.subtotals.reimbursement, show: tech.subtotals.reimbursement !== 0 },
    { label: "Deferred / top-up", value: tech.subtotals.deferral, show: tech.subtotals.deferral !== 0 },
    { label: "2nd-half releases", value: tech.subtotals.released, show: tech.subtotals.released !== 0 },
    { label: "Adjustments", value: tech.subtotals.adjustments, show: tech.subtotals.adjustments !== 0 },
    {
      label: "YTD incl. this",
      value: (ytdPrior ?? 0) + tech.grandTotal,
      show: ytdPrior !== undefined,
    },
  ].filter((c) => c.show);

  if (chips.length > 0) {
    const chipsPerRow = 4;
    const gap = 8;
    const chipW = (CONTENT_W - gap * (chipsPerRow - 1)) / chipsPerRow;
    const chipH = 30;
    for (let i = 0; i < chips.length; i++) {
      const row = Math.floor(i / chipsPerRow);
      const col = i % chipsPerRow;
      const x = MARGIN + col * (chipW + gap);
      const y = doc.y + row * (chipH + 6);
      const c = chips[i];
      const negative = c.value < 0;
      doc.save();
      doc
        .roundedRect(x, y, chipW, chipH, 6)
        .lineWidth(0.5)
        .strokeColor(LIGHT)
        .stroke();
      doc
        .fillColor(MUTED)
        .font("Helvetica-Bold")
        .fontSize(8.5)
        .text(c.label.toUpperCase(), x + 8, y + 5, {
          width: chipW - 16,
          characterSpacing: 0.8,
        });
      doc
        .fillColor(negative ? RED : NAVY)
        .font("Helvetica-Bold")
        .fontSize(12)
        .text(formatCurrency(c.value), x + 8, y + 17, { width: chipW - 16 });
      doc.restore();
    }
    const rows = Math.ceil(chips.length / chipsPerRow);
    doc.y += rows * (chipH + 6) + 6;
  }

  // Line items table
  ensureRoom(doc, 64);
  renderLineItemsTable(doc, tech, nameplates);

  doc.y += 18;
}

function renderLineItemsTable(
  doc: Doc,
  tech: TechRollup,
  nameplates: Map<string, ArrayBuffer>
): void {
  // Column geometry. CONTENT_W = 516pt (letter, 48pt margins).
  // Widths sum to 516; amount column's right edge lands exactly on
  // MARGIN+CONTENT_W so right-aligned values stop at the page margin
  // instead of bleeding past it.
  //
  // date 58 + gap 4 + job 170 + gap 4 + type 70 + gap 4 + desc 134 + gap 4 + amount 68 = 516
  const cols = {
    date: { x: MARGIN, w: 58 },
    job: { x: MARGIN + 62, w: 170 },
    type: { x: MARGIN + 236, w: 70 },
    desc: { x: MARGIN + 310, w: 134 },
    amount: { x: MARGIN + 448, w: 68 },
  };
  const rightEdge = MARGIN + CONTENT_W;

  // Header row
  const headerY = doc.y;
  doc
    .rect(MARGIN, headerY, CONTENT_W, 18)
    .fill("#F4F5F7");
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8);
  doc.text("DATE", cols.date.x + 6, headerY + 5, { width: cols.date.w });
  doc.text("JOB / CUSTOMER", cols.job.x, headerY + 5, { width: cols.job.w });
  doc.text("TYPE", cols.type.x, headerY + 5, { width: cols.type.w });
  doc.text("NOTE", cols.desc.x, headerY + 5, { width: cols.desc.w });
  doc.text("AMOUNT", cols.amount.x, headerY + 5, {
    width: cols.amount.w - 6,
    align: "right",
  });
  doc.y = headerY + 22;

  // Rows
  for (const item of tech.lineItems) {
    const isAdj = item.source === "adjustment";
    const negative = item.amount < 0;
    // A unit line (with optional nameplate thumbnail) renders beneath
    // the customer name when the line item is tied to a specific unit.
    // Grow the row so the thumbnail/label has its own band.
    const hasUnit = Boolean(item.unitLabel || item.unitId);
    const rowH = hasUnit ? 34 : 22;

    // Reserve room for the row plus a bit of padding.
    ensureRoom(doc, rowH + 4);
    const rowY = doc.y;

    // Subtle alternating-row band so adjustments visually distinct
    if (isAdj) {
      doc
        .rect(MARGIN, rowY - 1, CONTENT_W, rowH)
        .fillOpacity(0.06)
        .fill(GOLD);
      doc.fillOpacity(1);
    }

    doc.font("Helvetica").fontSize(9);
    doc.fillColor(MUTED).text(item.date || "—", cols.date.x + 6, rowY + 4, {
      width: cols.date.w,
    });

    const jobText = item.customerName
      ? item.customerName
      : item.jobId || (isAdj ? "—" : "");
    doc.fillColor(NAVY).text(jobText, cols.job.x, rowY + 4, {
      width: cols.job.w,
      ellipsis: true,
    });

    // Unit line — thumbnail (if Drive returned a renderable JPEG/PNG)
    // and the unit label or ID. The thumbnail is intentionally tiny
    // (12pt square) so a packed table stays readable on letter paper.
    if (hasUnit) {
      const unitY = rowY + 18;
      let textX = cols.job.x;
      const thumb = item.nameplateFileId
        ? nameplates.get(item.nameplateFileId)
        : undefined;
      if (thumb) {
        try {
          doc.image(thumb, cols.job.x, unitY - 2, { fit: [12, 12] });
          textX = cols.job.x + 16;
        } catch (e) {
          // If PDFKit can't decode this particular nameplate (rare
          // CMYK JPEG, malformed PNG), fall back to label-only so the
          // row still renders cleanly.
          console.warn("[payroll-pdf] nameplate render failed:", e);
        }
      }
      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(7.5)
        .text(item.unitLabel || item.unitId || "", textX, unitY, {
          width: cols.job.w - (textX - cols.job.x),
          ellipsis: true,
        });
    }

    doc
      .fillColor(isAdj ? GOLD : MUTED)
      .font(isAdj ? "Helvetica-Bold" : "Helvetica")
      .fontSize(8)
      .text(item.lineType, cols.type.x, rowY + 5, {
        width: cols.type.w,
        ellipsis: true,
      });

    const noteText = item.description || item.note || "";
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(8)
      .text(noteText, cols.desc.x, rowY + 5, {
        width: cols.desc.w,
        ellipsis: true,
      });

    doc.font("Helvetica-Bold").fontSize(10);
    doc.fillColor(negative ? RED : NAVY);
    moneyAlignRight(
      doc,
      formatCurrency(item.amount),
      rightEdge,
      rowY + 4,
      cols.amount.w - 6
    );
    doc.y = rowY + rowH;
  }

  // Total row
  ensureRoom(doc, 28);
  const totalY = doc.y + 4;
  doc
    .moveTo(MARGIN, totalY - 4)
    .lineTo(rightEdge, totalY - 4)
    .lineWidth(1)
    .strokeColor(NAVY)
    .stroke();
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("TOTAL", MARGIN, totalY + 4, { width: CONTENT_W - 80 });
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(13)
    .text(formatCurrency(tech.grandTotal), MARGIN, totalY, {
      width: CONTENT_W,
      align: "right",
    });
  doc.y = totalY + 22;
}

// ─── Footer cover sheet (last page) ──────────────────────────────────

function renderFooterMeta(doc: Doc, report: PayrollReport): void {
  ensureRoom(doc, 80);
  doc.y += 8;
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_W - MARGIN, doc.y)
    .lineWidth(0.5)
    .strokeColor(LIGHT)
    .stroke();
  doc.y += 14;

  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(8.5)
    .text(`Generated: ${prettyTimestamp(report.generatedAt)}`, MARGIN, doc.y);

  if (report.period) {
    const p = report.period;
    doc.y += 12;
    if (p.createdBy) {
      doc.text(
        `Created by ${p.createdBy} on ${prettyTimestamp(p.createdAt)}`,
        MARGIN,
        doc.y
      );
      doc.y += 12;
    }
    if (p.approvedBy) {
      doc.text(
        `Approved by ${p.approvedBy} on ${prettyTimestamp(p.approvedAt)}`,
        MARGIN,
        doc.y
      );
      doc.y += 12;
    }
    if (p.paidBy) {
      doc.text(
        `Marked Paid by ${p.paidBy} on ${prettyTimestamp(p.paidAt)}`,
        MARGIN,
        doc.y
      );
      doc.y += 12;
    }
    if (p.note) {
      doc.y += 4;
      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(9)
        .text("Note:", MARGIN, doc.y);
      doc.y += 12;
      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(9)
        .text(p.note, MARGIN, doc.y, { width: CONTENT_W });
    }
  }
}

// ─── Public API ──────────────────────────────────────────────────────

interface BuildOpts {
  report: PayrollReport;
  /** When set, filters output to just this tech. Used by the
   *  tech-self-view download. */
  techNameFilter?: string;
  /** Per-tech year-to-date totals across prior Paid/Closed periods.
   *  When provided, each tech section gets a "YTD incl. this" chip
   *  (prior YTD + this period's grand total) — the pay-stub line. */
  ytdByTech?: Map<string, number>;
}

export async function buildPayrollPdf(opts: BuildOpts): Promise<Buffer> {
  const { report, techNameFilter } = opts;
  const techs = techNameFilter
    ? report.techs.filter((t) => t.techName === techNameFilter)
    : report.techs;

  // Fetch nameplate thumbnails up front — PDFKit's render loop below
  // runs synchronously inside the Promise constructor, so we cannot
  // await Drive calls mid-render. One Drive round-trip per unique
  // fileId; results land in a per-render Map.
  const nameplates = await buildNameplateMap(report, techNameFilter);

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc: Doc = new PDFDocument({
        size: "LETTER",
        margin: MARGIN,
        bufferPages: true,
        info: {
          Title: `Commission Report · ${prettyDateRange(report.startDate, report.endDate)}`,
          Author: "Maryland Smart Energy",
          Subject: "Commission Report",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      renderHeader(doc, report);
      renderSummary(doc, report);

      if (techs.length === 0) {
        ensureRoom(doc, 60);
        doc
          .fillColor(MUTED)
          .font("Helvetica")
          .fontSize(11)
          .text("No pay activity in this period.", MARGIN, doc.y, {
            width: CONTENT_W,
            align: "center",
          });
      } else {
        for (const tech of techs) {
          renderTechSection(
            doc,
            tech,
            nameplates,
            opts.ytdByTech ? opts.ytdByTech.get(tech.techName) ?? 0 : undefined
          );
        }
      }

      renderFooterMeta(doc, report);

      // Footers on every page
      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        addPageFooter(doc);
      }

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
