import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { getPayrollPeriod } from "@/lib/data/payroll-periods";
import {
  listAllPayrollAdjustments,
  updateAdjustmentLinkage,
} from "@/lib/data/payroll-adjustments";
import { logPayrollAction } from "@/lib/data/payroll-log";

// POST /api/admin/payroll/adjustments/link
// Body: { adjustmentId, relatedDispatchId, relatedUnitId? }
// Re-link an existing adjustment to a different (or first) dispatch.
// Used by the commission report's "Set site for this adjustment"
// affordance — admin clicks a Job cell on an adjustment row, picks a
// dispatch from the period, this endpoint stamps it.
//
// Period must still be Draft. Amount + description + audit columns
// stay frozen; only relatedDispatchId / relatedUnitId / relatedTech
// can move.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  let body: {
    adjustmentId?: unknown;
    relatedDispatchId?: unknown;
    relatedUnitId?: unknown;
    relatedTech?: unknown;
  };
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
      { error: "Unlock the period to Draft before re-linking adjustments" },
      { status: 409 }
    );
  }

  // String-ify each updatable field as undefined-or-string so the
  // helper only touches what the caller actually sent.
  const relatedDispatchId =
    body.relatedDispatchId !== undefined
      ? String(body.relatedDispatchId ?? "").trim()
      : undefined;
  const relatedUnitId =
    body.relatedUnitId !== undefined
      ? String(body.relatedUnitId ?? "").trim()
      : undefined;
  const relatedTech =
    body.relatedTech !== undefined
      ? String(body.relatedTech ?? "").trim()
      : undefined;

  try {
    await updateAdjustmentLinkage({
      adjustmentId,
      relatedDispatchId,
      relatedUnitId,
      relatedTech,
    });
    await logPayrollAction({
      admin: guard.session.name,
      action: "adjustment-link",
      periodId: adj.periodId,
      target: adjustmentId,
      detail: `re-linked: dispatch=${relatedDispatchId ?? "(unchanged)"} unit=${relatedUnitId ?? "(unchanged)"} tech=${relatedTech ?? "(unchanged)"}`,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[adjustments/link] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
