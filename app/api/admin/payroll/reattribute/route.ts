import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { getPayrollPeriod } from "@/lib/data/payroll-periods";
import { createReattribution } from "@/lib/data/payroll-adjustments";

// POST /api/admin/payroll/reattribute
// Body: { periodId, fromTech, toTech, amount, description,
//         relatedDispatchId, relatedUnitId }
// Creates a paired -X / +X adjustment so the unit's pay shifts
// from one tech to another within the period.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  let body: {
    periodId?: unknown;
    fromTech?: unknown;
    toTech?: unknown;
    amount?: unknown;
    description?: unknown;
    relatedDispatchId?: unknown;
    relatedUnitId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const periodId = String(body.periodId ?? "").trim();
  const fromTech = String(body.fromTech ?? "").trim();
  const toTech = String(body.toTech ?? "").trim();
  const amount = Number(body.amount);
  const description = String(body.description ?? "").trim();
  const relatedDispatchId = String(body.relatedDispatchId ?? "").trim();
  const relatedUnitId = String(body.relatedUnitId ?? "").trim();

  if (!periodId) {
    return NextResponse.json({ error: "periodId required" }, { status: 400 });
  }
  if (!fromTech || !toTech) {
    return NextResponse.json(
      { error: "fromTech and toTech required" },
      { status: 400 }
    );
  }
  if (fromTech === toTech) {
    return NextResponse.json(
      { error: "fromTech and toTech must differ" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 }
    );
  }

  const period = await getPayrollPeriod(periodId);
  if (!period) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }
  if (period.status !== "Draft") {
    return NextResponse.json(
      { error: "Unlock the period to Draft before reattributing" },
      { status: 409 }
    );
  }

  try {
    const result = await createReattribution({
      periodId,
      fromTech,
      toTech,
      amount,
      description:
        description ||
        `Reattributed ${amount.toFixed(2)} from ${fromTech} to ${toTech}`,
      relatedDispatchId,
      relatedUnitId,
      createdBy: guard.session.name,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[payroll/reattribute POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
