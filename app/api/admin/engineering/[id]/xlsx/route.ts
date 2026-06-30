import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/payroll/auth";
import { getEngineeringProject } from "@/lib/data/engineering-projects";
import { fillCalculatorTemplate } from "@/lib/engineering/template-fill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Template open + cell writes + buffer serialize takes a few seconds
// on the 5.5MB BWI workbook. 60s ceiling for Vercel headroom.
export const maxDuration = 60;

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
    const buffer = await fillCalculatorTemplate(project);
    const baseName = `${slugify(project.customerName)}_${project.projectId}_calculator`;
    return new Response(new Blob([buffer as unknown as BlobPart]), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${baseName}.xlsx"`,
        "Content-Length": String(buffer.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[engineering/xlsx] failed:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Server error" },
      { status: 500 }
    );
  }
}
