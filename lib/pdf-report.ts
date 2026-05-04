import "server-only";
// Standalone build inlines the Standard 14 fonts so the document
// renders in Vercel's serverless runtime without external font files.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const PDFDocument: any = require("pdfkit/js/pdfkit.standalone");
import { getDriveClient } from "@/lib/google/auth";
import type { Dispatch, Job, UnitServiced } from "@/lib/types";

const NAVY = "#1A2332";
const GOLD = "#C5A572";
const MUTED = "#6B7280";

interface BuildPdfInput {
  job: Job;
  dispatch: Dispatch;
  units: UnitServiced[];
}

/**
 * Render a one-page-ish PDF service report and return the bytes.
 * Reads photo bytes from Drive via the service account so they can be
 * embedded directly into the document. Photos are scaled down to fit;
 * if a photo can't be fetched (deleted, permissions glitch), we skip
 * it silently and continue.
 */
export async function buildJobPdf(input: BuildPdfInput): Promise<Buffer> {
  const { job, dispatch, units } = input;

  // ── 1. Pre-fetch every embedded image as a buffer. PDFKit needs a
  //    Buffer (or path) to embed; it cannot stream Drive's response.
  type EmbedItem = { label: string; buffer: Buffer | null };
  const photoFetches: { label: string; url: string }[] = [];
  for (const u of units) {
    const unitTag = `Unit ${String(u.unitNumberOnJob).padStart(3, "0")} — ${u.unitType}`;
    // Walk every populated photo field on the unit. Different unit
    // types repurpose the same columns (e.g. Simple types use pre2Url
    // for the AFTER photo since they only have one before/after pair),
    // so listing them all by raw column rather than by slot picks up
    // every captured shot regardless of unitType.
    const slots: Array<[string, string]> = [
      [u.nameplateUrl, "Nameplate"],
      [u.pre1Url, "Before 1"],
      [u.pre2Url, "Before 2"],
      [u.pre3Url, "Before 3"],
      [u.post1Url, "After 1"],
      [u.post2Url, "After 2"],
      [u.post3Url, "After 3"],
      [u.filterUrl, "Filter"],
      [u.inPreUrl, "Air handler · before"],
      [u.inPostUrl, "Air handler · after"],
      [u.inNameplateUrl, "Air handler nameplate"],
    ];
    for (const [url, slotLabel] of slots) {
      if (url) photoFetches.push({ label: `${unitTag} · ${slotLabel}`, url });
    }
  }
  if (dispatch.signatureUrl) {
    photoFetches.push({
      label: `Customer signature${
        dispatch.signedByName ? ` — ${dispatch.signedByName}` : ""
      }`,
      url: dispatch.signatureUrl,
    });
  }

  console.log(
    `[pdf] dispatch=${dispatch.dispatchId} fetching ${photoFetches.length} photo(s)`
  );
  const embedded: EmbedItem[] = await Promise.all(
    photoFetches.map(async ({ label, url }) => ({
      label,
      buffer: await fetchDriveImage(url, label),
    }))
  );
  const fetchedCount = embedded.filter((e) => e.buffer).length;
  console.log(
    `[pdf] dispatch=${dispatch.dispatchId} fetched ${fetchedCount}/${photoFetches.length} photo bytes`
  );

  // ── 2. Build the document
  return await new Promise<Buffer>((resolve) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    // Header
    doc
      .fillColor(NAVY)
      .fontSize(22)
      .font("Helvetica-Bold")
      .text("Maryland Smart Energy", { continued: false });
    doc
      .fillColor(MUTED)
      .fontSize(10)
      .font("Helvetica")
      .text("HVAC service report", { paragraphGap: 16 });

    // Customer block
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
        `Utility territory: ${job.utilityTerritory}`,
      ].join("    ·    "),
      { paragraphGap: 16 }
    );

    // Units table
    doc
      .moveTo(48, doc.y)
      .lineTo(564, doc.y)
      .strokeColor(GOLD)
      .lineWidth(1.5)
      .stroke();
    doc.moveDown(0.5);
    doc
      .fillColor(NAVY)
      .fontSize(13)
      .font("Helvetica-Bold")
      .text(`Units serviced (${units.length})`, { paragraphGap: 8 });

    if (units.length === 0) {
      doc
        .fillColor(MUTED)
        .fontSize(11)
        .font("Helvetica")
        .text("No units recorded on this dispatch.");
    } else {
      for (const u of units) {
        const num = String(u.unitNumberOnJob).padStart(3, "0");
        const labelLine = u.label?.trim()
          ? `Unit ${num} · ${u.label} · ${u.unitType}`
          : `Unit ${num} · ${u.unitType}`;
        doc
          .fillColor(NAVY)
          .fontSize(11)
          .font("Helvetica-Bold")
          .text(labelLine, { paragraphGap: 2 });
        const detail = [
          u.make && `Make: ${u.make}`,
          u.model && `Model: ${u.model}`,
          u.serial && `Serial: ${u.serial}`,
        ]
          .filter(Boolean)
          .join("   ·   ");
        if (detail) {
          doc
            .fillColor(MUTED)
            .fontSize(10)
            .font("Helvetica")
            .text(detail, { paragraphGap: 2 });
        }
        if (u.notes) {
          doc
            .fillColor(MUTED)
            .fontSize(10)
            .font("Helvetica-Oblique")
            .text(u.notes, { paragraphGap: 6 });
        } else {
          doc.moveDown(0.3);
        }
      }
    }

    // Photo strip — embed up to ~12 thumbnails so the PDF stays
    // readable in a single email attachment (typically <2 MB).
    const photos = embedded.filter((p) => p.buffer).slice(0, 12);
    if (photos.length > 0) {
      doc.addPage();
      doc
        .fillColor(NAVY)
        .fontSize(13)
        .font("Helvetica-Bold")
        .text("Photo log", { paragraphGap: 12 });

      const cellW = 240;
      const cellH = 180;
      const cols = 2;
      let i = 0;
      let y = doc.y;
      for (const p of photos) {
        const col = i % cols;
        if (col === 0 && i > 0) y += cellH + 22;
        const x = 48 + col * (cellW + 16);
        if (y + cellH > 720) {
          doc.addPage();
          y = 48;
        }
        try {
          doc.image(p.buffer!, x, y, {
            fit: [cellW, cellH],
            align: "center",
            valign: "center",
          });
        } catch {
          // skip broken
        }
        doc
          .fillColor(MUTED)
          .fontSize(9)
          .font("Helvetica")
          .text(p.label, x, y + cellH + 4, { width: cellW });
        i++;
      }
    }

    doc.end();
  });
}

async function fetchDriveImage(
  url: string,
  label?: string
): Promise<Buffer | null> {
  const m =
    url.match(/\/d\/([A-Za-z0-9_-]+)/) ??
    url.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (!m) {
    console.warn(`[pdf] no fileId in url for ${label ?? "?"}: ${url}`);
    return null;
  }
  const fileId = m[1];
  try {
    const drive = getDriveClient();
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
    const buf = Buffer.from(res.data as ArrayBuffer);
    if (buf.length === 0) {
      console.warn(`[pdf] empty buffer for ${label ?? fileId}`);
      return null;
    }
    return buf;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[pdf] drive fetch failed for ${label ?? fileId}: ${msg}`);
    return null;
  }
}
