import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { listActiveJobs } from "@/lib/data/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Search active jobs by customer name for the "Link job" picker.
 *
 * GET /api/admin/engineering/jobs-search?q=mango
 */
export async function GET(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";

  const all = await listActiveJobs();
  const matches = (
    q === ""
      ? all
      : all.filter(
          (j) =>
            j.customerName.toLowerCase().includes(q) ||
            j.siteAddress.toLowerCase().includes(q) ||
            j.jobId.toLowerCase().includes(q)
        )
  ).slice(0, 20);
  return NextResponse.json({
    jobs: matches.map((j) => ({
      jobId: j.jobId,
      customerName: j.customerName,
      siteAddress: j.siteAddress,
      utility: j.utilityTerritory,
      status: j.status,
    })),
  });
}
