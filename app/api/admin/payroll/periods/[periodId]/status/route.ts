import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import {
  getPayrollPeriod,
  setPayrollPeriodStatus,
} from "@/lib/data/payroll-periods";
import { logPayrollAction } from "@/lib/data/payroll-log";
import type { PayrollStatus } from "@/lib/types";

// POST /api/admin/payroll/periods/[periodId]/status
// Transitions a period through Draft → Approved → Paid → Closed (and
// Unlock, which sends it back to Draft and clears prior approvals).
// Stricter transitions enforced server-side so the UI buttons can't
// fast-forward past states by accident.
//
// Closed is the hard lock: reopening (Closed → Draft) requires a typed
// justification, which lands in the Payroll Log alongside every other
// status change.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED: Record<PayrollStatus, PayrollStatus[]> = {
  Draft: ["Approved"],
  Approved: ["Paid", "Draft"], // Draft = Unlock
  Paid: ["Draft", "Closed"],   // Draft = unlock for quick fixes; Closed = lock the books
  Closed: ["Draft"],           // reopen — requires justification
};

const VALID_STATUSES: PayrollStatus[] = ["Draft", "Approved", "Paid", "Closed"];

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

  let body: { status?: unknown; justification?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const next = String(body.status ?? "") as PayrollStatus;
  const justification = String(body.justification ?? "").trim();

  if (!VALID_STATUSES.includes(next)) {
    return NextResponse.json(
      { error: `status must be one of: ${VALID_STATUSES.join(", ")}` },
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

  const isReopen = period.status === "Closed" && next === "Draft";
  if (isReopen && justification.length < 10) {
    return NextResponse.json(
      {
        error:
          "Reopening a closed period requires a justification (at least 10 characters)",
      },
      { status: 400 }
    );
  }

  try {
    await setPayrollPeriodStatus(periodId, next, guard.session.name);
    await logPayrollAction({
      admin: guard.session.name,
      action: isReopen ? "period-reopen" : "status-change",
      periodId,
      detail: `${period.status} → ${next}`,
      justification: isReopen ? justification : undefined,
    });
    return NextResponse.json({ ok: true, status: next });
  } catch (e) {
    console.error("[payroll/periods status POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
