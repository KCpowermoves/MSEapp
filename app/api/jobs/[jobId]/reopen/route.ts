import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  listDispatchesForJob,
  unfinalizeDispatch,
} from "@/lib/data/dispatches";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";
import { listAllPayrollPeriods } from "@/lib/data/payroll-periods";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { jobId: string } }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const jobId = decodeURIComponent(params.jobId);
  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const dispatches = await listDispatchesForJob(jobId);
    const finalized = dispatches.filter((d) => d.submittedAt);
    if (finalized.length === 0) {
      return NextResponse.json({ ok: true, note: "Nothing to reopen." });
    }

    // Approved-period guard: any finalized dispatch whose date sits
    // inside an Approved or Paid period blocks the reopen.
    const periods = await listAllPayrollPeriods();
    const blockers: { dispatchDate: string; periodId: string; periodLabel: string }[] = [];
    for (const d of finalized) {
      for (const p of periods) {
        if (p.status !== "Approved" && p.status !== "Paid") continue;
        if (p.startDate <= d.dispatchDate && d.dispatchDate <= p.endDate) {
          blockers.push({
            dispatchDate: d.dispatchDate,
            periodId: p.periodId,
            periodLabel: p.label || `${p.startDate} – ${p.endDate}`,
          });
        }
      }
    }
    if (blockers.length > 0) {
      const b = blockers[0];
      const blockingPeriod = periods.find((p) => p.periodId === b.periodId);
      return NextResponse.json(
        {
          error: `Locked — commission report ${b.periodLabel} is already ${
            blockingPeriod?.status
          }. Ask admin to unlock the period first.`,
          blockingPeriodId: b.periodId,
        },
        { status: 409 }
      );
    }

    for (const d of finalized) {
      await unfinalizeDispatch(d.dispatchId);
    }
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    return NextResponse.json({ ok: true, reopened: finalized.length });
  } catch (e) {
    console.error("[jobs/reopen] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
