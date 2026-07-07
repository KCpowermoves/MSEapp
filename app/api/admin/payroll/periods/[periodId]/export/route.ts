import { NextResponse } from "next/server";
import JSZip from "jszip";
import { requireAdmin } from "@/lib/payroll/auth";
import { getPayrollPeriod } from "@/lib/data/payroll-periods";
import { computePayrollReport, computeYtdByTech } from "@/lib/payroll/compute";
import { buildPayrollPdf } from "@/lib/payroll-pdf";
import { buildPayrollCsv } from "@/lib/payroll/csv";

// GET /api/admin/payroll/periods/[periodId]/export?format=pdf|csv|zip[&tech=Name]
//
// Returns the export as a downloadable binary. PDF is rendered with
// the MSE logo, gold accents, and the same brand palette as the
// service report. CSV is flat data, one row per line item, suitable
// for QuickBooks or Gusto import. ZIP bundles one PDF per tech for
// easy mass-distribution — admin clicks once and gets a folder full
// of individually addressable invoices.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// ZIP-of-PDFs is slower than a single PDF (one PDFKit render per tech,
// each with its own Drive nameplate fetches). 60s gives us headroom on
// Vercel's serverless function ceiling for an 8-tech crew.
export const maxDuration = 60;

function slugify(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 64) || "payroll";
}

export async function GET(
  request: Request,
  { params }: { params: { periodId: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const periodId = decodeURIComponent(params.periodId);
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "pdf").toLowerCase();
  const techNameFilter = url.searchParams.get("tech") ?? undefined;

  const period = await getPayrollPeriod(periodId);
  if (!period) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }

  try {
    const report = await computePayrollReport({
      periodId,
      startDate: period.startDate,
      endDate: period.endDate,
    });

    // YTD line for pay stubs: everything already Paid/Closed this
    // calendar year, excluding this period (its own total is added on
    // top at render time so Draft exports still show a correct YTD).
    const ytdByTech = await computeYtdByTech({
      year: period.startDate.slice(0, 4),
      excludePeriodId: periodId,
    }).catch(() => undefined);

    const baseName = `payroll_${slugify(periodId)}_${period.startDate}_to_${period.endDate}${
      techNameFilter ? `_${slugify(techNameFilter)}` : ""
    }`;

    if (format === "csv") {
      const csv = buildPayrollCsv({ report, techNameFilter });
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${baseName}.csv"`,
          "Cache-Control": "no-store",
        },
      });
    }

    if (format === "zip") {
      // One PDF per tech in a single ZIP. Each file inside the archive
      // is filtered to that tech's data only — this matches what each
      // tech sees on their own self-view download, so admin can hand
      // them out individually without leaking the rest of the crew's
      // totals. Honors ?tech= by narrowing to just that name.
      const techs = techNameFilter
        ? report.techs.filter((t) => t.techName === techNameFilter)
        : report.techs;
      if (techs.length === 0) {
        return NextResponse.json(
          { error: "No tech activity in this period to ZIP." },
          { status: 404 }
        );
      }
      const zip = new JSZip();
      // Render PDFs in parallel — each call has its own Drive nameplate
      // fetches, but they're capped by Node's HTTP agent and the cost
      // is dominated by PDFKit assembly, not Drive latency.
      const renders = await Promise.all(
        techs.map(async (t) => {
          const pdf = await buildPayrollPdf({
            report,
            techNameFilter: t.techName,
            ytdByTech,
          });
          return { techName: t.techName, pdf };
        })
      );
      for (const { techName, pdf } of renders) {
        const safeName = slugify(techName);
        const filename = `${safeName}_${period.startDate}_to_${period.endDate}.pdf`;
        zip.file(filename, pdf);
      }
      const zipBuf = await zip.generateAsync({
        type: "nodebuffer",
        // PDFs are already compressed — STORE is faster and the size
        // difference vs DEFLATE is negligible.
        compression: "STORE",
      });
      return new Response(new Blob([zipBuf as unknown as BlobPart]), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${baseName}.zip"`,
          "Content-Length": String(zipBuf.length),
          "Cache-Control": "no-store",
        },
      });
    }

    if (format !== "pdf") {
      return NextResponse.json(
        { error: "format must be pdf, csv, or zip" },
        { status: 400 }
      );
    }

    const pdf = await buildPayrollPdf({ report, techNameFilter, ytdByTech });
    // Wrap Buffer in a Blob so the DOM-types Response constructor
    // accepts the body without a TS widening drama. Cheap on Node 18+.
    return new Response(new Blob([pdf as unknown as BlobPart]), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${baseName}.pdf"`,
        "Content-Length": String(pdf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[payroll/export GET] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
