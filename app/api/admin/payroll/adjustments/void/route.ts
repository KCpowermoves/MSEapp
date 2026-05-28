import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { getPayrollPeriod } from "@/lib/data/payroll-periods";
import {
  listAllPayrollAdjustments,
  voidAdjustment,
} from "@/lib/data/payroll-adjustments";

// POST /api/admin/payroll/adjustments/void
// Body: { adjustmentId }
// Zeroes the amount + stamps the row as voided. Audit-preserving
// alternative to deletion. Period must be Draft.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  let body: { adjustmentId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const adjustmentId = String(body.adjustmentId ?? "").trim();
  if (!adjustmentId) {
    return NextResponse.json(
      { error: "adjustmentId required" },
      { status: 400 }
    );
  }

  const all = await listAllPayrollAdjustments();
  const adj = all.find((a) => a.adjustmentId === adjustmentId);
  if (!adj) {
    return NextResponse.json(
      { error: "Adjustment not found" },
      { status: 404 }
    );
  }
  const period = await getPayrollPeriod(adj.periodId);
  if (!period) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }
  if (period.status !== "Draft") {
    return NextResponse.json(
      { error: "Unlock the period to Draft before voiding adjustments" },
      { status: 409 }
    );
  }

  try {
    await voidAdjustment(adjustmentId, guard.session.name);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[payroll/adjustments void POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
