import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { computePayrollReport } from "@/lib/payroll/compute";

// GET /api/admin/payroll/preview?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Computes a payroll report for any date range WITHOUT saving a
// period. Used by the dashboard's live-preview panel so the admin
// can see what a range would total before committing to a period.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const url = new URL(request.url);
  const start = url.searchParams.get("start") ?? "";
  const end = url.searchParams.get("end") ?? "";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return NextResponse.json(
      { error: "start must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) {
    return NextResponse.json(
      { error: "end must be YYYY-MM-DD" },
      { status: 400 }
    );
  }
  if (end < start) {
    return NextResponse.json(
      { error: "end must be on or after start" },
      { status: 400 }
    );
  }

  try {
    const report = await computePayrollReport({
      startDate: start,
      endDate: end,
    });
    return NextResponse.json({
      ok: true,
      startDate: report.startDate,
      endDate: report.endDate,
      grandTotal: report.grandTotal,
      attributionLineCount: report.attributionLineCount,
      adjustmentLineCount: report.adjustmentLineCount,
      techs: report.techs.map((t) => ({
        techName: t.techName,
        grandTotal: t.grandTotal,
      })),
    });
  } catch (e) {
    console.error("[payroll/preview GET] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
