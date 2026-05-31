import "server-only";
// Standalone PDFKit build bundles the Standard 14 fonts so this works
// on Vercel serverless without external font files.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const PDFDocument: any = require("pdfkit/js/pdfkit.standalone");

import { formatCurrency } from "@/lib/utils";
import { getPayrollLogoBuffer } from "@/lib/payroll-logo";
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
// The MSE logo lives as an inlined base64 string in lib/payroll-logo.ts
// (auto-generated from public/logo.png, downscaled to 256×256). This
// dodges every Vercel-serverless gotcha around dynamic fs reads —
// outputFileTracingIncludes, working-directory drift, asset
// tracing — by making the logo part of the JS bundle itself.
//
// To refresh the embedded logo after a brand asset change:
//   node scripts/generate-payroll-logo.mjs

let cachedLogo: Buffer | null = null;
function getLogoBuffer(): Buffer | null {
  if (cachedLogo) return cachedLogo;
  try {
    cachedLogo = getPayrollLogoBuffer();
    return cachedLogo;
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
      "Maryland Smart Energy · Payroll Report · CONFIDENTIAL",
      MARGIN,
      y,
      { width: CONTENT_W, align: "left", continued: true }
    )
    .text(`Page ${doc.bufferedPageRange().count}`, { align: "right" });
  doc.restore();
}

function statusPill(doc: Doc, status: string, x: number, y: number): void {
  const label = status.toUpperCase();
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

  // Logo block — sits at top-left at 56x56pt. If the PNG file can't
  // be read on this runtime (cold serverless, missing tracing, etc.)
  // we fall back to a circular brand badge drawn via shapes so the
  // header always has identifiable branding.
  const logoSize = 56;
  const logoY = MARGIN;
  let logoRendered = false;
  const logo = getLogoBuffer();
  if (logo) {
    try {
      doc.image(logo, MARGIN, logoY, { fit: [logoSize, logoSize] });
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
    .text("Payroll Report", textLeft, MARGIN + 2);
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
    const pillLabel = report.period.status.toUpperCase();
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

  card(0, "Total Payroll", formatCurrency(report.grandTotal), "navy");
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

function renderTechSection(doc: Doc, tech: TechRollup): void {
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
    { label: "Install", value: tech.subtotals.install, show: tech.subtotals.install !== 0 },
    { label: "Sales (paid)", value: tech.subtotals.salesPaid, show: tech.subtotals.salesPaid !== 0 },
    { label: "Sales (pending)", value: tech.subtotals.salesPending, show: tech.subtotals.salesPending !== 0 },
    { label: "Service", value: tech.subtotals.service, show: tech.subtotals.service !== 0 },
    { label: "Standalone", value: tech.subtotals.standalone, show: tech.subtotals.standalone !== 0 },
    { label: "Daily Stipend", value: tech.subtotals.dailyStipend, show: tech.subtotals.dailyStipend !== 0 },
    { label: "Travel Bonus", value: tech.subtotals.travelBonus, show: tech.subtotals.travelBonus !== 0 },
    { label: "Adjustments", value: tech.subtotals.adjustments, show: tech.subtotals.adjustments !== 0 },
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
  renderLineItemsTable(doc, tech);

  doc.y += 18;
}

function renderLineItemsTable(doc: Doc, tech: TechRollup): void {
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

    // Reserve up to ~36pt for a tall row (description wraps).
    ensureRoom(doc, 38);
    const rowY = doc.y;

    // Subtle alternating-row band so adjustments visually distinct
    if (isAdj) {
      doc
        .rect(MARGIN, rowY - 1, CONTENT_W, 22)
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
    doc.y = rowY + 22;
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
}

export async function buildPayrollPdf(opts: BuildOpts): Promise<Buffer> {
  const { report, techNameFilter } = opts;
  const techs = techNameFilter
    ? report.techs.filter((t) => t.techName === techNameFilter)
    : report.techs;

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc: Doc = new PDFDocument({
        size: "LETTER",
        margin: MARGIN,
        bufferPages: true,
        info: {
          Title: `Payroll · ${prettyDateRange(report.startDate, report.endDate)}`,
          Author: "Maryland Smart Energy",
          Subject: "Payroll Report",
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
          renderTechSection(doc, tech);
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
