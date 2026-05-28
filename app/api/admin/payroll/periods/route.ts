import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { createPayrollPeriod } from "@/lib/data/payroll-periods";

// POST /api/admin/payroll/periods
// Creates a new Draft payroll period with a start/end date range.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

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

  const startDate = String(body.startDate ?? "").trim();
  const endDate = String(body.endDate ?? "").trim();
  const label = String(body.label ?? "").trim();
  const note = String(body.note ?? "").trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    return NextResponse.json({ error: "endDate must be YYYY-MM-DD" }, { status: 400 });
  }
  if (endDate < startDate) {
    return NextResponse.json(
      { error: "endDate must be on or after startDate" },
      { status: 400 }
    );
  }

  try {
    const period = await createPayrollPeriod({
      startDate,
      endDate,
      label,
      note,
      createdBy: guard.session.name,
    });
    return NextResponse.json({ ok: true, period });
  } catch (e) {
    console.error("[payroll/periods POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
