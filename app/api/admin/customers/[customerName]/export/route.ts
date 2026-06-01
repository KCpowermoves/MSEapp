import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import {
  buildCustomerReport,
  buildCustomerReportCsv,
} from "@/lib/customer-report";
import { buildCustomerReportPdf } from "@/lib/customer-report-pdf";

// GET /api/admin/customers/[customerName]/export?format=pdf|csv
//
// Branded per-customer rollup. The PDF mirrors the commission report
// look (logo, gold band, navy summary cards) so the two artifacts
// feel like siblings. CSV is unit-level for QuickBooks / Excel use.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Customer reports pull every job + dispatch + unit for a customer
// and fetch a Drive image per cover/nameplate/grid thumb. 60s of
// headroom handles a high-volume property (multiple sites, dozens of
// units) without tripping the Vercel function ceiling.
export const maxDuration = 60;

function slugify(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 96) || "customer";
}

export async function GET(
  request: Request,
  { params }: { params: { customerName: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const customerName = decodeURIComponent(params.customerName);
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "pdf").toLowerCase();

  const report = await buildCustomerReport(customerName);
  if (!report) {
    return NextResponse.json(
      { error: "No active jobs found for this customer." },
      { status: 404 }
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const baseName = `customer_${slugify(report.customerName)}_${stamp}`;

  try {
    if (format === "csv") {
      const csv = buildCustomerReportCsv(report);
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

    const pdf = await buildCustomerReportPdf(report);
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
    console.error("[customer/export GET] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
