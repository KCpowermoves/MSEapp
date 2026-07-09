import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import { computeDeferralLedger, JOB_MARKER } from "@/lib/payroll/deferrals";
import { ensureWeeklyPeriod } from "@/lib/data/payroll-periods";
import { createAdjustment } from "@/lib/data/payroll-adjustments";
import { logPayrollAction } from "@/lib/data/payroll-log";
import { todayIsoDate } from "@/lib/utils";

// GET  /api/admin/payroll/releases            → the deferral ledger
// POST /api/admin/payroll/releases            → approve releases
//   Body: { entries: [{ techName, jobId }] }
//
// Approving writes one "deferred_release" adjustment per (tech, job)
// for that pair's full remaining amount, into the weekly period that
// covers TODAY — so it rides the next Thursday pay report. The period
// is created on demand if the Monday cron hasn't made it yet.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  try {
    const ledger = await computeDeferralLedger();
    return NextResponse.json(ledger);
  } catch (e) {
    console.error("[releases GET] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  let body: { entries?: Array<{ techName?: unknown; jobId?: unknown }> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const requested = (body.entries ?? [])
    .map((e) => ({
      techName: String(e.techName ?? "").trim(),
      jobId: String(e.jobId ?? "").trim(),
    }))
    .filter((e) => e.techName && e.jobId);
  if (requested.length === 0) {
    return NextResponse.json(
      { error: "entries required: [{ techName, jobId }]" },
      { status: 400 }
    );
  }

  try {
    // Recompute the ledger server-side — amounts come from HERE, never
    // from the client, so a stale page can't over-release.
    const ledger = await computeDeferralLedger();

    // Target period: the weekly period covering today (created on
    // demand). Releases fold into its Thursday report.
    const { period } = await ensureWeeklyPeriod({
      anchorIso: todayIsoDate(),
      createdBy: guard.session.name,
    });
    if (period.status !== "Draft") {
      return NextResponse.json(
        {
          error: `This week's period (${period.periodId}) is ${period.status} — unlock it to Draft before approving releases`,
        },
        { status: 409 }
      );
    }

    const results: Array<{
      techName: string;
      jobId: string;
      amount: number;
      skipped?: string;
    }> = [];

    for (const req of requested) {
      const entry = ledger.entries.find(
        (e) => e.techName === req.techName && e.jobId === req.jobId
      );
      if (!entry) {
        results.push({ ...req, amount: 0, skipped: "no deferral found" });
        continue;
      }
      if (entry.remaining < 0.01) {
        results.push({ ...req, amount: 0, skipped: "already fully released" });
        continue;
      }
      if (!entry.clientPaidAt) {
        results.push({ ...req, amount: 0, skipped: "client not marked paid" });
        continue;
      }
      const adjustment = await createAdjustment({
        periodId: period.periodId,
        techName: entry.techName,
        type: "deferred_release",
        amount: entry.remaining,
        description: `2nd-half release — ${entry.customerName} (client paid)`,
        relatedDispatchId: "",
        relatedUnitId: "",
        note: `${JOB_MARKER(entry.jobId)} earned ${entry.earned.toFixed(2)} across ${entry.weeks.join("; ")}`,
        createdBy: guard.session.name,
      });
      await logPayrollAction({
        admin: guard.session.name,
        action: "adjustment-create",
        periodId: period.periodId,
        target: adjustment.adjustmentId,
        detail: `RELEASE approved: $${entry.remaining.toFixed(2)} to ${entry.techName} for ${entry.jobId} (${entry.customerName})`,
      });
      results.push({
        techName: entry.techName,
        jobId: entry.jobId,
        amount: entry.remaining,
      });
    }

    revalidatePath("/admin/payroll/releases");
    revalidatePath(`/admin/payroll/${period.periodId}`);
    const released = results.filter((r) => !r.skipped);
    return NextResponse.json({
      ok: true,
      targetPeriodId: period.periodId,
      releasedCount: released.length,
      releasedTotal: released.reduce((s, r) => s + r.amount, 0),
      results,
    });
  } catch (e) {
    console.error("[releases POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
