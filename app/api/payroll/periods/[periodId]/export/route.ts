import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPayrollPeriod } from "@/lib/data/payroll-periods";
import { computePayrollReport } from "@/lib/payroll/compute";
import { buildPayrollPdf } from "@/lib/payroll-pdf";
import { buildPayrollCsv } from "@/lib/payroll/csv";

// GET /api/payroll/periods/[periodId]/export?format=pdf|csv
//
// Tech-facing export. Requires an authenticated session and filters
// the report to the requester's own data only. Drafts are blocked so
// techs only ever download approved or paid versions.

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
  const session = await getSession();
  if (!session.techId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const techName = session.name ?? "";

  const periodId = decodeURIComponent(params.periodId);
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "pdf").toLowerCase();

  const period = await getPayrollPeriod(periodId);
  if (!period) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }
  if (period.status === "Draft") {
    return NextResponse.json(
      { error: "Draft periods are admin-only" },
      { status: 403 }
    );
  }

  try {
    const report = await computePayrollReport({
      periodId,
      startDate: period.startDate,
      endDate: period.endDate,
    });

    // Confirm the tech actually has data in this period before
    // generating a file. Saves a wasted download.
    const hasActivity = report.techs.some((t) => t.techName === techName);
    if (!hasActivity) {
      return NextResponse.json(
        { error: "No activity for you in this period" },
        { status: 404 }
      );
    }

    const baseName = `payroll_${slugify(periodId)}_${period.startDate}_to_${period.endDate}_${slugify(
      techName
    )}`;

    if (format === "csv") {
      const csv = buildPayrollCsv({ report, techNameFilter: techName });
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
    const pdf = await buildPayrollPdf({ report, techNameFilter: techName });
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
    console.error("[tech payroll export GET] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
