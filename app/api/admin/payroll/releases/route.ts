import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import { computeDeferralLedger, JOB_MARKER } from "@/lib/payroll/deferrals";
import { ensureWeeklyPeriod } from "@/lib/data/payroll-periods";
import {
  createAdjustment,
  listAllPayrollAdjustments,
} from "@/lib/data/payroll-adjustments";
import { logPayrollAction } from "@/lib/data/payroll-log";
import { todayIsoEastern } from "@/lib/utils";

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

// Serialize approvals within this instance — two overlapping POSTs
// (double-click, two tabs) queue instead of both reading the same
// pre-write ledger and double-paying. Cross-instance approvals are
// additionally guarded by the fresh released-sum re-check below.
let approvalChain: Promise<unknown> = Promise.resolve();

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

  // Chain behind any in-flight approval on this instance.
  const run = approvalChain.then(
    () => doApprove(requested, guard.session.name),
    () => doApprove(requested, guard.session.name)
  );
  approvalChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

async function doApprove(
  requested: Array<{ techName: string; jobId: string }>,
  adminName: string
): Promise<NextResponse> {
  try {
    // Recompute the ledger server-side — amounts come from HERE, never
    // from the client, so a stale page can't over-release.
    const ledger = await computeDeferralLedger();

    // Fresh (cache-bypassed) released sums, read moments before the
    // write: if another instance already released one of these jobs
    // within the cache window, this catches it.
    const freshAdjustments = await listAllPayrollAdjustments({ fresh: true });
    const freshReleased = new Map<string, number>();
    for (const a of freshAdjustments) {
      if (a.type !== "deferred_release") continue;
      if ((a.note ?? "").trim().toUpperCase().startsWith("VOIDED")) continue;
      const m = (a.note ?? "").match(/\[job:([^\]]+)\]/);
      if (!m) continue;
      const key = `${a.techName}::${m[1]}`;
      freshReleased.set(key, (freshReleased.get(key) ?? 0) + a.amount);
    }

    // Target period: the weekly period covering today (Eastern time —
    // a Sunday-evening approval belongs to the closing week, not the
    // next UTC day's week). Created on demand; releases fold into its
    // Thursday report.
    const { period } = await ensureWeeklyPeriod({
      anchorIso: todayIsoEastern(),
      createdBy: adminName,
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
      if (!entry.clientPaidAt) {
        results.push({ ...req, amount: 0, skipped: "client not marked paid" });
        continue;
      }
      // Remaining vs the FRESH released sum — never the cached ledger.
      const freshRel =
        freshReleased.get(`${entry.techName}::${entry.jobId}`) ?? 0;
      const remaining =
        Math.round((entry.deferredOwed - freshRel) * 100) / 100;
      if (remaining < 0.01) {
        results.push({ ...req, amount: 0, skipped: "already fully released" });
        continue;
      }
      const adjustment = await createAdjustment({
        periodId: period.periodId,
        techName: entry.techName,
        type: "deferred_release",
        amount: remaining,
        description: `2nd-half release — ${entry.customerName} (client paid)`,
        relatedDispatchId: "",
        relatedUnitId: "",
        note: `${JOB_MARKER(entry.jobId)} earned ${entry.earned.toFixed(2)} across ${entry.weeks.join("; ")}`,
        createdBy: adminName,
      });
      await logPayrollAction({
        admin: adminName,
        action: "adjustment-create",
        periodId: period.periodId,
        target: adjustment.adjustmentId,
        detail: `RELEASE approved: $${remaining.toFixed(2)} to ${entry.techName} for ${entry.jobId} (${entry.customerName})`,
      });
      results.push({
        techName: entry.techName,
        jobId: entry.jobId,
        amount: remaining,
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
