import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getAudit, setAuditField } from "@/lib/data/audits";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PATCHABLE_FIELDS = ["basNotes", "notes"] as const;
type PatchableField = (typeof PATCHABLE_FIELDS)[number];

export async function PATCH(
  request: Request,
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

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    for (const field of PATCHABLE_FIELDS) {
      const raw = (body as Record<string, unknown>)[field];
      if (raw === undefined) continue;
      await setAuditField({
        auditId,
        field: field as PatchableField,
        value: String(raw),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[audits PATCH] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
