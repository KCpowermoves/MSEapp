import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/payroll/auth";
import {
  getEngineeringProject,
  updateEngineeringProject,
} from "@/lib/data/engineering-projects";
import {
  createFolder,
  getRootFolderId,
  uploadFile,
} from "@/lib/google/drive";
import { nowIso } from "@/lib/utils";
import type {
  EngineeringDocument,
  EngineeringDocumentKind,
} from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VALID_KINDS: EngineeringDocumentKind[] = [
  "utility-bill",
  "hvac-nameplate",
  "walkin-nameplate",
  "other",
];

function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 96) || "project";
}

async function ensureProjectFolder(project: {
  projectId: string;
  customerName: string;
  driveFolderId: string;
  driveFolderUrl: string;
}): Promise<{ folderId: string; folderUrl: string }> {
  if (project.driveFolderId) {
    return {
      folderId: project.driveFolderId,
      folderUrl: project.driveFolderUrl,
    };
  }
  const rootFolderId = getRootFolderId();
  const folderName = `ENG-${slug(project.customerName || project.projectId)}-${project.projectId}`;
  const folder = await createFolder(folderName, rootFolderId);
  return { folderId: folder.id, folderUrl: folder.url };
}

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  const { session } = guard;
  const id = decodeURIComponent(params.id);

  const project = await getEngineeringProject(id);
  if (!project)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const formData = await request.formData().catch(() => null);
  if (!formData)
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const file = formData.get("file");
  const kind = String(formData.get("kind") ?? "") as EngineeringDocumentKind;

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!VALID_KINDS.includes(kind)) {
    return NextResponse.json({ error: "Invalid document kind" }, { status: 400 });
  }

  try {
    // Ensure a project-scoped Drive folder exists (creates lazily).
    const { folderId, folderUrl } = await ensureProjectFolder(project);
    if (!project.driveFolderId) {
      await updateEngineeringProject({
        projectId: id,
        driveFolderId: folderId,
        driveFolderUrl: folderUrl,
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || "application/octet-stream";
    const cleanName = file.name.replace(/[/\\?%*:|"<>]/g, "-");
    const filename = `${kind}_${Date.now()}_${cleanName}`;
    const uploaded = await uploadFile({
      folderId,
      filename,
      mimeType,
      body: buffer,
    });

    const doc: EngineeringDocument = {
      fileId: uploaded.id,
      url: uploaded.url,
      name: file.name,
      kind,
      uploadedAt: nowIso(),
      uploadedBy: session.name ?? "",
      // OCR flows kick off separately from a different endpoint. "other"
      // never runs OCR; the three data-carrying kinds start at pending.
      ocrStatus: kind === "other" ? "skip" : "pending",
    };

    const fresh = await getEngineeringProject(id, { fresh: true });
    const documents = [...(fresh?.documents ?? []), doc];
    await updateEngineeringProject({ projectId: id, documents });

    revalidatePath(`/admin/engineering/${id}`);
    return NextResponse.json({ document: doc });
  } catch (e) {
    console.error("[engineering upload] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
