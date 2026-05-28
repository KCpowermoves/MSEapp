import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import {
  getPayrollPeriod,
  setPayrollPeriodStatus,
} from "@/lib/data/payroll-periods";
import type { PayrollStatus } from "@/lib/types";

// POST /api/admin/payroll/periods/[periodId]/status
// Transitions a period through Draft → Approved → Paid (and Unlock,
// which sends it back to Draft and clears prior approvals).
// Stricter transitions enforced server-side so the UI buttons can't
// fast-forward past states by accident.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: Record<PayrollStatus, PayrollStatus[]> = {
  Draft: ["Approved"],
  Approved: ["Paid", "Draft"], // Draft = Unlock
  Paid: ["Draft"], // Paid → Draft also unlocks; rare but valid
};

export async function POST(
  request: Request,
  { params }: { params: { periodId: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const periodId = decodeURIComponent(params.periodId);
  const period = await getPayrollPeriod(periodId);
  if (!period) {
    return NextResponse.json({ error: "Period not found" }, { status: 404 });
  }

  let body: { status?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const next = String(body.status ?? "") as PayrollStatus;
  if (!["Draft", "Approved", "Paid"].includes(next)) {
    return NextResponse.json(
      { error: "status must be Draft, Approved, or Paid" },
      { status: 400 }
    );
  }
  if (!ALLOWED[period.status].includes(next)) {
    return NextResponse.json(
      {
        error: `Cannot transition from ${period.status} to ${next}`,
      },
      { status: 409 }
    );
  }

  try {
    await setPayrollPeriodStatus(periodId, next, guard.session.name);
    return NextResponse.json({ ok: true, status: next });
  } catch (e) {
    console.error("[payroll/periods status POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
