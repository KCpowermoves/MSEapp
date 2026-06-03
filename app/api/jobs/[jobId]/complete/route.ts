import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { autoFinalizeOpenDraftsForTech } from "@/lib/data/dispatches";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";

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
    // Reuse the existing helper that finalizes any open Draft dispatches
    // for this tech on this job. Same logic as the auto-finalize trigger,
    // just called explicitly with onlyJobId to scope it to this job.
    const result = await autoFinalizeOpenDraftsForTech(session.name ?? "", {
      onlyJobId: jobId,
    });
    revalidatePath(`/jobs/${jobId}`);
    revalidatePath("/jobs");
    return NextResponse.json({ ok: true, finalized: result?.finalizedCount ?? 0 });
  } catch (e) {
    console.error("[jobs/complete] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
