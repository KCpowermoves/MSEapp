import { NextResponse } from "next/server";
import { ensureWeeklyPeriod, mondayOf } from "@/lib/data/payroll-periods";
import { logPayrollAction } from "@/lib/data/payroll-log";
import { todayIsoEastern } from "@/lib/utils";

// GET /api/cron/weekly-period
//
// Fires every Monday 10:00 UTC (see vercel.json). Creates the PRIOR
// Mon–Sun week's payroll period as a Draft — and BACKFILLS any weeks
// missed by failed runs (up to 8 back, never before the split-pay
// epoch). Idempotent: existing periods are returned untouched.
//
// Auth: Vercel cron requests carry `Authorization: Bearer $CRON_SECRET`
// when the env var is set (recommended). Without the secret we match
// Vercel's documented cron user-agent so the schedule still works.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// No weekly periods are ever auto-created before this date — the week
// split-pay went live. Keeps the backfill loop from spamming history.
const SPLIT_PAY_EPOCH = "2026-07-06";

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(dateIso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  const ua = request.headers.get("user-agent") ?? "";
  const authorized = secret
    ? auth === `Bearer ${secret}`
    : ua.toLowerCase().includes("vercel-cron") ||
      Boolean(request.headers.get("x-vercel-cron"));
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Anchor on "yesterday" in Eastern time (an explicit ?anchor=
    // overrides for manual backfills). On a Monday-morning run this
    // lands in the prior Mon–Sun week.
    const url = new URL(request.url);
    const anchorParam = url.searchParams.get("anchor") ?? "";
    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(anchorParam)
      ? anchorParam
      : addDaysIso(todayIsoEastern(), -1);

    // Ensure the anchor week AND walk back up to 8 weeks to self-heal
    // any gaps from failed Mondays. Existing weeks are no-ops.
    const created: string[] = [];
    let primaryPeriodId = "";
    for (let weeksBack = 0; weeksBack < 8; weeksBack++) {
      const weekAnchor = addDaysIso(anchor, -7 * weeksBack);
      if (mondayOf(weekAnchor) < SPLIT_PAY_EPOCH) break;
      const { period, created: isNew } = await ensureWeeklyPeriod({
        anchorIso: weekAnchor,
        createdBy: "auto (Monday cron)",
      });
      if (weeksBack === 0) primaryPeriodId = period.periodId;
      if (isNew) {
        created.push(period.periodId);
        await logPayrollAction({
          admin: "system",
          action: "period-create",
          periodId: period.periodId,
          detail: `auto-created weekly period ${period.startDate} to ${period.endDate} (${period.note})${weeksBack > 0 ? " [gap backfill]" : ""}`,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      periodId: primaryPeriodId,
      created,
    });
  } catch (e) {
    console.error("[cron/weekly-period] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cron failed" },
      { status: 500 }
    );
  }
}
