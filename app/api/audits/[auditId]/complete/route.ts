import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { getAudit, setAuditStatus } from "@/lib/data/audits";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: { auditId: string } }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const auditId = decodeURIComponent(params.auditId);
  const audit = await getAudit(auditId);
  if (!audit) return NextResponse.json({ error: "Audit not found" }, { status: 404 });

  const job = await getJob(audit.jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    await setAuditStatus({
      auditId,
      status: "Complete",
      byTechName: session.name ?? "",
    });
    revalidatePath(`/jobs/${audit.jobId}`);
    revalidatePath(`/jobs/${audit.jobId}/audit`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[audits/complete] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
