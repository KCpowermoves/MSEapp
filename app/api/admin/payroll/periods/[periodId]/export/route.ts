import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { getPayrollPeriod } from "@/lib/data/payroll-periods";
import { computePayrollReport } from "@/lib/payroll/compute";
import { buildPayrollPdf } from "@/lib/payroll-pdf";
import { buildPayrollCsv } from "@/lib/payroll/csv";

// GET /api/admin/payroll/periods/[periodId]/export?format=pdf|csv[&tech=Name]
//
// Returns the export as a downloadable binary. PDF is rendered with
// the MSE logo, gold accents, and the same brand palette as the
// service report. CSV is flat data, one row per line item, suitable
// for QuickBooks or Gusto import.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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

    if (format !== "pdf") {
      return NextResponse.json(
        { error: "format must be pdf or csv" },
        { status: 400 }
      );
    }

    const pdf = await buildPayrollPdf({ report, techNameFilter });
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
