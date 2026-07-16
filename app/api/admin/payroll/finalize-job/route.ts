import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import { getJob, setJobFinalized } from "@/lib/data/jobs";
import { ensureWeeklyPeriod } from "@/lib/data/payroll-periods";
import { createAdjustment } from "@/lib/data/payroll-adjustments";
import { logPayrollAction } from "@/lib/data/payroll-log";
import { JOB_MARKER } from "@/lib/payroll/deferrals";
import { todayIsoEastern } from "@/lib/utils";

// POST /api/admin/payroll/finalize-job
//
// Force-finalize a job off the payroll worklist. Two modes:
//
//  - "adjust": write one or more corrective manual adjustments (e.g.
//    paying a unit whose photos never landed) into the weekly period
//    covering TODAY — same landing rule as second-half releases, so
//    late money always rides the next pay report and never mutates an
//    already-approved week. Then stamp the job finalized.
//
//  - "waive": no money. Admin accepts the work as-is with a required
//    reason. Stamp + audit log only.
//
// Both stamp Jobs!R/S/T; the finalization detector treats dispatches
// dated on or before the stamp as settled.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface AdjustmentInput {
  techName: string;
  amount: number;
  description: string;
}

export async function POST(request: Request) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  const admin = guard.session.name || guard.session.techId;

  let body: {
    jobId?: unknown;
    mode?: unknown;
    note?: unknown;
    adjustments?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  const jobId = String(body.jobId ?? "").trim();
  const mode = String(body.mode ?? "");
  const note = String(body.note ?? "").trim();
  if (!jobId) {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }
  if (mode !== "adjust" && mode !== "waive") {
    return NextResponse.json(
      { error: 'mode must be "adjust" or "waive"' },
      { status: 400 }
    );
  }
  if (!note) {
    return NextResponse.json(
      {
        error:
          mode === "waive"
            ? "A reason is required to wave off without pay changes."
            : "A note is required.",
      },
      { status: 400 }
    );
  }

  const job = await getJob(jobId, { fresh: true });
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  try {
    const createdAdjustmentIds: string[] = [];

    if (mode === "adjust") {
      // Validate the adjustment lines before writing anything.
      const raw = Array.isArray(body.adjustments) ? body.adjustments : [];
      const lines: AdjustmentInput[] = [];
      for (const r of raw) {
        const o = (r ?? {}) as Record<string, unknown>;
        const techName = String(o.techName ?? "").trim();
        const amount = Number(o.amount ?? 0);
        const description = String(o.description ?? "").trim();
        if (!techName) continue;
        if (!Number.isFinite(amount) || amount === 0) {
          return NextResponse.json(
            { error: `Adjustment for ${techName} needs a nonzero amount.` },
            { status: 400 }
          );
        }
        if (Math.abs(amount) > 25_000) {
          return NextResponse.json(
            { error: "Adjustment amounts are capped at $25,000 per line." },
            { status: 400 }
          );
        }
        lines.push({ techName, amount, description });
      }
      if (lines.length === 0) {
        return NextResponse.json(
          {
            error:
              "Adjust mode needs at least one adjustment line. Use wave off to finalize without pay changes.",
          },
          { status: 400 }
        );
      }

      // Land in the weekly period covering today (created on demand).
      const { period } = await ensureWeeklyPeriod({
        anchorIso: todayIsoEastern(),
        createdBy: admin,
      });
      if (period.status !== "Draft") {
        return NextResponse.json(
          {
            error: `This week's period (${period.periodId}) is ${period.status} — unlock it before adding finalize adjustments.`,
          },
          { status: 409 }
        );
      }

      for (const line of lines) {
        const adj = await createAdjustment({
          periodId: period.periodId,
          techName: line.techName,
          type: "manual",
          amount: line.amount,
          description:
            line.description ||
            `Finalize correction for ${job.customerName} (${jobId})`,
          createdBy: admin,
          note: `${JOB_MARKER(jobId)} force-finalize: ${note}`,
        });
        createdAdjustmentIds.push(adj.adjustmentId);
        await logPayrollAction({
          admin,
          action: "adjustment-create",
          periodId: period.periodId,
          target: adj.adjustmentId,
          detail: `finalize adjustment ${line.techName} $${line.amount.toFixed(2)} on ${jobId} — ${line.description || note}`,
        });
      }

      await setJobFinalized({ jobId, finalizedBy: admin, note });
      await logPayrollAction({
        admin,
        action: "finalize-adjust",
        periodId: period.periodId,
        target: jobId,
        detail: `force-finalized ${jobId} (${job.customerName}) with ${createdAdjustmentIds.length} adjustment(s): ${note}`,
      });

      revalidatePath("/admin/payroll");
      revalidatePath("/admin/payroll/worklist");
      return NextResponse.json({
        ok: true,
        mode,
        periodId: period.periodId,
        adjustmentIds: createdAdjustmentIds,
      });
    }

    // Waive: stamp + audit log, no money.
    await setJobFinalized({ jobId, finalizedBy: admin, note });
    await logPayrollAction({
      admin,
      action: "finalize-waive",
      periodId: "",
      target: jobId,
      detail: `waved off ${jobId} (${job.customerName}) without pay changes`,
      justification: note,
    });

    revalidatePath("/admin/payroll");
    revalidatePath("/admin/payroll/worklist");
    return NextResponse.json({ ok: true, mode });
  } catch (e) {
    console.error("[finalize-job] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Finalize failed" },
      { status: 500 }
    );
  }
}
