import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import {
  getPayrollPeriod,
  updatePayrollPeriodWindow,
} from "@/lib/data/payroll-periods";
import { logPayrollAction } from "@/lib/data/payroll-log";

// PATCH /api/admin/payroll/periods/[periodId]
// Update a Draft period's window/label/note. Approved/Paid periods are
// frozen — the admin must Unlock (POST status route below) first.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
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
  if (period.status !== "Draft") {
    return NextResponse.json(
      { error: "Unlock the period to Draft before editing" },
      { status: 409 }
    );
  }

  let body: {
    startDate?: unknown;
    endDate?: unknown;
    label?: unknown;
    note?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const patch: {
    startDate?: string;
    endDate?: string;
    label?: string;
    note?: string;
  } = {};
  if (body.startDate !== undefined) {
    const s = String(body.startDate).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return NextResponse.json(
        { error: "startDate must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    patch.startDate = s;
  }
  if (body.endDate !== undefined) {
    const s = String(body.endDate).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      return NextResponse.json(
        { error: "endDate must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    patch.endDate = s;
  }
  if (body.label !== undefined) patch.label = String(body.label);
  if (body.note !== undefined) patch.note = String(body.note);

  const newStart = patch.startDate ?? period.startDate;
  const newEnd = patch.endDate ?? period.endDate;
  if (newEnd < newStart) {
    return NextResponse.json(
      { error: "endDate must be on or after startDate" },
      { status: 400 }
    );
  }

  try {
    await updatePayrollPeriodWindow(periodId, patch);
    await logPayrollAction({
      admin: guard.session.name,
      action: "period-edit",
      periodId,
      detail: Object.entries(patch)
        .map(([k, v]) => `${k}="${v}"`)
        .join(", "),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[payroll/periods PATCH] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
