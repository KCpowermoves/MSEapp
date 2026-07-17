import "server-only";
// Standalone PDFKit build bundles the Standard 14 fonts so this works
// on Vercel serverless without external font files.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const PDFDocument: any = require("pdfkit/js/pdfkit.standalone");

import { getPayrollLogoBuffer } from "@/lib/payroll-logo";
import { UTILITY_PROGRAM_LABELS } from "@/lib/programs";
import { agreementParagraphs } from "@/lib/agreement-text";
import type { Lead } from "@/lib/types";

// Native e-sign: renders the signed HVAC tune-up agreement PDF —
// program, customer details, authorization text, the customer's drawn
// signature, and an audit footer (timestamp, IP, signing token).
//
// NOTE: the authorization paragraph below is interim language. When
// Kevin supplies the official per-utility agreement text (from the
// existing SignNow PDFs), replace AGREEMENT_BODY / per-program terms
// in lib/agreement-terms.ts-style granularity.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = any;

const NAVY = "#1A2332";
const GOLD = "#C5A572";
const MUTED = "#6B7280";
const LIGHT = "#E5E7EB";

const PAGE_W = 612;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;

const agreementBody = agreementParagraphs;

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export async function buildAgreementPdf(opts: {
  lead: Lead;
  /** PNG bytes of the drawn signature. */
  signaturePng: Buffer;
  signedName: string;
  signedAtIso: string;
  signerIp: string;
}): Promise<Buffer> {
  const { lead } = opts;
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc: Doc = new PDFDocument({
        size: "LETTER",
        margin: MARGIN,
        info: {
          Title: `HVAC Tune-Up Agreement · ${lead.businessName || lead.contactName}`,
          Author: "Maryland Smart Energy",
          Subject: "HVAC Tune-Up Incentive Program Agreement",
        },
      });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      // ── Header ────────────────────────────────────────────────────
      try {
        const logo = getPayrollLogoBuffer();
        const ab = logo.buffer.slice(
          logo.byteOffset,
          logo.byteOffset + logo.byteLength
        );
        doc.image(ab, MARGIN, MARGIN - 6, { width: 52 });
      } catch {
        // logo optional
      }
      doc
        .fillColor(NAVY)
        .font("Helvetica-Bold")
        .fontSize(18)
        .text("HVAC Tune-Up Program Agreement", MARGIN + 64, MARGIN, {
          width: CONTENT_W - 64,
        });
      doc
        .font("Helvetica")
        .fontSize(10)
        .fillColor(MUTED)
        .text("Maryland Smart Energy", MARGIN + 64, doc.y + 2);

      doc.moveDown(1.4);
      doc
        .moveTo(MARGIN, doc.y)
        .lineTo(PAGE_W - MARGIN, doc.y)
        .lineWidth(2)
        .strokeColor(GOLD)
        .stroke();
      doc.moveDown(0.8);

      // ── Customer block ────────────────────────────────────────────
      const rows: Array<[string, string]> = [
        ["Business", lead.businessName || "—"],
        ["Contact", lead.contactName || "—"],
        ["Phone", lead.phone || "—"],
        ["Email", lead.email || "—"],
        [
          "Service address",
          [lead.address, lead.city, lead.zip].filter(Boolean).join(", ") || "—",
        ],
        ["Utility program", UTILITY_PROGRAM_LABELS[lead.utility] ?? lead.utility],
        ["Utility account #", lead.accountNumber || "—"],
        ["Approx. HVAC units", lead.hvacUnits || "—"],
        ["Agent", lead.agentName || "—"],
      ];
      const startY = doc.y;
      doc.roundedRect(MARGIN, startY, CONTENT_W, rows.length * 19 + 16, 8)
        .fillColor("#F7F5F0")
        .fill();
      let y = startY + 10;
      for (const [k, v] of rows) {
        doc
          .font("Helvetica-Bold")
          .fontSize(9)
          .fillColor(MUTED)
          .text(k.toUpperCase(), MARGIN + 12, y, { width: 150 });
        doc
          .font("Helvetica")
          .fontSize(10)
          .fillColor(NAVY)
          .text(v, MARGIN + 170, y - 1, { width: CONTENT_W - 182 });
        y += 19;
      }
      doc.y = startY + rows.length * 19 + 28;

      // ── Terms ─────────────────────────────────────────────────────
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fillColor(NAVY)
        .text("Authorization", MARGIN, doc.y);
      doc.moveDown(0.4);
      for (const para of agreementBody(lead)) {
        doc
          .font("Helvetica")
          .fontSize(9.5)
          .fillColor(NAVY)
          .text(para, MARGIN, doc.y, {
            width: CONTENT_W,
            align: "left",
            lineGap: 2,
          });
        doc.moveDown(0.5);
      }

      // ── Signature ─────────────────────────────────────────────────
      doc.moveDown(0.6);
      const sigY = doc.y;
      doc.roundedRect(MARGIN, sigY, CONTENT_W, 108, 8)
        .lineWidth(1)
        .strokeColor(LIGHT)
        .stroke();
      try {
        const sig = opts.signaturePng;
        const ab = sig.buffer.slice(
          sig.byteOffset,
          sig.byteOffset + sig.byteLength
        );
        doc.image(ab, MARGIN + 16, sigY + 10, { fit: [260, 60] });
      } catch {
        reject(new Error("Could not embed signature image"));
        return;
      }
      doc
        .moveTo(MARGIN + 16, sigY + 76)
        .lineTo(MARGIN + 286, sigY + 76)
        .lineWidth(1)
        .strokeColor(MUTED)
        .stroke();
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor(NAVY)
        .text(opts.signedName, MARGIN + 16, sigY + 82);
      doc
        .font("Helvetica")
        .fontSize(8.5)
        .fillColor(MUTED)
        .text("Authorized signature", MARGIN + 16, sigY + 94);
      doc
        .font("Helvetica")
        .fontSize(9)
        .fillColor(NAVY)
        .text(`Signed: ${fmtDateTime(opts.signedAtIso)} ET`, MARGIN + 320, sigY + 78, {
          width: CONTENT_W - 336,
        });

      // ── Audit footer ──────────────────────────────────────────────
      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor(MUTED)
        .text(
          `Electronically signed via MSE Field. Reference ${lead.leadId} · token ${lead.signToken} · IP ${opts.signerIp || "unknown"} · ${opts.signedAtIso}`,
          MARGIN,
          720,
          { width: CONTENT_W, align: "center" }
        );

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}
