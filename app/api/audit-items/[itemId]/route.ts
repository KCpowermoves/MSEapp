import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import {
  getAuditItem,
  setAuditItemField,
  setAuditItemStatus,
} from "@/lib/data/audit-items";
import { getJob, techCanAccessJob } from "@/lib/data/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Subtype, label, notes are tech-editable. Photo URLs are written via
// /api/upload (see Phase 4). itemNumber is tech-editable for the
// orphan/revive flow. Status is admin-edit only.
const PATCHABLE_FIELDS = [
  "itemSubtype",
  "itemNumber",
  "label",
  "notes",
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: { itemId: string } }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const itemId = decodeURIComponent(params.itemId);
  const item = await getAuditItem(itemId);
  if (!item) return NextResponse.json({ error: "AuditItem not found" }, { status: 404 });

  const job = await getJob(item.jobId);
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
      await setAuditItemField({
        itemId,
        field,
        value: typeof raw === "number" ? raw : String(raw),
      });
    }
    revalidatePath(`/jobs/${item.jobId}`);
    revalidatePath(`/jobs/${item.jobId}/audit`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[audit-items PATCH] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { itemId: string } }
) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  // Soft-delete: mark Orphaned. True deletion is admin Sheet-side only
  // (no UI in v1 — see the spec's "Out of scope" section).
  const itemId = decodeURIComponent(params.itemId);
  const item = await getAuditItem(itemId);
  if (!item) return NextResponse.json({ error: "AuditItem not found" }, { status: 404 });

  const job = await getJob(item.jobId);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const canAccess = await techCanAccessJob({
    job,
    techName: session.name ?? "",
    isAdmin: session.isAdmin === true,
  });
  if (!canAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    await setAuditItemStatus({ itemId, status: "Orphaned" });
    revalidatePath(`/jobs/${item.jobId}`);
    revalidatePath(`/jobs/${item.jobId}/audit`);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[audit-items DELETE] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
