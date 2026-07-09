import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import { getJob, setJobClientPaid } from "@/lib/data/jobs";
import { logPayrollAction } from "@/lib/data/payroll-log";

// POST /api/admin/jobs/[jobId]/client-paid
// Body: { paid: boolean }
//
// Records (or clears) the client's payment to MSE on a job. Marking a
// job Client Paid unlocks the crew's deferred second-half pay for
// release approval on /admin/payroll/releases.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { jobId: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;

  const jobId = decodeURIComponent(params.jobId);
  const job = await getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  let body: { paid?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  const paid = Boolean(body.paid);

  try {
    await setJobClientPaid({ jobId, paid, markedBy: guard.session.name });
    await logPayrollAction({
      admin: guard.session.name,
      action: "adjustment-create",
      periodId: "",
      target: jobId,
      detail: paid
        ? `CLIENT PAID marked on ${jobId} (${job.customerName}) — deferred pay now ready for release`
        : `CLIENT PAID cleared on ${jobId} (${job.customerName})`,
    });
    revalidatePath("/admin/payroll/releases");
    revalidatePath("/admin/customers");
    return NextResponse.json({ ok: true, paid });
  } catch (e) {
    console.error("[client-paid POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
