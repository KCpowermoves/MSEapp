import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import {
  getEngineeringProject,
  updateEngineeringProject,
} from "@/lib/data/engineering-projects";
import { nowIso } from "@/lib/utils";
import {
  ocrEngineeringDocument,
  engineeringOcrConfigured,
  type OcrKind,
} from "@/lib/engineering/nameplate-ocr";
import type { EngineeringDocumentKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const OCR_KINDS: OcrKind[] = [
  "utility-bill",
  "hvac-nameplate",
  "walkin-nameplate",
];

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  const id = decodeURIComponent(params.id);

  const project = await getEngineeringProject(id);
  if (!project)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body)
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const fileId = String(body.fileId ?? "").trim();
  const kind = String(body.kind ?? "") as EngineeringDocumentKind;
  if (!fileId)
    return NextResponse.json({ error: "Missing fileId" }, { status: 400 });
  if (!OCR_KINDS.includes(kind as OcrKind)) {
    return NextResponse.json(
      { error: "OCR not supported for this kind" },
      { status: 400 }
    );
  }

  const doc = project.documents.find((d) => d.fileId === fileId);
  if (!doc)
    return NextResponse.json(
      { error: "Document not found on project" },
      { status: 404 }
    );

  if (!engineeringOcrConfigured()) {
    return NextResponse.json({ error: "OCR not configured" }, { status: 503 });
  }

  try {
    const { result, summary } = await ocrEngineeringDocument(
      fileId,
      kind as OcrKind
    );
    await markDocStatus(id, fileId, "ok", summary);
    revalidatePath(`/admin/engineering/${id}`);
    return NextResponse.json({ ok: true, result, summary });
  } catch (e) {
    console.error("[engineering ocr] failed:", e);
    const message = e instanceof Error ? e.message : "OCR error";
    await markDocStatus(id, fileId, "failed", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function markDocStatus(
  projectId: string,
  fileId: string,
  status: "ok" | "failed",
  summary: string
): Promise<void> {
  const fresh = await getEngineeringProject(projectId, { fresh: true });
  if (!fresh) return;
  const documents = fresh.documents.map((d) =>
    d.fileId === fileId
      ? {
          ...d,
          ocrStatus: status,
          ocrExtractedAt: nowIso(),
          ...(status === "ok"
            ? { ocrSummary: summary }
            : { ocrError: summary }),
        }
      : d
  );
  await updateEngineeringProject({ projectId, documents });
}
