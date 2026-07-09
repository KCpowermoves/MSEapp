import { NextResponse } from "next/server";
import { ensureWeeklyPeriod } from "@/lib/data/payroll-periods";
import { logPayrollAction } from "@/lib/data/payroll-log";

// GET /api/cron/weekly-period
//
// Fires every Monday 10:00 UTC (see vercel.json) and creates the
// PRIOR Mon–Sun week's payroll period as a Draft, labeled with its
// pay-Thursday. Idempotent — an existing period for that exact week
// is returned untouched, so re-runs and manual triggers are safe.
//
// Auth: Vercel cron invocations carry an Authorization header when
// CRON_SECRET is set in the project env (recommended). Until that's
// configured we accept Vercel's x-vercel-cron marker header so the
// schedule works out of the box.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization") ?? "";
  const isVercelCron = Boolean(request.headers.get("x-vercel-cron"));
  const authorized = secret
    ? auth === `Bearer ${secret}`
    : isVercelCron;
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // "Last week": today is Monday, so anchor on yesterday (Sunday).
    // An explicit ?anchor=YYYY-MM-DD overrides — used for backfilling
    // a specific week's period.
    const url = new URL(request.url);
    const anchorParam = url.searchParams.get("anchor") ?? "";
    const anchor = /^\d{4}-\d{2}-\d{2}$/.test(anchorParam)
      ? anchorParam
      : new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { period, created } = await ensureWeeklyPeriod({
      anchorIso: anchor,
      createdBy: "auto (Monday cron)",
    });
    if (created) {
      await logPayrollAction({
        admin: "system",
        action: "period-create",
        periodId: period.periodId,
        detail: `auto-created weekly period ${period.startDate} to ${period.endDate} (${period.note})`,
      });
    }
    return NextResponse.json({
      ok: true,
      created,
      periodId: period.periodId,
      startDate: period.startDate,
      endDate: period.endDate,
    });
  } catch (e) {
    console.error("[cron/weekly-period] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cron failed" },
      { status: 500 }
    );
  }
}
