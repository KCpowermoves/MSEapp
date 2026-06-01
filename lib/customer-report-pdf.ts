import "server-only";
// Same browserify-bundled PDFKit build as the payroll report — see
// payroll-pdf.ts for the ArrayBuffer rationale on doc.image().
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const PDFDocument: any = require("pdfkit/js/pdfkit.standalone");

import { getDriveClient } from "@/lib/google/auth";
import { getPayrollLogoBuffer } from "@/lib/payroll-logo";
import type {
  CustomerReport,
  CustomerReportJob,
  CustomerReportUnit,
} from "@/lib/customer-report";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;

// Brand tokens — kept identical to payroll-pdf.ts so a customer
// rollup feels like part of the same MSE document family.
const NAVY = "#1A2332";
const NAVY_SOFT = "#2A3A52";
const GOLD = "#C5A572";
const GOLD_SOFT = "#E8DCC4";
const MUTED = "#6B7280";
const LIGHT = "#E5E7EB";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

// ─── Image fetching helpers ──────────────────────────────────────────

async function fetchDriveImage(
  fileId: string
): Promise<ArrayBuffer | null> {
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
    console.warn("[customer-report-pdf] image fetch failed:", fileId, e);
    return null;
  }
}

// Per-render image cache. Cap how many distinct images we embed so a
// 200-photo customer doesn't blow the PDFKit memory ceiling — the
// most relevant ones (cover + nameplates + a few per-job thumbs) are
// what an admin actually needs in a rollup.
const PHOTOS_PER_JOB_CAP = 12;

async function buildImageMap(
  report: CustomerReport
): Promise<Map<string, ArrayBuffer>> {
  const ids = new Set<string>();
  for (const rj of report.jobs) {
    if (rj.job.coverPhotoFileId) ids.add(rj.job.coverPhotoFileId);
    for (const u of rj.units) {
      if (u.nameplateFileId) ids.add(u.nameplateFileId);
    }
    // First N photos per job for the inline grid.
    const grid = rj.units
      .flatMap((u) => u.photos)
      .slice(0, PHOTOS_PER_JOB_CAP);
    for (const p of grid) ids.add(p.fileId);
  }
  const out = new Map<string, ArrayBuffer>();
  await Promise.all(
    Array.from(ids).map(async (id) => {
      const buf = await fetchDriveImage(id);
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
    console.warn("[customer-report-pdf] logo decode failed:", e);
    return null;
  }
}

// ─── Small format helpers ────────────────────────────────────────────

function prettyDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function prettyDateRange(start: string, end: string): string {
  return `${prettyDate(start)} – ${prettyDate(end)}`;
}

function ensureRoom(doc: Doc, needed: number): void {
  if (doc.y + needed > PAGE_H - MARGIN - 28) {
    addPageFooter(doc);
    doc.addPage();
    drawTopRule(doc);
  }
}

function drawTopRule(doc: Doc): void {
  doc.save();
  doc.rect(0, 0, PAGE_W, 6).fill(NAVY);
  doc.rect(0, 6, PAGE_W, 2).fill(GOLD);
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
      "Maryland Smart Energy · Customer Report · CONFIDENTIAL",
      MARGIN,
      y,
      { width: CONTENT_W, align: "left", continued: true }
    )
    .text(`Page ${doc.bufferedPageRange().count}`, { align: "right" });
  doc.restore();
}

// ─── Sections ────────────────────────────────────────────────────────

function renderHeader(
  doc: Doc,
  report: CustomerReport,
  images: Map<string, ArrayBuffer>
): void {
  drawTopRule(doc);

  const logoSize = 56;
  const logoY = MARGIN;
  const logoAb = getLogoArrayBuffer();
  if (logoAb) {
    try {
      doc.image(logoAb, MARGIN, logoY, { fit: [logoSize, logoSize] });
    } catch (e) {
      console.warn("[customer-report-pdf] logo render failed:", e);
    }
  }
  const textLeft = MARGIN + logoSize + 14;

  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(22)
    .text("Customer Report", textLeft, MARGIN + 2);
  doc
    .fillColor(MUTED)
    .font("Helvetica")
    .fontSize(10)
    .text("Maryland Smart Energy", textLeft, MARGIN + 28);

  // Right-aligned customer name + activity span.
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(report.customerName, MARGIN, MARGIN + 4, {
      width: CONTENT_W,
      align: "right",
    });
  if (report.firstActivityIso) {
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text(
        `Activity ${prettyDateRange(
          report.firstActivityIso,
          report.lastActivityIso
        )}`,
        MARGIN,
        MARGIN + 24,
        { width: CONTENT_W, align: "right" }
      );
  }
  if (report.utilityTerritories.length > 0) {
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text(
        `Utility · ${report.utilityTerritories.join(", ")}`,
        MARGIN,
        MARGIN + 38,
        { width: CONTENT_W, align: "right" }
      );
  }

  doc.y = MARGIN + 78;
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(PAGE_W - MARGIN, doc.y)
    .lineWidth(0.5)
    .strokeColor(LIGHT)
    .stroke();
  doc.y += 18;

  // Suppress unused-image warning when the cover is referenced only
  // later — `images` is intentionally part of the signature so the
  // header can be extended to embed a hero shot if we want one later.
  void images;
}

function renderSummary(doc: Doc, report: CustomerReport): void {
  const cardW = (CONTENT_W - 24) / 4;
  const cardH = 60;
  const startY = doc.y;

  function card(i: number, label: string, value: string, accent: "navy" | "gold" | "muted") {
    const x = MARGIN + i * (cardW + 8);
    doc.save();
    const bg = accent === "navy" ? NAVY : accent === "gold" ? GOLD_SOFT : "white";
    doc.roundedRect(x, startY, cardW, cardH, 8).fill(bg);
    if (accent === "muted") {
      doc.roundedRect(x, startY, cardW, cardH, 8).strokeColor(LIGHT).lineWidth(1).stroke();
    }
    const labelColor =
      accent === "navy" ? GOLD : accent === "gold" ? NAVY : MUTED;
    const valueColor = accent === "navy" ? "white" : NAVY;
    doc
      .fillColor(labelColor)
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(label.toUpperCase(), x + 12, startY + 10, {
        width: cardW - 24,
        characterSpacing: 1,
      });
    doc
      .fillColor(valueColor)
      .font("Helvetica-Bold")
      .fontSize(18)
      .text(value, x + 12, startY + 28, { width: cardW - 24 });
    doc.restore();
  }

  card(0, "Jobs", String(report.totals.jobCount), "navy");
  card(1, "Units", String(report.totals.unitCount), "gold");
  card(2, "Dispatches", String(report.totals.dispatchCount), "muted");
  card(3, "Photos", String(report.totals.photoCount), "muted");

  doc.y = startY + cardH + 22;

  if (report.techNames.length > 0) {
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text(`Techs on site: ${report.techNames.join(", ")}`, MARGIN, doc.y, {
        width: CONTENT_W,
      });
    doc.y += 18;
  }
}

function renderJobSection(
  doc: Doc,
  rj: CustomerReportJob,
  images: Map<string, ArrayBuffer>
): void {
  ensureRoom(doc, 120);

  const headerY = doc.y;
  doc.roundedRect(MARGIN, headerY, CONTENT_W, 38, 6).fill(NAVY_SOFT);

  // Optional cover thumbnail on the section header — gives the admin
  // a visual anchor when paging through.
  let textLeft = MARGIN + 14;
  if (rj.job.coverPhotoFileId) {
    const cover = images.get(rj.job.coverPhotoFileId);
    if (cover) {
      try {
        doc.image(cover, MARGIN + 6, headerY + 5, { fit: [28, 28] });
        textLeft = MARGIN + 6 + 28 + 8;
      } catch (e) {
        console.warn("[customer-report-pdf] cover render failed:", e);
      }
    }
  }

  doc
    .fillColor("white")
    .font("Helvetica-Bold")
    .fontSize(12)
    .text(rj.job.siteAddress || "(no address)", textLeft, headerY + 7, {
      width: CONTENT_W - (textLeft - MARGIN) - 130,
      ellipsis: true,
    });
  doc
    .fillColor(GOLD_SOFT)
    .font("Helvetica")
    .fontSize(8.5)
    .text(
      `${rj.job.jobId} · ${prettyDate(rj.job.createdDate)} · ${rj.job.utilityTerritory}`,
      textLeft,
      headerY + 22,
      { width: CONTENT_W - (textLeft - MARGIN) - 130 }
    );
  doc
    .fillColor(GOLD_SOFT)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(
      `${rj.units.length} unit${rj.units.length === 1 ? "" : "s"} · ${rj.totalPhotos} photo${rj.totalPhotos === 1 ? "" : "s"}`,
      MARGIN,
      headerY + 13,
      { width: CONTENT_W - 14, align: "right" }
    );
  doc.y = headerY + 48;

  if (rj.techNames.length > 0) {
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text(`Crew: ${rj.techNames.join(", ")}`, MARGIN, doc.y, {
        width: CONTENT_W,
      });
    doc.y += 14;
  }

  // Units table — one row per unit with make/model/serial/photo count.
  if (rj.units.length > 0) {
    renderUnitsTable(doc, rj.units);
  } else {
    doc
      .fillColor(MUTED)
      .font("Helvetica-Oblique")
      .fontSize(9)
      .text("No units logged on this job yet.", MARGIN, doc.y, {
        width: CONTENT_W,
      });
    doc.y += 14;
  }

  // Photo grid — a horizontal strip of up to PHOTOS_PER_JOB_CAP
  // thumbnails. Pages flow when room runs out.
  const allPhotos = rj.units
    .flatMap((u) => u.photos)
    .slice(0, PHOTOS_PER_JOB_CAP);
  if (allPhotos.length > 0) {
    const renderable = allPhotos
      .map((p) => ({ p, img: images.get(p.fileId) }))
      .filter((row): row is { p: typeof allPhotos[number]; img: ArrayBuffer } =>
        Boolean(row.img)
      );
    if (renderable.length > 0) {
      const perRow = 6;
      const gap = 6;
      const thumbW = (CONTENT_W - gap * (perRow - 1)) / perRow;
      const thumbH = thumbW * 0.72;
      ensureRoom(doc, thumbH + 8);
      const stripY = doc.y;
      for (let i = 0; i < renderable.length; i++) {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        const x = MARGIN + col * (thumbW + gap);
        const y = stripY + row * (thumbH + 12);
        try {
          doc.image(renderable[i].img, x, y, {
            fit: [thumbW, thumbH],
            align: "center",
            valign: "center",
          });
          doc
            .roundedRect(x, y, thumbW, thumbH, 3)
            .lineWidth(0.5)
            .strokeColor(LIGHT)
            .stroke();
          doc
            .fillColor(MUTED)
            .font("Helvetica")
            .fontSize(7)
            .text(renderable[i].p.slotLabel, x, y + thumbH + 1, {
              width: thumbW,
              align: "center",
            });
        } catch (e) {
          console.warn(
            "[customer-report-pdf] thumb render failed:",
            renderable[i].p.fileId,
            e
          );
        }
      }
      const rows = Math.ceil(renderable.length / perRow);
      doc.y = stripY + rows * (thumbH + 12);
    }
    if (rj.totalPhotos > allPhotos.length) {
      doc
        .fillColor(MUTED)
        .font("Helvetica-Oblique")
        .fontSize(8)
        .text(
          `+ ${rj.totalPhotos - allPhotos.length} additional photo${
            rj.totalPhotos - allPhotos.length === 1 ? "" : "s"
          } in the Drive folder.`,
          MARGIN,
          doc.y,
          { width: CONTENT_W, align: "right" }
        );
      doc.y += 14;
    }
  }

  doc.y += 12;
}

function renderUnitsTable(doc: Doc, units: CustomerReportUnit[]): void {
  // Columns: # | Type | Make/Model | Serial | Photos
  const cols = {
    n: { x: MARGIN, w: 22 },
    type: { x: MARGIN + 26, w: 76 },
    makeModel: { x: MARGIN + 106, w: 200 },
    serial: { x: MARGIN + 310, w: 130 },
    photos: { x: MARGIN + 444, w: 72 },
  };

  ensureRoom(doc, 22);
  const headerY = doc.y;
  doc.rect(MARGIN, headerY, CONTENT_W, 16).fill("#F4F5F7");
  doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(8);
  doc.text("#", cols.n.x + 4, headerY + 4, { width: cols.n.w });
  doc.text("TYPE", cols.type.x, headerY + 4, { width: cols.type.w });
  doc.text("MAKE / MODEL", cols.makeModel.x, headerY + 4, {
    width: cols.makeModel.w,
  });
  doc.text("SERIAL", cols.serial.x, headerY + 4, { width: cols.serial.w });
  doc.text("PHOTOS", cols.photos.x, headerY + 4, {
    width: cols.photos.w - 4,
    align: "right",
  });
  doc.y = headerY + 20;

  for (const u of units) {
    ensureRoom(doc, 20);
    const rowY = doc.y;
    doc.fillColor(NAVY).font("Helvetica").fontSize(9);
    doc.text(String(u.unitNumberOnJob || ""), cols.n.x + 4, rowY + 3, {
      width: cols.n.w,
    });
    doc
      .fillColor(MUTED)
      .text(u.unitType, cols.type.x, rowY + 3, { width: cols.type.w, ellipsis: true });
    const makeModel = [u.make, u.model].filter(Boolean).join(" ") || "—";
    doc.fillColor(NAVY).text(makeModel, cols.makeModel.x, rowY + 3, {
      width: cols.makeModel.w,
      ellipsis: true,
    });
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .text(u.serial || "—", cols.serial.x, rowY + 3, {
        width: cols.serial.w,
        ellipsis: true,
      });
    doc.fillColor(NAVY).font("Helvetica-Bold").text(
      String(u.photos.length),
      cols.photos.x,
      rowY + 3,
      { width: cols.photos.w - 4, align: "right" }
    );
    doc.y = rowY + 18;
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export async function buildCustomerReportPdf(
  report: CustomerReport
): Promise<Buffer> {
  // Drive image fetches up front — see payroll-pdf for the rationale.
  const images = await buildImageMap(report);

  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc: Doc = new PDFDocument({
        size: "LETTER",
        margin: MARGIN,
        bufferPages: true,
        info: {
          Title: `Customer Report · ${report.customerName}`,
          Author: "Maryland Smart Energy",
          Subject: "Customer Report",
        },
      });

      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      renderHeader(doc, report, images);
      renderSummary(doc, report);

      if (report.jobs.length === 0) {
        ensureRoom(doc, 60);
        doc
          .fillColor(MUTED)
          .font("Helvetica")
          .fontSize(11)
          .text("No jobs found for this customer.", MARGIN, doc.y, {
            width: CONTENT_W,
            align: "center",
          });
      } else {
        for (const rj of report.jobs) {
          renderJobSection(doc, rj, images);
        }
      }

      // Generated stamp at the very end.
      doc.y += 4;
      doc
        .moveTo(MARGIN, doc.y)
        .lineTo(PAGE_W - MARGIN, doc.y)
        .lineWidth(0.5)
        .strokeColor(LIGHT)
        .stroke();
      doc.y += 10;
      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(8.5)
        .text(
          `Generated ${new Date(report.generatedAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}`,
          MARGIN,
          doc.y,
          { width: CONTENT_W }
        );

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
