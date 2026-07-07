import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { getPayrollPeriod } from "@/lib/data/payroll-periods";
import { createAdjustment } from "@/lib/data/payroll-adjustments";
import { logPayrollAction } from "@/lib/data/payroll-log";
import type { PayrollAdjustmentType } from "@/lib/types";

// POST /api/admin/payroll/adjustments
//
// Generic adjustment creation. Used for:
//   - "manual"        : free-form +/- with note (legacy catch-all)
//   - "bonus"         : positive extra pay (performance, referral, spiff)
//   - "deduction"     : negative — advance repayment, equipment, etc.
//   - "reimbursement" : positive expense pay-back (materials, mileage)
//   - "standalone"    : free-form line for work outside the app
//
// Re-attribution and split-change get their own routes (paired writes,
// stricter validation, distinct UX).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_TYPES: PayrollAdjustmentType[] = [
  "manual",
  "bonus",
  "deduction",
  "reimbursement",
  "standalone",
];

// Typed categories carry an expected sign so a fat-fingered negative
// bonus (or positive deduction) is rejected instead of silently paid.
const SIGN_RULE: Partial<Record<PayrollAdjustmentType, "positive" | "negative">> = {
  bonus: "positive",
  reimbursement: "positive",
  deduction: "negative",
};

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  let body: {
    periodId?: unknown;
    techName?: unknown;
    type?: unknown;
    amount?: unknown;
    description?: unknown;
    note?: unknown;
    relatedDispatchId?: unknown;
    relatedUnitId?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const periodId = String(body.periodId ?? "").trim();
  const techName = String(body.techName ?? "").trim();
  const type = String(body.type ?? "manual") as PayrollAdjustmentType;
  const amount = Number(body.amount);
  const description = String(body.description ?? "").trim();

  if (!periodId) {
    return NextResponse.json({ error: "periodId required" }, { status: 400 });
  }
  if (!techName) {
    return NextResponse.json({ error: "techName required" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${ALLOWED_TYPES.join(", ")}` },
      { status: 400 }
    );
  }
  if (!Number.isFinite(amount) || amount === 0) {
    return NextResponse.json(
      { error: "amount must be a non-zero number" },
      { status: 400 }
    );
  }
  const signRule = SIGN_RULE[type];
  if (signRule === "positive" && amount < 0) {
    return NextResponse.json(
      { error: `${type} amounts must be positive` },
      { status: 400 }
    );
  }
  if (signRule === "negative" && amount > 0) {
    return NextResponse.json(
      { error: `${type} amounts must be negative (it's money withheld)` },
      { status: 400 }
    );
  }
  if (!description) {
    return NextResponse.json(
      { error: "description required" },
      { status: 400 }
    );
  }

  const period = await getPayrollPeriod(periodId);
  if (!period) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }
  if (period.status !== "Draft") {
    return NextResponse.json(
      { error: "Unlock the period to Draft before adding adjustments" },
      { status: 409 }
    );
  }

  try {
    const adjustment = await createAdjustment({
      periodId,
      techName,
      type,
      amount,
      description,
      relatedDispatchId: String(body.relatedDispatchId ?? "").trim(),
      relatedUnitId: String(body.relatedUnitId ?? "").trim(),
      note: String(body.note ?? ""),
      createdBy: guard.session.name,
    });
    await logPayrollAction({
      admin: guard.session.name,
      action: "adjustment-create",
      periodId,
      target: adjustment.adjustmentId,
      detail: `${type} ${amount >= 0 ? "+" : ""}$${amount.toFixed(2)} for ${techName}: ${description}`,
    });
    return NextResponse.json({ ok: true, adjustment });
  } catch (e) {
    console.error("[payroll/adjustments POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
