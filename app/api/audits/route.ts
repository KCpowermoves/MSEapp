import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { ensureAudit } from "@/lib/data/audits";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const jobId = String(body.jobId ?? "").trim();
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

  const job = await getJob(jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const audit = await ensureAudit({
      jobId,
      createdBy: session.name ?? "",
    });
    return NextResponse.json({ audit });
  } catch (e) {
    console.error("[audits POST] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
