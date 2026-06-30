import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { getEngineeringProject } from "@/lib/data/engineering-projects";
import { fillSowTemplate } from "@/lib/engineering/sow-fill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function slugify(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 64) || "project";
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const guard = await requireAdmin();
  if ("response" in guard) return guard.response;
  const id = decodeURIComponent(params.id);
  const project = await getEngineeringProject(id);
  if (!project)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const buffer = await fillSowTemplate(project);
    const baseName = `${slugify(project.customerName)}_${project.projectId}_sow`;
    return new Response(new Blob([buffer as unknown as BlobPart]), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${baseName}.docx"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[engineering/sow] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
